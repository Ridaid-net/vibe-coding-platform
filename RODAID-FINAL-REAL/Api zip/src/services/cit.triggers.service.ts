// ─── RODAID · CIT Triggers — Notificaciones Automáticas ──
// Gestiona los 4 eventos de ciclo de vida del CIT que
// disparan notificaciones push + email + MxM:
//
// 1. CIT_APROBADO (finalizarCIT):
//    · Push FCM/APNs con numeroCIT + BFA txHash
//    · Email con datos del certificado
//    · MxM LEGAL (validez ante autoridades)
//    · Crear expediente provincial (tramiteCITEmitido)
//    · Marcar tasa pagada si corresponde
//
// 2. CIT_RECHAZADO (validarCIT — alerta MinSeg activa):
//    · Push URGENTE "Rodado en base de denuncias"
//    · Email con instrucciones de acción
//    · MxM URGENTE (canal gubernamental)
//    · Notificar inspector que inspeccionó
//
// 3. ALERTA_ROBO (denunciarRobo):
//    · Push URGENTE a propietario
//    · Email con número de denuncia
//    · MxM URGENTE + validez legal
//    · Broadcast al tópico FCM de zona
//    · Notificar inspectores de la zona
//
// 4. VENCIMIENTO_PROXIMO (cron diario):
//    · 30 días antes: recordatorio suave
//    · 15 días antes: aviso moderado
//    · 7 días antes: urgente
//    · 1 día antes: crítico
//    · Deduplicación: una sola alerta por umbral por CIT
//
// Todos los triggers son fire-and-forget desde los
// servicios de negocio y nunca bloquean el flujo principal.

import { query, queryOne }           from '../config/database'
import { log }                        from '../middleware/logger'
import { enviarPush }                 from './device_token.service'
import { registrarRetribucion }       from './aliado.panel.service'
import { triggerRetribucionCIT }      from './retribucion.mp.service'
import { auditarInspeccionGPS }       from './auditoria.gps.service'
import {
  emailCITEmitido, emailDenunciaRobo,
}                                     from './email.service'
import {
  notifCITEmitido, notifDenunciaRobo,
  notifBiciRecuperada, notifSistema,
}                                     from './mxm.notificaciones.service'
import { tramiteCITEmitido }          from './mxm.tramites.service'
import { enviarPushTopico }           from './fcm.service'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export interface CITAprobadoPayload {
  citId:          string
  usuarioId:      string
  numeroCIT:      string
  serial:         string
  marca:          string
  modelo:         string
  txHash:         string
  tokenId?:       string
  tallerAliadoId?: string
  inspectorId?:   string
}

export interface CITRechazadoPayload {
  citId:       string
  usuarioId:   string
  numeroCIT:   string
  serial:      string
  marca:       string
  modelo:      string
  motivoRechazo: string
  inspectorId?:  string
  alertaMinSeg?: boolean
}

export interface AlertaRoboPayload {
  citId:           string
  usuarioId:       string
  serial:          string
  marca:           string
  modelo:          string
  numeroDenuncia:  string
  provincia?:      string
  localidad?:      string
}

// ══════════════════════════════════════════════════════════
// FIRE-AND-FORGET WRAPPER
// ══════════════════════════════════════════════════════════

function trigger(nombre: string, fn: () => Promise<void>): void {
  fn().catch(err =>
    log.mensajeria.error({ trigger: nombre, err: (err as Error).message },
      `⚠ Trigger ${nombre} falló`)
  )
}

// ══════════════════════════════════════════════════════════
// 1. TRIGGER: CIT APROBADO
// ══════════════════════════════════════════════════════════

/**
 * Llamar desde finalizarCIT() inmediatamente después del mint en BFA.
 * Fire-and-forget — nunca interrumpe el flujo de emisión.
 */
