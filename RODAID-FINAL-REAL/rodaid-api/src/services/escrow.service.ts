// ─── RODAID PAY · Escrow Service ─────────────────────────
// Sistema de pago en fideicomiso para el marketplace de bicicletas.
//
// Máquina de estados del escrow:
//
//   PENDIENTE
//     ↓ iniciarCompra() → link de pago generado
//   DEPOSITO_PENDIENTE
//     ↓ webhookPago() → gateway confirmó el pago
//   FONDOS_RETENIDOS  ← el dinero está seguro en escrow
//     ↓ confirmarEnvio() → vendedor marca que entregó/envió
//   EN_CAMINO
//     ↓ confirmarEntrega() → comprador confirma recepción
//   COMPLETADA ← fondos liberados al vendedor
//
//   Desde FONDOS_RETENIDOS o EN_CAMINO:
//     → abrirDisputa() → DISPUTADA → resolverDisputa() → COMPLETADA | CANCELADA
//     → autoRelease()  → COMPLETADA (si comprador no confirma en 5 días)
//     → cancelar()     → CANCELADA + reembolso al comprador
//
// Comisión RODAID:
//   2.5% Plan Libre · 1.8% Plan Estándar · 1.2% Plan Premium
//   Monto al vendedor = precio - comisión
//
// Gateway de pagos:
//   Producción: MercadoPago (RODAID_MP_ACCESS_TOKEN)
//   Desarrollo: STUB (simula link + webhook)

import crypto from 'crypto'
import { query, queryOne }    from '../config/database'
import { crearPreferencia, emitirReembolso, getModo } from './mercadopago.service'
import { registrarComision, devolverComision } from './comision.service'
import { transferirNFTAlComprador } from './nft.transfer.service'
import { registrarEvento, type EscrowEvento } from './escrow.eventos'
import { log }              from '../middleware/logger'
import { env }              from '../config/env'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export type EstadoEscrow =
  | 'PENDIENTE'
  | 'DEPOSITO_PENDIENTE'
  | 'FONDOS_RETENIDOS'
  | 'EN_CAMINO'
  | 'COMPLETADA'
  | 'DISPUTADA'
  | 'CANCELADA'

export interface TransaccionEscrow {
  id:                  string
  publicacionId:       string
  compradorId:         string
  vendedorId:          string
  precioARS:           number
  comisionRodaid:      number
  montoVendedor:       number
  estado:              EstadoEscrow
  linkPago?:           string
  gateway:             string
  // Fechas clave del ciclo de vida
  creadaEn:            Date
  depositoEn?:         Date
  fondosRetenidosEn?:  Date
  envioConfirmadoEn?:  Date
  entregaConfirmadaEn?: Date
  autoReleaseEn?:      Date
  completadaEn?:       Date
  canceladaEn?:        Date
  canceladaMotivo?:    string
}

export interface IniciarCompraInput {
  publicacionId: string
  compradorId:   string
  /** URL de retorno si el pago es exitoso */
  returnUrl?:    string
  /** URL de retorno si el pago falla */
  cancelUrl?:    string
}

// ══════════════════════════════════════════════════════════
// CONSTANTES
// ══════════════════════════════════════════════════════════

const COMISION_RATES: Record<string, number> = {
  LIBRE:    0.025,
  ESTANDAR: 0.018,
  PREMIUM:  0.012,
}

/** Días antes de auto-liberar fondos si comprador no confirma */
const AUTO_RELEASE_DAYS = 5

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════

// registrarEvento moved to escrow.eventos.ts module
async function _registrarEventoLOCAL(opts: EscrowEvento): Promise<void> {
  // Use explicit casts for UUID columns to help pg driver resolve types
  const eventoParams = [
    opts.transaccionId,       // $1 transaccion_id UUID
    opts.evento,              // $2 evento text
    opts.estadoPrevio ?? null,// $3 estado_previo text
    opts.estadoNuevo ?? null, // $4 estado_nuevo text
    opts.actorId ?? null,     // $5 actor_id UUID
    opts.actorTipo ?? null,   // $6 actor_tipo text
    opts.datos ? JSON.stringify(opts.datos) : null, // $7 datos jsonb
    opts.ip ?? null,          // $8 ip text
  ]
  const eventoSQL = `INSERT INTO escrow_eventos
       (transaccion_id, evento, estado_previo, estado_nuevo,
        actor_id, actor_tipo, datos, ip)
     VALUES (
       $1::uuid, $2, $3, $4,
       $5::uuid, $6, $7::jsonb, $8
     )`
  await query(eventoSQL, eventoParams).catch((err: Error) => log.escrow.error({ err: err.message }, '✗ Error escrow evento local'))
    .catch(err => log.escrow.warn({ err: err.message }, 'Error registrando evento escrow'))
}

