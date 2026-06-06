import { randomUUID } from 'node:crypto'
import { ApiError, getPool, type DbClient } from '@/lib/marketplace'
import {
  consultarPago,
  crearPreferencia,
  emitirReembolso,
  getModo,
  type MercadoPagoModo,
} from '@/src/services/mercadopago.service'

/**
 * RODAID PAY — maquina de estados del Escrow.
 *
 *   iniciarCompra()            -> DEPOSITO_PENDIENTE  (+ link de pago, publicacion PAUSADA)
 *   webhookPago(approved)      -> FONDOS_RETENIDOS    (dinero en custodia)
 *   confirmarEnvio(vendedor)   -> EN_CAMINO           (arranca el reloj de auto-release)
 *   confirmarEntrega(comprador)-> COMPLETADA          (libera precio - comision, publicacion VENDIDA)
 *
 *   Ramificaciones:
 *   cancelarTransaccion()      -> CANCELADA  + reembolso + publicacion re-ACTIVA
 *   abrirDisputa()             -> DISPUTADA  (fondos en hold)
 *   resolverDisputa(admin)     -> COMPLETADA (vendedor) | CANCELADA (comprador)
 *   procesarAutoReleases()     -> COMPLETADA (5 dias sin accion del comprador)
 */

export type EscrowEstado =
  | 'DEPOSITO_PENDIENTE'
  | 'FONDOS_RETENIDOS'
  | 'EN_CAMINO'
  | 'COMPLETADA'
  | 'CANCELADA'
  | 'DISPUTADA'

// Comision de RODAID por plan. El Plan Libre cobra 2.5%.
const COMISIONES: Record<string, number> = {
  LIBRE: 0.025,
}

// Dias que tiene el comprador para confirmar la entrega antes del auto-release.
const AUTO_RELEASE_DIAS = 5

export interface TransaccionRow {
  id: string
  publicacion_id: string
  comprador_id: string
  vendedor_id: string
  estado: EscrowEstado
  plan: string
  precio_ars: string
  comision_rodaid: string
  monto_vendedor: string
  gateway: string
  preference_id: string | null
  init_point: string | null
  tracking_code: string | null
  disputa_motivo: string | null
  cancelacion_motivo: string | null
  deposito_confirmado_en: string | null
  envio_confirmado_en: string | null
  entrega_confirmada_en: string | null
  auto_release_en: string | null
  expira_en: string | null
  created_at: string
  updated_at: string
}

export interface PagoRow {
  id: string
  transaccion_id: string
  preference_id: string | null
  payment_id: string | null
  estado: string
  monto: string
  gateway: string
  refund_id: string | null
  raw_status: string | null
  created_at: string
  updated_at: string
}

export interface EventoRow {
  id: string
  transaccion_id: string
  tipo: string
  estado_anterior: EscrowEstado | null
  estado_nuevo: EscrowEstado | null
  actor_id: string | null
  actor_rol: string | null
  metadata: Record<string, unknown>
  created_at: string
}

/** Liquidacion matematica: comision y monto que recibe el vendedor. */
export function calcularLiquidacion(precioARS: number, plan = 'LIBRE') {
  const tasa = COMISIONES[plan] ?? COMISIONES.LIBRE
  const comision = Math.round(precioARS * tasa * 100) / 100
  const montoVendedor = Math.round((precioARS - comision) * 100) / 100
  return { comision, montoVendedor, tasa }
}

