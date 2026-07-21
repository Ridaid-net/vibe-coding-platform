import { randomUUID } from 'node:crypto'
import { ApiError, getPool, type DbClient } from '@/lib/marketplace'
import {
  buscarPagosPorExternalReference,
  consultarPago,
  crearPreferencia,
  emitirReembolso,
  getModo,
  type MercadoPagoModo,
} from '@/src/services/mercadopago.service'
import { emitirEvento } from '@/src/services/notification.service'
import {
  cancelarLiquidacionesDeTransaccion,
  registrarLiquidacionVendedor,
  registrarLiquidacionAliadoFeeExito,
} from '@/src/services/compensaciones.service'
import {
  notificarCompraCompletada,
  notificarVentaConfirmada,
} from '@/src/services/notif.service'
import {
  resolverAliadoPorBicicleta,
  contarTalleresAliadosActivos,
} from '@/src/services/aliados.service'
import { calcularEconomiaTransaccionCIT } from '@/src/services/pricing-cit.service'
import {
  transferirTitularidadBicicleta,
  anclarTransferenciaEnBFA,
  invalidarCachePorTransferencia,
} from '@/src/services/transferencia-dominio.service'

/**
 * Dispara, fuera de la transaccion (best-effort), las notificaciones de cierre de una
 * operacion COMPLETADA: VENTA_CONFIRMADA al vendedor y COMPRA_COMPLETADA al comprador.
 * Un fallo de notificacion nunca afecta la liberacion de fondos ya confirmada.
 */
async function notificarOperacionCompletada(
  tx: ReturnType<typeof mapTransaccion>
): Promise<void> {
  await Promise.allSettled([
    notificarVentaConfirmada(tx.vendedorId, {
      transaccionId: tx.id,
      montoVendedor: tx.montoVendedor,
    }),
    notificarCompraCompletada(tx.compradorId, { transaccionId: tx.id }),
  ])
}

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
 *   retirarPublicacion(vendedor) -> publicacion CANCELADA (solo si NO hay
 *                                   ninguna escrow_transacciones no-terminal
 *                                   asociada -- nunca toca bicicletas/cits)
 *
 *   Fase 6 (CIT Completo) — flujo de DOS pagos secuenciales, sena -> saldo,
 *   O de un pago unico si la bici ya esta certificada (ver
 *   iniciarReservaCitCompleto):
 *   iniciarReservaCitCompleto()  -> RESERVA_PENDIENTE (sena, publicacion RESERVADO)
 *                                   o SALDO_PENDIENTE directo (bici ya certificada,
 *                                   publicacion EJECUTANDO_LOGISTICA, sin sena)
 *   webhookPago(sena aprobada)   -> RESERVADA (financia la verificacion del Taller)
 *   aprobarInspeccionFisica()    -> (inspeccion.service.ts) publicacion EJECUTANDO_LOGISTICA
 *   confirmarPagoCitCompleto()   -> SALDO_PENDIENTE (saldo: precio + logistica)
 *   webhookPago(saldo aprobado)  -> FONDOS_RETENIDOS (reserva_vence_en se limpia aca,
 *                                   saldo_confirmado_en se estampa aca)
 *
 *   Fase 6b (Remito de Embalaje y Despacho, remito.service.ts) — vive DENTRO
 *   de FONDOS_RETENIDOS, no agrega ningun estado nuevo al enum: generarRemito()
 *   (vendedor, accion explicita) -> confirmarDespachoRemito() (Taller, firma
 *   con su wallet_address) -> liquida el Fee de Logistica. remitos.estado
 *   (GENERADO/DESPACHADO) es la fuente de verdad de este sub-tramo.
 *
 *   Cierre de CIT Completo (RESUELTO 2026-07-11, commit 233922f -- este
 *   comentario estuvo desactualizado un tiempo, ver tambien CLAUDE.md):
 *   confirmarEntregaCitCompleto() es el cierre real de este flujo. Lo dispara
 *   el COMPRADOR al confirmar que recibio la bici: FONDOS_RETENIDOS ->
 *   COMPLETADA, libera el pago, transfiere la titularidad real
 *   (transferencia-dominio.service.ts) y liquida el vendedor + la mitad del
 *   Taller Aliado en el Fee de Exito. El Fee de Logistica (embalaje) NO se
 *   liquida aca -- se liquida antes, en confirmarDespachoRemito()
 *   (remito.service.ts), cuando el Taller confirma que efectivamente embalo
 *   y despacho la bici (boton "Despacho a Logistica" del Remito, Fase 6b).
 *   Mismo criterio que el Fee de Verificacion (se paga al sellar el
 *   checklist, no al cerrarse la venta): el Taller cobra por el trabajo que
 *   el hizo, sin depender de una confirmacion de un tercero dias despues.
 *
 *   Auditoria de integridad de dinero (misma fecha): procesarReservasVencidas()
 *   reconcilia contra MercadoPago (buscarPagosPorExternalReference) ANTES de
 *   revertir cualquier reserva con un pago PENDIENTE -- un webhook perdido o
 *   tardio ya no alcanza para cancelar una reserva realmente pagada. Ver el
 *   comentario de esa funcion para el detalle completo.
 */

export type EscrowEstado =
  | 'DEPOSITO_PENDIENTE'
  | 'FONDOS_RETENIDOS'
  | 'EN_CAMINO'
  | 'COMPLETADA'
  | 'CANCELADA'
  | 'DISPUTADA'
  // Fase 6 (CIT Completo): flujo de dos pagos, sena -> certificacion, saldo -> venta.
  | 'RESERVA_PENDIENTE'
  | 'RESERVADA'
  | 'SALDO_PENDIENTE'
  | 'RESERVA_VENCIDA'