export function triggerCITAprobado(payload: CITAprobadoPayload): void {
  trigger('CITAprobado', async () => {
    const u = await getUsuario(payload.usuarioId)
    if (!u) return

    const frontendUrl = process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.com.ar'
    const pushPayload = {
      titulo:         `✅ CIT emitido: ${payload.numeroCIT}`,
      cuerpo:         `${payload.marca} ${payload.modelo} certificada bajo Ley 9556`,
      subtitulo:      `S/N: ${payload.serial}`,
      badge:          1,
      sound:          'default' as const,
      mutableContent: true,
      collapseId:     `cit-${payload.citId.slice(0, 8)}`,
      clickUrl:       `${frontendUrl}/cit/${payload.numeroCIT}`,
      datos: {
        tipo:      'CIT_APROBADO',
        numeroCIT: payload.numeroCIT,
        serial:    payload.serial,
        txHash:    payload.txHash.slice(0, 20),
        url:       `${frontendUrl}/cit/${payload.numeroCIT}`,
      },
    }

    await Promise.allSettled([
      // Push a todos los dispositivos del propietario
      enviarPush(payload.usuarioId, pushPayload),
      // Email con datos del certificado
      emailCITEmitido({
        to:        u.email,
        nombre:    u.nombreCompleto,
        numeroCIT: payload.numeroCIT,
        serial:    payload.serial,
        marca:     payload.marca,
        modelo:    payload.modelo,
        txHash:    payload.txHash,
      }),
      // MxM gubernamental (validez legal)
      notifCITEmitido({
        usuarioId:  payload.usuarioId,
        numeroCIT:  payload.numeroCIT,
        serial:     payload.serial,
        marca:      payload.marca,
        modelo:     payload.modelo,
        txHash:     payload.txHash,
      }),
      // Crear expediente provincial (fire-and-forget dentro de fire-and-forget)
      tramiteCITEmitido({ citId: payload.citId, usuarioId: payload.usuarioId }),
    ])

    // Registrar retribución del aliado (fire-and-forget)
    if (payload.tallerAliadoId) {
      registrarRetribucion({
        tallerId:    payload.tallerAliadoId,
        citId:       payload.citId,
        numeroCIT:   payload.numeroCIT,
        inspectorId: undefined,
      }).catch((e: Error) => log.mensajeria.warn({ err: e.message }, 'Error registrando retribución'))
    }

    // Auditoría GPS automática (fire-and-forget)
    if (payload.citId && payload.inspectorId && payload.tallerAliadoId) {
      import('../config/database').then(({ queryOne: q }) =>
        q(
          `SELECT c.insp_geo_lat, c.insp_geo_lng, c.prop_geo_lat, c.prop_geo_lng,
                  c.insp_device_id
           FROM cits c WHERE c.id=$1`, [payload.citId]
        ).then(citGeo => {
          if (citGeo) {
            auditarInspeccionGPS({
              citId:       payload.citId,
              inspectorId: payload.inspectorId!,
              tallerId:    payload.tallerAliadoId!,
              inspLat:     citGeo.insp_geo_lat != null ? Number(citGeo.insp_geo_lat) : undefined,
              inspLng:     citGeo.insp_geo_lng != null ? Number(citGeo.insp_geo_lng) : undefined,
              propLat:     citGeo.prop_geo_lat != null ? Number(citGeo.prop_geo_lat) : undefined,
              propLng:     citGeo.prop_geo_lng != null ? Number(citGeo.prop_geo_lng) : undefined,
              deviceId:    citGeo.insp_device_id != null ? String(citGeo.insp_device_id) : undefined,
            }).catch((e: Error) => log.mensajeria.warn({ err: e.message }, 'Error en auditoría GPS'))
          }
        })
      ).catch(() => {})
    }

    log.mensajeria.info({
      numeroCIT: payload.numeroCIT,
      usuarioId: payload.usuarioId.slice(0, 8),
    }, '✓ Trigger CITAprobado: push + email + MxM + tramite + retribución + auditoría GPS')
  })
}

// ══════════════════════════════════════════════════════════
// 2. TRIGGER: CIT RECHAZADO
// ══════════════════════════════════════════════════════════

/**
 * Llamar desde validarCIT() cuando alertaActiva=true (MinSeg),
 * y también cuando se rechaza manualmente un CIT.
 */
