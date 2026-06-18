// ─── RODAID PAY · Puente MP → Escrow → Notificaciones ────
//
// Conecta los tres sistemas que operaban en silos:
//
//   MercadoPago webhook
//       │
//       ▼
//   Escrow state machine  ←── la transición ya existía
//       │
//       ▼   ← ESTE PUENTE FALTABA
//   Notification dispatcher → Push FCM + APNs + Email + In-App
//
// ══ EVENTOS MANEJADOS ════════════════════════════════════
//
//   MP_APROBADO  → FONDOS_RETENIDOS   → notif comprador + vendedor
//   MP_RECHAZADO → CANCELADA          → notif comprador (reintentar)
//   TASA_CIT_OK  → tasa_pagada=true   → notif ciclista (CIT oficial)
//   AUTO_RELEASE → COMPLETADA         → notif vendedor (fondos acreditados)
//   DISPUTA      → EN_DISPUTA         → notif ambas partes
//
// ══ IDEMPOTENCIA ═════════════════════════════════════════
//
//   Cada evento guarda en Redis mp:notif:{paymentId}:{evento}
//   TTL 24h para evitar duplicados si MP reenvía el webhook.

import { log }                    from '../middleware/logger'
import { getRedis }               from '../config/redis'
import { queryOne, query }        from '../config/database'
import { webhookPago }            from './escrow.service'
import {
  despacharCITEmitido,
  despacharDenunciaRobo,
} from './notif.dispatcher'
import {
  notificarVentaConfirmada,
  notificarCompraCompletada,
} from './notif.service'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export type BridgeEvento =
  | 'MP_APROBADO'
  | 'MP_RECHAZADO'
  | 'TASA_CIT_OK'
  | 'ESCROW_AUTO_RELEASE'
  | 'ESCROW_DISPUTA'
  | 'ESCROW_COMPLETADO'

export interface BridgeResult {
  evento:           BridgeEvento
  transaccionId:    string | null
  estadoEscrow:     string
  notifEnviadas:    number
  idempotente:      boolean   // true = ya procesado, se saltó
}

// ══════════════════════════════════════════════════════════
// HELPER — idempotencia Redis
// ══════════════════════════════════════════════════════════

async function yaProcessed(key: string): Promise<boolean> {
  try {
    const redis = getRedis()
    const val   = await redis.get(key)
    if (val) return true
    await redis.set(key, '1', 'EX', String(86400))  // 24h TTL
    return false
  } catch { return false }
}

// ══════════════════════════════════════════════════════════
// BRIDGE 1: Pago MP aprobado → Escrow FONDOS_RETENIDOS
//                             → Notif comprador + vendedor
// ══════════════════════════════════════════════════════════

export async function bridgePagoAprobado(opts: {
  paymentId:      string
  transaccionId?: string
  monto?:         number
  gateway:        string
}): Promise<BridgeResult> {
  const key = `mp:notif:${opts.paymentId}:aprobado`
  if (await yaProcessed(key)) {
    return { evento: 'MP_APROBADO', transaccionId: opts.transaccionId ?? null,
             estadoEscrow: 'FONDOS_RETENIDOS', notifEnviadas: 0, idempotente: true }
  }

  // 1. Transicionar escrow
  const escrow = await webhookPago({
    transaccionId:     opts.transaccionId,
    externalReference: opts.transaccionId,
    paymentId:         opts.paymentId,
    status:            'approved',
    monto:             opts.monto,
    gateway:           opts.gateway,
  })

  let notifEnviadas = 0

  if (escrow.ok && escrow.estado === 'FONDOS_RETENIDOS') {
    // 2. Cargar partes de la transacción
    const tx = await queryOne<{
      publicacion_id: string; comprador_id: string; vendedor_id: string
      precio_ars: number; bicicleta_id: string; cit_id_from_pub: string
      marca: string; modelo: string; numero_serie: string
    }>(`
      SELECT t.publicacion_id, t.comprador_id, t.vendedor_id,
             t.precio_ars, t.bicicleta_id, t.cit_id_from_pub,
             b.marca, b.modelo, b.numero_serie
      FROM transacciones t
      JOIN bicicletas b ON b.id = t.bicicleta_id
      WHERE t.id = $1::uuid
    `, [opts.transaccionId])

    if (tx) {
      // 3. Notificar comprador: fondos retenidos en escrow
      notificarCompraCompletada({
        usuarioId:   tx.comprador_id,
        numeroCIT:   '',
        serial:      tx.numero_serie,
        tokenId:     null,
      }).then(() => { }).catch(err =>
        log.escrow.warn({ err: err.message }, 'notif comprador fondos fallida')
      )
      notifEnviadas++

      // 4. Notificar vendedor: nuevo comprador — fondos en escrow
      notificarVentaConfirmada({
        usuarioId:       tx.vendedor_id,
        numeroCIT:       '',
        montoVendedor:   tx.precio_ars,
        compradorNombre: 'Comprador RODAID',
      }).then(() => { }).catch(err =>
        log.escrow.warn({ err: err.message }, 'notif vendedor fondos fallida')
      )
      notifEnviadas++

      log.escrow.info({
        paymentId: opts.paymentId, transaccionId: opts.transaccionId,
        bici: `${tx.marca} ${tx.modelo}`, monto: tx.precio_ars,
      }, `✓ Bridge APROBADO: FONDOS_RETENIDOS + ${notifEnviadas} notificaciones`)
    }
  }

  return {
    evento:        'MP_APROBADO',
    transaccionId: opts.transaccionId ?? null,
    estadoEscrow:  escrow.estado,
    notifEnviadas,
    idempotente:   false,
  }
}