/**
 * Mapeo conceptual EXPRESS / EN_TRANSFERENCIA / TRANSFERIDO (auditoria de
 * modelo de datos, 2026-07-16) -- vocabulario de negocio para describir la
 * titularidad de UN RODADO, NO una tabla ni un enum nuevo. Decision explicita:
 * no crear una tabla/enum "Token" separada -- se deriva enteramente de
 * `escrow_transacciones.estado` (mas `bicicletas.propietario_id`, que solo
 * cambia en la liquidacion final, ver liberarFondos() abajo). Si en el futuro
 * el frontend necesita exponer este mapeo repetidamente, evaluar una VISTA
 * SQL sobre estas mismas tablas -- no una tabla nueva a mantener sincronizada.
 *
 * NO CONFUNDIR con "CIT Express" (el producto comercial, cit-express*.service.ts)
 * -- es una coincidencia de nombre, sin relacion conceptual alguna.
 *
 *   EXPRESS         -> no existe ninguna fila de escrow_transacciones en un
 *                      estado no-terminal para este rodado (o la mas reciente
 *                      ya es terminal). El rodado no tiene ninguna venta en
 *                      curso; su titular puede publicarlo o transferirlo
 *                      libremente.
 *   EN_TRANSFERENCIA -> existe una fila de escrow_transacciones en un estado
 *                      no-terminal: DEPOSITO_PENDIENTE, RESERVA_PENDIENTE,
 *                      RESERVADA, SALDO_PENDIENTE, FONDOS_RETENIDOS,
 *                      EN_CAMINO o DISPUTADA. Hay una venta en curso.
 *   TRANSFERIDO     -> esa transaccion llego a COMPLETADA: liberarFondos() ya
 *                      corrio, bicicletas.propietario_id ya refleja al nuevo
 *                      dueno y cit_transferencias tiene el registro inmutable
 *                      del cambio (ver transferencia-dominio.service.ts). El
 *                      CIT en si nunca cambia de id ni se re-emite.
 *   Reversion EN_TRANSFERENCIA -> EXPRESS -> CANCELADA o RESERVA_VENCIDA (o
 *                      DISPUTADA resuelta a favor del comprador/reembolso): la
 *                      publicacion vuelve a estar disponible SIN que
 *                      bicicletas.propietario_id se haya tocado nunca, porque
 *                      transferirTitularidadBicicleta() -- vía liberarFondos()
 *                      -- solo se llama desde los caminos de cierre exitoso
 *                      (confirmarEntrega/confirmarEntregaCitCompleto/
 *                      resolverDisputa a favor del vendedor/procesarAutoReleases),
 *                      nunca antes. Una cancelacion nunca revierte una
 *                      escritura ya hecha, porque todavia no se escribio nada.
 */

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
  /** Fase 5 (CIT Completo): ventana de 48hs de la reserva. Distinto de auto_release_en. */
  reserva_vence_en: string | null
  expira_en: string | null
  created_at: string
  updated_at: string
  // Fase 6 (CIT Completo): snapshot congelado de fees, ver pricing-cit.service.ts
  aliado_id: string | null
  disparo_verificacion: boolean
  fee_verificacion_ars: string
  fee_logistica_cobrado_comprador_ars: string
  fee_logistica_pagado_taller_ars: string
  fee_exito_total_ars: string
  fee_exito_rodaid_ars: string
  fee_exito_taller_ars: string
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
    reservaVenceEn: row.reserva_vence_en,
    expiraEn: row.expira_en,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    aliadoId: row.aliado_id,
    disparoVerificacion: row.disparo_verificacion,
    feeVerificacionARS: Number(row.fee_verificacion_ars),
    feeLogisticaCobradoCompradorARS: Number(row.fee_logistica_cobrado_comprador_ars),
    feeLogisticaPagadoTallerARS: Number(row.fee_logistica_pagado_taller_ars),
    feeExitoTotalARS: Number(row.fee_exito_total_ars),
    feeExitoRodaidARS: Number(row.fee_exito_rodaid_ars),
    feeExitoTallerARS: Number(row.fee_exito_taller_ars),
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

/** Exportado para remito.service.ts: misma disciplina de transaccion/lock/auditoria que el resto del escrow. */
export async function withTx<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
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

export async function lockTransaccion(
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

export async function logEvento(
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

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Libera los fondos al vendedor y marca la publicacion como VENDIDA. */
async function liberarFondos(
  client: DbClient,
  tx: TransaccionRow,
  actor: { id: string | null; rol: string }
): Promise<{ transaccion: TransaccionRow; transferenciaId: string | null; numeroSerie: string | null }> {
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

  // Transferencia REAL de titularidad — mismo criterio que la liberacion de
  // fondos: si "entrega confirmada" alcanza para soltar el dinero, alcanza
  // para transferir la bici. Cubre los 4 caminos que llegan hasta aca:
  // confirmarEntrega, resolverDisputa a favor del vendedor,
  // procesarAutoReleases y confirmarEntregaCitCompleto.
  const pubRow = await client.query<{ cit_id: string | null; bicicleta_id: string | null }>(
    `SELECT cit_id, bicicleta_id FROM marketplace_publicaciones WHERE id = $1`,
    [tx.publicacion_id]
  )
  let transferenciaId: string | null = null
  let numeroSerie: string | null = null
  if (pubRow.rows[0]?.cit_id && pubRow.rows[0]?.bicicleta_id) {
    const resultado = await transferirTitularidadBicicleta(client, {
      citId: pubRow.rows[0].cit_id,
      bicicletaId: pubRow.rows[0].bicicleta_id,
      propietarioAnteriorId: tx.vendedor_id,
      propietarioNuevoId: tx.comprador_id,
      motivo: 'venta_marketplace',
      escrowTransaccionId: tx.id,
      actorId: actor.id,
      actorRol: actor.rol,
    })
    transferenciaId = resultado.transferenciaId
    numeroSerie = resultado.numeroSerie
  }

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
      transferenciaId,
    },
  })
  await logEvento(client, {
    transaccionId: tx.id,
    tipo: 'ENTREGA_CONFIRMADA_FONDOS_LIBERADOS',
    estadoNuevo: 'COMPLETADA',
    actorId: actor.id,
    actorRol: actor.rol,
  })

  // Hito 13 (RODAID PAY): registra la deuda a pagar al vendedor (precio -
  // comision) de forma ATOMICA con la liberacion. La transferencia real se
  // ejecuta despues, de modo asincrono; si falla, el escrow vuelve a DISPUTADA.
  await registrarLiquidacionVendedor(client, {
    transaccionId: tx.id,
    vendedorId: tx.vendedor_id,
    montoVendedor: Number(tx.monto_vendedor),
    comision: Number(tx.comision_rodaid),
  })

  return { transaccion: updated.rows[0], transferenciaId, numeroSerie }
}