async function transicionarEstado(
  id:           string,
  nuevoEstado:  EstadoEscrow,
  camposFecha?: Record<string, string>,  // col → 'NOW()' | 'NOW() + INTERVAL ...'
  camposExtra?: Record<string, unknown>
): Promise<void> {
  const sets = ['estado_pago=$2', 'actualizado_en=NOW()']
  const params: unknown[] = [id, nuevoEstado]

  if (camposFecha) {
    for (const [col, expr] of Object.entries(camposFecha)) {
      sets.push(`${col}=${expr}`)
    }
  }
  if (camposExtra) {
    for (const [col, val] of Object.entries(camposExtra)) {
      params.push(val)
      sets.push(`${col}=$${params.length}`)
    }
  }

  await query(
    `UPDATE transacciones SET ${sets.join(',')} WHERE id=$1::uuid`,
    params
  )
}

function calcularComision(precioARS: number, plan = 'LIBRE'): {
  comisionRodaid: number; montoVendedor: number
} {
  const tasa = COMISION_RATES[plan] ?? COMISION_RATES['LIBRE']
  const comisionRodaid = Math.round(precioARS * tasa * 100) / 100
  const montoVendedor  = Math.round((precioARS - comisionRodaid) * 100) / 100
  return { comisionRodaid, montoVendedor }
}

// Gateway de pagos: ver mercadopago.service.ts

// ══════════════════════════════════════════════════════════
// 1. INICIAR COMPRA
// ══════════════════════════════════════════════════════════

export async function iniciarCompra(input: IniciarCompraInput): Promise<{
  transaccionId: string
  linkPago:      string
  monto:         number
  precioARS:     number
  comisionARS:   number
  montoVendedor: number
  comisionPct:   number
  expiraEn:      Date
  estado:        EstadoEscrow
}> {
  // Cargar publicación y validar
  const pub = await queryOne<{
    id: string; estado: string; precio_ars: string
    vendedor_id: string; comprador_id: string | null
    titulo: string; slug: string
  }>(
    `SELECT id, estado::text AS estado, precio_ars, vendedor_id, NULL::uuid AS comprador_id,
            titulo, slug
     FROM marketplace_publicaciones WHERE id=$1`,
    [input.publicacionId]
  )

  if (!pub) throw Object.assign(new Error('Publicación no encontrada'), { code: 'NOT_FOUND', status: 404 })

  // Verificar SELF_PURCHASE antes que estado (para mejor UX)
  if (pub.vendedor_id === input.compradorId) throw Object.assign(
    new Error('El vendedor no puede comprar su propia publicación'),
    { code: 'SELF_PURCHASE', status: 422 }
  )

  // Verificar que no hay transacción activa (también antes del estado check)
  const txActiva = await queryOne<{ id: string }>(
    `SELECT id FROM transacciones
     WHERE publicacion_id=$1 AND estado_pago NOT IN ('CANCELADA','FALLIDO','LIBERADO','DEVUELTO','COMPLETADA')`,
    [input.publicacionId]
  )
  if (txActiva) throw Object.assign(
    new Error('Ya existe una transacción activa para esta publicación'),
    { code: 'TX_DUPLICATE', status: 409 }
  )

  if (pub.estado !== 'ACTIVA' && pub.estado !== 'PAUSADA') throw Object.assign(
    new Error(`La publicación no está disponible (estado: ${pub.estado})`),
    { code: 'NOT_AVAILABLE', status: 409 }
  )

  // Calcular importes
  const precioARS = parseFloat(pub.precio_ars)
  const { comisionRodaid, montoVendedor } = calcularComision(precioARS)

  // Obtener email del comprador para MercadoPago
  const comprador = await queryOne<{ email: string }>(
    `SELECT email FROM usuarios WHERE id=$1`, [input.compradorId]
  )

  // Crear preference MercadoPago (o STUB)
  const mpResult = await crearPreferencia({
    transaccionId:  crypto.randomUUID(), // placeholder — se reemplaza al insertar tx
    monto:          precioARS,
    titulo:         `RODAID PAY: ${pub.titulo}`,
    descripcion:    `Bicicleta certificada — ${pub.id.slice(0,8)}`,
    compradorEmail: comprador?.email,
    returnUrl:      input.returnUrl,
    cancelUrl:      input.cancelUrl,
    expirarEn:      new Date(Date.now() + 48 * 3600_000),
  })
  const linkPago     = mpResult.initPoint
  const preferenceId = mpResult.preferenceId
  const gateway      = mpResult.gateway

  // Fecha de expiración del link de pago: 48 horas
  const expiraEn = new Date(Date.now() + 48 * 3600 * 1000)

  // Crear transacción
  const tx = await queryOne<{ id: string; creado_en: Date }>(
    `INSERT INTO transacciones
       (publicacion_id, comprador_id, vendedor_id,
        monto_ars, comision_ars, precio_ars, monto_vendedor,
        estado_pago, link_pago, mp_preference_id, gateway,
        auto_release_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'DEPOSITO_PENDIENTE',$8,$9,$10,$11)
     RETURNING id, creado_en`,
    [
      input.publicacionId, input.compradorId, pub.vendedor_id,
      precioARS, comisionRodaid, precioARS, montoVendedor,
      linkPago, preferenceId, gateway,
      new Date(Date.now() + AUTO_RELEASE_DAYS * 86400_000),
    ]
  )

  // Pausar la publicación para que no haya doble compra
  await query(
    `UPDATE marketplace_publicaciones SET estado='PAUSADA' WHERE id=$1`,
    [input.publicacionId]
  )

  // Evento
  await registrarEvento({
    transaccionId: tx!.id,
    evento:        'COMPRA_INICIADA',
    estadoPrevio:  'PENDIENTE',
    estadoNuevo:   'DEPOSITO_PENDIENTE',
    actorId:       input.compradorId,
    actorTipo:     'COMPRADOR',
    datos: { precioARS, comisionRodaid, montoVendedor, gateway, linkPago },
  })

  await registrarEvento({
    transaccionId: tx!.id,
    evento:        'COMPRA_INICIADA',
    estadoPrevio:  'PENDIENTE',
    estadoNuevo:   'DEPOSITO_PENDIENTE',
    actorId:       input.compradorId,
    actorTipo:     'COMPRADOR',
    datos: { precioARS, comisionRodaid, gateway, linkPago },
  })

  log.escrow.info({
    txId: tx!.id, publicacionId: input.publicacionId,
    compradorId: input.compradorId, precioARS, comisionRodaid, gateway,
  }, '✓ Compra iniciada — escrow DEPOSITO_PENDIENTE')

  return {
    transaccionId: tx!.id,
    linkPago,
    monto:         precioARS,
    precioARS,
    comisionARS:   comisionRodaid,
    montoVendedor,
    comisionPct:   COMISION_RATES['LIBRE'] * 100,
    expiraEn,
    estado:        'DEPOSITO_PENDIENTE',
  }
}