export function triggerCITRechazado(payload: CITRechazadoPayload): void {
  trigger('CITRechazado', async () => {
    const u = await getUsuario(payload.usuarioId)
    if (!u) return

    const esAlertaMinSeg = payload.alertaMinSeg === true
    const frontendUrl    = process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.com.ar'

    // Push urgente al propietario
    await Promise.allSettled([
      enviarPush(payload.usuarioId, {
        titulo:    esAlertaMinSeg
          ? '🚨 CIT rechazado — Alerta de seguridad'
          : `❌ CIT rechazado: ${payload.numeroCIT}`,
        cuerpo:    esAlertaMinSeg
          ? `Rodado ${payload.serial} figura en la base de denuncias del Ministerio de Seguridad.`
          : `Motivo: ${payload.motivoRechazo}`,
        badge:     1,
        sound:     'default',
        datos: {
          tipo:      'CIT_RECHAZADO',
          numeroCIT: payload.numeroCIT,
          serial:    payload.serial,
          alerta:    String(esAlertaMinSeg),
          url:       `${frontendUrl}/cit/${payload.numeroCIT}`,
        },
      }),

      // Email con instrucciones
      (async () => {
        const { Resend } = await import('resend').catch(() => ({ Resend: null })) as any
        if (!Resend || !process.env.RESEND_API_KEY) {
          log.mensajeria.warn({ numeroCIT: payload.numeroCIT }, '📧 Email CIT rechazado STUB')
          return
        }
        const r = new Resend(process.env.RESEND_API_KEY)
        await r.emails.send({
          from:    'RODAID <noreply@rodaid.com.ar>',
          to:      u.email,
          subject: `❌ CIT rechazado — ${payload.marca} ${payload.modelo}`,
          html:    buildEmailRechazado(payload, u.nombreCompleto, esAlertaMinSeg, frontendUrl),
          text:    `CIT ${payload.numeroCIT} fue rechazado. Motivo: ${payload.motivoRechazo}`,
        })
      })(),

      // MxM URGENTE si es alerta de seguridad
      esAlertaMinSeg && notifSistema({
        usuarioId: payload.usuarioId,
        titulo:    '🚨 CIT rechazado — Alerta MinSeg',
        cuerpo:    `Tu certificado ${payload.numeroCIT} fue rechazado porque el rodado ${payload.serial} figura en la base de denuncias del Ministerio de Seguridad de Mendoza.`,
        urgente:   true,
        datos:     { tipo: 'CIT_RECHAZADO', numeroCIT: payload.numeroCIT, alerta: 'MINSEG' },
      }),

      // Notificar al inspector si corresponde
      payload.inspectorId && notificarInspector(
        payload.inspectorId, payload.numeroCIT, payload.serial, esAlertaMinSeg
      ),
    ])

    log.mensajeria.info({
      numeroCIT:    payload.numeroCIT,
      alertaMinSeg: esAlertaMinSeg,
    }, '✓ Trigger CITRechazado: push + email + MxM')
  })
}

// ══════════════════════════════════════════════════════════
// 3. TRIGGER: ALERTA DE ROBO
// ══════════════════════════════════════════════════════════

/**
 * Llamar desde el endpoint de denuncia inmediatamente después
 * de registrar la denuncia en DB.
 */
export function triggerAlertaRobo(payload: AlertaRoboPayload): void {
  trigger('AlertaRobo', async () => {
    const u = await getUsuario(payload.usuarioId)
    if (!u) return

    const provincia = payload.provincia ?? 'mendoza'
    const topicoZona = `denuncias_zona_${provincia.toLowerCase().replace(/\s+/g, '_')}`

    await Promise.allSettled([
      // Push URGENTE al propietario
      enviarPush(payload.usuarioId, {
        titulo:  '🚨 Denuncia registrada',
        cuerpo:  `${payload.marca} ${payload.modelo} — N° ${payload.numeroDenuncia}. CIT bloqueado.`,
        badge:   1,
        sound:   'default',
        datos: {
          tipo:           'DENUNCIA_REGISTRADA',
          serial:         payload.serial,
          numeroDenuncia: payload.numeroDenuncia,
          url:            `${process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.com.ar'}/denuncias/${payload.numeroDenuncia}`,
        },
      }),

      // Email
      emailDenunciaRobo({
        to:             u.email,
        nombre:         u.nombreCompleto,
        serial:         payload.serial,
        marca:          payload.marca,
        modelo:         payload.modelo,
        numeroDenuncia: payload.numeroDenuncia,
      }),

      // MxM URGENTE con validez legal
      notifDenunciaRobo({
        usuarioId:      payload.usuarioId,
        serial:         payload.serial,
        marca:          payload.marca,
        modelo:         payload.modelo,
        numeroDenuncia: payload.numeroDenuncia,
      }),

      // Broadcast al tópico de zona (todos los usuarios con esa suscripción)
      enviarPushTopico(topicoZona, {
        titulo:  `🚨 Robo en ${payload.localidad ?? provincia}`,
        cuerpo:  `Se reportó el robo de una ${payload.marca} ${payload.modelo}. S/N: ${payload.serial}`,
        datos: {
          tipo:     'ALERTA_ZONA',
          serial:   payload.serial,
          marca:    payload.marca,
          modelo:   payload.modelo,
          provincia,
        },
      }),
    ])

    // Registrar en DB que se envió la alerta
    await query(
      `UPDATE cits SET actualizado_en=NOW() WHERE id=$1`, [payload.citId]
    ).catch(() => {})

    log.mensajeria.info({
      serial:         payload.serial,
      numeroDenuncia: payload.numeroDenuncia,
      topicoZona,
    }, '✓ Trigger AlertaRobo: push + email + MxM + broadcast zona')
  })
}

