// ─── RODAID · MxM Notificaciones ─────────────────────────
// Envía alertas oficiales al ciudadano a través del canal
// gubernamental Mendoza por Mí (MxM).
//
// Canales disponibles (según configuración MxM):
//   push_email → push en la app MxM + email institucional
//   push       → solo push en la app MxM
//   email      → email desde correo oficial Mendoza
//   sms        → SMS (cuando MxM lo habilite)
//
// Tipos de mensaje MxM:
//   INFORMATIVA        → aviso sin acción requerida
//   ACCION_REQUERIDA   → requiere que el usuario haga algo
//   URGENTE            → alta prioridad (denuncia, alerta)
//   LEGAL              → con validez legal (Ley 9556, Art. 18)
//
// Flujo:
//   1. notificarCiudadano() → INSERT notificaciones + mxm_notif_queue
//   2. procesarCola()       → getMxMAccessToken() + mxmService.enviarNotificacion()
//      retry: 0 → 2 min → 8 min → 30 min → FALLIDA
//   3. Disparadores de negocio (fire-and-forget):
//      · notifCITEmitido()       — CIT emitido on-chain en BFA
//      · notifTasaConfirmada()   — tasa pagada via MxM Pagos
//      · notifDenunciaRobo()     — bicicleta denunciada robada
//      · notifBiciRecuperada()   — bicicleta marcada recuperada
//      · notifVentaConfirmada()  — escrow COMPLETADO (vendedor)
//      · notifCompraCompletada() — escrow COMPLETADO (comprador)
//      · notifNFTTransferido()   — NFT ERC-721 transferido al comprador
//      · notifDisputaAbierta()   — disputa abierta en marketplace
//      · notifSistema()          — mensaje general del sistema RODAID
//
// Sin MXM_NOTIF_URL configurada → modo STUB (log solamente)
// Con MxM real → usa el access_token del usuario + POST /api/notificaciones

import crypto from 'crypto'
import { featureDisponible } from './mxm.circuit.service'
import { query, queryOne }       from '../config/database'
import { getRedis }              from '../config/redis'
import { mxmService, getMxMAccessToken } from './mxm.service'
import { AppError }              from '../middleware/errorHandler'
import { log }                   from '../middleware/logger'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export type TipoMxM = 'INFORMATIVA' | 'ACCION_REQUERIDA' | 'URGENTE' | 'LEGAL'
export type CanalMxM = 'push_email' | 'push' | 'email' | 'sms'

export type TipoNotificacion =
  | 'CIT_APROBADO' | 'CIT_RECHAZADO' | 'CIT_POR_VENCER'
  | 'TASA_CONFIRMADA' | 'PAGO_RECHAZADO'
  | 'DENUNCIA_REGISTRADA' | 'BICI_RECUPERADA'
  | 'NUEVA_OFERTA' | 'VENTA_CONFIRMADA' | 'COMPRA_COMPLETADA'
  | 'NFT_TRANSFERIDO' | 'DISPUTA_ABIERTA' | 'DISPUTA_RESUELTA'
  | 'SISTEMA_GENERAL'

export interface NotifInput {
  usuarioId:    string
  tipo:         TipoNotificacion
  titulo:       string
  cuerpo:       string
  datos?:       Record<string, unknown>
  tipoMxM?:     TipoMxM
  canalMxM?:    CanalMxM
  validezLegal?: boolean
  enviarMxM?:   boolean   // default: true si usuario tiene MxM conectado
}

export interface NotifResult {
  notifId:   string
  enColaId?: string
  enviada:   boolean
  esStub:    boolean
}

// ══════════════════════════════════════════════════════════
// BACKOFF DE REINTENTOS
// ══════════════════════════════════════════════════════════