// ══════════════════════════════════════════════════════════
// 2. WEBHOOK DE PAGO (gateway confirma depósito)
// ══════════════════════════════════════════════════════════

export async function webhookPago(opts: {
  transaccionId?: string
  externalReference?: string   // MP usa external_reference
  paymentId:       string
  status:          string      // 'approved' | 'rejected' | 'pending'
  monto?:          number
  gateway:         string
}): Promise<{ ok: boolean; estado: EstadoEscrow }> {

  const txId = opts.transaccionId ?? opts.externalReference
  if (!txId) return { ok: false, estado: 'PENDIENTE' }

  const tx = await queryOne<{ id: string; estado_pago: string; monto_ars: string }>(
    `SELECT id, estado_pago::text, monto_ars FROM transacciones WHERE id=$1`, [txId]
  )
  if (!tx) return { ok: false, estado: 'PENDIENTE' }
  if (!['PENDIENTE','DEPOSITO_PENDIENTE'].includes(tx.estado_pago)) {
    return { ok: true, estado: tx.estado_pago as EstadoEscrow }
  }

  if (opts.status === 'approved') {
    await transicionarEstado(txId, 'FONDOS_RETENIDOS', {
      deposito_en: 'NOW()',
      fondos_retenidos_en: 'NOW()',
    }, { mp_payment_id: opts.paymentId })

    await registrarEvento({
      transaccionId: txId,
      evento:        'DEPOSITO_CONFIRMADO',
      estadoPrevio:  tx.estado_pago,
      estadoNuevo:   'FONDOS_RETENIDOS',
      actorTipo:     'SISTEMA',
      datos: { paymentId: opts.paymentId, monto: opts.monto, gateway: opts.gateway },
    })

    log.escrow.info({
      txId, paymentId: opts.paymentId, monto: tx.monto_ars,
    }, '✓ Depósito confirmado — FONDOS_RETENIDOS (escrow activo)')

    return { ok: true, estado: 'FONDOS_RETENIDOS' }
  }

  if (opts.status === 'rejected') {
    await transicionarEstado(txId, 'CANCELADA', { cancelada_en: 'NOW()' },
      { cancelada_motivo: `Pago rechazado por ${opts.gateway}: ${opts.paymentId}` })

    // Re-activar publicación
    await query(
      `UPDATE marketplace_publicaciones mp
       SET estado='ACTIVA'
       FROM transacciones tx
       WHERE tx.id=$1::uuid AND mp.id=tx.publicacion_id`,
      [txId]
    )

    await registrarEvento({ transaccionId: txId, evento: 'PAGO_RECHAZADO',
      estadoPrevio: tx.estado_pago, estadoNuevo: 'CANCELADA', actorTipo: 'SISTEMA',
      datos: { paymentId: opts.paymentId, gateway: opts.gateway } })

    return { ok: true, estado: 'CANCELADA' }
  }

  return { ok: true, estado: tx.estado_pago as EstadoEscrow }
}

// ══════════════════════════════════════════════════════════
// 2b. SIMULAR DEPÓSITO (solo STUB — para tests y demo)
// ══════════════════════════════════════════════════════════

export async function simularDeposito(transaccionId: string): Promise<{ estado: EstadoEscrow; autoReleaseEn?: Date; envioConfirmado?: boolean; diasParaAutoRelease?: number }> {
  const stubPaymentId = `STUB_PAY_${crypto.randomBytes(4).toString('hex').toUpperCase()}`
  const result = await webhookPago({
    transaccionId,
    paymentId:    stubPaymentId,
    status:       'approved',
    gateway:      'STUB',
  })
  log.escrow.info({ transaccionId, stubPaymentId }, '🔄 STUB: depósito simulado')
  return { estado: result.estado }
}

