/**
 * RODAID — Hito 10: Servicio de Notificaciones basado en EVENTOS.
 *
 * Los servicios de dominio (Pipeline de validacion, Escrow del marketplace,
 * Inspecciones) no envian notificaciones a mano: emiten un EVENTO y este
 * servicio se encarga de (1) construir un mensaje claro y directo, (2) resolver
 * los destinos del usuario y (3) despacharlo por cada CANAL registrado.
 *
 * Arquitectura:
 *   evento de dominio ──▶ construirMensaje() ──▶ canales[]  ──▶ acuse + auditoria
 *
 * Canales: hoy el unico activo es Web Push (notificaciones nativas del
 * navegador, sin librerias pesadas — ver `webpush.ts`). El bus es agnostico del
 * canal: sumar WhatsApp o Email a futuro es registrar un canal nuevo en
 * `CANALES`, sin tocar los disparadores de los servicios de dominio.
 *
 * Opt-in: solo se notifica a los usuarios que autorizaron explicitamente y
 * suscribieron su navegador (`notificaciones_suscripciones`). Sin suscripciones,
 * el evento se registra pero no se envia nada.
 *
 * Best-effort: emitir un evento NUNCA lanza ni bloquea al flujo que lo dispara.
 */

import { getPool } from '@/lib/marketplace'
import {
  sendPushNotification,
  type PushSubscriptionData,
} from '@/src/services/webpush'
import { despacharEventoEcosistema } from '@/src/services/webhooks-ecosistema.service'

// Re-export para que el frontend/endpoints obtengan la clave publica VAPID.
export { getVapidPublicKey } from '@/src/services/webpush'

// ---------------------------------------------------------------------------
// Eventos de dominio
// ---------------------------------------------------------------------------

export type NotificacionEventoTipo =
  | 'cit.aprobado'
  | 'cit.bloqueado'
  | 'cit.recuperada'
  | 'marketplace.oferta'
  | 'escrow.fondos_retenidos'
  | 'inspeccion.acta_firmada'
  | 'iot.geovalla_salida'
  | 'iot.mantenimiento'
  | 'iot.robo_en_curso'

/**
 * Evento de dominio. `usuarioId` es el destinatario (propietario de la bici,
 * vendedor, etc.). `data` lleva los campos que el constructor del mensaje usa
 * para personalizar el texto. Cualquier servicio puede emitir uno.
 */
export interface NotificacionEvento {
  tipo: NotificacionEventoTipo
  usuarioId: string | null
  data?: Record<string, unknown>
}

/** Mensaje listo para mostrarse en una notificacion nativa. */
export interface MensajeNotificacion {
  titulo: string
  cuerpo: string
  /** Ruta a abrir al hacer click en la notificacion. */
  url: string
  /** Agrupa/colapsa notificaciones del mismo tipo en el navegador. */
  tag: string
}

