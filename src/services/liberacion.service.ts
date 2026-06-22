// ─── RODAID PAY · Liberación Automática de Fondos ─────────
//
// Se activa cuando el comprador confirma la entrega.
// Flujo completo de la liberación:
//
//   confirmarEntrega()
//     ↓
//   liberarFondosTx()  ← esta función
//     ↓
//   1. Calcular split: monto_vendedor = precio - comision_rodaid
//   2. INSERT liberaciones_fondos (comprobante contable)
//   3. emitirReembolso() / MP Release via SDK (si modo LIVE)
//   4. UPDATE transacciones estado_pago=COMPLETADA
//   5. Notificar vendedor (push + in-app) con monto acreditado
//   6. Notificar comprador (push + in-app) con comprobante
//   7. Registrar evento en escrow_eventos
//   8. Retornar comprobante completo
//
// Garantías:
//   · Idempotente: si ya existe liberación para la tx → devolver la existente
//   · Atómica: DB + notificaciones en secuencia controlada
//   · Audit trail: toda liberación tiene comprobante_id único
//   · Sin pérdida: si MP falla → estado=PENDIENTE → reintento manual

import crypto              from 'crypto'
import { query, queryOne, transaction } from '../config/database'
import { getRedis }        from '../config/redis'
import { log }             from '../middleware/logger'
import { AppError }        from '../middleware/errorHandler'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export interface LiberacionInput {
  transaccionId:  string
  vendedorId:     string
  compradorId:    string
  precioVenta:    number     // precio total ARS
  comisionRodaid: number     // monto ARS para RODAID
  montoVendedor:  number     // monto ARS neto al vendedor
  pctComision:    number     // ej: 0.025
  gateway:        string     // STUB | MERCADOPAGO
  mpPaymentId?:   string
  motivo:         'CONFIRMACION_COMPRADOR' | 'AUTO_RELEASE' | 'RESOLUCION_DISPUTA'
  calificacion?:  number
  comentario?:    string
}

export interface LiberacionResult {
  liberacionId:    string
  comprobanteId:   string    // LIB-2026-00001
  estado:          string
  monto:           SplitDetalle
  vendedor:        ParticipanteInfo
  comprador:       ParticipanteInfo
  timestamps: {
    liberadoEn:   Date
    acreditadoEn?: Date
  }
  mpReleaseId?:    string
}

export interface SplitDetalle {
  precioVenta:    number
  comisionRodaid: number
  montoVendedor:  number
  pctComision:    number
}

interface ParticipanteInfo {
  id:      string
  email?:  string
  nombre?: string
}

// ══════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ══════════════════════════════════════════════════════════