const BACKOFF_SECS   = [0, 120, 480, 1800]  // 0 → 2min → 8min → 30min
const MAX_INTENTOS   = 4
const CACHE_KEY      = (id: string) => `mxm:notif:sent:${id}`
const CACHE_TTL      = 3600   // 1 hora — idempotencia
const MODO_STUB      = !process.env.MXM_NOTIF_URL

// ══════════════════════════════════════════════════════════
// PRINCIPAL: notificarCiudadano
// ══════════════════════════════════════════════════════════

export async function notificarCiudadano(
  opts: NotifInput,
  opciones?: { silencioso?: boolean }
): Promise<NotifResult> {

  // 1. Insertar en notificaciones (in-app)
  const notifRow = await queryOne<{ id: string }>(
    `INSERT INTO notificaciones
       (usuario_id, tipo, titulo, cuerpo, datos, canal, mxm_tipo, enviada_mxm)
     VALUES ($1, $2::tipo_notificacion, $3, $4, $5::jsonb, 'MXM', $6, FALSE)
     RETURNING id`,
    [
      opts.usuarioId, opts.tipo,
      opts.titulo, opts.cuerpo,
      opts.datos ? JSON.stringify(opts.datos) : null,
      opts.tipoMxM ?? 'INFORMATIVA',
    ]
  )
  const notifId = notifRow!.id

  // 2. Verificar si el usuario tiene MxM conectado
  const cuil = await getUserCuil(opts.usuarioId)
  const debeEnviarMxM = opts.enviarMxM !== false && !!cuil

  if (!debeEnviarMxM) {
    log.mxm.debug({ notifId, usuarioId: opts.usuarioId.slice(0, 8) },
      'Notif solo in-app — usuario sin MxM conectado')
    return { notifId, enviada: false, esStub: MODO_STUB }
  }

  // 3. Encolar para envío MxM
  const queueRow = await queryOne<{ id: string }>(
    `INSERT INTO mxm_notif_queue
       (notificacion_id, usuario_id, cuil, titulo, cuerpo,
        tipo_mxm, datos_extra, canal_mxm, validez_legal, proximo_intento)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::boolean, NOW())
     RETURNING id`,
    [
      notifId, opts.usuarioId, cuil,
      opts.titulo, opts.cuerpo,
      opts.tipoMxM ?? 'INFORMATIVA',
      opts.datos ? JSON.stringify(opts.datos) : null,
      opts.canalMxM ?? 'push_email',
      opts.validezLegal ?? false,
    ]
  )

  if (!opciones?.silencioso) {
    log.mxm.info({
      notifId, queueId: queueRow!.id,
      tipo: opts.tipo, tipoMxM: opts.tipoMxM ?? 'INFORMATIVA',
      canal: opts.canalMxM ?? 'push_email', usuarioId: opts.usuarioId.slice(0, 8),
    }, `📬 Notif MxM encolada: ${opts.titulo}`)
  }

  // 4. Intentar envío inmediato (si hay token vigente)
  const enviada = await intentarEnvioInmediato(queueRow!.id, opts.usuarioId, opts.titulo, opts.cuerpo, opts.tipoMxM, opts.canalMxM, opts.validezLegal)

  return { notifId, enColaId: queueRow!.id, enviada, esStub: MODO_STUB }
}

// ══════════════════════════════════════════════════════════
// INTENTAR ENVÍO INMEDIATO
// ══════════════════════════════════════════════════════════