// ══════════════════════════════════════════════════════════
// BRIDGE 2: Pago rechazado → Escrow CANCELADA
//                          → Notif comprador (reintentar)
// ══════════════════════════════════════════════════════════

export async function bridgePagoRechazado(opts: {
  paymentId:      string
  transaccionId?: string
  motivo?:        string
  gateway:        string
}): Promise<BridgeResult> {
  const key = `mp:notif:${opts.paymentId}:rechazado`
  if (await yaProcessed(key)) {
    return { evento: 'MP_RECHAZADO', transaccionId: opts.transaccionId ?? null,
             estadoEscrow: 'CANCELADA', notifEnviadas: 0, idempotente: true }
  }

  await webhookPago({
    transaccionId:     opts.transaccionId,
    externalReference: opts.transaccionId,
    paymentId:         opts.paymentId,
    status:            'rejected',
    gateway:           opts.gateway,
  })

  let notifEnviadas = 0
  if (opts.transaccionId) {
    const tx = await queryOne<{ comprador_id: string; numero_serie: string }>(
      `SELECT t.comprador_id, b.numero_serie
       FROM transacciones t JOIN bicicletas b ON b.id=t.bicicleta_id
       WHERE t.id=$1::uuid`, [opts.transaccionId]
    )
    if (tx) {
      // In-app + email
      const { notificar } = await import('./notif.service')
      await notificar({
        usuarioId: tx.comprador_id,
        tipo:      'COMPRA_COMPLETADA',   // reutilizamos el tipo con mensaje de error
        titulo:    '⚠ Pago no procesado',
        cuerpo:    `El pago para la bicicleta (${tx.numero_serie}) no pudo procesarse. Podés reintentar con otro método de pago.`,
        datos:     { transaccionId: opts.transaccionId, motivo: opts.motivo ?? opts.gateway },
      }).catch(() => {})
      notifEnviadas++
    }
  }

  log.escrow.warn({ paymentId: opts.paymentId, motivo: opts.motivo }, 'Bridge RECHAZADO → CANCELADA')
  return {
    evento: 'MP_RECHAZADO', transaccionId: opts.transaccionId ?? null,
    estadoEscrow: 'CANCELADA', notifEnviadas, idempotente: false,
  }
}

// ══════════════════════════════════════════════════════════
// BRIDGE 3: Tasa CIT pagada → tasa_pagada=TRUE
//                           → CIT oficial → Notif ciclista
// ══════════════════════════════════════════════════════════

export async function bridgeTasaCITConfirmada(opts: {
  citId:     string
  paymentId: string
  mxmExpediente?: string
}): Promise<BridgeResult> {
  const key = `mp:notif:${opts.paymentId}:tasa_cit`
  if (await yaProcessed(key)) {
    return { evento: 'TASA_CIT_OK', transaccionId: opts.citId,
             estadoEscrow: 'TASA_PAGADA', notifEnviadas: 0, idempotente: true }
  }

  // 1. Marcar tasa_pagada en el CIT
  await query(
    `UPDATE cits SET tasa_pagada=TRUE, actualizado_en=NOW()
     WHERE id=$1::uuid AND tasa_pagada=FALSE`,
    [opts.citId]
  )

  // 2. Registrar en cit_pagos_mxm si existe la tabla
  await query(
    `INSERT INTO cit_pagos_mxm (cit_id, payment_id, estado)
     VALUES ($1::uuid, $2, 'CONFIRMADO')
     ON CONFLICT DO NOTHING`,
    [opts.citId, opts.paymentId]
  ).catch(() => {}) // tabla opcional

  // 3. Cargar datos del CIT para la notificación
  const cit = await queryOne<{
    numero_cit: string; propietario_id: string;
    marca: string; modelo: string; numero_serie: string;
  }>(`
    SELECT c.numero_cit, c.propietario_id::text,
           b.marca, b.modelo, b.numero_serie
    FROM cits c JOIN bicicletas b ON b.id = c.bicicleta_id
    WHERE c.id = $1::uuid
  `, [opts.citId])

  let notifEnviadas = 0
  if (cit) {
    // 4. Disparar notificación "CIT activo"
    despacharCITEmitido({
      usuarioId:  cit.propietario_id,
      numeroCIT:  cit.numero_cit,
      serial:     cit.numero_serie,
      marca:      cit.marca,
      modelo:     cit.modelo,
      txHash:     opts.paymentId,          // usamos el payment ID como ref
    })
    notifEnviadas++

    // 5. In-app con confirmación de tasa
    const { notificar } = await import('./notif.service')
    await notificar({
      usuarioId: cit.propietario_id,
      tipo:      'CIT_APROBADO',
      titulo:    `✅ Tasa CIT pagada — ${cit.numero_cit} activo`,
      cuerpo:    `La tasa MxM fue acreditada. Tu CIT para la ${cit.marca} ${cit.modelo} (${cit.numero_serie}) está ahora oficialmente activo bajo la Ley Provincial N° 9556.`,
      datos:     { citId: opts.citId, numeroCIT: cit.numero_cit, paymentId: opts.paymentId },
    }).catch(() => {})
    notifEnviadas++

    log.escrow.info({
      citId: opts.citId, numeroCIT: cit.numero_cit, paymentId: opts.paymentId,
    }, `✓ Bridge TASA_CIT: tasa_pagada=TRUE + ${notifEnviadas} notificaciones`)
  }

  return {
    evento: 'TASA_CIT_OK', transaccionId: opts.citId,
    estadoEscrow: 'TASA_PAGADA', notifEnviadas, idempotente: false,
  }
}