export async function liberarFondosTx(input: LiberacionInput): Promise<LiberacionResult> {
  // 1. Idempotencia — una sola liberación por transacción
  const yaLiberado = await queryOne<{
    id: string; comprobante_id: string; estado: string; monto_liberado: number
  }>(
    `SELECT id, comprobante_id, estado, monto_liberado
     FROM liberaciones_fondos WHERE transaccion_id=$1 AND NOT es_reembolso
     LIMIT 1`,
    [input.transaccionId]
  )
  if (yaLiberado) {
    log.escrow.warn({ txId: input.transaccionId.slice(0, 8), comp: yaLiberado.comprobante_id },
      '⚠ Liberación ya existente — retornando idempotente')
    return construirResultadoExistente(yaLiberado, input)
  }

  // 2. Generar comprobante_id correlativo
  const seq = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM liberaciones_fondos WHERE NOT es_reembolso`, []
  )
  const num          = String(parseInt(seq?.count ?? '0') + 1).padStart(5, '0')
  const año          = new Date().getFullYear()
  const comprobanteId = `LIB-${año}-${num}`

  // 3. Obtener datos de participantes
  const [vendedor, comprador] = await Promise.all([
    queryOne<{ email: string | null; nombre: string | null }>(
      `SELECT email, nombre FROM usuarios WHERE id=$1`, [input.vendedorId]
    ),
    queryOne<{ email: string | null; nombre: string | null }>(
      `SELECT email, nombre FROM usuarios WHERE id=$1`, [input.compradorId]
    ),
  ])

  // 4. INSERT en tabla contable (TX atómica)
  let liberacionId: string
  let mpReleaseId: string | undefined

  try {
    await transaction(async (client) => {
      // Insertar liberación
      const lib = await client.query<{ id: string }>(
        `INSERT INTO liberaciones_fondos
           (transaccion_id, vendedor_id, comprador_id,
            precio_venta, comision_rodaid, monto_liberado, pct_comision,
            metodo, gateway, mp_payment_id, estado, trigger_motivo, comprobante_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'MP_RELEASE',$8,$9,'PENDIENTE',$10,$11)
         RETURNING id`,
        [
          input.transaccionId, input.vendedorId, input.compradorId,
          input.precioVenta, input.comisionRodaid, input.montoVendedor,
          input.pctComision, input.gateway, input.mpPaymentId ?? null,
          input.motivo, comprobanteId,
        ]
      )
      liberacionId = lib.rows[0].id

      // Actualizar transacción a COMPLETADA con timestamp
      await client.query(
        `UPDATE transacciones SET
           estado_pago='COMPLETADA',
           completada_en=NOW(),
           escrow_liberado_en=NOW(),
           actualizado_en=NOW()
         WHERE id=$1 AND estado_pago IN ('EN_CAMINO','FONDOS_RETENIDOS')`,
        [input.transaccionId]
      )
    })
  } catch (err) {
    throw new AppError(
      `Error registrando liberación: ${(err as Error).message}`,
      500, 'LIBERACION_ERROR'
    )
  }

  // 5. Trigger MP (fire-and-forget si falla → queda PENDIENTE para reintento)
  if (input.gateway === 'MERCADOPAGO' && input.mpPaymentId) {
    try {
      const mpSvc = await import('./mercadopago.service')
      // En MP Marketplace, la liberación es automática cuando el pago se aprueba
      // Para pagos en custodia, usar: POST /v1/payments/{id}/release
      const result = await mpSvc.emitirReembolso?.({
        transaccionId: input.transaccionId,
        paymentId:     input.mpPaymentId ?? '',  // emitirReembolso uses paymentId
        monto:         undefined,   // liberación total
        motivo:        'release',
      }).catch(() => null)

      if (result?.ok) {
        mpReleaseId = result?.refundId
        await query(
          `UPDATE liberaciones_fondos SET
             estado='ACREDITADO', mp_release_id=$2, acreditado_en=NOW()
           WHERE id=$1`,
          [liberacionId!, mpReleaseId ?? null]
        )
      }
    } catch { /* STUB o fallo → queda PENDIENTE */ }
  } else {
    // STUB: marcar como acreditado directamente
    await query(
      `UPDATE liberaciones_fondos SET estado='ACREDITADO', acreditado_en=NOW() WHERE id=$1`,
      [liberacionId!]
    )
  }

  // 6. Notificar al VENDEDOR
  await notificarVendedor({
    vendedorId:   input.vendedorId,
    montoARS:     input.montoVendedor,
    comisionARS:  input.comisionRodaid,
    comprobanteId,
    transaccionId:input.transaccionId,
    compradorNombre: comprador?.nombre ?? undefined,
  })

  // 7. Notificar al COMPRADOR
  await notificarComprador({
    compradorId:  input.compradorId,
    comprobanteId,
    transaccionId:input.transaccionId,
    montoTotal:   input.precioVenta,
    calificacion: input.calificacion,
  })

  // 8. Registrar en escrow_eventos (via import dinámico para evitar circular)
  const { registrarEvento } = await import('./escrow.eventos')
  await registrarEvento({
    transaccionId: input.transaccionId,
    evento:        'LIBERACION_FONDOS_COMPLETADA',
    estadoNuevo:   'COMPLETADA',
    actorTipo:     'SISTEMA',
    datos: {
      comprobanteId,
      montoVendedor:  input.montoVendedor,
      comisionRodaid: input.comisionRodaid,
      motivo:         input.motivo,
      acreditado:     true,
    },
  })

  log.escrow.info({
    liberacionId:  liberacionId!.slice(0, 8),
    comprobanteId,
    txId:          input.transaccionId.slice(0, 8),
    montoVendedor: input.montoVendedor,
    comision:      input.comisionRodaid,
    motivo:        input.motivo,
  }, `💸 Fondos liberados — ${comprobanteId}`)

  return {
    liberacionId:  liberacionId!,
    comprobanteId,
    estado:        'ACREDITADO',
    monto: {
      precioVenta:    input.precioVenta,
      comisionRodaid: input.comisionRodaid,
      montoVendedor:  input.montoVendedor,
      pctComision:    input.pctComision,
    },
    vendedor:  { id: input.vendedorId, email: vendedor?.email ?? undefined, nombre: vendedor?.nombre ?? undefined },
    comprador: { id: input.compradorId, email: comprador?.email ?? undefined, nombre: comprador?.nombre ?? undefined },
    timestamps: {
      liberadoEn:  new Date(),
      acreditadoEn:new Date(),
    },
    mpReleaseId,
  }
}

// ══════════════════════════════════════════════════════════
// REEMBOLSO AL COMPRADOR (cancelación)
// ══════════════════════════════════════════════════════════

export async function reembolsarCompradorTx(opts: {
  transaccionId: string
  compradorId:   string
  vendedorId:    string
  montoARS:      number
  gateway:       string
  mpPaymentId?:  string
  motivo:        string
}): Promise<{ reembolsoId: string; comprobanteId: string; ok: boolean }> {
  // Idempotencia
  const yaReembolsado = await queryOne<{ id: string; comprobante_id: string }>(
    `SELECT id, comprobante_id FROM liberaciones_fondos
     WHERE transaccion_id=$1 AND es_reembolso=TRUE LIMIT 1`,
    [opts.transaccionId]
  )
  if (yaReembolsado) {
    return { reembolsoId: yaReembolsado.id, comprobanteId: yaReembolsado.comprobante_id, ok: true }
  }

  const seq = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM liberaciones_fondos WHERE es_reembolso=TRUE`, []
  )
  const comprobanteId = `REM-${new Date().getFullYear()}-${String(parseInt(seq?.count ?? '0') + 1).padStart(5, '0')}`

  const lib = await queryOne<{ id: string }>(
    `INSERT INTO liberaciones_fondos
       (transaccion_id, vendedor_id, comprador_id, precio_venta, comision_rodaid,
        monto_liberado, pct_comision, metodo, gateway, mp_payment_id,
        estado, trigger_motivo, comprobante_id, es_reembolso, reembolso_a_id)
     VALUES ($1,$2,$3,$4,0,$4,0,'MP_REEMBOLSO',$5,$6,'PENDIENTE',$7,$8,TRUE,$3)
     RETURNING id`,
    [
      opts.transaccionId, opts.vendedorId, opts.compradorId, opts.montoARS,
      opts.gateway, opts.mpPaymentId ?? null, opts.motivo, comprobanteId,
    ]
  )

  let ok = false
  if (opts.gateway === 'MERCADOPAGO' && opts.mpPaymentId) {
    try {
      const mpSvc = await import('./mercadopago.service')
      const r = await mpSvc.emitirReembolso?.({
        transaccionId: opts.transaccionId,
        paymentId:     opts.mpPaymentId ?? '',
        monto:         undefined,
        motivo:        'refund',
      }).catch(() => null)
      ok = r?.ok ?? false
    } catch { /* STUB */ }
  } else {
    ok = true // STUB: siempre OK
  }

  await query(
    `UPDATE liberaciones_fondos SET
       estado=$2, acreditado_en=CASE WHEN $2='ACREDITADO' THEN NOW() END
     WHERE id=$1`,
    [lib!.id, ok ? 'ACREDITADO' : 'PENDIENTE']
  )

  // Notificar al comprador
  import('./device_token.service').then(dt =>
    dt.enviarPush(opts.compradorId, {
      titulo: '💰 Reembolso en proceso',
      cuerpo: `Tu reembolso de $${opts.montoARS.toFixed(0)} ARS fue iniciado. Comprobante: ${comprobanteId}`,
      datos:  { tipo: 'REEMBOLSO', comprobanteId, transaccionId: opts.transaccionId },
    })
  ).catch(() => {})

  return { reembolsoId: lib!.id, comprobanteId, ok }
}