async function intentarEnvioInmediato(
  queueId:     string,
  usuarioId:   string,
  titulo:      string,
  cuerpo:      string,
  tipoMxM?:   TipoMxM,
  canalMxM?:  CanalMxM,
  validezLegal?: boolean
): Promise<boolean> {
  try {
    const accessToken = await getMxMAccessToken(usuarioId)
    if (!accessToken) return false

    // Idempotencia: no reenviar si ya fue enviada
    const redis = getRedis()
    const cacheKey = CACHE_KEY(queueId)
    const cached = await redis.get(cacheKey)
    if (cached) {
      log.mxm.debug({ queueId }, 'Notif ya enviada (cache hit) — ignorando')
      return true
    }

    await enviarViaGateway(accessToken, titulo, cuerpo, tipoMxM, canalMxM, validezLegal, {
      notificacionId: queueId,
      usuarioId,
    })

    // Marcar como enviada
    await query(
      `UPDATE mxm_notif_queue SET estado='ENVIADA', enviada_en=NOW(), intentos=intentos+1 WHERE id=$1`,
      [queueId]
    )
    await query(
      `UPDATE notificaciones SET enviada_mxm=TRUE WHERE id=(SELECT notificacion_id FROM mxm_notif_queue WHERE id=$1)`,
      [queueId]
    )
    await redis.set(cacheKey, '1', 'EX', CACHE_TTL)

    log.mxm.info({ queueId, titulo }, '✓ Notif MxM enviada')
    return true

  } catch (err) {
    // No es fatal — quedará para el procesador de cola
    const msg = (err as Error).message
    await query(
      `UPDATE mxm_notif_queue SET
         estado='FALLIDA', ultimo_error=$2, intentos=intentos+1,
         proximo_intento=NOW() + INTERVAL '120 seconds'
       WHERE id=$1`,
      [queueId, msg.slice(0, 500)]
    )
    log.mxm.warn({ queueId, err: msg }, 'Envío inmediato fallido — quedará en cola')
    return false
  }
}

// ══════════════════════════════════════════════════════════
// GATEWAY MxM
// ══════════════════════════════════════════════════════════


// ── Registrar envío en tabla de tracking ─────────────────
async function registrarEnvioMxM(opts: {
  notificacionId?: string   // ID en tabla notificaciones (FK) — puede ser null
  queueId?:        string   // ID en mxm_notif_queue — solo para idempotency key
  usuarioId?:      string
  cuil?:           string
  titulo: string; cuerpo: string; tipoMxM: string; canalMxM: string
  validezLegal: boolean; mxmNotifId?: string; httpStatus?: number
  estado: string; errorMsg?: string
}): Promise<void> {
  // Resolver la FK real a notificaciones (null si no está disponible)
  let realNotifId: string | null = null
  if (opts.notificacionId) {
    // Verificar si el ID pertenece a notificaciones o a mxm_notif_queue
    const existe = await queryOne<{id:string}>(
      `SELECT id FROM notificaciones WHERE id=$1`, [opts.notificacionId]
    ).catch(() => null)
    realNotifId = existe?.id ?? null
  }

  await query(
    `INSERT INTO mxm_notif_envios
       (notificacion_id, usuario_id, cuil, titulo, cuerpo,
        tipo_mxm, canal_mxm, validez_legal, mxm_notif_id,
        mxm_estado, http_status, error_msg, enviado_en, intentos)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::boolean,$9,$10,$11,$12,NOW(),1)`,
    [
      realNotifId, opts.usuarioId ?? null, opts.cuil ?? null,
      opts.titulo, opts.cuerpo, opts.tipoMxM, opts.canalMxM,
      opts.validezLegal, opts.mxmNotifId ?? null,
      opts.estado, opts.httpStatus ?? null, opts.errorMsg ?? null,
    ]
  ).catch(e => log.mxm.warn({ err: (e as Error).message }, 'Error tracking envío MxM'))
}