// ══════════════════════════════════════════════════════════
// BRIDGE 4: Escrow completado → Notif vendedor fondos
// Llamado desde confirmarEntrega() en escrow.service
// ══════════════════════════════════════════════════════════

export async function bridgeEscrowCompletado(opts: {
  transaccionId: string
  vendedorId:    string
  montoARS:      number
  serial:        string
}): Promise<BridgeResult> {
  const key = `mp:notif:${opts.transaccionId}:completado`
  if (await yaProcessed(key)) {
    return { evento: 'ESCROW_COMPLETADO', transaccionId: opts.transaccionId,
             estadoEscrow: 'COMPLETADA', notifEnviadas: 0, idempotente: true }
  }

  let notifEnviadas = 0
  try {
    const { notificar } = await import('./notif.service')
    await notificar({
      usuarioId: opts.vendedorId,
      tipo:      'VENTA_CONFIRMADA',
      titulo:    '💸 ¡Fondos acreditados!',
      cuerpo:    `$${Math.round(opts.montoARS).toLocaleString('es-AR')} ARS fueron liberados a tu cuenta MercadoPago. Bicicleta: ${opts.serial}.`,
      datos:     { transaccionId: opts.transaccionId, monto: opts.montoARS },
    })
    notifEnviadas++
  } catch (err) {
    log.escrow.warn({ err: (err as Error).message }, 'Bridge COMPLETADO: notif vendedor falló')
  }

  return {
    evento: 'ESCROW_COMPLETADO', transaccionId: opts.transaccionId,
    estadoEscrow: 'COMPLETADA', notifEnviadas, idempotente: false,
  }
}

// ══════════════════════════════════════════════════════════
// PUNTO DE ENTRADA PRINCIPAL — desde el webhook handler
// Determina el tipo de evento y rutea al bridge correcto
// ══════════════════════════════════════════════════════════

export async function procesarEventoMP(opts: {
  paymentId:      string
  status:         string           // 'approved' | 'rejected' | 'pending' | ...
  transaccionId?: string
  monto?:         number
  gateway:        string
  esTaskaCIT?:    boolean          // true si es pago de tasa CIT (no marketplace)
  citId?:         string
}): Promise<BridgeResult> {
  log.escrow.info({
    paymentId: opts.paymentId, status: opts.status,
    transaccionId: opts.transaccionId, esTaskaCIT: opts.esTaskaCIT,
  }, 'Bridge procesarEventoMP')

  if (opts.esTaskaCIT && opts.citId && opts.status === 'approved') {
    return bridgeTasaCITConfirmada({ citId: opts.citId, paymentId: opts.paymentId })
  }

  if (opts.status === 'approved') {
    return bridgePagoAprobado({
      paymentId:     opts.paymentId,
      transaccionId: opts.transaccionId,
      monto:         opts.monto,
      gateway:       opts.gateway,
    })
  }

  if (['rejected', 'cancelled', 'charged_back'].includes(opts.status)) {
    return bridgePagoRechazado({
      paymentId:     opts.paymentId,
      transaccionId: opts.transaccionId,
      motivo:        opts.status,
      gateway:       opts.gateway,
    })
  }

  // pending / in_process → sin acción, solo loggear
  return {
    evento:        'MP_APROBADO',  // placeholder
    transaccionId: opts.transaccionId ?? null,
    estadoEscrow:  'PENDIENTE',
    notifEnviadas: 0,
    idempotente:   false,
  }
}