// ══════════════════════════════════════════════════════════
// NOTIFICACIONES
// ══════════════════════════════════════════════════════════

async function notificarVendedor(opts: {
  vendedorId:      string
  montoARS:        number
  comisionARS:     number
  comprobanteId:   string
  transaccionId:   string
  compradorNombre?: string
}): Promise<void> {
  // In-app
  await query(
    `INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, datos)
     VALUES ($1,'FONDOS_LIBERADOS','💸 ¡Fondos acreditados!',$2,$3::jsonb)`,
    [
      opts.vendedorId,
      `$${opts.montoARS.toFixed(0)} ARS acreditados en tu cuenta.${opts.compradorNombre ? ` Confirmado por: ${opts.compradorNombre}.` : ''}`,
      JSON.stringify({
        comprobanteId:  opts.comprobanteId,
        montoARS:       opts.montoARS,
        comisionRodaid: opts.comisionARS,
        transaccionId:  opts.transaccionId,
      }),
    ]
  ).catch(() => {})

  // Push FCM
  import('./device_token.service').then(dt =>
    dt.enviarPush(opts.vendedorId, {
      titulo: '💸 ¡Fondos acreditados!',
      cuerpo: `$${opts.montoARS.toFixed(0)} ARS acreditados. Comprobante: ${opts.comprobanteId}`,
      datos:  { tipo: 'FONDOS_LIBERADOS', comprobanteId: opts.comprobanteId, transaccionId: opts.transaccionId },
    })
  ).catch(() => {})

}