async function enviarViaGateway(
  accessToken:   string,
  titulo:        string,
  cuerpo:        string,
  tipoMxM?:     TipoMxM,
  canalMxM?:    CanalMxM,
  validezLegal?: boolean,
  opciones?: {
    cuil?:           string
    datosExtra?:     Record<string, unknown>
    notificacionId?: string  // ID real en tabla notificaciones (FK)
    queueId?:        string  // ID en mxm_notif_queue (para idempotency)
    usuarioId?:      string
  }
): Promise<{ mxmNotifId?: string; entregada: boolean }> {
  if (MODO_STUB) {
    log.mxm.warn({ titulo, tipoMxM, canal: canalMxM },
      '⚠ MxM Notif STUB — configurar MXM_NOTIF_URL para envíos reales')
    const stubId = 'stub_' + Date.now()
    // Registrar en tracking aunque sea STUB (útil para debugging y tests)
    if (opciones?.notificacionId || opciones?.usuarioId) {
      await registrarEnvioMxM({
        notificacionId: opciones?.notificacionId,
        usuarioId:      opciones?.usuarioId,
        cuil:           opciones?.cuil,
        titulo, cuerpo,
        tipoMxM:       tipoMxM ?? 'INFORMATIVA',
        canalMxM:      canalMxM ?? 'push_email',
        validezLegal:  validezLegal ?? false,
        mxmNotifId:    stubId,
        httpStatus:    200,
        estado:        'ENTREGADA',
      })
    }
    return { mxmNotifId: stubId, entregada: true }
  }

  const idempotencyKey = (opciones?.queueId ?? opciones?.notificacionId)
    ? `rodaid-notif-${opciones?.queueId ?? opciones?.notificacionId}`
    : undefined

  const resultado = await mxmService.enviarNotificacion(accessToken, titulo, cuerpo, {
    tipoMxM,
    canalMxM,
    validezLegal,
    cuil:          opciones?.cuil,
    datosExtra:    opciones?.datosExtra,
    idempotencyKey,
  })

  // Registrar en tabla de tracking
  if (opciones?.notificacionId || opciones?.usuarioId) {
    await registrarEnvioMxM({
      notificacionId: opciones?.notificacionId,
      usuarioId:      opciones?.usuarioId,
      titulo,
      cuerpo,
      tipoMxM:       tipoMxM ?? 'INFORMATIVA',
      canalMxM:      canalMxM ?? 'push_email',
      validezLegal:  validezLegal ?? false,
      mxmNotifId:    resultado.mxmNotifId,
      httpStatus:    resultado.httpStatus,
      estado:        resultado.entregada ? 'ENTREGADA' : 'FALLIDA',
    })
  }

  log.mxm.info({
    titulo, tipoMxM, canal: canalMxM,
    mxmNotifId: resultado.mxmNotifId?.slice(0, 12),
    validezLegal,
  }, `✓ Notif MxM enviada (${tipoMxM ?? 'INFORMATIVA'})`)

  return { mxmNotifId: resultado.mxmNotifId, entregada: resultado.entregada }
}

// ══════════════════════════════════════════════════════════
// PROCESADOR DE COLA (cron / admin trigger)
// ══════════════════════════════════════════════════════════