export function mapTransaccion(row: TransaccionRow) {
  return {
    id: row.id,
    publicacionId: row.publicacion_id,
    compradorId: row.comprador_id,
    vendedorId: row.vendedor_id,
    estado: row.estado,
    plan: row.plan,
    precioARS: Number(row.precio_ars),
    comisionRodaid: Number(row.comision_rodaid),
    montoVendedor: Number(row.monto_vendedor),
    gateway: row.gateway,
    preferenceId: row.preference_id,
    initPoint: row.init_point,
    trackingCode: row.tracking_code,
    disputaMotivo: row.disputa_motivo,
    cancelacionMotivo: row.cancelacion_motivo,
    depositoConfirmadoEn: row.deposito_confirmado_en,
    envioConfirmadoEn: row.envio_confirmado_en,
    entregaConfirmadaEn: row.entrega_confirmada_en,
    autoReleaseEn: row.auto_release_en,
    expiraEn: row.expira_en,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapPago(row: PagoRow) {
  return {
    id: row.id,
    transaccionId: row.transaccion_id,
    preferenceId: row.preference_id,
    paymentId: row.payment_id,
    estado: row.estado,
    monto: Number(row.monto),
    gateway: row.gateway,
    refundId: row.refund_id,
    rawStatus: row.raw_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ── Helpers internos ────────────────────────────────────────────────────────

async function withTx<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

async function lockTransaccion(
  client: DbClient,
  transaccionId: string
): Promise<TransaccionRow> {
  const res = await client.query<TransaccionRow>(
    `SELECT * FROM escrow_transacciones WHERE id = $1 FOR UPDATE`,
    [transaccionId]
  )
  const tx = res.rows[0]
  if (!tx) {
    throw new ApiError(404, 'TRANSACCION_NOT_FOUND', 'La transaccion no existe.')
  }
  return tx
}

async function logEvento(
  client: DbClient,
  evento: {
    transaccionId: string
    tipo: string
    estadoAnterior?: EscrowEstado | null
    estadoNuevo?: EscrowEstado | null
    actorId?: string | null
    actorRol?: string | null
    metadata?: Record<string, unknown>
  }
) {
  await client.query(
    `
      INSERT INTO escrow_eventos
        (transaccion_id, tipo, estado_anterior, estado_nuevo, actor_id, actor_rol, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `,
    [
      evento.transaccionId,
      evento.tipo,
      evento.estadoAnterior ?? null,
      evento.estadoNuevo ?? null,
      evento.actorId ?? null,
      evento.actorRol ?? null,
      JSON.stringify(evento.metadata ?? {}),
    ]
  )
}

function gatewayLabel(modo: MercadoPagoModo): string {
  return modo === 'STUB' ? 'stub' : 'mercadopago'
}

/** Libera los fondos al vendedor y marca la publicacion como VENDIDA. */
async function liberarFondos(
  client: DbClient,
  tx: TransaccionRow,
  actor: { id: string | null; rol: string }
) {
  const updated = await client.query<TransaccionRow>(
    `
      UPDATE escrow_transacciones
      SET estado = 'COMPLETADA',
          entrega_confirmada_en = NOW(),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [tx.id]
  )

  await client.query(
    `
      UPDATE mp_pagos
      SET estado = 'LIBERADO', updated_at = NOW()
      WHERE transaccion_id = $1 AND estado = 'FONDOS_RETENIDOS'
    `,
    [tx.id]
  )

  await client.query(
    `
      UPDATE marketplace_publicaciones
      SET estado = 'VENDIDA',
          vendido_en = NOW(),
          comprador_id = $2,
          precio_final_ars = $3,
          comision_rodaid = $4
      WHERE id = $1
    `,
    [tx.publicacion_id, tx.comprador_id, tx.precio_ars, tx.comision_rodaid]
  )

  await logEvento(client, {
    transaccionId: tx.id,
    tipo: 'FONDOS_ACREDITADOS_VENDEDOR',
    estadoAnterior: tx.estado,
    estadoNuevo: 'COMPLETADA',
    actorId: actor.id,
    actorRol: actor.rol,
    metadata: {
      montoVendedor: Number(tx.monto_vendedor),
      comision: Number(tx.comision_rodaid),
    },
  })
  await logEvento(client, {
    transaccionId: tx.id,
    tipo: 'ENTREGA_CONFIRMADA_FONDOS_LIBERADOS',
    estadoNuevo: 'COMPLETADA',
    actorId: actor.id,
    actorRol: actor.rol,
  })

  return updated.rows[0]
}

/** Reembolsa el pago retenido (si existe) contra la API de MercadoPago. */
async function reembolsarPagoRetenido(
  client: DbClient,
  transaccionId: string,
  motivo: string | null
) {
  const pagos = await client.query<PagoRow>(
    `
      SELECT * FROM mp_pagos
      WHERE transaccion_id = $1 AND estado = 'FONDOS_RETENIDOS' AND payment_id IS NOT NULL
      ORDER BY created_at DESC
    `,
    [transaccionId]
  )

  const aprobado = pagos.rows[0]
  if (!aprobado || !aprobado.payment_id) {
    return null
  }

  const resultado = await emitirReembolso({
    paymentId: aprobado.payment_id,
    motivo,
    monto: Number(aprobado.monto),
  })

  await client.query(
    `
      UPDATE mp_pagos
      SET estado = 'REEMBOLSADO', refund_id = $2, updated_at = NOW()
      WHERE id = $1
    `,
    [aprobado.id, resultado.refundId]
  )

  return resultado
}

// ── 1. iniciarCompra ────────────────────────────────────────────────────────

export interface IniciarCompraInput {
  publicacionId: string
  compradorId: string
  compradorEmail?: string | null
  compradorNombre?: string | null
}

export async function iniciarCompra(input: IniciarCompraInput) {
  const pool = getPool()

  // Pre-validacion (sin lock) para fallar barato antes de llamar a MercadoPago.
  const pre = await pool.query<{
    id: string
    vendedor_id: string
    estado: string
    titulo: string
    descripcion: string
    precio_ars: string
  }>(
    `
      SELECT id, vendedor_id, estado, titulo, descripcion, precio_ars
      FROM marketplace_publicaciones
      WHERE id = $1
    `,
    [input.publicacionId]
  )

  const pub = pre.rows[0]
  if (!pub) {
    throw new ApiError(404, 'PUBLICACION_NOT_FOUND', 'La publicacion no existe.')
  }
  if (pub.estado !== 'ACTIVA') {
    throw new ApiError(
      409,
      'PUBLICACION_NO_DISPONIBLE',
      'La publicacion no esta disponible para la compra.'
    )
  }
  if (pub.vendedor_id === input.compradorId) {
    throw new ApiError(
      422,
      'COMPRADOR_ES_VENDEDOR',
      'No podes comprar tu propia publicacion.'
    )
  }

  const transaccionId = randomUUID()
  const precio = Number(pub.precio_ars)
  const { comision, montoVendedor } = calcularLiquidacion(precio, 'LIBRE')

  // Generar la preferencia de pago FUERA de la transaccion (llamada de red).
  const preferencia = await crearPreferencia({
    transaccionId,
    titulo: pub.titulo,
    descripcion: pub.descripcion,
    precioARS: precio,
    compradorEmail: input.compradorEmail,
    compradorNombre: input.compradorNombre,
  })
  const gateway = gatewayLabel(preferencia.gateway)

  try {
    const transaccion = await withTx(async (client) => {
      // Re-verificar bajo lock para evitar la doble compra.
      const locked = await client.query<{ estado: string }>(
        `SELECT estado FROM marketplace_publicaciones WHERE id = $1 FOR UPDATE`,
        [input.publicacionId]
      )
      const lockedRow = locked.rows[0]
      if (!lockedRow) {
        throw new ApiError(404, 'PUBLICACION_NOT_FOUND', 'La publicacion no existe.')
      }
      if (lockedRow.estado !== 'ACTIVA') {
        throw new ApiError(
          409,
          'PUBLICACION_NO_DISPONIBLE',
          'La publicacion ya no esta disponible.'
        )
      }

      const txRes = await client.query<TransaccionRow>(
        `
          INSERT INTO escrow_transacciones (
            id, publicacion_id, comprador_id, vendedor_id, estado, plan,
            precio_ars, comision_rodaid, monto_vendedor, gateway,
            preference_id, init_point, expira_en
          )
          VALUES ($1, $2, $3, $4, 'DEPOSITO_PENDIENTE', 'LIBRE',
                  $5, $6, $7, $8, $9, $10, $11)
          RETURNING *
        `,
        [
          transaccionId,
          input.publicacionId,
          input.compradorId,
          pub.vendedor_id,
          precio,
          comision,
          montoVendedor,
          gateway,
          preferencia.preferenceId,
          preferencia.initPoint,
          preferencia.expiraEn,
        ]
      )

      // Mutacion preventiva: PAUSA la publicacion para evitar doble compra.
      await client.query(
        `UPDATE marketplace_publicaciones SET estado = 'PAUSADA' WHERE id = $1`,
        [input.publicacionId]
      )

      await client.query(
        `
          INSERT INTO mp_pagos (transaccion_id, preference_id, estado, monto, gateway)
          VALUES ($1, $2, 'PENDIENTE', $3, $4)
        `,
        [transaccionId, preferencia.preferenceId, precio, gateway]
      )

      await logEvento(client, {
        transaccionId,
        tipo: 'COMPRA_INICIADA',
        estadoNuevo: 'DEPOSITO_PENDIENTE',
        actorId: input.compradorId,
        actorRol: 'comprador',
        metadata: { preferenceId: preferencia.preferenceId, gateway },
      })

      return txRes.rows[0]
    })

    return {
      transaccion: mapTransaccion(transaccion),
      pago: {
        preferenceId: preferencia.preferenceId,
        initPoint: preferencia.initPoint,
        sandboxPoint: preferencia.sandboxPoint,
        gateway: preferencia.gateway,
        expiraEn: preferencia.expiraEn,
      },
    }
  } catch (error) {
    // Violacion del indice unico de transaccion viva por publicacion.
    if (isUniqueViolation(error)) {
      throw new ApiError(
        409,
        'PUBLICACION_NO_DISPONIBLE',
        'Ya existe una compra en curso para esta publicacion.'
      )
    }
    throw error
  }
}

// ── 2. webhookPago / procesar pago de MercadoPago ───────────────────────────

export interface ProcesarPagoInput {
  paymentId: string
  externalReferenceHint?: string | null
}

export type AccionWebhook = 'APROBADO' | 'RECHAZADO' | 'IGNORADO'

/**
 * Procesa una notificacion de pago: re-consulta el estado real a MercadoPago
 * (nunca confia en el payload) y transiciona el escrow. Idempotente.
 */
export async function webhookPago(
  input: ProcesarPagoInput
): Promise<{ accion: AccionWebhook; transaccionId: string | null }> {
  const pago = await consultarPago(input.paymentId)
  const transaccionId = pago.externalReference ?? input.externalReferenceHint ?? null

  if (!transaccionId) {
    return { accion: 'IGNORADO', transaccionId: null }
  }

  return withTx(async (client) => {
    const tx = await lockTransaccion(client, transaccionId)

    if (pago.status === 'approved') {
      // Idempotencia por payment_id: si este pago ya se contabilizo, ignorar.
      const yaContabilizado = await client.query(
        `
          SELECT 1 FROM mp_pagos
          WHERE transaccion_id = $1 AND payment_id = $2
            AND estado IN ('FONDOS_RETENIDOS', 'LIBERADO', 'REEMBOLSADO')
          LIMIT 1
        `,
        [transaccionId, input.paymentId]
      )
      if (yaContabilizado.rowCount && yaContabilizado.rowCount > 0) {
        return { accion: 'IGNORADO', transaccionId }
      }

      // Los fondos ya estan retenidos (por otro pago): no re-transicionar.
      if (tx.estado !== 'DEPOSITO_PENDIENTE') {
        return { accion: 'IGNORADO', transaccionId }
      }

      // Reclamar la fila PENDIENTE; si un intento previo la consumio (rechazo y
      // reintento con binary_mode:false), registrar una fila nueva para el pago.
      const actualizado = await client.query(
        `
          UPDATE mp_pagos
          SET payment_id = $2,
              estado = 'FONDOS_RETENIDOS',
              raw_status = $3,
              monto = COALESCE($4, monto),
              updated_at = NOW()
          WHERE id = (
            SELECT id FROM mp_pagos
            WHERE transaccion_id = $1 AND estado = 'PENDIENTE'
            ORDER BY created_at ASC
            LIMIT 1
          )
          RETURNING id
        `,
        [transaccionId, input.paymentId, pago.status, pago.monto]
      )

      if (actualizado.rowCount === 0) {
        await client.query(
          `
            INSERT INTO mp_pagos
              (transaccion_id, payment_id, estado, monto, gateway, raw_status)
            VALUES ($1, $2, 'FONDOS_RETENIDOS', COALESCE($3, 0), $4, $5)
          `,
          [
            transaccionId,
            input.paymentId,
            pago.monto,
            gatewayLabel(getModo()),
            pago.status,
          ]
        )
      }

      await client.query(
        `
          UPDATE escrow_transacciones
          SET estado = 'FONDOS_RETENIDOS', deposito_confirmado_en = NOW(), updated_at = NOW()
          WHERE id = $1
        `,
        [transaccionId]
      )

      await logEvento(client, {
        transaccionId,
        tipo: 'DEPOSITO_CONFIRMADO',
        estadoAnterior: tx.estado,
        estadoNuevo: 'FONDOS_RETENIDOS',
        actorRol: 'gateway',
        metadata: { paymentId: input.paymentId, monto: pago.monto },
      })

      return { accion: 'APROBADO', transaccionId }
    }

    if (pago.status === 'rejected' || pago.status === 'cancelled') {
      await client.query(
        `
          UPDATE mp_pagos
          SET payment_id = $2, estado = 'RECHAZADO', raw_status = $3, updated_at = NOW()
          WHERE transaccion_id = $1 AND estado = 'PENDIENTE'
        `,
        [transaccionId, input.paymentId, pago.status]
      )
      await logEvento(client, {
        transaccionId,
        tipo: 'DEPOSITO_RECHAZADO',
        actorRol: 'gateway',
        metadata: { paymentId: input.paymentId, status: pago.status },
      })
      // binary_mode:false permite reintentos: la transaccion sigue pendiente.
      return { accion: 'RECHAZADO', transaccionId }
    }

    return { accion: 'IGNORADO', transaccionId }
  })
}

// ── 3. confirmarEnvio (vendedor) ────────────────────────────────────────────

export async function confirmarEnvio(input: {
  transaccionId: string
  vendedorId: string
  trackingCode?: string | null
}) {
  return withTx(async (client) => {
    const tx = await lockTransaccion(client, input.transaccionId)

    if (tx.vendedor_id !== input.vendedorId) {
      throw new ApiError(403, 'NOT_SELLER', 'Solo el vendedor puede confirmar el envio.')
    }
    if (tx.estado !== 'FONDOS_RETENIDOS') {
      throw new ApiError(
        409,
        'ESTADO_INVALIDO',
        'El envio solo se confirma con los fondos retenidos.'
      )
    }

    const updated = await client.query<TransaccionRow>(
      `
        UPDATE escrow_transacciones
        SET estado = 'EN_CAMINO',
            envio_confirmado_en = NOW(),
            auto_release_en = NOW() + ($2 || ' days')::interval,
            tracking_code = $3,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [input.transaccionId, String(AUTO_RELEASE_DIAS), input.trackingCode ?? null]
    )

    await logEvento(client, {
      transaccionId: input.transaccionId,
      tipo: 'ENVIO_CONFIRMADO',
      estadoAnterior: 'FONDOS_RETENIDOS',
      estadoNuevo: 'EN_CAMINO',
      actorId: input.vendedorId,
      actorRol: 'vendedor',
      metadata: { trackingCode: input.trackingCode ?? null, autoReleaseDias: AUTO_RELEASE_DIAS },
    })

    return mapTransaccion(updated.rows[0])
  })
}

// ── 4. confirmarEntrega (comprador) ─────────────────────────────────────────

export async function confirmarEntrega(input: {
  transaccionId: string
  compradorId: string
}) {
  return withTx(async (client) => {
    const tx = await lockTransaccion(client, input.transaccionId)

    if (tx.comprador_id !== input.compradorId) {
      throw new ApiError(403, 'NOT_BUYER', 'Solo el comprador puede confirmar la entrega.')
    }
    if (tx.estado !== 'EN_CAMINO') {
      throw new ApiError(
        409,
        'ESTADO_INVALIDO',
        'La entrega solo se confirma cuando el envio esta en camino.'
      )
    }

    const updated = await liberarFondos(client, tx, {
      id: input.compradorId,
      rol: 'comprador',
    })

    return mapTransaccion(updated)
  })
}

// ── 5. cancelarTransaccion ──────────────────────────────────────────────────

export async function cancelarTransaccion(input: {
  transaccionId: string
  actorId: string
  actorRol?: string
  motivo?: string | null
}) {
  return withTx(async (client) => {
    const tx = await lockTransaccion(client, input.transaccionId)

    const esParte =
      tx.comprador_id === input.actorId || tx.vendedor_id === input.actorId
    if (!esParte && input.actorRol !== 'admin') {
      throw new ApiError(403, 'NOT_PARTICIPANT', 'No participas de esta transaccion.')
    }
    if (!['DEPOSITO_PENDIENTE', 'FONDOS_RETENIDOS'].includes(tx.estado)) {
      throw new ApiError(
        409,
        'ESTADO_INVALIDO',
        'La transaccion no se puede cancelar en su estado actual.'
      )
    }

    const reembolso = await reembolsarPagoRetenido(client, tx.id, input.motivo ?? null)

    const updated = await client.query<TransaccionRow>(
      `
        UPDATE escrow_transacciones
        SET estado = 'CANCELADA', cancelacion_motivo = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [tx.id, input.motivo ?? null]
    )

    // Re-activar la publicacion para que vuelva a estar disponible.
    await client.query(
      `
        UPDATE marketplace_publicaciones
        SET estado = 'ACTIVA'
        WHERE id = $1 AND estado = 'PAUSADA'
      `,
      [tx.publicacion_id]
    )

    if (reembolso) {
      await logEvento(client, {
        transaccionId: tx.id,
        tipo: 'REEMBOLSO_EMITIDO',
        actorId: input.actorId,
        actorRol: input.actorRol ?? 'parte',
        metadata: { refundId: reembolso.refundId, gateway: reembolso.gateway },
      })
    }
    await logEvento(client, {
      transaccionId: tx.id,
      tipo: 'COMPRA_CANCELADA',
      estadoAnterior: tx.estado,
      estadoNuevo: 'CANCELADA',
      actorId: input.actorId,
      actorRol: input.actorRol ?? 'parte',
      metadata: { motivo: input.motivo ?? null, reembolsado: Boolean(reembolso) },
    })

    return { transaccion: mapTransaccion(updated.rows[0]), reembolso }
  })
}

// ── 6. abrirDisputa ─────────────────────────────────────────────────────────

export async function abrirDisputa(input: {
  transaccionId: string
  actorId: string
  motivo: string
}) {
  return withTx(async (client) => {
    const tx = await lockTransaccion(client, input.transaccionId)

    const esParte =
      tx.comprador_id === input.actorId || tx.vendedor_id === input.actorId
    if (!esParte) {
      throw new ApiError(403, 'NOT_PARTICIPANT', 'No participas de esta transaccion.')
    }
    if (!['FONDOS_RETENIDOS', 'EN_CAMINO'].includes(tx.estado)) {
      throw new ApiError(
        409,
        'ESTADO_INVALIDO',
        'Solo se puede disputar con fondos en custodia o un envio en camino.'
      )
    }

    const updated = await client.query<TransaccionRow>(
      `
        UPDATE escrow_transacciones
        SET estado = 'DISPUTADA', disputa_motivo = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [tx.id, input.motivo]
    )

    await logEvento(client, {
      transaccionId: tx.id,
      tipo: 'DISPUTA_ABIERTA',
      estadoAnterior: tx.estado,
      estadoNuevo: 'DISPUTADA',
      actorId: input.actorId,
      actorRol: tx.comprador_id === input.actorId ? 'comprador' : 'vendedor',
      metadata: { motivo: input.motivo },
    })

    return mapTransaccion(updated.rows[0])
  })
}

// ── 7. resolverDisputa (admin) ──────────────────────────────────────────────

export async function resolverDisputa(input: {
  transaccionId: string
  adminId: string
  aFavor: 'COMPRADOR' | 'VENDEDOR'
  nota?: string | null
}) {
  return withTx(async (client) => {
    const tx = await lockTransaccion(client, input.transaccionId)

    if (tx.estado !== 'DISPUTADA') {
      throw new ApiError(409, 'ESTADO_INVALIDO', 'La transaccion no esta en disputa.')
    }

    if (input.aFavor === 'VENDEDOR') {
      const updated = await liberarFondos(client, tx, { id: input.adminId, rol: 'admin' })
      await logEvento(client, {
        transaccionId: tx.id,
        tipo: 'DISPUTA_RESUELTA',
        estadoNuevo: 'COMPLETADA',
        actorId: input.adminId,
        actorRol: 'admin',
        metadata: { aFavor: 'VENDEDOR', nota: input.nota ?? null },
      })
      return { transaccion: mapTransaccion(updated), reembolso: null }
    }

    // A favor del comprador: reembolso + cancelacion + re-activacion.
    const reembolso = await reembolsarPagoRetenido(client, tx.id, input.nota ?? 'Disputa a favor del comprador')

    const updated = await client.query<TransaccionRow>(
      `
        UPDATE escrow_transacciones
        SET estado = 'CANCELADA', cancelacion_motivo = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [tx.id, input.nota ?? 'Disputa a favor del comprador']
    )
    await client.query(
      `UPDATE marketplace_publicaciones SET estado = 'ACTIVA' WHERE id = $1 AND estado = 'PAUSADA'`,
      [tx.publicacion_id]
    )
    await logEvento(client, {
      transaccionId: tx.id,
      tipo: 'DISPUTA_RESUELTA',
      estadoAnterior: 'DISPUTADA',
      estadoNuevo: 'CANCELADA',
      actorId: input.adminId,
      actorRol: 'admin',
      metadata: { aFavor: 'COMPRADOR', nota: input.nota ?? null, reembolsado: Boolean(reembolso) },
    })

    return { transaccion: mapTransaccion(updated.rows[0]), reembolso }
  })
}

// ── 8. procesarAutoReleases ─────────────────────────────────────────────────

/**
 * Libera automaticamente las transacciones EN_CAMINO cuyo plazo de
 * confirmacion vencio (5 dias sin accion del comprador).
 */
export async function procesarAutoReleases(limite = 100) {
  const pendientes = await getPool().query<{ id: string }>(
    `
      SELECT id FROM escrow_transacciones
      WHERE estado = 'EN_CAMINO' AND auto_release_en IS NOT NULL AND auto_release_en <= NOW()
      ORDER BY auto_release_en ASC
      LIMIT $1
    `,
    [limite]
  )

  const liberadas: string[] = []
  for (const { id } of pendientes.rows) {
    try {
      await withTx(async (client) => {
        const tx = await lockTransaccion(client, id)
        if (tx.estado !== 'EN_CAMINO' || !tx.auto_release_en) {
          return
        }
        if (new Date(tx.auto_release_en).getTime() > Date.now()) {
          return
        }
        await liberarFondos(client, tx, { id: null, rol: 'sistema' })
        await logEvento(client, {
          transaccionId: tx.id,
          tipo: 'AUTO_RELEASE',
          estadoAnterior: 'EN_CAMINO',
          estadoNuevo: 'COMPLETADA',
          actorRol: 'sistema',
          metadata: { motivo: `${AUTO_RELEASE_DIAS} dias sin confirmacion del comprador` },
        })
        liberadas.push(tx.id)
      })
    } catch (error) {
      console.error('[escrow] auto-release fallo para', id, error)
    }
  }

  return { procesadas: pendientes.rows.length, liberadas }
}

// ── Consultas de lectura ────────────────────────────────────────────────────

export async function getTransaccion(transaccionId: string) {
  const res = await getPool().query<TransaccionRow>(
    `SELECT * FROM escrow_transacciones WHERE id = $1`,
    [transaccionId]
  )
  if (!res.rows[0]) {
    throw new ApiError(404, 'TRANSACCION_NOT_FOUND', 'La transaccion no existe.')
  }
  return mapTransaccion(res.rows[0])
}

export async function getEventos(transaccionId: string) {
  const res = await getPool().query<EventoRow>(
    `
      SELECT * FROM escrow_eventos
      WHERE transaccion_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [transaccionId]
  )
  return (res.rows as EventoRow[]).map((row) => ({
    id: row.id,
    tipo: row.tipo,
    estadoAnterior: row.estado_anterior,
    estadoNuevo: row.estado_nuevo,
    actorId: row.actor_id,
    actorRol: row.actor_rol,
    metadata: row.metadata,
    createdAt: row.created_at,
  }))
}

export async function getPagosPorTransaccion(transaccionId: string) {
  const res = await getPool().query<PagoRow>(
    `SELECT * FROM mp_pagos WHERE transaccion_id = $1 ORDER BY created_at DESC`,
    [transaccionId]
  )
  return (res.rows as PagoRow[]).map(mapPago)
}

export async function getEstadoPago(transaccionId: string) {
  const pagos = await getPagosPorTransaccion(transaccionId)
  return pagos[0] ?? null
}

/** Re-consulta a MercadoPago el ultimo pago con payment_id y reaplica el estado. */
export async function refrescarPago(transaccionId: string) {
  const pagos = await getPagosPorTransaccion(transaccionId)
  const conPayment = pagos.find((p) => p.paymentId)
  if (!conPayment || !conPayment.paymentId) {
    throw new ApiError(404, 'PAGO_NOT_FOUND', 'No hay un pago con identificador de MercadoPago.')
  }
  const resultado = await webhookPago({
    paymentId: conPayment.paymentId,
    externalReferenceHint: transaccionId,
  })
  return { resultado, pago: await getEstadoPago(transaccionId) }
}

/**
 * Simula un deposito aprobado. Solo disponible cuando NO se opera en modo LIVE
 * (es decir, en STUB o SANDBOX), para poder ejercitar el flujo sin pagos reales.
 */
export async function simularDeposito(input: {
  transaccionId: string
  paymentId?: string
}) {
  if (getModo() === 'LIVE') {
    throw new ApiError(403, 'STUB_DESHABILITADO', 'La simulacion no esta disponible en modo LIVE.')
  }
  const paymentId = input.paymentId ?? `stub-pay-${input.transaccionId}`
  return webhookPago({ paymentId, externalReferenceHint: input.transaccionId })
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  )
}