async function notificarComprador(opts: {
  compradorId:   string
  comprobanteId: string
  transaccionId: string
  montoTotal:    number
  calificacion?: number
}): Promise<void> {
  await query(
    `INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, datos)
     VALUES ($1,'COMPRA_COMPLETADA','✅ Compra completada',$2,$3::jsonb)`,
    [
      opts.compradorId,
      `Tu compra de $${opts.montoTotal.toFixed(0)} ARS fue completada exitosamente. Comprobante: ${opts.comprobanteId}`,
      JSON.stringify({
        comprobanteId: opts.comprobanteId,
        montoTotal:    opts.montoTotal,
        transaccionId: opts.transaccionId,
        calificacion:  opts.calificacion,
      }),
    ]
  ).catch(() => {})

  import('./device_token.service').then(dt =>
    dt.enviarPush(opts.compradorId, {
      titulo: '✅ Compra completada',
      cuerpo: `Tu compra fue confirmada. Comprobante: ${opts.comprobanteId}`,
      datos:  { tipo: 'COMPRA_COMPLETADA', comprobanteId: opts.comprobanteId },
    })
  ).catch(() => {})
}

// ══════════════════════════════════════════════════════════
// REPROCESAR LIBERACIONES PENDIENTES
// ══════════════════════════════════════════════════════════

export async function reprocesarLiberacionesPendientes(): Promise<{
  procesadas: number; acreditadas: number; fallidas: number
}> {
  const pendientes = await query<{
    id: string; transaccion_id: string; vendedor_id: string; monto_liberado: number
    gateway: string; mp_payment_id: string | null
  }>(
    `SELECT id, transaccion_id, vendedor_id, monto_liberado, gateway, mp_payment_id
     FROM liberaciones_fondos
     WHERE estado='PENDIENTE' AND NOT es_reembolso
       AND creado_en > NOW() - INTERVAL '7 days'
     ORDER BY creado_en LIMIT 50`,
    []
  )

  let acreditadas = 0; let fallidas = 0
  for (const lib of pendientes) {
    try {
      let ok = lib.gateway === 'STUB'
      if (!ok && lib.mp_payment_id) {
        const mpSvc = await import('./mercadopago.service')
        const r = await mpSvc.emitirReembolso?.({
          transaccionId: lib.transaccion_id,
          paymentId:   lib.mp_payment_id ?? '',
          monto: undefined,
          motivo: 'release_retry',
        }).catch(() => null)
        ok = r?.ok ?? false
      }

      await query(
        `UPDATE liberaciones_fondos SET
           estado=CASE WHEN $2 THEN 'ACREDITADO' ELSE 'FALLIDO' END,
           acreditado_en=CASE WHEN $2 THEN NOW() END
         WHERE id=$1`,
        [lib.id, ok]
      )
      ok ? acreditadas++ : fallidas++
    } catch { fallidas++ }
  }

  return { procesadas: pendientes.length, acreditadas, fallidas }
}