export async function procesarColaMxM(): Promise<{
  procesadas: number; enviadas: number; fallidas: number
}> {
  const pendientes = await query<{
    id: string; usuario_id: string; cuil?: string | null; titulo: string; cuerpo: string
    tipo_mxm: TipoMxM; canal_mxm: CanalMxM; validez_legal: boolean; intentos: number
  }>(
    `SELECT id, usuario_id, titulo, cuerpo, tipo_mxm, canal_mxm, validez_legal, intentos
     FROM mxm_notif_queue
     WHERE estado IN ('PENDIENTE','FALLIDA')
       AND (proximo_intento IS NULL OR proximo_intento <= NOW())
       AND intentos < $1
     ORDER BY creada_en
     LIMIT 20`,
    [MAX_INTENTOS]
  )

  let enviadas = 0; let fallidas = 0

  for (const item of pendientes) {
    await query(`UPDATE mxm_notif_queue SET estado='ENVIANDO' WHERE id=$1`, [item.id])

    try {
      const accessToken = await getMxMAccessToken(item.usuario_id)

      if (!accessToken) {
        // Sin token: marcar como IGNORADA — el usuario no tiene MxM
        await query(
          `UPDATE mxm_notif_queue SET estado='IGNORADA', ultimo_error='Sin token MxM' WHERE id=$1`,
          [item.id]
        )
        continue
      }

      const redis = getRedis()
      const cached = await redis.get(CACHE_KEY(item.id))
      if (cached) {
        await query(`UPDATE mxm_notif_queue SET estado='ENVIADA' WHERE id=$1`, [item.id])
        enviadas++
        continue
      }

      await enviarViaGateway(accessToken, item.titulo, item.cuerpo, item.tipo_mxm, item.canal_mxm, item.validez_legal, {
          queueId:   item.id,
          usuarioId: item.usuario_id,
          cuil:      item.cuil ?? undefined,
        })

      await query(`UPDATE mxm_notif_queue SET estado='ENVIADA', enviada_en=NOW() WHERE id=$1`, [item.id])
      await redis.set(CACHE_KEY(item.id), '1', 'EX', CACHE_TTL)
      await query(
        `UPDATE notificaciones SET enviada_mxm=TRUE WHERE id=(SELECT notificacion_id FROM mxm_notif_queue WHERE id=$1)`,
        [item.id]
      )

      enviadas++
      log.mxm.info({ queueId: item.id, titulo: item.titulo }, '✓ Notif MxM enviada (cola)')

    } catch (err) {
      const msg = (err as Error).message
      const nextRetry = item.intentos < MAX_INTENTOS - 1
        ? new Date(Date.now() + (BACKOFF_SECS[item.intentos + 1] ?? 1800) * 1000)
        : null

      await query(
        `UPDATE mxm_notif_queue SET
           estado = $2,
           ultimo_error = $3,
           intentos = intentos + 1,
           proximo_intento = $4
         WHERE id=$1`,
        [item.id, nextRetry ? 'FALLIDA' : 'FALLIDA', msg.slice(0, 500), nextRetry]
      )
      if (!nextRetry) log.mxm.error({ queueId: item.id }, '🚨 Notif MxM agotó reintentos')
      fallidas++
    }
  }

  if (pendientes.length > 0) {
    log.mxm.info({ procesadas: pendientes.length, enviadas, fallidas }, 'Cola MxM procesada')
  }
  return { procesadas: pendientes.length, enviadas, fallidas }
}

// ══════════════════════════════════════════════════════════
// DISPARADORES DE NEGOCIO (fire-and-forget)
// ══════════════════════════════════════════════════════════

/** CIT emitido y registrado on-chain en BFA */
export async function notifCITEmitido(opts: {
  usuarioId:   string
  numeroCIT:   string
  serial:      string
  marca:       string
  modelo:      string
  txHash:      string
}): Promise<void> {
  await notificarCiudadano({
    usuarioId:   opts.usuarioId,
    tipo:        'CIT_APROBADO',
    tipoMxM:     'LEGAL',
    canalMxM:    'push_email',
    validezLegal: true,
    titulo:      `✅ CIT emitido: ${opts.numeroCIT}`,
    cuerpo:
      `Tu bicicleta ${opts.marca} ${opts.modelo} (S/N: ${opts.serial}) ` +
      `fue certificada bajo Ley N° 9556.\n\n` +
      `📋 Certificado: ${opts.numeroCIT}\n` +
      `⛓ BFA TxHash: ${opts.txHash.slice(0, 16)}...\n\n` +
      `Este certificado tiene validez legal ante cualquier autoridad de la ` +
      `Provincia de Mendoza y puede ser verificado en rodaid.com.ar`,
    datos: {
      numeroCIT: opts.numeroCIT, serial: opts.serial,
      marca: opts.marca, modelo: opts.modelo, txHash: opts.txHash,
    },
  }).catch(e => log.mxm.error({ err: e.message }, 'Error notif CIT emitido'))
}