// ══════════════════════════════════════════════════════════
// 3. CONFIRMAR ENVÍO (vendedor)
// ══════════════════════════════════════════════════════════

export async function confirmarEnvio(opts: {
  transaccionId: string
  vendedorId:    string
  trackingCode?: string
  mensaje?:      string
  ip?:           string
}): Promise<{ estado: EstadoEscrow; autoReleaseEn?: Date; envioConfirmado?: boolean; diasParaAutoRelease?: number }> {

  const tx = await queryOne<{ id: string; estado_pago: string; vendedor_id: string }>(
    `SELECT id, estado_pago::text, vendedor_id FROM transacciones WHERE id=$1`,
    [opts.transaccionId]
  )

  if (!tx) throw Object.assign(new Error('Transacción no encontrada'), { code: 'NOT_FOUND', status: 404 })
  if (tx.vendedor_id !== opts.vendedorId) throw Object.assign(
    new Error('Solo el vendedor puede confirmar el envío'),
    { code: 'FORBIDDEN', status: 403 }
  )
  if (tx.estado_pago !== 'FONDOS_RETENIDOS') throw Object.assign(
    new Error(`Estado inválido para confirmar envío: ${tx.estado_pago}`),
    { code: 'INVALID_STATE', status: 422 }
  )

  await transicionarEstado(opts.transaccionId, 'EN_CAMINO', {
    envio_confirmado_en: 'NOW()',
  })

  await registrarEvento({
    transaccionId: opts.transaccionId,
    evento:        'ENVIO_CONFIRMADO',
    estadoPrevio:  'FONDOS_RETENIDOS',
    estadoNuevo:   'EN_CAMINO',
    actorId:       opts.vendedorId,
    actorTipo:     'VENDEDOR',
    datos: { trackingCode: opts.trackingCode, mensaje: opts.mensaje },
    ip:            opts.ip,
  })

  log.escrow.info({ txId: opts.transaccionId, vendedorId: opts.vendedorId },
    '✓ Envío confirmado por vendedor — estado: EN_CAMINO')

  // Fetch updated values from DB
  const txUpdated = await queryOne<{ auto_release_en: Date; envio_confirmado: boolean }>(
    `SELECT auto_release_en, TRUE AS envio_confirmado FROM transacciones WHERE id=$1`, [opts.transaccionId]
  )
  return {
    estado:              'EN_CAMINO' as const,
    autoReleaseEn:       txUpdated?.auto_release_en,
    envioConfirmado:     txUpdated?.envio_confirmado ?? true,
    diasParaAutoRelease: 5,
  }
}

// ══════════════════════════════════════════════════════════
// 4. CONFIRMAR ENTREGA → RELEASE (comprador)
// ══════════════════════════════════════════════════════════