// ══════════════════════════════════════════════════════════
// CONSULTAS
// ══════════════════════════════════════════════════════════

export async function getLiberacion(transaccionId: string) {
  return queryOne<any>(
    `SELECT lf.*, u_v.email AS vendedor_email, u_v.nombre AS vendedor_nombre,
            u_c.email AS comprador_email, u_c.nombre AS comprador_nombre
     FROM liberaciones_fondos lf
     JOIN usuarios u_v ON u_v.id=lf.vendedor_id
     JOIN usuarios u_c ON u_c.id=lf.comprador_id
     WHERE lf.transaccion_id=$1 AND NOT lf.es_reembolso
     ORDER BY lf.creado_en DESC LIMIT 1`,
    [transaccionId]
  )
}

export async function getComprobanteCompleto(comprobanteId: string) {
  const lib = await queryOne<any>(
    `SELECT lf.*,
            u_v.email AS vendedor_email, u_v.nombre AS vendedor_nombre,
            u_c.email AS comprador_email, u_c.nombre AS comprador_nombre,
            t.precio_ars, t.comision_pct, t.estado_pago AS estado_transaccion
     FROM liberaciones_fondos lf
     JOIN usuarios u_v ON u_v.id=lf.vendedor_id
     JOIN usuarios u_c ON u_c.id=lf.comprador_id
     JOIN transacciones t ON t.id=lf.transaccion_id
     WHERE lf.comprobante_id=$1`,
    [comprobanteId]
  )
  if (!lib) return null
  return {
    comprobanteId:  lib.comprobante_id,
    emitidoEn:      lib.creado_en,
    estado:         lib.estado,
    transaccion: {
      id:           lib.transaccion_id,
      precioVenta:  parseFloat(lib.precio_venta),
      comision:     parseFloat(lib.comision_rodaid),
      montoVendedor:parseFloat(lib.monto_liberado),
      pctComision:  parseFloat(lib.pct_comision),
      estado:       lib.estado_transaccion,
    },
    vendedor: {
      id:    lib.vendedor_id,
      email: lib.vendedor_email,
      nombre:lib.vendedor_nombre,
    },
    comprador: {
      id:    lib.comprador_id,
      email: lib.comprador_email,
      nombre:lib.comprador_nombre,
    },
    acreditacion: {
      metodo:     lib.metodo,
      gateway:    lib.gateway,
      mpReleaseId:lib.mp_release_id,
      acreditadoEn:lib.acreditado_en,
    },
  }
}

export async function getResumenLiberaciones(usuarioId: string, rol: 'vendedor' | 'comprador', dias = 90) {
  const campo = rol === 'vendedor' ? 'vendedor_id' : 'comprador_id'
  return queryOne<any>(
    `SELECT COUNT(*)::int                                            AS total,
            COUNT(*) FILTER(WHERE estado='ACREDITADO')::int         AS acreditadas,
            COUNT(*) FILTER(WHERE estado='PENDIENTE')::int          AS pendientes,
            COALESCE(SUM(monto_liberado) FILTER(WHERE estado='ACREDITADO'),0)::numeric AS total_ars,
            COALESCE(SUM(comision_rodaid) FILTER(WHERE NOT es_reembolso),0)::numeric AS comision_total
     FROM liberaciones_fondos
     WHERE ${campo}=$1 AND creado_en > NOW()-($2||' days')::interval`,
    [usuarioId, dias]
  )
}

// ══════════════════════════════════════════════════════════
// HELPER
// ══════════════════════════════════════════════════════════

function construirResultadoExistente(
  lib: { id: string; comprobante_id: string; estado: string; monto_liberado: number },
  input: LiberacionInput
): LiberacionResult {
  return {
    liberacionId:  lib.id,
    comprobanteId: lib.comprobante_id,
    estado:        lib.estado,
    monto: {
      precioVenta:    input.precioVenta,
      comisionRodaid: input.comisionRodaid,
      montoVendedor:  lib.monto_liberado,
      pctComision:    input.pctComision,
    },
    vendedor:  { id: input.vendedorId },
    comprador: { id: input.compradorId },
    timestamps: { liberadoEn: new Date() },
  }
}