/** Tasa CIT pagada exitosamente */
export async function notifTasaConfirmada(opts: {
  usuarioId: string; montoARS: number; pagoId: string
  numeroCIT?: string
}): Promise<void> {
  await notificarCiudadano({
    usuarioId:   opts.usuarioId,
    tipo:        'TASA_CONFIRMADA',
    tipoMxM:     'INFORMATIVA',
    canalMxM:    'push_email',
    titulo:      `💳 Tasa CIT confirmada — $${opts.montoARS.toLocaleString('es-AR')} ARS`,
    cuerpo:
      `El pago de $${opts.montoARS.toLocaleString('es-AR')} ARS fue acreditado.\n` +
      `${opts.numeroCIT ? `Certificado: ${opts.numeroCIT}\n` : ''}` +
      `Ref. de pago: ${opts.pagoId.slice(0, 8).toUpperCase()}`,
    datos: { montoARS: opts.montoARS, pagoId: opts.pagoId, numeroCIT: opts.numeroCIT },
  }).catch(e => log.mxm.error({ err: e.message }, 'Error notif tasa'))
}

/** Bicicleta denunciada como robada */
export async function notifDenunciaRobo(opts: {
  usuarioId:   string
  serial:      string
  marca:       string
  modelo:      string
  numeroDenuncia: string
}): Promise<void> {
  await notificarCiudadano({
    usuarioId:   opts.usuarioId,
    tipo:        'DENUNCIA_REGISTRADA',
    tipoMxM:     'URGENTE',
    canalMxM:    'push_email',
    validezLegal: true,
    titulo:      `🚨 Denuncia registrada: ${opts.serial}`,
    cuerpo:
      `Tu denuncia de robo fue registrada en el sistema RODAID y comunicada ` +
      `al Ministerio de Seguridad de Mendoza.\n\n` +
      `🚲 ${opts.marca} ${opts.modelo} · S/N: ${opts.serial}\n` +
      `📑 N° denuncia: ${opts.numeroDenuncia}\n\n` +
      `El CIT queda BLOQUEADO para cualquier transferencia hasta que recuperes la bicicleta.`,
    datos: {
      serial: opts.serial, marca: opts.marca, modelo: opts.modelo,
      numeroDenuncia: opts.numeroDenuncia,
    },
  }).catch(e => log.mxm.error({ err: e.message }, 'Error notif denuncia'))
}

/** Bicicleta marcada como recuperada */
export async function notifBiciRecuperada(opts: {
  usuarioId: string; serial: string; marca: string; modelo: string
}): Promise<void> {
  await notificarCiudadano({
    usuarioId:   opts.usuarioId,
    tipo:        'BICI_RECUPERADA',
    tipoMxM:     'URGENTE',
    canalMxM:    'push_email',
    titulo:      `🎉 Bicicleta recuperada: ${opts.serial}`,
    cuerpo:
      `Tu bicicleta ${opts.marca} ${opts.modelo} (S/N: ${opts.serial}) ` +
      `fue marcada como recuperada en el sistema RODAID.\n\n` +
      `El CIT vuelve a estar activo para transferencias.`,
    datos: { serial: opts.serial, marca: opts.marca, modelo: opts.modelo },
  }).catch(e => log.mxm.error({ err: e.message }, 'Error notif recuperada'))
}