function texto(data: Record<string, unknown> | undefined, key: string): string | null {
  const value = data?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * Construye el mensaje claro y directo de cada evento. Centraliza el copy para
 * mantener un tono consistente ("¡Tu bicicleta fue verificada!", "Protección
 * RODAID: Fondos retenidos").
 */
function construirMensaje(evento: NotificacionEvento): MensajeNotificacion {
  const data = evento.data
  switch (evento.tipo) {
    case 'cit.aprobado': {
      const codigo = texto(data, 'codigoCit')
      return {
        titulo: '¡Tu bicicleta ha sido verificada!',
        cuerpo: codigo
          ? `Tu Cédula de Identidad ${codigo} fue aprobada. Ya podés publicarla con identidad verificada.`
          : 'Tu bici superó el control de seguridad y tiene identidad verificada.',
        url: '/garaje',
        tag: 'cit',
      }
    }
    case 'cit.bloqueado': {
      const motivo = texto(data, 'motivo')
      return {
        titulo: 'Verificación no aprobada',
        cuerpo: motivo
          ? `La verificación de tu CIT no fue aprobada: ${motivo}. Comunicate con soporte de RODAID.`
          : 'La verificación de tu CIT no fue aprobada. Comunicate con soporte de RODAID.',
        url: '/garaje',
        tag: 'cit',
      }
    }
    case 'cit.recuperada': {
      const codigo = texto(data, 'codigoCit')
      return {
        titulo: '¡Buenas noticias! Tu bicicleta fue recuperada',
        cuerpo: codigo
          ? `El Ministerio de Seguridad informó la recuperación de tu bici. Su Cédula ${codigo} se desbloqueó y volvió a estado activo.`
          : 'El Ministerio de Seguridad informó la recuperación de tu bici. Su Cédula se desbloqueó y volvió a estado activo.',
        url: '/garaje',
        tag: 'cit',
      }
    }
    case 'marketplace.oferta': {
      const titulo = texto(data, 'publicacionTitulo')
      return {
        titulo: 'Tenés una nueva oferta',
        cuerpo: titulo
          ? `Un comprador quiere llevarse "${titulo}". Revisá la operación en RODAID.`
          : 'Un comprador está interesado en una de tus publicaciones.',
        url: '/garaje',
        tag: 'marketplace',
      }
    }
    case 'escrow.fondos_retenidos': {
      const titulo = texto(data, 'publicacionTitulo')
      return {
        titulo: 'Protección RODAID: Fondos retenidos',
        cuerpo: titulo
          ? `El pago de "${titulo}" quedó en custodia. Coordiná el envío para liberar los fondos.`
          : 'El pago quedó retenido en custodia. Coordiná el envío para liberar los fondos.',
        url: '/garaje',
        tag: 'escrow',
      }
    }
    case 'inspeccion.acta_firmada': {
      const aliado = texto(data, 'aliadoNombre')
      return {
        titulo: 'Inspección física aprobada',
        cuerpo: aliado
          ? `Un inspector de ${aliado} firmó el acta de tu bici. Su identidad se acelera en la verificación.`
          : 'Un inspector firmó el acta física de tu bici. Su identidad se acelera en la verificación.',
        url: '/garaje',
        tag: 'inspeccion',
      }
    }
    case 'iot.geovalla_salida': {
      const zona = texto(data, 'zonaSegura')
      const bici = texto(data, 'biciNombre')
      return {
        titulo: '⚠️ Tu bici salió de la zona segura',
        cuerpo: zona
          ? `${bici ?? 'Tu bicicleta'} salió de "${zona}" sin autorización. Revisá su ubicación en tiempo real.`
          : `${bici ?? 'Tu bicicleta'} salió de una zona segura sin autorización. Revisá su ubicación en tiempo real.`,
        url: '/garaje',
        tag: 'iot-geovalla',
      }
    }
    case 'iot.mantenimiento': {
      const detalle = texto(data, 'resumen')
      return {
        titulo: 'Mantenimiento predictivo RODAID',
        cuerpo:
          detalle ??
          'Detectamos una señal de desgaste en tu bici. Revisá la recomendación de mantenimiento.',
        url: '/garaje',
        tag: 'iot-mantenimiento',
      }
    }
    case 'iot.robo_en_curso': {
      return {
        titulo: '🚨 Reporte de robo en curso enviado',
        cuerpo:
          'Compartimos la ubicación en tiempo real de tu bici con el Ministerio de Seguridad. Seguí las indicaciones de las autoridades.',
        url: '/garaje',
        tag: 'iot-robo',
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Suscripciones (CRUD) — opt-in del navegador a Web Push
// ---------------------------------------------------------------------------

export interface SuscripcionInput {
  endpoint: string
  p256dh: string
  auth: string
  userAgent?: string | null
}

/** Alta/actualizacion (upsert por endpoint) de una suscripcion de un usuario. */
export async function guardarSuscripcion(
  usuarioId: string,
  sub: SuscripcionInput
): Promise<void> {
  await getPool().query(
    `
      INSERT INTO notificaciones_suscripciones
        (usuario_id, endpoint, p256dh, auth, user_agent)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (endpoint) DO UPDATE
        SET usuario_id = EXCLUDED.usuario_id,
            p256dh = EXCLUDED.p256dh,
            auth = EXCLUDED.auth,
            user_agent = EXCLUDED.user_agent,
            updated_at = NOW()
    `,
    [usuarioId, sub.endpoint, sub.p256dh, sub.auth, sub.userAgent ?? null]
  )
}

/** Baja de una suscripcion. Acotada al usuario duenno (no borra ajenas). */
export async function eliminarSuscripcion(
  usuarioId: string,
  endpoint: string
): Promise<boolean> {
  const res = await getPool().query(
    `DELETE FROM notificaciones_suscripciones
     WHERE endpoint = $1 AND usuario_id = $2`,
    [endpoint, usuarioId]
  )
  return (res.rowCount ?? 0) > 0
}

async function purgarSuscripcion(endpoint: string): Promise<void> {
  await getPool()
    .query(`DELETE FROM notificaciones_suscripciones WHERE endpoint = $1`, [endpoint])
    .catch(() => undefined)
}

interface SuscripcionRow {
  endpoint: string
  p256dh: string
  auth: string
}

async function listarSuscripciones(usuarioId: string): Promise<SuscripcionRow[]> {
  const res = await getPool().query<SuscripcionRow>(
    `SELECT endpoint, p256dh, auth
     FROM notificaciones_suscripciones
     WHERE usuario_id = $1`,
    [usuarioId]
  )
  return res.rows
}

// ---------------------------------------------------------------------------
// Canales — pluggables. Hoy: Web Push. Manana: WhatsApp / Email.
// ---------------------------------------------------------------------------

interface AcuseCanal {
  canal: string
  entregas: number
  exito: boolean
  error?: string
}

interface CanalNotificacion {
  nombre: string
  enviar(
    usuarioId: string,
    mensaje: MensajeNotificacion,
    evento: NotificacionEvento
  ): Promise<AcuseCanal>
}

/** Canal Web Push: cifra y envia a cada navegador suscripto del usuario. */
const canalWebPush: CanalNotificacion = {
  nombre: 'webpush',
  async enviar(usuarioId, mensaje, evento) {
    const subs = await listarSuscripciones(usuarioId)
    if (subs.length === 0) {
      return { canal: 'webpush', entregas: 0, exito: false, error: 'sin_suscripciones' }
    }

    const payload = {
      title: mensaje.titulo,
      body: mensaje.cuerpo,
      url: mensaje.url,
      tag: mensaje.tag,
      evento: evento.tipo,
    }

    let entregas = 0
    let ultimoError: string | undefined
    await Promise.all(
      subs.map(async (s) => {
        const data: PushSubscriptionData = {
          endpoint: s.endpoint,
          p256dh: s.p256dh,
          auth: s.auth,
        }
        const res = await sendPushNotification(data, payload)
        if (res.ok) {
          entregas += 1
        } else {
          ultimoError = res.error
          // El push service avisa que la suscripcion murio: la purgamos.
          if (res.gone) {
            await purgarSuscripcion(s.endpoint)
          }
        }
      })
    )

    return {
      canal: 'webpush',
      entregas,
      exito: entregas > 0,
      error: entregas > 0 ? undefined : ultimoError,
    }
  },
}

/** Registro de canales activos. Sumar uno nuevo es agregarlo a esta lista. */
const CANALES: CanalNotificacion[] = [canalWebPush]

// ---------------------------------------------------------------------------
// Bus de eventos
// ---------------------------------------------------------------------------

export interface AcuseEvento {
  tipo: NotificacionEventoTipo
  entregas: number
  enviada: boolean
}

async function auditarEnvio(
  evento: NotificacionEvento,
  mensaje: MensajeNotificacion,
  acuses: AcuseCanal[]
): Promise<void> {
  const entregas = acuses.reduce((acc, a) => acc + a.entregas, 0)
  const exito = acuses.some((a) => a.exito)
  const error = exito ? null : acuses.map((a) => a.error).filter(Boolean).join('; ') || null
  await getPool()
    .query(
      `
        INSERT INTO notificaciones_enviadas
          (usuario_id, evento, canal, titulo, cuerpo, entregas, exito, error, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      `,
      [
        evento.usuarioId,
        evento.tipo,
        acuses.map((a) => a.canal).join(',') || 'webpush',
        mensaje.titulo,
        mensaje.cuerpo,
        entregas,
        exito,
        error,
        JSON.stringify(evento.data ?? {}),
      ]
    )
    .catch((err: unknown) => console.error('[notificaciones] no se pudo auditar el envio', err))
}

/**
 * Emite un evento de dominio. Construye el mensaje, lo despacha por todos los
 * canales y deja la auditoria. Best-effort: nunca lanza. Devuelve un acuse para
 * quien quiera registrarlo (p. ej. el pipeline en su bitacora).
 */
export async function emitirEvento(
  evento: NotificacionEvento
): Promise<AcuseEvento> {
  const mensaje = construirMensaje(evento)
  try {
    // Hito 16 — Open-Connect: fan-out al ecosistema de terceros (logística,
    // seguros). NO BLOQUEANTE: se dispara sin await para no afectar el SLA del
    // proceso de negocio; solo se entregan eventos PUBLICOS sin datos personales.
    void despacharEventoEcosistema({ tipo: evento.tipo, data: evento.data }).catch(
      () => undefined
    )

    // El log de consola deja rastro siempre, haya o no suscripciones (util en
    // preview y para debugging del pipeline).
    console.info(
      `[notificacion:${evento.tipo}] -> ${evento.usuarioId ?? 'sin-destinatario'} | ${mensaje.titulo}\n${mensaje.cuerpo}`
    )

    if (!evento.usuarioId) {
      await auditarEnvio(evento, mensaje, [])
      return { tipo: evento.tipo, entregas: 0, enviada: false }
    }

    const acuses = await Promise.all(
      CANALES.map((canal) =>
        canal
          .enviar(evento.usuarioId as string, mensaje, evento)
          .catch((err): AcuseCanal => ({
            canal: canal.nombre,
            entregas: 0,
            exito: false,
            error: (err as Error).message,
          }))
      )
    )
    await auditarEnvio(evento, mensaje, acuses)

    const entregas = acuses.reduce((acc, a) => acc + a.entregas, 0)
    return { tipo: evento.tipo, entregas, enviada: entregas > 0 }
  } catch (error) {
    console.error('[notificaciones] fallo al emitir evento', error)
    return { tipo: evento.tipo, entregas: 0, enviada: false }
  }
}

// ---------------------------------------------------------------------------
// Compatibilidad: notificacion de resultado del pipeline (Hito 5).
//
// El pipeline de validacion ya construia un payload `NotificacionValidacion`.
// Lo mantenemos como una fachada delgada sobre el bus de eventos, de modo que el
// pipeline no necesita conocer canales ni suscripciones.
// ---------------------------------------------------------------------------

export type CanalNotificacionLegacy = 'consola' | 'email' | 'push'

export interface NotificacionValidacion {
  /** Identificador del propietario de la bici (destinatario del push). */
  propietarioId?: string | null
  /** Email/identificador legible del destinatario (compat; no se usa para push). */
  destinatario: string | null
  citId: string
  codigoCit: string
  resultado: 'APROBADO' | 'BLOQUEADO'
  motivo?: string | null
}

export interface AcuseNotificacion {
  enviada: boolean
  canal: CanalNotificacionLegacy
  asunto: string
}

/**
 * Notifica el resultado de la validacion de un CIT emitiendo el evento de
 * dominio correspondiente. Best-effort: nunca lanza. Devuelve un acuse para la
 * auditoria del pipeline (`log_validaciones`).
 */
export async function enviarNotificacion(
  n: NotificacionValidacion
): Promise<AcuseNotificacion> {
  const tipo: NotificacionEventoTipo =
    n.resultado === 'APROBADO' ? 'cit.aprobado' : 'cit.bloqueado'
  const acuse = await emitirEvento({
    tipo,
    usuarioId: n.propietarioId ?? null,
    data: { citId: n.citId, codigoCit: n.codigoCit, motivo: n.motivo ?? null },
  })
  const asunto =
    n.resultado === 'APROBADO'
      ? `Tu bici fue verificada — CIT ${n.codigoCit} aprobado`
      : `Verificacion no aprobada — CIT ${n.codigoCit} bloqueado`
  return {
    enviada: true,
    canal: acuse.entregas > 0 ? 'push' : 'consola',
    asunto,
  }
}