export async function confirmarEntrega(opts: {
  transaccionId: string
  compradorId:   string
  ip?:           string
}): Promise<{
  estado:         EstadoEscrow
  montoLiberado:  number
  comisionRodaid: number
}> {
  const tx = await queryOne<{
    id: string; estado_pago: string; comprador_id: string
    monto_ars: string; comision_ars: string; monto_vendedor: string
    vendedor_id: string; publicacion_id: string
    gateway: string | null; mp_payment_id: string | null
    cit_id_from_pub: string
  }>(
    `SELECT t.id, t.estado_pago::text, t.comprador_id, t.monto_ars, t.comision_ars,
            t.monto_vendedor, t.vendedor_id, t.publicacion_id,
            t.gateway, t.mp_payment_id,
            (SELECT c2.id FROM cits c2 WHERE c2.bicicleta_id=mp.bicicleta_id
             AND c2.estado='ACTIVO' ORDER BY c2.creado_en DESC LIMIT 1) AS cit_id_from_pub
     FROM transacciones t
     LEFT JOIN marketplace_publicaciones mp ON mp.id=t.publicacion_id
     WHERE t.id=$1`,
    [opts.transaccionId]
  )

  if (!tx) throw Object.assign(new Error('Transacción no encontrada'), { code: 'NOT_FOUND', status: 404 })
  if (tx.comprador_id !== opts.compradorId) throw Object.assign(
    new Error('Solo el comprador puede confirmar la entrega'),
    { code: 'FORBIDDEN', status: 403 }
  )
  if (!['EN_CAMINO', 'FONDOS_RETENIDOS'].includes(tx.estado_pago)) throw Object.assign(
    new Error(`Estado inválido: ${tx.estado_pago}`),
    { code: 'INVALID_STATE', status: 422 }
  )

  const montoLiberado  = parseFloat(tx.monto_vendedor)
  const comisionRodaid = parseFloat(tx.comision_ars)

  // Liberar fondos al vendedor
  // Liberación real via liberacion.service
  const liberacionSvc = await import('./liberacion.service')
  const liberacion = await liberacionSvc.liberarFondosTx({
    transaccionId:  opts.transaccionId,
    vendedorId:     tx.vendedor_id,
    compradorId:    opts.compradorId,
    precioVenta:    parseFloat(tx.monto_ars),
    comisionRodaid: comisionRodaid,
    montoVendedor:  montoLiberado,
    pctComision:    COMISION_RATES['LIBRE'],
    gateway:        tx.gateway ?? 'STUB',
    mpPaymentId:    tx.mp_payment_id ?? undefined,
    motivo:         'CONFIRMACION_COMPRADOR',
    calificacion:   (opts as any).calificacion,
    comentario:     (opts as any).comentario,
  })
  log.escrow.info({ comprobanteId: liberacion.comprobanteId }, '✅ Liberación completada')

  await transicionarEstado(opts.transaccionId, 'COMPLETADA', {
    entrega_confirmada_en: 'NOW()',
    completada_en:         'NOW()',
    escrow_liberado_en:    'NOW()',
  }, { entrega_confirmada: true })

  // Marcar publicación como vendida
  await query(
    `UPDATE marketplace_publicaciones SET estado='VENDIDA',
       vendido_en=NOW(), comprador_id=$1, precio_final_ars=$2, comision_rodaid=$3
     WHERE id=$4`,
    [opts.compradorId, parseFloat(tx.monto_ars), comisionRodaid, tx.publicacion_id]
  )

  await registrarEvento({
    transaccionId: opts.transaccionId,
    evento:        'ENTREGA_CONFIRMADA_FONDOS_LIBERADOS',
    estadoPrevio:  tx.estado_pago,
    estadoNuevo:   'COMPLETADA',
    actorId:       opts.compradorId,
    actorTipo:     'COMPRADOR',
    datos: { montoLiberado, comisionRodaid },
    ip:    opts.ip,
  })

  // Registrar comisión en tabla contable (fire-and-forget)
  registrarComision({
    transaccionId:  opts.transaccionId,
    vendedorId:     tx.vendedor_id,
    compradorId:    opts.compradorId,
    citId:          tx.cit_id_from_pub ?? '',
    precioVentaARS: parseFloat(tx.monto_ars),
    gateway:        tx.gateway ?? 'STUB',
    mpPaymentId:    tx.mp_payment_id ?? undefined,
  }).catch((e: Error) => log.escrow.error({ err: e.message }, 'Error registrando comisión'))

  log.escrow.info({
    txId: opts.transaccionId, montoLiberado, comisionRodaid,
  }, '✓ Entrega confirmada — fondos LIBERADOS al vendedor')

  // ── Transferir NFT ERC-721 al comprador (fire-and-forget con reintentos)
  const citId = await queryOne<{ cit_id: string }>(
    `SELECT c.id AS cit_id FROM cits c
     JOIN marketplace_publicaciones mp ON mp.bicicleta_id=c.id
     WHERE mp.id=$1`, [tx.publicacion_id]
  )

  if (citId?.cit_id) {
    transferirNFTAlComprador({
      citId:         citId.cit_id,
      transaccionId: opts.transaccionId,
      compradorId:   opts.compradorId,
      vendedorId:    tx.vendedor_id,
    }).then(r => {
      log.escrow.info({
        estado:    r.estado,
        custodial: r.custodial,
        txHash:    r.txHash?.slice(0, 20),
      }, `NFT → ${r.estado}`)
    }).catch(err => {
      log.escrow.error({ err: err.message }, '⚠ NFT transfer encolado para reintento')
    })
  }

  return { estado: 'COMPLETADA', montoLiberado, comisionRodaid }
}

// ══════════════════════════════════════════════════════════
// 4b. AUTO-RELEASE (sistema — cron o Bull job)
// ══════════════════════════════════════════════════════════

export async function procesarAutoReleases(): Promise<{ procesadas: number }> {
  const vencidas = await query<{ id: string; monto_vendedor: string; vendedor_id: string; comprador_id: string; precio_ars: string; comision_ars: string; gateway: string }>(
    `SELECT id, monto_vendedor, vendedor_id, comprador_id, precio_ars, comision_ars, gateway FROM transacciones
     WHERE estado_pago IN ('EN_CAMINO','FONDOS_RETENIDOS')
       AND auto_release_en < NOW()`,
    []
  )

  let procesadas = 0
  for (const tx of vencidas) {
    try {
      const libSvc = await import('./liberacion.service')
      await libSvc.liberarFondosTx({
        transaccionId:  tx.id,
        vendedorId:     tx.vendedor_id,
        compradorId:    tx.comprador_id,
        precioVenta:    parseFloat(tx.precio_ars ?? '0'),
        comisionRodaid: parseFloat(tx.comision_ars ?? '0'),
        montoVendedor:  parseFloat(tx.monto_vendedor),
        pctComision:    COMISION_RATES['LIBRE'],
        gateway:        tx.gateway ?? 'STUB',
        motivo:         'AUTO_RELEASE',
      })

      await transicionarEstado(tx.id, 'COMPLETADA', {
        completada_en: 'NOW()', escrow_liberado_en: 'NOW()',
      })

      await registrarEvento({
        transaccionId: tx.id,
        evento:        'AUTO_RELEASE_FONDOS_LIBERADOS',
        estadoNuevo:   'COMPLETADA',
        actorTipo:     'SISTEMA',
        datos: { motivo: `${AUTO_RELEASE_DAYS} días sin acción del comprador` },
      })

      procesadas++
      log.escrow.info({ txId: tx.id }, `✓ Auto-release procesado`)
    } catch (err) {
      log.escrow.error({ txId: tx.id, err: (err as Error).message }, 'Error en auto-release')
    }
  }

  if (procesadas > 0) log.escrow.info({ procesadas }, `✓ ${procesadas} auto-releases procesados`)
  return { procesadas }
}