// ══════════════════════════════════════════════════════════
// 4. TRIGGER: VENCIMIENTO PRÓXIMO (cron diario)
// ══════════════════════════════════════════════════════════

/** Umbrales de alerta en días */
const UMBRALES_VENCIMIENTO = [30, 15, 7, 1]

/**
 * Ejecutar una vez al día desde un cron job o endpoint admin.
 * Retorna el resumen de alertas enviadas.
 */
export async function procesarVencimientosProximos(): Promise<{
  procesados:  number
  alertasEnviadas: number
  porUmbral:   Record<number, number>
}> {
  let alertasEnviadas = 0
  const porUmbral: Record<number, number> = {}

  for (const dias of UMBRALES_VENCIMIENTO) {
    // CITs que vencen en exactamente [dias-1, dias] días y aún no recibieron alerta de este umbral
    const citsProximos = await query<{
      id: string; numero_cit: string; propietario_id: string
      fecha_vencimiento: Date; numero_serie: string; marca: string; modelo: string
    }>(
      `SELECT c.id, c.numero_cit, c.propietario_id, c.fecha_vencimiento,
              b.numero_serie, b.marca, b.modelo
       FROM cits c
       JOIN bicicletas b ON b.id = c.bicicleta_id
       WHERE c.estado = 'ACTIVO'
         AND c.fecha_vencimiento IS NOT NULL
         AND c.fecha_vencimiento >= NOW() + (($1-1) || ' days')::interval
         AND c.fecha_vencimiento <  NOW() + ($1        || ' days')::interval
         AND NOT EXISTS (
           SELECT 1 FROM cit_alertas_vencimiento
           WHERE cit_id = c.id AND dias_restantes = $1
         )`,
      [dias]
    )

    if (citsProximos.length === 0) continue

    log.mensajeria.info({ dias, count: citsProximos.length },
      `📅 ${citsProximos.length} CITs vencen en ${dias} días`)

    let enviados = 0
    for (const cit of citsProximos) {
      await enviarAlertaVencimiento(cit, dias)

      // Registrar alerta enviada (deduplicación)
      await query(
        `INSERT INTO cit_alertas_vencimiento (cit_id, usuario_id, dias_restantes)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [cit.id, cit.propietario_id, dias]
      )
      enviados++
      alertasEnviadas++
    }
    porUmbral[dias] = enviados
  }

  if (alertasEnviadas > 0) {
    log.mensajeria.info({ alertasEnviadas, porUmbral }, '✓ Vencimientos procesados')
  }

  return {
    procesados:      UMBRALES_VENCIMIENTO.reduce((acc, d) => acc + (porUmbral[d] ?? 0), 0),
    alertasEnviadas,
    porUmbral,
  }
}

/** Enviar alerta de vencimiento a un CIT específico */
async function enviarAlertaVencimiento(cit: {
  id: string; numero_cit: string; propietario_id: string
  fecha_vencimiento: Date; numero_serie: string; marca: string; modelo: string
}, diasRestantes: number): Promise<void> {

  const u = await getUsuario(cit.propietario_id)
  if (!u) return

  const urgente    = diasRestantes <= 7
  const critico    = diasRestantes <= 1
  const fechaStr   = new Date(cit.fecha_vencimiento).toLocaleDateString('es-AR', {
    day: '2-digit', month: 'long', year: 'numeric',
  })
  const frontendUrl = process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.com.ar'
  const renovarUrl  = `${frontendUrl}/cit/${cit.numero_cit}/renovar`

  const titulo = critico
    ? `🔴 CIT vence HOY: ${cit.numero_cit}`
    : urgente
    ? `⚠ CIT vence en ${diasRestantes} días`
    : `📅 CIT vence en ${diasRestantes} días`

  const cuerpo = critico
    ? `El certificado de tu ${cit.marca} ${cit.modelo} (S/N: ${cit.numero_serie}) vence hoy. Renovalo para seguir operando.`
    : `El CIT ${cit.numero_cit} de tu ${cit.marca} ${cit.modelo} vence el ${fechaStr}. Te quedan ${diasRestantes} día${diasRestantes > 1 ? 's' : ''}.`

  await Promise.allSettled([
    enviarPush(cit.propietario_id, {
      titulo,
      cuerpo,
      badge:     urgente ? 1 : 0,
      sound:     urgente ? 'default' : undefined,
      collapseId: `venc-${cit.id.slice(0, 8)}`,
      clickUrl:   renovarUrl,
      datos: {
        tipo:          'CIT_POR_VENCER',
        numeroCIT:     cit.numero_cit,
        serial:        cit.numero_serie,
        diasRestantes: String(diasRestantes),
        venceEn:       cit.fecha_vencimiento.toISOString(),
        url:           renovarUrl,
      },
    }),

    // Email solo en umbrales importantes (30, 7, 1)
    [30, 7, 1].includes(diasRestantes) && enviarEmailVencimiento(
      u.email, u.nombreCompleto, cit, diasRestantes, fechaStr, renovarUrl
    ),

    // MxM solo para urgentes
    urgente && notifSistema({
      usuarioId: cit.propietario_id,
      titulo,
      cuerpo,
      urgente:   critico,
      datos:     { tipo: 'CIT_POR_VENCER', numeroCIT: cit.numero_cit, diasRestantes: String(diasRestantes) },
    }),
  ])
}

// ══════════════════════════════════════════════════════════
// CONSULTAS
// ══════════════════════════════════════════════════════════

/** CITs vencidos que aún están marcados como ACTIVO */
export async function getCITsVencidos(): Promise<Array<{
  id: string; numeroCIT: string; propietarioId: string; vencidoHace: string
}>> {
  return query<any>(
    `SELECT c.id, c.numero_cit AS "numeroCIT", c.propietario_id AS "propietarioId",
            EXTRACT(DAY FROM NOW()-c.fecha_vencimiento)||' días' AS "vencidoHace"
     FROM cits c
     WHERE c.estado='ACTIVO' AND c.fecha_vencimiento < NOW()
     ORDER BY c.fecha_vencimiento`,
    []
  )
}

/** Marcar CITs vencidos como VENCIDO */
export async function marcarCITsVencidos(): Promise<number> {
  const result = await query<{ id: string; numero_cit: string; propietario_id: string }>(
    `UPDATE cits SET estado='VENCIDO', actualizado_en=NOW()
     WHERE estado='ACTIVO' AND fecha_vencimiento < NOW()
     RETURNING id, numero_cit, propietario_id`,
    []
  )

  for (const cit of result) {
    trigger('CITVencido', async () => {
      const u = await getUsuario(cit.propietario_id)
      if (!u) return
      await enviarPush(cit.propietario_id, {
        titulo: `🔴 CIT vencido: ${cit.numero_cit}`,
        cuerpo: 'Tu certificado venció. Iniciá la renovación para volver a operar legalmente.',
        badge: 1,
        datos: { tipo: 'CIT_VENCIDO', numeroCIT: cit.numero_cit },
      })
    })
  }

  if (result.length > 0) log.mensajeria.warn({ count: result.length }, `${result.length} CITs marcados como VENCIDO`)
  return result.length
}

/** Historial de alertas enviadas para un CIT */
export async function getAlertasVencimiento(citId: string) {
  return query(
    `SELECT dias_restantes, enviada_en FROM cit_alertas_vencimiento
     WHERE cit_id=$1 ORDER BY enviada_en DESC`,
    [citId]
  )
}

// ══════════════════════════════════════════════════════════
// HELPERS PRIVADOS
// ══════════════════════════════════════════════════════════

async function getUsuario(userId: string): Promise<{
  email: string; nombreCompleto: string
} | null> {
  const row = await queryOne<{ email: string; nombre: string | null; apellido: string | null }>(
    `SELECT email, nombre, apellido FROM usuarios WHERE id=$1`, [userId]
  )
  if (!row) return null
  return {
    email:          row.email,
    nombreCompleto: [row.nombre, row.apellido].filter(Boolean).join(' ') || row.email,
  }
}

async function notificarInspector(
  inspectorId: string, numeroCIT: string, serial: string, alertaMinSeg: boolean
): Promise<void> {
  const insp = await queryOne<{ usuario_id: string | null }>(
    `SELECT usuario_id FROM inspectores WHERE id=$1`, [inspectorId]
  ).catch(() => null)
  if (!insp?.usuario_id) return

  await enviarPush(insp.usuario_id, {
    titulo: alertaMinSeg
      ? `🚨 CIT rechazado por alerta MinSeg`
      : `❌ CIT rechazado: ${numeroCIT}`,
    cuerpo: `El CIT que inspeccionaste (S/N: ${serial}) fue rechazado.`,
    datos:  { tipo: 'CIT_RECHAZADO_INSPECTOR', numeroCIT, serial },
  }).catch(() => {})
}

function buildEmailRechazado(
  payload: CITRechazadoPayload,
  nombre: string,
  esAlertaMinSeg: boolean,
  frontendUrl: string
): string {
  const alerta = esAlertaMinSeg
    ? `<div style="background:#fff8f8;border:1px solid #fde;border-radius:8px;padding:16px;margin:16px 0">
        <p style="color:#dc2626;font-weight:bold">⚠ Alerta del Ministerio de Seguridad</p>
        <p>El rodado <code>${payload.serial}</code> figura en la base de denuncias provincial.
        Los datos fueron remitidos automáticamente a las autoridades.</p>
       </div>`
    : ''
  return `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
    <h2 style="color:#0F1E35">❌ CIT rechazado</h2>
    <p>Hola <strong>${nombre}</strong>,</p>
    <p>Lamentablemente el CIT <strong>${payload.numeroCIT}</strong> para tu
    <strong>${payload.marca} ${payload.modelo}</strong> (S/N: ${payload.serial}) fue rechazado.</p>
    ${alerta}
    <p><strong>Motivo:</strong> ${payload.motivoRechazo}</p>
    <p>Podés ver más detalles en:
    <a href="${frontendUrl}/cit/${payload.numeroCIT}">${frontendUrl}/cit/${payload.numeroCIT}</a></p>
    <hr><p style="color:#888;font-size:12px">RODAID · Ley Provincial N° 9556</p>
  </div>`
}

async function enviarEmailVencimiento(
  email: string, nombre: string,
  cit: { numero_cit: string; numero_serie: string; marca: string; modelo: string; fecha_vencimiento: Date },
  dias: number, fechaStr: string, renovarUrl: string
): Promise<void> {
  try {
    const { Resend } = await import('resend').catch(() => ({ Resend: null })) as any
    if (!Resend || !process.env.RESEND_API_KEY) {
      log.mensajeria.warn({ numeroCIT: cit.numero_cit, dias }, '📧 Email vencimiento STUB')
      return
    }
    const r = new Resend(process.env.RESEND_API_KEY)
    const urgente = dias <= 7
    await r.emails.send({
      from:    'RODAID <noreply@rodaid.com.ar>',
      to:      email,
      subject: urgente
        ? `⚠ Tu CIT vence en ${dias} día${dias > 1 ? 's' : ''}`
        : `📅 Renovación de CIT — ${cit.numero_cit}`,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:${urgente ? '#dc2626' : '#0F1E35'}">
          ${urgente ? '⚠' : '📅'} CIT ${dias === 1 ? 'vence HOY' : `vence en ${dias} días`}
        </h2>
        <p>Hola <strong>${nombre}</strong>,</p>
        <p>Tu certificado CIT <strong>${cit.numero_cit}</strong> para la
        <strong>${cit.marca} ${cit.modelo}</strong> (S/N: <code>${cit.numero_serie}</code>)
        vence el <strong>${fechaStr}</strong>.</p>
        ${urgente ? '<p style="color:#dc2626"><strong>⚠ Renovalo antes del vencimiento para evitar multas.</strong></p>' : ''}
        <a href="${renovarUrl}"
           style="display:inline-block;background:#E8621A;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">
          Renovar CIT →
        </a>
        <hr><p style="color:#888;font-size:12px">RODAID · Ley Provincial N° 9556</p>
      </div>`,
      text: `Tu CIT ${cit.numero_cit} vence el ${fechaStr}. Renovalo en: ${renovarUrl}`,
    })
  } catch { /* no interrumpir */ }
}