/** Best-effort, fuera de la transaccion: anclaje BFA + invalidacion de cache. */
async function cerrarTransferenciaPostCommit(
  transferenciaId: string | null,
  numeroSerie: string | null
): Promise<void> {
  if (!transferenciaId) return
  await Promise.allSettled([
    anclarTransferenciaEnBFA(transferenciaId),
    invalidarCachePorTransferencia(numeroSerie),
  ])
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

    // Hito 10: avisar al vendedor que recibio una oferta (best-effort).
    await emitirEvento({
      tipo: 'marketplace.oferta',
      usuarioId: pub.vendedor_id,
      data: { publicacionId: input.publicacionId, publicacionTitulo: pub.titulo },
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

/** Transicion de escrow que produce un pago APROBADO, segun el estado ACTUAL de la fila (nunca el payload). */
const TRANSICIONES_APROBADO: Partial<Record<EscrowEstado, EscrowEstado>> = {
  DEPOSITO_PENDIENTE: 'FONDOS_RETENIDOS',
  RESERVA_PENDIENTE: 'RESERVADA',
  SALDO_PENDIENTE: 'FONDOS_RETENIDOS',
}

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

  const resultado = (await withTx(async (client) => {
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

      const estadoNuevo = TRANSICIONES_APROBADO[tx.estado]
      // Los fondos ya estan en otro estado (retenidos por otro pago, reserva
      // vencida, disputa, etc.): no re-transicionar.
      if (!estadoNuevo) {
        // Un pago aprobado que llega para una fila ya CANCELADA/RESERVA_VENCIDA
        // es plata real que quedo sin reconciliar (webhook tardio + barrido que
        // ya actuo, carrera residual incluso con la reconciliacion de
        // procesarReservasVencidas). Nunca debe pasar en silencio.
        if (tx.estado === 'CANCELADA' || tx.estado === 'RESERVA_VENCIDA') {
          console.error(
            `[escrow] pago APROBADO de MercadoPago llego para una transaccion ya ${tx.estado} -- posible plata sin reconciliar.`,
            { transaccionId, paymentId: input.paymentId, monto: pago.monto, estado: tx.estado }
          )
        }
        return { accion: 'IGNORADO', transaccionId }
      }

      // Reclamar la fila PENDIENTE (sena o saldo, segun cual este vigente); si
      // un intento previo la consumio, registrar una fila nueva para el pago.
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

      if (tx.estado === 'DEPOSITO_PENDIENTE') {
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
          estadoNuevo,
          actorRol: 'gateway',
          metadata: { paymentId: input.paymentId, monto: pago.monto },
        })
        return { accion: 'APROBADO', transaccionId, vendedorId: tx.vendedor_id }
      }

      if (tx.estado === 'RESERVA_PENDIENTE') {
        // Fase 6: la sena se confirmo -- financia la verificacion del Taller.
        await client.query(
          `UPDATE escrow_transacciones SET estado = 'RESERVADA', updated_at = NOW() WHERE id = $1`,
          [transaccionId]
        )
        await logEvento(client, {
          transaccionId,
          tipo: 'RESERVA_CONFIRMADA',
          estadoAnterior: tx.estado,
          estadoNuevo,
          actorRol: 'gateway',
          metadata: { paymentId: input.paymentId, monto: pago.monto },
        })
        return { accion: 'APROBADO', transaccionId, aliadoId: tx.aliado_id }
      }

      // tx.estado === 'SALDO_PENDIENTE'
      // TODO(cierre CIT Completo): ver el TODO en el comentario de la maquina
      // de estados al inicio del archivo -- este UPDATE deja la transaccion en
      // FONDOS_RETENIDOS pero no hay ningun endpoint que la libere todavia.
      // reserva_vence_en se limpia ACA: una vez cobrado el saldo completo, el
      // reloj de procesarReservasVencidas() debe dejar de correr para esta
      // fila -- si no, el barrido la vuelve a encontrar (pub.estado sigue en
      // EJECUTANDO_LOGISTICA, nadie lo cambia despues de esto) y la degrada a
      // CANCELADA pese a estar totalmente pagada.
      await client.query(
        `UPDATE escrow_transacciones SET estado = 'FONDOS_RETENIDOS', reserva_vence_en = NULL, updated_at = NOW() WHERE id = $1`,
        [transaccionId]
      )
      await logEvento(client, {
        transaccionId,
        tipo: 'SALDO_CONFIRMADO',
        estadoAnterior: tx.estado,
        estadoNuevo,
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
  })) as {
    accion: AccionWebhook
    transaccionId: string | null
    vendedorId?: string
    aliadoId?: string | null
  }

  // Hito 10: fondos retenidos -> avisar al vendedor (best-effort, fuera de la tx).
  if (resultado.accion === 'APROBADO' && resultado.vendedorId) {
    await emitirEvento({
      tipo: 'escrow.fondos_retenidos',
      usuarioId: resultado.vendedorId,
      data: { transaccionId: resultado.transaccionId },
    })
  }

  // Fase 6: sena confirmada -> avisar al Taller Aliado que hay una verificacion esperando.
  if (resultado.accion === 'APROBADO' && resultado.aliadoId) {
    const aliadoUsuario = await getPool().query<{ usuario_id: string | null }>(
      `SELECT usuario_id FROM aliados WHERE id = $1`,
      [resultado.aliadoId]
    )
    const usuarioId = aliadoUsuario.rows[0]?.usuario_id ?? null
    if (usuarioId) {
      await emitirEvento({
        tipo: 'escrow.verificacion_solicitada',
        usuarioId,
        data: { transaccionId: resultado.transaccionId },
      })
    }
  }

  return { accion: resultado.accion, transaccionId: resultado.transaccionId }
}

// ── 2b. iniciarReservaCitCompleto (Fase 6: reserva del comprador) ───────────

export interface IniciarReservaCitCompletoInput {
  publicacionId: string
  compradorId: string
  compradorEmail?: string | null
  compradorNombre?: string | null
}

/**
 * Primer paso del flujo de CIT Completo: reservar. Solo aplica a publicaciones
 * en el ciclo de CIT Completo (PUBLICADO_PENDIENTE_CERTIFICACION o
 * PUBLICADO_CERTIFICADO) -- una publicacion 'ACTIVA' generica sigue usando
 * iniciarCompra()/comprar, nunca este flujo.
 *
 * Opcion A (confirmada): si la bici no tiene un Taller Aliado vinculado via
 * aliado_servicios, bloquea con 422 SIN_TALLER_VINCULADO -- no hay asignacion
 * dinamica todavia (ver resolverAliadoPorBicicleta en aliados.service.ts).
 *
 * Fase 3: PUBLICADO_CERTIFICADO ya paso por una inspeccion APROBADA (de una
 * reserva anterior vencida, o de una certificacion directa). Un segundo
 * comprador NO dispara ni paga una nueva verificacion -- el Taller ya cobro
 * el fee_verificacion_ars esa unica vez (registrarLiquidacionAliadoFeeVerificacion,
 * en aprobarInspeccionFisica). Por eso esta reserva salta directo a
 * EJECUTANDO_LOGISTICA (nada que inspeccionar) y cobra el saldo completo
 * (precio + logistica) en un solo pago (concepto 'saldo'), sin pasar por
 * RESERVA_PENDIENTE/RESERVADA -- confirmarPagoCitCompleto no aplica a este
 * camino, nunca va a encontrar una fila RESERVADA para el.
 *
 * marketplace_publicaciones transiciona ACA, al crear la preferencia -- NO
 * espera a que el pago se confirme. Mismo patron anti-doble-reserva que
 * iniciarCompra() (que pausa la publicacion de igual forma): si el pago nunca
 * llega, procesarReservasVencidas() revierte la publicacion a los 48hs.
 */
export async function iniciarReservaCitCompleto(input: IniciarReservaCitCompletoInput) {
  const pool = getPool()

  const pre = await pool.query<{
    id: string
    vendedor_id: string
    estado: string
    titulo: string
    descripcion: string
    precio_ars: string
    bicicleta_id: string
  }>(
    `
      SELECT id, vendedor_id, estado, titulo, descripcion, precio_ars, bicicleta_id
      FROM marketplace_publicaciones
      WHERE id = $1
    `,
    [input.publicacionId]
  )

  const pub = pre.rows[0]
  if (!pub) {
    throw new ApiError(404, 'PUBLICACION_NOT_FOUND', 'La publicacion no existe.')
  }
  if (
    pub.estado !== 'PUBLICADO_PENDIENTE_CERTIFICACION' &&
    pub.estado !== 'PUBLICADO_CERTIFICADO'
  ) {
    throw new ApiError(
      409,
      'PUBLICACION_NO_DISPONIBLE',
      'La publicacion no esta disponible para reservar.'
    )
  }
  if (pub.vendedor_id === input.compradorId) {
    throw new ApiError(422, 'COMPRADOR_ES_VENDEDOR', 'No podes reservar tu propia publicacion.')
  }

  // El Taller sigue siendo necesario en ambos casos: si hay que verificar,
  // ejecuta la inspeccion; si la bici ya esta certificada, es quien cobra
  // logistica/exito igual (resolverAliadoPorBicicleta es "el vinculo mas
  // reciente", no necesariamente el que certifico originalmente).
  const aliadoId = await resolverAliadoPorBicicleta(pub.bicicleta_id)
  if (!aliadoId) {
    const activos = await contarTalleresAliadosActivos()
    console.warn(
      `[escrow] /reservar bloqueado por SIN_TALLER_VINCULADO (publicacion ${pub.id}). Talleres Aliados activos: ${activos}.`
    )
    throw new ApiError(
      422,
      'SIN_TALLER_VINCULADO',
      'Esta bicicleta no tiene un Taller Aliado vinculado. No se puede reservar todavia.'
    )
  }

  const economia = await calcularEconomiaTransaccionCIT(Number(pub.precio_ars))
  const yaCertificada = pub.estado === 'PUBLICADO_CERTIFICADO'

  const plan = yaCertificada
    ? {
        estadoEscrow: 'SALDO_PENDIENTE' as const,
        estadoPublicacion: 'EJECUTANDO_LOGISTICA' as const,
        concepto: 'saldo' as const,
        montoARS: round2(
          economia.valorVentaARS + economia.ejecucion.feeLogisticaCobradoCompradorARS
        ),
        titulo: `Saldo — ${pub.titulo}`,
        descripcion:
          'Precio de la bici + logistica de entrega coordinada por el Taller Aliado (bici ya certificada).',
        feeVerificacionARS: 0,
        feeLogisticaCobradoCompradorARS: economia.ejecucion.feeLogisticaCobradoCompradorARS,
        feeLogisticaPagadoTallerARS: economia.ejecucion.feeLogisticaPagadoTallerARS,
        feeExitoTotalARS: economia.ejecucion.feeExitoTotalARS,
        feeExitoRodaidARS: economia.ejecucion.feeExitoRodaidARS,
        feeExitoTallerARS: economia.ejecucion.feeExitoTallerARS,
        comisionRodaid: economia.ejecucion.feeExitoRodaidARS,
        montoVendedor: round2(economia.valorVentaARS - economia.ejecucion.feeExitoTotalARS),
      }
    : {
        estadoEscrow: 'RESERVA_PENDIENTE' as const,
        estadoPublicacion: 'RESERVADO' as const,
        concepto: 'sena' as const,
        montoARS: economia.certificacion.precioPublicadoARS,
        titulo: `Sena de verificacion — ${pub.titulo}`,
        descripcion: 'Financia la certificacion tecnica de 20 puntos del Taller Aliado.',
        feeVerificacionARS: economia.certificacion.feeVerificacionARS,
        feeLogisticaCobradoCompradorARS: 0,
        feeLogisticaPagadoTallerARS: 0,
        feeExitoTotalARS: 0,
        feeExitoRodaidARS: 0,
        feeExitoTallerARS: 0,
        comisionRodaid: economia.certificacion.margenRodaidARS,
        montoVendedor: 0,
      }

  const transaccionId = randomUUID()

  const preferencia = await crearPreferencia({
    transaccionId,
    titulo: plan.titulo,
    descripcion: plan.descripcion,
    precioARS: plan.montoARS,
    compradorEmail: input.compradorEmail,
    compradorNombre: input.compradorNombre,
  })
  const gateway = gatewayLabel(preferencia.gateway)

  try {
    const transaccion = await withTx(async (client) => {
      const locked = await client.query<{ estado: string }>(
        `SELECT estado FROM marketplace_publicaciones WHERE id = $1 FOR UPDATE`,
        [input.publicacionId]
      )
      // Re-verifica bajo lock el MISMO estado detectado antes de llamar a MP
      // (evita una carrera con otra reserva o con una re-inspeccion concurrente).
      if (locked.rows[0]?.estado !== pub.estado) {
        throw new ApiError(
          409,
          'PUBLICACION_NO_DISPONIBLE',
          'La publicacion ya no esta disponible para reservar.'
        )
      }

      const txRes = await client.query<TransaccionRow>(
        `
          INSERT INTO escrow_transacciones (
            id, publicacion_id, comprador_id, vendedor_id, estado, plan,
            precio_ars, comision_rodaid, monto_vendedor, gateway,
            preference_id, init_point, expira_en, reserva_vence_en,
            aliado_id, disparo_verificacion, fee_verificacion_ars,
            fee_logistica_cobrado_comprador_ars, fee_logistica_pagado_taller_ars,
            fee_exito_total_ars, fee_exito_rodaid_ars, fee_exito_taller_ars
          )
          VALUES ($1, $2, $3, $4, $5, 'LIBRE',
                  $6, $7, $8, $9, $10, $11, $12, NOW() + INTERVAL '48 hours',
                  $13, $14, $15, $16, $17, $18, $19, $20)
          RETURNING *
        `,
        [
          transaccionId,
          input.publicacionId,
          input.compradorId,
          pub.vendedor_id,
          plan.estadoEscrow,
          Number(pub.precio_ars),
          plan.comisionRodaid,
          plan.montoVendedor,
          gateway,
          preferencia.preferenceId,
          preferencia.initPoint,
          preferencia.expiraEn,
          aliadoId,
          !yaCertificada,
          plan.feeVerificacionARS,
          plan.feeLogisticaCobradoCompradorARS,
          plan.feeLogisticaPagadoTallerARS,
          plan.feeExitoTotalARS,
          plan.feeExitoRodaidARS,
          plan.feeExitoTallerARS,
        ]
      )

      await client.query(
        `UPDATE marketplace_publicaciones SET estado = $2 WHERE id = $1`,
        [input.publicacionId, plan.estadoPublicacion]
      )

      await client.query(
        `
          INSERT INTO mp_pagos (transaccion_id, preference_id, estado, monto, gateway, concepto)
          VALUES ($1, $2, 'PENDIENTE', $3, $4, $5)
        `,
        [transaccionId, preferencia.preferenceId, plan.montoARS, gateway, plan.concepto]
      )

      await logEvento(client, {
        transaccionId,
        tipo: yaCertificada ? 'SALDO_INICIADO_SIN_VERIFICACION' : 'RESERVA_INICIADA',
        estadoNuevo: plan.estadoEscrow,
        actorId: input.compradorId,
        actorRol: 'comprador',
        metadata: {
          preferenceId: preferencia.preferenceId,
          gateway,
          aliadoId,
          disparoVerificacion: !yaCertificada,
        },
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
        montoARS: plan.montoARS,
        concepto: plan.concepto,
      },
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(
        409,
        'PUBLICACION_NO_DISPONIBLE',
        'Ya existe una reserva en curso para esta publicacion.'
      )
    }
    throw error
  }
}

// ── 2c. confirmarPagoCitCompleto (Fase 6: saldo, precio + logistica) ────────

export interface ConfirmarPagoCitCompletoInput {
  publicacionId: string
  compradorId: string
  compradorEmail?: string | null
  compradorNombre?: string | null
}

/**
 * Segundo pago del flujo de CIT Completo: el saldo. Solo se puede iniciar
 * cuando el Taller ya sello la verificacion (publicacion EJECUTANDO_LOGISTICA)
 * -- si el Taller todavia no inspecciono, 409 VERIFICACION_PENDIENTE. No
 * aplica al camino de bici-ya-certificada (iniciarReservaCitCompleto ya cobro
 * el saldo completo en un solo pago para ese caso).
 *
 * El comprador paga precio de venta + logistica-a-costo-mas-comision-pasarela
 * (feeLogisticaCobradoCompradorARS); el fee de exito NO se le cobra aparte al
 * comprador -- se descuenta de lo que recibe el vendedor (ver
 * pricing-cit.service.ts). Los 5 montos de ejecucion se congelan aca mismo.
 */
export async function confirmarPagoCitCompleto(input: ConfirmarPagoCitCompletoInput) {
  const pool = getPool()

  const pubRes = await pool.query<{ id: string; estado: string; titulo: string }>(
    `SELECT id, estado, titulo FROM marketplace_publicaciones WHERE id = $1`,
    [input.publicacionId]
  )
  const pub = pubRes.rows[0]
  if (!pub) {
    throw new ApiError(404, 'PUBLICACION_NOT_FOUND', 'La publicacion no existe.')
  }
  if (pub.estado !== 'EJECUTANDO_LOGISTICA') {
    throw new ApiError(
      409,
      'VERIFICACION_PENDIENTE',
      'Todavia no se completo la verificacion tecnica del Taller Aliado.'
    )
  }

  const txRes = await pool.query<TransaccionRow>(
    `SELECT * FROM escrow_transacciones WHERE publicacion_id = $1 AND estado = 'RESERVADA'`,
    [input.publicacionId]
  )
  const tx = txRes.rows[0]
  if (!tx) {
    throw new ApiError(
      404,
      'TRANSACCION_NOT_FOUND',
      'No hay una reserva con sena confirmada esperando el saldo para esta publicacion.'
    )
  }
  if (tx.comprador_id !== input.compradorId) {
    throw new ApiError(403, 'NOT_BUYER', 'Solo el comprador de la reserva puede confirmar el saldo.')
  }

  const economia = await calcularEconomiaTransaccionCIT(Number(tx.precio_ars))
  const saldoARS = round2(economia.valorVentaARS + economia.ejecucion.feeLogisticaCobradoCompradorARS)

  const preferencia = await crearPreferencia({
    transaccionId: tx.id,
    titulo: `Saldo — ${pub.titulo}`,
    descripcion: 'Precio de la bici + logistica de entrega coordinada por el Taller Aliado.',
    precioARS: saldoARS,
    compradorEmail: input.compradorEmail,
    compradorNombre: input.compradorNombre,
  })
  const gateway = gatewayLabel(preferencia.gateway)

  const transaccion = await withTx(async (client) => {
    const locked = await lockTransaccion(client, tx.id)
    if (locked.estado !== 'RESERVADA') {
      throw new ApiError(409, 'ESTADO_INVALIDO', 'La reserva ya no esta en un estado valido para el saldo.')
    }
    if (locked.comprador_id !== input.compradorId) {
      throw new ApiError(403, 'NOT_BUYER', 'Solo el comprador de la reserva puede confirmar el saldo.')
    }

    const pubLocked = await client.query<{ estado: string }>(
      `SELECT estado FROM marketplace_publicaciones WHERE id = $1 FOR UPDATE`,
      [input.publicacionId]
    )
    if (pubLocked.rows[0]?.estado !== 'EJECUTANDO_LOGISTICA') {
      throw new ApiError(
        409,
        'VERIFICACION_PENDIENTE',
        'Todavia no se completo la verificacion tecnica del Taller Aliado.'
      )
    }

    const updated = await client.query<TransaccionRow>(
      `
        UPDATE escrow_transacciones
        SET estado = 'SALDO_PENDIENTE',
            preference_id = $2,
            init_point = $3,
            fee_logistica_cobrado_comprador_ars = $4,
            fee_logistica_pagado_taller_ars = $5,
            fee_exito_total_ars = $6,
            fee_exito_rodaid_ars = $7,
            fee_exito_taller_ars = $8,
            comision_rodaid = $9,
            monto_vendedor = $10,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [
        tx.id,
        preferencia.preferenceId,
        preferencia.initPoint,
        economia.ejecucion.feeLogisticaCobradoCompradorARS,
        economia.ejecucion.feeLogisticaPagadoTallerARS,
        economia.ejecucion.feeExitoTotalARS,
        economia.ejecucion.feeExitoRodaidARS,
        economia.ejecucion.feeExitoTallerARS,
        round2(Number(locked.comision_rodaid) + economia.ejecucion.feeExitoRodaidARS),
        round2(economia.valorVentaARS - economia.ejecucion.feeExitoTotalARS),
      ]
    )

    await client.query(
      `
        INSERT INTO mp_pagos (transaccion_id, preference_id, estado, monto, gateway, concepto)
        VALUES ($1, $2, 'PENDIENTE', $3, $4, 'saldo')
      `,
      [tx.id, preferencia.preferenceId, saldoARS, gateway]
    )

    await logEvento(client, {
      transaccionId: tx.id,
      tipo: 'SALDO_INICIADO',
      estadoAnterior: 'RESERVADA',
      estadoNuevo: 'SALDO_PENDIENTE',
      actorId: input.compradorId,
      actorRol: 'comprador',
      metadata: { preferenceId: preferencia.preferenceId, saldoARS },
    })

    return updated.rows[0]
  })

  return {
    transaccion: mapTransaccion(transaccion),
    pago: {
      preferenceId: preferencia.preferenceId,
      initPoint: preferencia.initPoint,
      sandboxPoint: preferencia.sandboxPoint,
      gateway: preferencia.gateway,
      expiraEn: preferencia.expiraEn,
      montoARS: saldoARS,
      concepto: 'saldo' as const,
    },
  }
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
  const transaccion = await withTx(async (client) => {
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

    const { transaccion: updated, transferenciaId, numeroSerie } = await liberarFondos(client, tx, {
      id: input.compradorId,
      rol: 'comprador',
    })

    return { transaccion: mapTransaccion(updated), transferenciaId, numeroSerie }
  })

  await notificarOperacionCompletada(transaccion.transaccion)
  await cerrarTransferenciaPostCommit(transaccion.transferenciaId, transaccion.numeroSerie)
  return transaccion.transaccion
}

// ── 4b. confirmarEntregaCitCompleto (comprador, cierre de CIT Completo) ────

/**
 * Cierre de CIT Completo: el comprador confirma la recepcion directo desde
 * FONDOS_RETENIDOS -- CIT Completo no usa el paso EN_CAMINO/confirmarEnvio del
 * flujo generico, porque la "logistica" la coordina el Taller Aliado antes de
 * llegar a este punto, no es un envio postal del vendedor. Libera el pago,
 * transfiere la titularidad real y liquida vendedor + la mitad del Taller
 * Aliado en el Fee de Exito. NO liquida el Fee de Logistica (embalaje) --
 * eso ya se liquido antes, en confirmarDespachoRemito() (remito.service.ts),
 * cuando el Taller confirmo el trabajo hecho (ver el comentario de la maquina
 * de estados al inicio del archivo, seccion "Fase 6b").
 */
export async function confirmarEntregaCitCompleto(input: {
  transaccionId: string
  compradorId: string
}) {
  const resultado = await withTx(async (client) => {
    const tx = await lockTransaccion(client, input.transaccionId)

    if (tx.comprador_id !== input.compradorId) {
      throw new ApiError(403, 'NOT_BUYER', 'Solo el comprador puede confirmar la entrega.')
    }
    if (!tx.aliado_id) {
      throw new ApiError(409, 'NO_ES_CIT_COMPLETO', 'Esta operacion no corresponde al flujo de CIT Completo.')
    }
    if (tx.estado !== 'FONDOS_RETENIDOS') {
      throw new ApiError(
        409,
        'ESTADO_INVALIDO',
        'La entrega solo se confirma con los fondos retenidos.'
      )
    }

    const { transaccion: updated, transferenciaId, numeroSerie } = await liberarFondos(client, tx, {
      id: input.compradorId,
      rol: 'comprador',
    })

    await registrarLiquidacionAliadoFeeExito(client, {
      transaccionId: tx.id,
      aliadoId: tx.aliado_id,
      monto: Number(tx.fee_exito_taller_ars),
    })

    await logEvento(client, {
      transaccionId: tx.id,
      tipo: 'CIT_COMPLETO_ENTREGA_CONFIRMADA',
      estadoAnterior: 'FONDOS_RETENIDOS',
      estadoNuevo: 'COMPLETADA',
      actorId: input.compradorId,
      actorRol: 'comprador',
    })

    return { transaccion: mapTransaccion(updated), transferenciaId, numeroSerie }
  })

  await notificarOperacionCompletada(resultado.transaccion)
  await cerrarTransferenciaPostCommit(resultado.transferenciaId, resultado.numeroSerie)
  return resultado.transaccion
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

// ── 5b. retirarPublicacion (vendedor, sin operacion viva) ───────────────────

/**
 * Estados de marketplace_publicaciones sin ninguna operacion de escrow en
 * curso (ver el mapeo EXPRESS/EN_TRANSFERENCIA/TRANSFERIDO mas arriba en
 * este archivo -- estos tres son exactamente el equivalente "EXPRESS" a
 * nivel publicacion). PAUSADA/RESERVADO/EJECUTANDO_LOGISTICA quedan afuera a
 * proposito: siempre reflejan una fila de escrow_transacciones en un estado
 * no-terminal (toda transicion del escrow actualiza ambas tablas en la misma
 * transaccion de DB -- confirmado leyendo iniciarCompra(),
 * iniciarReservaCitCompleto(), webhookPago() y procesarReservasVencidas()).
 *
 * Exportado: mismo set que usa retirarPublicacion() abajo Y el endpoint de
 * editar contenido (app/api/v1/marketplace/[id]/editar/route.ts) -- mismo
 * criterio de "sin comprador comprometido", confirmado explicitamente por
 * Federico para reusar en vez de duplicar la lista.
 */
export const ESTADOS_PUBLICACION_SIN_OPERACION_VIVA = new Set([
  'ACTIVA',
  'PUBLICADO_PENDIENTE_CERTIFICACION',
  'PUBLICADO_CERTIFICADO',
])

/**
 * El vendedor retira su propia publicacion. Nunca toca `bicicletas` ni
 * `cits` -- es puramente un cambio de estado de `marketplace_publicaciones`,
 * misma logica que ya usan cancelarTransaccion()/procesarReservasVencidas()
 * (ninguna de las dos toca la identidad del rodado tampoco). El estado
 * destino, CANCELADA, ya existia en el enum desde la migracion original
 * (20260606180000) y ya tenia label en mis-publicaciones.tsx -- nunca se
 * habia escrito hasta ahora.
 */
export async function retirarPublicacion(input: {
  publicacionId: string
  vendedorId: string
}) {
  return withTx(async (client) => {
    const pubRes = await client.query<{
      id: string
      vendedor_id: string
      estado: string
    }>(
      `SELECT id, vendedor_id, estado FROM marketplace_publicaciones WHERE id = $1 FOR UPDATE`,
      [input.publicacionId]
    )
    const pub = pubRes.rows[0]
    if (!pub) {
      throw new ApiError(404, 'PUBLICACION_NOT_FOUND', 'La publicacion no existe.')
    }
    if (pub.vendedor_id !== input.vendedorId) {
      throw new ApiError(403, 'NOT_OWNER', 'No sos el vendedor de esta publicacion.')
    }
    if (!ESTADOS_PUBLICACION_SIN_OPERACION_VIVA.has(pub.estado)) {
      throw new ApiError(
        409,
        'PUBLICACION_NO_RETIRABLE',
        'Esta publicacion tiene una operacion en curso (seña o pago de un comprador) y no se puede retirar unilateralmente.'
      )
    }

    // Defensa en profundidad: aunque el estado de la publicacion ya diga que
    // no hay operacion viva, confirmar bajo el mismo lock que no exista
    // ninguna fila de escrow_transacciones en un estado no-terminal para
    // esta publicacion.
    const txViva = await client.query(
      `
        SELECT id FROM escrow_transacciones
        WHERE publicacion_id = $1
          AND estado IN (
            'DEPOSITO_PENDIENTE', 'RESERVA_PENDIENTE', 'RESERVADA',
            'SALDO_PENDIENTE', 'FONDOS_RETENIDOS', 'EN_CAMINO', 'DISPUTADA'
          )
        LIMIT 1
      `,
      [input.publicacionId]
    )
    if ((txViva.rowCount ?? 0) > 0) {
      throw new ApiError(
        409,
        'PUBLICACION_NO_RETIRABLE',
        'Esta publicacion tiene una operacion en curso (seña o pago de un comprador) y no se puede retirar unilateralmente.'
      )
    }

    const updated = await client.query<{ id: string; estado: string }>(
      `UPDATE marketplace_publicaciones SET estado = 'CANCELADA' WHERE id = $1 RETURNING id, estado`,
      [pub.id]
    )

    return { id: updated.rows[0].id, estado: updated.rows[0].estado }
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
  const resultado = await withTx(async (client) => {
    const tx = await lockTransaccion(client, input.transaccionId)

    if (tx.estado !== 'DISPUTADA') {
      throw new ApiError(409, 'ESTADO_INVALIDO', 'La transaccion no esta en disputa.')
    }

    if (input.aFavor === 'VENDEDOR') {
      const { transaccion: updated, transferenciaId, numeroSerie } = await liberarFondos(client, tx, { id: input.adminId, rol: 'admin' })
      await logEvento(client, {
        transaccionId: tx.id,
        tipo: 'DISPUTA_RESUELTA',
        estadoNuevo: 'COMPLETADA',
        actorId: input.adminId,
        actorRol: 'admin',
        metadata: { aFavor: 'VENDEDOR', nota: input.nota ?? null },
      })
      return { transaccion: mapTransaccion(updated), reembolso: null, completada: true, transferenciaId, numeroSerie }
    }

    // A favor del comprador: reembolso + cancelacion + re-activacion.
    const reembolso = await reembolsarPagoRetenido(client, tx.id, input.nota ?? 'Disputa a favor del comprador')

    // Si habia una deuda con el vendedor (p. ej. una liberacion previa cuya
    // transferencia fallo y mando el escrow a disputa), se anula al reembolsar.
    await cancelarLiquidacionesDeTransaccion(
      client,
      tx.id,
      'Disputa resuelta a favor del comprador (reembolso).'
    )

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

    return { transaccion: mapTransaccion(updated.rows[0]), reembolso, completada: false, transferenciaId: null, numeroSerie: null }
  })

  if (resultado.completada) {
    await notificarOperacionCompletada(resultado.transaccion)
    await cerrarTransferenciaPostCommit(resultado.transferenciaId, resultado.numeroSerie)
  }
  return { transaccion: resultado.transaccion, reembolso: resultado.reembolso }
}

// ── 7b. resolverPagoForzado (admin: forzar liberacion / reembolso) ───────────

export type AccionForzada = 'LIBERAR' | 'REEMBOLSAR'

/**
 * Resolucion forzada por un admin sobre una transaccion con fondos en custodia,
 * para cuando el sistema detecta un comportamiento irregular (Hito 13). A
 * diferencia de `resolverDisputa`, no exige que la transaccion ya este DISPUTADA:
 * actua sobre cualquier estado con dinero retenido (FONDOS_RETENIDOS, EN_CAMINO o
 * DISPUTADA). LIBERAR acredita al vendedor; REEMBOLSAR devuelve al comprador.
 */
export async function resolverPagoForzado(input: {
  transaccionId: string
  adminId: string
  accion: AccionForzada
  motivo?: string | null
}) {
  const resultado = await withTx(async (client) => {
    const tx = await lockTransaccion(client, input.transaccionId)

    const estadosForzables: EscrowEstado[] = [
      'FONDOS_RETENIDOS',
      'EN_CAMINO',
      'DISPUTADA',
    ]
    if (!estadosForzables.includes(tx.estado)) {
      throw new ApiError(
        409,
        'ESTADO_INVALIDO',
        'Solo se puede forzar una resolucion con los fondos en custodia.'
      )
    }

    if (input.accion === 'LIBERAR') {
      const { transaccion: updated, transferenciaId, numeroSerie } = await liberarFondos(client, tx, { id: input.adminId, rol: 'admin' })
      await logEvento(client, {
        transaccionId: tx.id,
        tipo: 'RESOLUCION_FORZADA',
        estadoAnterior: tx.estado,
        estadoNuevo: 'COMPLETADA',
        actorId: input.adminId,
        actorRol: 'admin',
        metadata: { accion: 'LIBERAR', motivo: input.motivo ?? null },
      })
      return { transaccion: mapTransaccion(updated), reembolso: null, completada: true, transferenciaId, numeroSerie }
    }

    // REEMBOLSAR: devuelve al comprador, cancela deudas y re-activa la publicacion.
    const reembolso = await reembolsarPagoRetenido(
      client,
      tx.id,
      input.motivo ?? 'Reembolso forzado por revision administrativa'
    )
    await cancelarLiquidacionesDeTransaccion(
      client,
      tx.id,
      'Reembolso forzado por revision administrativa.'
    )
    const updated = await client.query<TransaccionRow>(
      `
        UPDATE escrow_transacciones
        SET estado = 'CANCELADA', cancelacion_motivo = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [tx.id, input.motivo ?? 'Reembolso forzado por revision administrativa']
    )
    await client.query(
      `UPDATE marketplace_publicaciones SET estado = 'ACTIVA' WHERE id = $1 AND estado = 'PAUSADA'`,
      [tx.publicacion_id]
    )
    await logEvento(client, {
      transaccionId: tx.id,
      tipo: 'RESOLUCION_FORZADA',
      estadoAnterior: tx.estado,
      estadoNuevo: 'CANCELADA',
      actorId: input.adminId,
      actorRol: 'admin',
      metadata: { accion: 'REEMBOLSAR', motivo: input.motivo ?? null, reembolsado: Boolean(reembolso) },
    })
    return { transaccion: mapTransaccion(updated.rows[0]), reembolso, completada: false, transferenciaId: null, numeroSerie: null }
  })

  if (resultado.completada) {
    await notificarOperacionCompletada(resultado.transaccion)
    await cerrarTransferenciaPostCommit(resultado.transferenciaId, resultado.numeroSerie)
  }
  return { transaccion: resultado.transaccion, reembolso: resultado.reembolso }
}

// ── 8. procesarAutoReleases ─────────────────────────────────────────────────

/**
 * Libera automaticamente las transacciones EN_CAMINO cuyo plazo de
 * confirmacion vencio (5 dias sin accion del comprador).
 *
 * TODO(unificar retries): ni esta funcion ni procesarReservasVencidas()
 * tienen backoff ni tope de reintentos -- a diferencia de cola_validaciones
 * (intentos/max_intentos/proximo_intento_en + estado ERROR como dead-letter),
 * una fila que falla por un bug persistente se reintenta en CADA corrida del
 * scheduled function para siempre, sin marcarse como agotada. Vale la pena
 * unificar los tres barridos (este, procesarReservasVencidas y
 * cola_validaciones) al mismo estandar en una pasada dedicada -- no parchar
 * esto aca.
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
  const completadas: Array<{
    tx: ReturnType<typeof mapTransaccion>
    transferenciaId: string | null
    numeroSerie: string | null
  }> = []
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
        const { transaccion: updated, transferenciaId, numeroSerie } = await liberarFondos(client, tx, { id: null, rol: 'sistema' })
        await logEvento(client, {
          transaccionId: tx.id,
          tipo: 'AUTO_RELEASE',
          estadoAnterior: 'EN_CAMINO',
          estadoNuevo: 'COMPLETADA',
          actorRol: 'sistema',
          metadata: { motivo: `${AUTO_RELEASE_DIAS} dias sin confirmacion del comprador` },
        })
        liberadas.push(tx.id)
        completadas.push({ tx: mapTransaccion(updated), transferenciaId, numeroSerie })
      })
    } catch (error) {
      console.error('[escrow] auto-release fallo para', id, error)
    }
  }

  // Notificaciones de cierre (best-effort), fuera de las transacciones.
  for (const c of completadas) {
    await notificarOperacionCompletada(c.tx)
    await cerrarTransferenciaPostCommit(c.transferenciaId, c.numeroSerie)
  }

  return { procesadas: pendientes.rows.length, liberadas }
}

// ── 9. procesarReservasVencidas (Fase 5/6: timeout de 48hs de la reserva) ───

/**
 * Barre las transacciones cuya reserva_vence_en vencio y revierte tanto la
 * publicacion como la transaccion de escrow vinculadas. Cubre los DOS puntos
 * del ciclo donde el comprador puede no confirmar el saldo a tiempo:
 *   - publicacion todavia en RESERVADO (el Taller nunca llego a sellar el
 *     checklist dentro de la ventana) -> vuelve a
 *     PUBLICADO_PENDIENTE_CERTIFICACION.
 *   - publicacion ya en EJECUTANDO_LOGISTICA (el Taller SI sello a tiempo,
 *     pero el comprador nunca confirmo el pago despues) -> vuelve a
 *     PUBLICADO_CERTIFICADO (no hace falta re-disparar la verificacion al
 *     proximo comprador).
 *
 * El lado del escrow distingue si la sena llego a confirmarse: RESERVADA
 * (plata real retenida, financio el trabajo del Taller si llego a hacerse)
 * pasa a RESERVA_VENCIDA -- no se reembolsa, a diferencia de CANCELADA.
 * RESERVA_PENDIENTE (la sena nunca se confirmo) pasa directo a CANCELADA.
 *
 * Esta funcion NUNCA toca pagos_liquidaciones: el pago ALIADO_FEE_VERIFICACION
 * al Taller, si corresponde, ya quedo registrado en aprobarInspeccionFisica
 * en el momento del sellado -- registrarlo tambien aca duplicaria el pago en
 * el camino de venta exitosa, o lo dejaria sin registrar en ese mismo camino
 * si solo se hiciera aca. El sellado es la unica fuente de verdad.
 *
 * El SQL filtra ademas por estado IN (RESERVA_PENDIENTE, RESERVADA,
 * SALDO_PENDIENTE) -- no solo por el timestamp -- para que una fila que ya
 * llego a un estado terminal (FONDOS_RETENIDOS, CANCELADA, etc.) nunca vuelva
 * a aparecer en el barrido aunque reserva_vence_en haya quedado sin limpiar
 * por algun camino futuro. Mismo patron defensivo que procesarAutoReleases.
 *
 * Reconciliacion contra MercadoPago (auditoria de integridad de dinero): antes
 * de revertir una fila con un pago mp_pagos todavia PENDIENTE, se busca contra
 * la API real de MercadoPago (buscarPagosPorExternalReference) si ese pago ya
 * se aprobo -- un webhook perdido o tardio no alcanza para cancelar una
 * reserva que en realidad ya esta pagada. Si la busqueda misma falla (error de
 * red/API), la fila NO se revierte ese barrido -- se prefiere reintentar en la
 * proxima corrida antes que cancelar una reserva que podria estar pagada.
 *
 * TODO(unificar retries): ver la nota en procesarAutoReleases -- esta funcion
 * tiene exactamente la misma falta de backoff/dead-letter.
 */
export async function procesarReservasVencidas(limite = 100) {
  const pendientes = await getPool().query<{ id: string }>(
    `
      SELECT id FROM escrow_transacciones
      WHERE reserva_vence_en IS NOT NULL AND reserva_vence_en <= NOW()
        AND estado IN ('RESERVA_PENDIENTE', 'RESERVADA', 'SALDO_PENDIENTE')
      ORDER BY reserva_vence_en ASC
      LIMIT $1
    `,
    [limite]
  )

  const revertidas: string[] = []
  const reconciliadas: string[] = []
  for (const { id } of pendientes.rows) {
    try {
      // Reconciliar contra MercadoPago ANTES de revertir: un webhook perdido o
      // tardio no debe alcanzar para cancelar una reserva que ya esta pagada.
      const pendienteMp = await getPool().query<{ id: string }>(
        `SELECT id FROM mp_pagos WHERE transaccion_id = $1 AND estado = 'PENDIENTE' LIMIT 1`,
        [id]
      )

      if (pendienteMp.rows[0]) {
        const conocidosRes = await getPool().query<{ payment_id: string }>(
          `SELECT payment_id FROM mp_pagos WHERE transaccion_id = $1 AND payment_id IS NOT NULL`,
          [id]
        )
        const conocidos = new Set(
          conocidosRes.rows.map((r: { payment_id: string }) => r.payment_id)
        )

        let aprobadoNuevo: string | null = null
        try {
          const pagos = await buscarPagosPorExternalReference(id)
          aprobadoNuevo =
            pagos.find((p) => p.status === 'approved' && !conocidos.has(p.paymentId))?.paymentId ?? null
        } catch (mpError) {
          // No se pudo confirmar contra MercadoPago: NO revertir esta fila
          // este barrido -- mejor reintentar en la proxima corrida que
          // cancelar una reserva que podria estar realmente pagada.
          console.error('[escrow] no se pudo reconciliar contra MercadoPago para', id, mpError)
          continue
        }

        if (aprobadoNuevo) {
          // MercadoPago ya lo aprobo -- el webhook se perdio o llego tarde.
          // Procesarlo como pago normal (webhookPago abre su propia
          // transaccion/lock), NO cancelar la reserva.
          await webhookPago({ paymentId: aprobadoNuevo, externalReferenceHint: id })
          reconciliadas.push(id)
          continue
        }
      }

      await withTx(async (client) => {
        const tx = await lockTransaccion(client, id)
        if (!tx.reserva_vence_en || new Date(tx.reserva_vence_en).getTime() > Date.now()) {
          return
        }

        const pubRes = await client.query<{
          id: string
          estado: string
          inspeccion_sellado_id: string | null
        }>(
          `
            SELECT id, estado, inspeccion_sellado_id
            FROM marketplace_publicaciones
            WHERE id = $1
            FOR UPDATE
          `,
          [tx.publicacion_id]
        )
        const pub = pubRes.rows[0]
        // Ya se resolvio de otra forma (venta confirmada, cancelada, etc.):
        // no revertir un estado que ya avanzo. Cubre AMBOS puntos del ciclo
        // donde el comprador puede no confirmar el saldo a tiempo: antes del
        // sellado (RESERVADO) y despues (EJECUTANDO_LOGISTICA, cuando el
        // Taller ya sello el checklist dentro de la ventana pero el
        // comprador nunca completo el pago).
        if (!pub || (pub.estado !== 'RESERVADO' && pub.estado !== 'EJECUTANDO_LOGISTICA')) {
          return
        }

        const yaSellada = pub.inspeccion_sellado_id !== null
        const estadoPublicacionNuevo = yaSellada
          ? 'PUBLICADO_CERTIFICADO'
          : 'PUBLICADO_PENDIENTE_CERTIFICACION'
        // Si la sena ya se habia confirmado (RESERVADA), la plata queda
        // retenida por el trabajo de verificacion ya hecho -- no se
        // reembolsa (RESERVA_VENCIDA, distinto de CANCELADA). Si nunca se
        // confirmo (RESERVA_PENDIENTE), no hay plata real retenida: cancela
        // sin mas tramite. El pago al Taller (ALIADO_FEE_VERIFICACION), si
        // corresponde, ya quedo registrado en aprobarInspeccionFisica al
        // sellar -- esta funcion no lo toca en ningun caso.
        const estadoEscrowNuevo = tx.estado === 'RESERVADA' ? 'RESERVA_VENCIDA' : 'CANCELADA'

        await client.query(
          `UPDATE marketplace_publicaciones SET estado = $2 WHERE id = $1`,
          [pub.id, estadoPublicacionNuevo]
        )
        await client.query(
          `UPDATE escrow_transacciones SET estado = $2, reserva_vence_en = NULL, updated_at = NOW() WHERE id = $1`,
          [tx.id, estadoEscrowNuevo]
        )
        await logEvento(client, {
          transaccionId: tx.id,
          tipo: 'RESERVA_VENCIDA',
          estadoAnterior: tx.estado,
          estadoNuevo: estadoEscrowNuevo,
          actorRol: 'sistema',
          metadata: { publicacionId: pub.id, estadoPublicacionNuevo },
        })

        revertidas.push(tx.id)
      })
    } catch (error) {
      console.error('[escrow] revertir reserva vencida fallo para', id, error)
    }
  }

  return {
    encontradas: pendientes.rows.length,
    revertidas: revertidas.length,
    reconciliadas: reconciliadas.length,
  }
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

const ESTADOS_RESERVA_ACTIVA = ['RESERVA_PENDIENTE', 'RESERVADA', 'SALDO_PENDIENTE'] as const

/**
 * Reserva activa (no terminal) de un comprador puntual sobre una publicacion,
 * si existe. Usada por la pagina de detalle para saber si el viewer ya tiene
 * una reserva en curso sobre ESTA bici, sin exponer nunca esa informacion a
 * otros viewers (privacidad del comprador).
 */
export async function obtenerMiReservaActiva(publicacionId: string, compradorId: string) {
  const res = await getPool().query<TransaccionRow>(
    `SELECT * FROM escrow_transacciones
     WHERE publicacion_id = $1 AND comprador_id = $2 AND estado = ANY($3)
     ORDER BY created_at DESC LIMIT 1`,
    [publicacionId, compradorId, ESTADOS_RESERVA_ACTIVA]
  )
  return res.rows[0] ? mapTransaccion(res.rows[0]) : null
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