// ══════════════════════════════════════════════════════════
// 5. CANCELAR (reembolso al comprador)
// ══════════════════════════════════════════════════════════

export async function cancelarTransaccion(opts: {
  transaccionId: string
  actorId:       string
  actorTipo:     'COMPRADOR' | 'VENDEDOR' | 'ADMIN'
  motivo:        string
  ip?:           string
}): Promise<{ estado: EstadoEscrow; reembolsado: boolean }> {

  const tx = await queryOne<{
    id: string; estado_pago: string; monto_ars: string
    comprador_id: string; vendedor_id: string; publicacion_id: string
  }>(
    `SELECT id, estado_pago::text, monto_ars, comprador_id, vendedor_id, publicacion_id
     FROM transacciones WHERE id=$1`,
    [opts.transaccionId]
  )

  if (!tx) throw Object.assign(new Error('Transacción no encontrada'), { code: 'NOT_FOUND', status: 404 })

  const estadosPermitidos = ['DEPOSITO_PENDIENTE', 'FONDOS_RETENIDOS', 'EN_CAMINO']
  if (!estadosPermitidos.includes(tx.estado_pago)) throw Object.assign(
    new Error(`No se puede cancelar en estado: ${tx.estado_pago}`),
    { code: 'INVALID_STATE', status: 422 }
  )

  // Autorización: comprador puede cancelar si fondos no están liberados
  if (opts.actorTipo === 'COMPRADOR' && tx.comprador_id !== opts.actorId) {
    throw Object.assign(new Error('Sin permiso para cancelar'), { code: 'FORBIDDEN', status: 403 })
  }
  if (opts.actorTipo === 'VENDEDOR' && tx.vendedor_id !== opts.actorId) {
    throw Object.assign(new Error('Sin permiso'), { code: 'FORBIDDEN', status: 403 })
  }

  // Reembolsar si había depósito
  let reembolsado = false
  if (['FONDOS_RETENIDOS', 'EN_CAMINO'].includes(tx.estado_pago)) {
    await procesarReembolso({
      transaccionId: opts.transaccionId,
      compradorId:   tx.comprador_id,
      montoARS:      parseFloat(tx.monto_ars),
      motivo:        opts.motivo,
    })
    reembolsado = true
  }

  await transicionarEstado(opts.transaccionId, 'CANCELADA', { cancelada_en: 'NOW()' },
    { cancelada_motivo: opts.motivo })

  // Re-activar publicación
  await query(
    `UPDATE marketplace_publicaciones SET estado='ACTIVA' WHERE id=$1`,
    [tx.publicacion_id]
  )

  await registrarEvento({
    transaccionId: opts.transaccionId,
    evento:        reembolsado ? 'CANCELADA_CON_REEMBOLSO' : 'CANCELADA',
    estadoPrevio:  tx.estado_pago, estadoNuevo: 'CANCELADA',
    actorId: opts.actorId, actorTipo: opts.actorTipo,
    datos: { motivo: opts.motivo, reembolsado }, ip: opts.ip,
  })

  // Marcar comisión como devuelta (si existía)
  if (reembolsado) {
    devolverComision(opts.transaccionId).catch(() => {})
  }
  log.escrow.info({ txId: opts.transaccionId, reembolsado, motivo: opts.motivo },
    '✓ Transacción cancelada')

  return { estado: 'CANCELADA', reembolsado }
}

// ══════════════════════════════════════════════════════════
// 6. ABRIR DISPUTA
// ══════════════════════════════════════════════════════════