/** Venta confirmada — fondos liberados al vendedor */
export async function notifVentaConfirmada(opts: {
  vendedorId:   string
  compradorId:  string
  montoARS:     number
  comisionARS:  number
  serial:       string
  marca:        string
  modelo:       string
}): Promise<void> {
  const [vendedor, comprador] = await Promise.all([
    notificarCiudadano({
      usuarioId: opts.vendedorId,
      tipo:      'VENTA_CONFIRMADA',
      tipoMxM:   'INFORMATIVA',
      canalMxM:  'push_email',
      titulo:    `💰 Venta confirmada: $${(opts.montoARS - opts.comisionARS).toLocaleString('es-AR')} ARS`,
      cuerpo:
        `La venta de tu ${opts.marca} ${opts.modelo} (S/N: ${opts.serial}) fue completada.\n\n` +
        `💵 Precio de venta: $${opts.montoARS.toLocaleString('es-AR')}\n` +
        `📊 Comisión RODAID: $${opts.comisionARS.toLocaleString('es-AR')}\n` +
        `🏦 Monto acreditado: $${(opts.montoARS - opts.comisionARS).toLocaleString('es-AR')}`,
      datos: { montoARS: opts.montoARS, comisionARS: opts.comisionARS, serial: opts.serial },
    }),
    notificarCiudadano({
      usuarioId: opts.compradorId,
      tipo:      'COMPRA_COMPLETADA',
      tipoMxM:   'INFORMATIVA',
      canalMxM:  'push_email',
      titulo:    `✅ Compra completada: ${opts.marca} ${opts.modelo}`,
      cuerpo:
        `Recibiste la ${opts.marca} ${opts.modelo} (S/N: ${opts.serial}).\n\n` +
        `Tu confirmación liberó $${(opts.montoARS - opts.comisionARS).toLocaleString('es-AR')} ARS al vendedor.\n` +
        `El CIT (certificado blockchain) fue transferido a tu nombre.`,
      datos: { montoARS: opts.montoARS, serial: opts.serial },
    }),
  ])
  return
}

/** NFT ERC-721 transferido on-chain */
export async function notifNFTTransferido(opts: {
  compradorId: string
  serial:      string
  txHash:      string
  numeroCIT:   string
}): Promise<void> {
  await notificarCiudadano({
    usuarioId:    opts.compradorId,
    tipo:         'NFT_TRANSFERIDO',
    tipoMxM:     'LEGAL',
    canalMxM:    'push_email',
    validezLegal: true,
    titulo:       `⛓ CIT transferido on-chain: ${opts.numeroCIT}`,
    cuerpo:
      `El certificado blockchain de tu bicicleta (S/N: ${opts.serial}) fue transferido ` +
      `a tu wallet en la Blockchain Federal Argentina.\n\n` +
      `📜 CIT: ${opts.numeroCIT}\n` +
      `🔗 BFA TxHash: ${opts.txHash.slice(0, 20)}...\n` +
      `Verificá en rodaid.com.ar/verificar`,
    datos: { serial: opts.serial, txHash: opts.txHash, numeroCIT: opts.numeroCIT },
  }).catch(e => log.mxm.error({ err: e.message }, 'Error notif NFT'))
}

/** Disputa abierta */
export async function notifDisputaAbierta(opts: {
  iniciadorId: string
  otroId:      string
  disputaId:   string
  motivo:      string
  transaccionId: string
}): Promise<void> {
  await Promise.all([
    notificarCiudadano({
      usuarioId: opts.iniciadorId,
      tipo:      'DISPUTA_ABIERTA',
      tipoMxM:   'ACCION_REQUERIDA',
      titulo:    '⚠ Disputa abierta — RODAID PAY',
      cuerpo:
        `Abriste una disputa (ID: ${opts.disputaId.slice(0, 8)}).\n` +
        `Motivo: ${opts.motivo}\n\n` +
        `El equipo RODAID revisará y resolverá en 72hs hábiles.`,
      datos: { disputaId: opts.disputaId, motivo: opts.motivo },
    }),
    notificarCiudadano({
      usuarioId: opts.otroId,
      tipo:      'DISPUTA_ABIERTA',
      tipoMxM:   'ACCION_REQUERIDA',
      titulo:    '⚠ Se abrió una disputa sobre tu transacción',
      cuerpo:
        `La otra parte abrió una disputa (ID: ${opts.disputaId.slice(0, 8)}).\n` +
        `Motivo: ${opts.motivo}\n\n` +
        `Podés aportar evidencia desde tu panel RODAID. Resolución en 72hs.`,
      datos: { disputaId: opts.disputaId, motivo: opts.motivo },
    }),
  ])
}