export async function abrirDisputa(opts: {
  transaccionId: string
  iniciadorId?:  string
  abiertaPorId?: string
  tipoActor:     'COMPRADOR' | 'VENDEDOR'
  motivo:        string
  descripcion:   string
  evidencias?:   string[]
  ip?:           string
}): Promise<{ disputaId: string }> {

  const tx = await queryOne<{ estado_pago: string; comprador_id: string; vendedor_id: string }>(
    `SELECT estado_pago::text, comprador_id, vendedor_id FROM transacciones WHERE id=$1`,
    [opts.transaccionId]
  )

  if (!tx) throw Object.assign(new Error('Transacción no encontrada'), { code: 'NOT_FOUND', status: 404 })
  if (!['FONDOS_RETENIDOS','EN_CAMINO'].includes(tx.estado_pago)) throw Object.assign(
    new Error(`No se puede disputar en estado: ${tx.estado_pago}`),
    { code: 'INVALID_STATE', status: 422 }
  )

  const actorId     = opts.iniciadorId ?? opts.abiertaPorId ?? ''
  const esComprador = tx.comprador_id === actorId
  const esVendedor  = tx.vendedor_id  === actorId
  if (!esComprador && !esVendedor) throw Object.assign(
    new Error('Solo compradores o vendedores de la transacción pueden abrir disputas'),
    { code: 'FORBIDDEN', status: 403 }
  )

  const disputa = await queryOne<{ id: string }>(
    `INSERT INTO disputas
       (transaccion_id, abierta_por_id, motivo, descripcion)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [opts.transaccionId, actorId, opts.motivo, opts.descripcion ?? null]
  )

  await transicionarEstado(opts.transaccionId, 'DISPUTADA', undefined,
    { disputa_id: disputa!.id })

  await registrarEvento({
    transaccionId: opts.transaccionId,
    evento:        'DISPUTA_ABIERTA',
    estadoPrevio:  tx.estado_pago, estadoNuevo: 'DISPUTADA',
    actorId:       actorId, actorTipo: opts.tipoActor,
    datos: { disputaId: disputa!.id, motivo: opts.motivo },
    ip:            opts.ip,
  })

  log.escrow.warn({ txId: opts.transaccionId, disputaId: disputa!.id, motivo: opts.motivo },
    '⚠ Disputa abierta — equipo RODAID debe revisar')

  return { disputaId: disputa!.id }
}

// ══════════════════════════════════════════════════════════
// 7. RESOLVER DISPUTA (admin)
// ══════════════════════════════════════════════════════════

export async function resolverDisputa(opts: {
  disputaId:      string
  adminId:        string
  resolucion:     'A_FAVOR_COMPRADOR' | 'A_FAVOR_VENDEDOR'
  descripcion:    string
}): Promise<{ estado: EstadoEscrow; autoReleaseEn?: Date; envioConfirmado?: boolean; diasParaAutoRelease?: number }> {

  const disputa = await queryOne<{ transaccion_id: string; estado: string }>(
    `SELECT transaccion_id, estado FROM disputas WHERE id=$1`, [opts.disputaId]
  )
  if (!disputa) throw Object.assign(new Error('Disputa no encontrada'), { code: 'NOT_FOUND', status: 404 })

  const tx = await queryOne<{
    monto_vendedor: string; monto_ars: string; vendedor_id: string; comprador_id: string
  }>(
    `SELECT monto_vendedor, monto_ars, vendedor_id, comprador_id
     FROM transacciones WHERE id=$1`, [disputa.transaccion_id]
  )

  const estadoDisputa = opts.resolucion === 'A_FAVOR_COMPRADOR'
    ? 'RESUELTA_A_FAVOR_COMPRADOR' : 'RESUELTA_A_FAVOR_VENDEDOR'

  await query(
    `UPDATE escrow_disputas SET estado=$2, resolucion=$3, resuelta_por=$4, resuelta_en=NOW()
     WHERE id=$1`,
    [opts.disputaId, estadoDisputa, opts.descripcion, opts.adminId]
  )

  let estadoFinal: EstadoEscrow

  if (opts.resolucion === 'A_FAVOR_VENDEDOR') {
    await liberarFondos({
      transaccionId: disputa.transaccion_id,
      vendedorId:    tx!.vendedor_id,
      montoARS:      parseFloat(tx!.monto_vendedor),
      motivo:        `Disputa resuelta a favor del vendedor: ${opts.descripcion}`,
    })
    estadoFinal = 'COMPLETADA'
    await transicionarEstado(disputa.transaccion_id, 'COMPLETADA', {
      completada_en: 'NOW()', escrow_liberado_en: 'NOW()',
    })
  } else {
    await procesarReembolso({
      transaccionId: disputa.transaccion_id,
      compradorId:   tx!.comprador_id,
      montoARS:      parseFloat(tx!.monto_ars),
      motivo:        `Disputa resuelta a favor del comprador: ${opts.descripcion}`,
    })
    estadoFinal = 'CANCELADA'
    await transicionarEstado(disputa.transaccion_id, 'CANCELADA', {
      cancelada_en: 'NOW()',
    }, { cancelada_motivo: opts.descripcion })
  }

  await registrarEvento({
    transaccionId: disputa.transaccion_id,
    evento:        `DISPUTA_RESUELTA_${opts.resolucion}`,
    estadoNuevo:   estadoFinal,
    actorId:       opts.adminId, actorTipo: 'ADMIN',
    datos: { disputaId: opts.disputaId, resolucion: opts.resolucion },
  })

  return { estado: estadoFinal }
}

// ══════════════════════════════════════════════════════════
// HELPERS INTERNOS — release y reembolso
// ══════════════════════════════════════════════════════════

async function liberarFondos(opts: {
  transaccionId: string; vendedorId: string; montoARS: number; motivo: string
}): Promise<void> {
  // En producción: trigger acreditación en cuenta RODAID del vendedor
  // Por ahora: registro del evento
  log.escrow.info({ ...opts }, '💸 FONDOS LIBERADOS al vendedor')

  await registrarEvento({
    transaccionId: opts.transaccionId,
    evento:        'FONDOS_ACREDITADOS_VENDEDOR',
    actorTipo:     'SISTEMA',
    datos: { montoARS: opts.montoARS, vendedorId: opts.vendedorId, motivo: opts.motivo },
  })
}

async function procesarReembolso(opts: {
  transaccionId: string; compradorId: string; montoARS: number; motivo: string
}): Promise<void> {
  log.escrow.info({ ...opts }, '💸 REEMBOLSO al comprador')

  await registrarEvento({
    transaccionId: opts.transaccionId,
    evento:        'REEMBOLSO_PROCESADO',
    actorTipo:     'SISTEMA',
    datos: { montoARS: opts.montoARS, compradorId: opts.compradorId, motivo: opts.motivo },
  })
}

// ══════════════════════════════════════════════════════════
// CONSULTA DE TRANSACCIÓN
// ══════════════════════════════════════════════════════════

export async function getTransaccion(id: string): Promise<TransaccionEscrow | null> {
  const row = await queryOne<any>(
    `SELECT id, publicacion_id, comprador_id, vendedor_id,
            monto_ars, comision_ars, monto_vendedor, estado_pago::text AS estado,
            link_pago, gateway, creado_en, deposito_en, fondos_retenidos_en,
            envio_confirmado_en, entrega_confirmada_en, auto_release_en,
            completada_en, cancelada_en, cancelada_motivo
     FROM transacciones WHERE id=$1`,
    [id]
  )
  if (!row) return null

  return {
    id:                  row.id,
    publicacionId:       row.publicacion_id,
    compradorId:         row.comprador_id,
    vendedorId:          row.vendedor_id,
    precioARS:           parseFloat(row.monto_ars),
    comisionRodaid:      parseFloat(row.comision_ars),
    montoVendedor:       parseFloat(row.monto_vendedor),
    estado:              row.estado,
    linkPago:            row.link_pago,
    gateway:             row.gateway,
    creadaEn:            new Date(row.creado_en),
    depositoEn:          row.deposito_en ? new Date(row.deposito_en) : undefined,
    fondosRetenidosEn:   row.fondos_retenidos_en ? new Date(row.fondos_retenidos_en) : undefined,
    envioConfirmadoEn:   row.envio_confirmado_en ? new Date(row.envio_confirmado_en) : undefined,
    entregaConfirmadaEn: row.entrega_confirmada_en ? new Date(row.entrega_confirmada_en) : undefined,
    autoReleaseEn:       row.auto_release_en ? new Date(row.auto_release_en) : undefined,
    completadaEn:        row.completada_en ? new Date(row.completada_en) : undefined,
    canceladaEn:         row.cancelada_en ? new Date(row.cancelada_en) : undefined,
    canceladaMotivo:     row.cancelada_motivo ?? undefined,
  }
}

export async function getEventos(transaccionId: string) {
  return query(
    `SELECT evento, estado_previo, estado_nuevo, actor_tipo, datos, creado_en
     FROM escrow_eventos WHERE transaccion_id=$1 ORDER BY creado_en`,
    [transaccionId]
  )
}

// ══════════════════════════════════════════════════════════
// HISTORIAL DE TRANSACCIONES DEL USUARIO
// ══════════════════════════════════════════════════════════

export async function getMisTransacciones(opts: {
  usuarioId:  string
  rol:        'comprador' | 'vendedor' | 'ambos'
  pagina?:    number
  porPagina?: number
}): Promise<{ items: TransaccionEscrow[]; total: number; pagina: number }> {
  const pagina    = Math.max(1, opts.pagina ?? 1)
  const porPagina = Math.min(50, opts.porPagina ?? 25)
  const offset    = (pagina - 1) * porPagina

  const cond = opts.rol === 'comprador' ? 'comprador_id=$1'
    : opts.rol === 'vendedor'  ? 'vendedor_id=$1'
    : '(comprador_id=$1 OR vendedor_id=$1)'

  const [rows, countRow] = await Promise.all([
    query<any>(
      `SELECT id, publicacion_id, comprador_id, vendedor_id,
              precio_ars, comision_pct, comision_rodaid, monto_vendedor,
              estado_pago AS estado, gateway, link_pago,
              creada_en, deposito_en, fondos_retenidos_en,
              envio_confirmado_en, entrega_confirmada_en,
              auto_release_en, completada_en, cancelada_en, cancelada_motivo
       FROM transacciones WHERE ${cond}
       ORDER BY creada_en DESC LIMIT $2 OFFSET $3`,
      [opts.usuarioId, porPagina, offset]
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM transacciones WHERE ${cond}`,
      [opts.usuarioId]
    ),
  ])

  return {
    items: rows as unknown as TransaccionEscrow[],
    total: parseInt(countRow?.count ?? '0'),
    pagina,
  }
}