/** Mensaje general del sistema */
export async function notifSistema(opts: {
  usuarioId: string
  titulo:    string
  cuerpo:    string
  urgente?:  boolean
  datos?:    Record<string, unknown>
}): Promise<NotifResult> {
  return notificarCiudadano({
    usuarioId:  opts.usuarioId,
    tipo:       'SISTEMA_GENERAL',
    tipoMxM:    opts.urgente ? 'URGENTE' : 'INFORMATIVA',
    canalMxM:   opts.urgente ? 'push_email' : 'push',
    titulo:     opts.titulo,
    cuerpo:     opts.cuerpo,
    datos:      opts.datos,
  })
}

// ══════════════════════════════════════════════════════════
// CONSULTAS
// ══════════════════════════════════════════════════════════

export async function getNotificacionesUsuario(
  usuarioId: string,
  opciones?: { soloNoLeidas?: boolean; limite?: number }
): Promise<Array<{
  id: string; tipo: string; titulo: string; cuerpo: string; leida: boolean
  enviadaMxM: boolean; canal: string; createdAt: Date
}>> {
  const cond = opciones?.soloNoLeidas ? 'AND NOT leida' : ''
  const rows = await query<any>(
    `SELECT id, tipo::text, titulo, cuerpo, leida, enviada_mxm, canal,
            datos, creado_en AS "createdAt"
     FROM notificaciones
     WHERE usuario_id=$1 ${cond}
     ORDER BY creado_en DESC
     LIMIT $2`,
    [usuarioId, opciones?.limite ?? 50]
  )
  return rows.map((r: any) => ({ ...r, createdAt: new Date(r.createdAt) }))
}

export async function marcarLeida(notifId: string, usuarioId: string): Promise<boolean> {
  const r = await query(
    `UPDATE notificaciones SET leida=TRUE, leida_en=NOW()
     WHERE id=$1 AND usuario_id=$2 AND NOT leida
     RETURNING id`,
    [notifId, usuarioId]
  )
  return r.length > 0
}

export async function marcarTodasLeidas(usuarioId: string): Promise<number> {
  const r = await query(
    `UPDATE notificaciones SET leida=TRUE, leida_en=NOW()
     WHERE usuario_id=$1 AND NOT leida
     RETURNING id`,
    [usuarioId]
  )
  return r.length
}

export async function getEstadisticasMxM(dias = 30): Promise<{
  enColaPendiente: number; enviadas: number; fallidas: number; ignoradas: number
}> {
  const row = await queryOne<{ pend: string; env: string; fall: string; ign: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE estado IN ('PENDIENTE','FALLIDA'))::text AS pend,
       COUNT(*) FILTER (WHERE estado='ENVIADA')::text                  AS env,
       COUNT(*) FILTER (WHERE estado='FALLIDA' AND intentos>=$2)::text AS fall,
       COUNT(*) FILTER (WHERE estado='IGNORADA')::text                 AS ign
     FROM mxm_notif_queue
     WHERE creada_en > NOW() - ($1 || ' days')::interval`,
    [dias, MAX_INTENTOS]
  )
  return {
    enColaPendiente: parseInt(row?.pend ?? '0'),
    enviadas:        parseInt(row?.env  ?? '0'),
    fallidas:        parseInt(row?.fall ?? '0'),
    ignoradas:       parseInt(row?.ign  ?? '0'),
  }
}

// ── Helper privado ──────────────────────────────────────

async function getUserCuil(usuarioId: string): Promise<string | null> {
  const row = await queryOne<{ cuil: string | null; mxm_verificado: boolean }>(
    `SELECT cuil, mxm_verificado FROM usuarios WHERE id=$1`, [usuarioId]
  )
  return row?.mxm_verificado ? (row.cuil ?? null) : null
}
