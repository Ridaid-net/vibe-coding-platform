// ─── RODAID · Centro de Preferencias de Notificaciones ───
// Gestiona qué notificaciones recibe cada usuario y
// por qué canal (push, email, MxM, in_app).
//
// Defaults por evento:
//   cit_aprobado     → push ✓ email ✓ mxm ✓ in_app ✓
//   cit_rechazado    → push ✓ email ✓ mxm ✓ in_app ✓
//   cit_por_vencer   → push ✓ email ✓ mxm ✓ in_app ✓
//   cit_vencido      → push ✓ email ✓ mxm ✓ in_app ✓
//   tasa_confirmada  → push ✓ email ✓ mxm ✓ in_app ✓
//   pago_rechazado   → push ✓ email ✓ mxm ✗ in_app ✓
//   denuncia_registrada → push ✓ email ✓ mxm ✓ in_app ✓
//   bici_recuperada  → push ✓ email ✓ mxm ✓ in_app ✓
//   alerta_zona      → push ✓ email ✗ mxm ✗ in_app ✗  ← suscripción opt-in
//   nueva_oferta     → push ✓ email ✓ mxm ✗ in_app ✓
//   venta_confirmada → push ✓ email ✓ mxm ✓ in_app ✓
//   compra_completada→ push ✓ email ✓ mxm ✓ in_app ✓
//   disputa_abierta  → push ✓ email ✓ mxm ✓ in_app ✓
//   disputa_resuelta → push ✓ email ✓ mxm ✓ in_app ✓
//   nft_transferido  → push ✓ email ✓ mxm ✓ in_app ✓
//   sistema_general  → push ✓ email ✗ mxm ✗ in_app ✓
//   token_expiracion → push ✓ email ✗ mxm ✗ in_app ✓
//   newsletter       → push ✗ email ✓ mxm ✗ in_app ✗  ← opt-out
//
// Notas importantes:
//   · Las notificaciones de seguridad crítica (denuncia, CIT rechazado)
//     SIEMPRE se envían in_app, independientemente de las preferencias.
//   · El canal MxM requiere que el usuario tenga MxM conectado (nivel 2).
//   · El token de desuscripción permite unsubscribe one-click desde email.
//
// Integración con los dispatchers:
//   Antes de enviar → await puedeNotificar(usuarioId, evento, canal)
//   Si false → omitir ese canal para ese usuario

import crypto              from 'crypto'
import { query, queryOne } from '../config/database'
import { getRedis }        from '../config/redis'
import { log }             from '../middleware/logger'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export type EventoNotif =
  | 'cit_aprobado' | 'cit_rechazado' | 'cit_por_vencer' | 'cit_vencido'
  | 'tasa_confirmada' | 'pago_rechazado'
  | 'denuncia_registrada' | 'bici_recuperada' | 'alerta_zona'
  | 'nueva_oferta' | 'venta_confirmada' | 'compra_completada'
  | 'disputa_abierta' | 'disputa_resuelta'
  | 'nft_transferido'
  | 'sistema_general' | 'token_expiracion' | 'newsletter'

export type CanalNotif = 'push' | 'email' | 'mxm' | 'in_app'

export interface Preferencia {
  evento:    EventoNotif
  canal:     CanalNotif
  activo:    boolean
  horaInicio?: number
  horaFin?:    number
}

// ══════════════════════════════════════════════════════════
// DEFAULTS POR EVENTO Y CANAL
// ══════════════════════════════════════════════════════════

// true = activo por defecto, false = desactivado por defecto (opt-in)
const DEFAULTS: Record<EventoNotif, Record<CanalNotif, boolean>> = {
  cit_aprobado:       { push: true,  email: true,  mxm: true,  in_app: true  },
  cit_rechazado:      { push: true,  email: true,  mxm: true,  in_app: true  },
  cit_por_vencer:     { push: true,  email: true,  mxm: true,  in_app: true  },
  cit_vencido:        { push: true,  email: true,  mxm: true,  in_app: true  },
  tasa_confirmada:    { push: true,  email: true,  mxm: true,  in_app: true  },
  pago_rechazado:     { push: true,  email: true,  mxm: false, in_app: true  },
  denuncia_registrada:{ push: true,  email: true,  mxm: true,  in_app: true  },
  bici_recuperada:    { push: true,  email: true,  mxm: true,  in_app: true  },
  alerta_zona:        { push: false, email: false, mxm: false, in_app: false }, // opt-in
  nueva_oferta:       { push: true,  email: true,  mxm: false, in_app: true  },
  venta_confirmada:   { push: true,  email: true,  mxm: true,  in_app: true  },
  compra_completada:  { push: true,  email: true,  mxm: true,  in_app: true  },
  disputa_abierta:    { push: true,  email: true,  mxm: true,  in_app: true  },
  disputa_resuelta:   { push: true,  email: true,  mxm: true,  in_app: true  },
  nft_transferido:    { push: true,  email: true,  mxm: true,  in_app: true  },
  sistema_general:    { push: true,  email: false, mxm: false, in_app: true  },
  token_expiracion:   { push: true,  email: false, mxm: false, in_app: true  },
  newsletter:         { push: false, email: true,  mxm: false, in_app: false },
}

// Eventos que SIEMPRE envían in_app, sin importar preferencias
const SIEMPRE_IN_APP: EventoNotif[] = [
  'cit_aprobado', 'cit_rechazado', 'denuncia_registrada',
  'disputa_abierta', 'tasa_confirmada',
]

// ══════════════════════════════════════════════════════════
// CACHE
// ══════════════════════════════════════════════════════════

const CACHE_TTL = 300  // 5 minutos
const prefKey = (userId: string) => `notif:prefs:${userId}`

async function invalidarCache(userId: string): Promise<void> {
  const redis = getRedis()
  await redis.del(prefKey(userId)).catch(() => {})
}

// ══════════════════════════════════════════════════════════
// OBTENER PREFERENCIAS
// ══════════════════════════════════════════════════════════

export async function getPreferencias(usuarioId: string): Promise<
  Array<{
    evento: EventoNotif; canal: CanalNotif; activo: boolean
    horaInicio?: number; horaFin?: number; esDefault: boolean
  }>
> {
  // Cache Redis
  const redis = getRedis()
  const cached = await redis.get(prefKey(usuarioId)).catch(() => null)
  if (cached) return JSON.parse(cached)

  // Preferencias guardadas en DB
  const rows = await query<{
    evento: string; canal: string; activo: boolean
    hora_inicio: number | null; hora_fin: number | null
  }>(
    `SELECT evento::text, canal::text, activo, hora_inicio, hora_fin
     FROM notif_preferencias WHERE usuario_id=$1`,
    [usuarioId]
  )

  const guardadas = new Map<string, typeof rows[0]>()
  for (const r of rows) guardadas.set(`${r.evento}:${r.canal}`, r)

  // Combinar con defaults
  const resultado = []
  for (const [evento, canales] of Object.entries(DEFAULTS)) {
    for (const [canal, defaultActivo] of Object.entries(canales)) {
      const key = `${evento}:${canal}`
      const guardada = guardadas.get(key)
      resultado.push({
        evento:     evento as EventoNotif,
        canal:      canal as CanalNotif,
        activo:     guardada ? guardada.activo : defaultActivo,
        horaInicio: guardada?.hora_inicio ?? undefined,
        horaFin:    guardada?.hora_fin    ?? undefined,
        esDefault:  !guardada,
      })
    }
  }

  await redis.set(prefKey(usuarioId), JSON.stringify(resultado), 'EX', CACHE_TTL).catch(() => {})
  return resultado
}

/** Preferencias en formato organizado por evento (para el UI del centro) */
export async function getPreferenciasPorEvento(usuarioId: string): Promise<
  Record<EventoNotif, {
    label:    string
    grupo:    string
    canales:  Record<CanalNotif, { activo: boolean; soportado: boolean }>
    critico:  boolean  // no se puede desactivar in_app
  }>
> {
  const prefs = await getPreferencias(usuarioId)
  const map   = new Map<string, Preferencia>()
  for (const p of prefs) map.set(`${p.evento}:${p.canal}`, p)

  const resultado = {} as any
  for (const evento of Object.keys(DEFAULTS) as EventoNotif[]) {
    const meta = EVENTO_META[evento]
    const canales: any = {}
    for (const canal of ['push', 'email', 'mxm', 'in_app'] as CanalNotif[]) {
      const p = map.get(`${evento}:${canal}`)
      canales[canal] = {
        activo:    p ? p.activo : DEFAULTS[evento][canal],
        soportado: true,  // todos los canales son técnicamente soportables
      }
    }
    resultado[evento] = {
      label:   meta.label,
      grupo:   meta.grupo,
      canales,
      critico: SIEMPRE_IN_APP.includes(evento),
    }
  }
  return resultado
}

// ══════════════════════════════════════════════════════════
// ACTUALIZAR PREFERENCIAS
// ══════════════════════════════════════════════════════════

export async function setPreferencia(
  usuarioId: string,
  evento:    EventoNotif,
  canal:     CanalNotif,
  activo:    boolean,
  horario?:  { horaInicio?: number; horaFin?: number }
): Promise<void> {
  // Protección: in_app de eventos críticos siempre activo
  if (!activo && canal === 'in_app' && SIEMPRE_IN_APP.includes(evento)) {
    throw Object.assign(
      new Error(`La notificación in-app de "${evento}" no puede desactivarse por seguridad.`),
      { code: 'CANAL_OBLIGATORIO', status: 422 }
    )
  }

  await query(
    `INSERT INTO notif_preferencias (usuario_id, evento, canal, activo, hora_inicio, hora_fin)
     VALUES ($1, $2::evento_notif, $3::canal_notif, $4::boolean, $5, $6)
     ON CONFLICT (usuario_id, evento, canal) DO UPDATE SET
       activo         = EXCLUDED.activo,
       hora_inicio    = EXCLUDED.hora_inicio,
       hora_fin       = EXCLUDED.hora_fin,
       actualizado_en = NOW()`,
    [usuarioId, evento, canal, activo, horario?.horaInicio ?? null, horario?.horaFin ?? null]
  )

  await invalidarCache(usuarioId)

  log.mensajeria.info({
    usuarioId: usuarioId.slice(0, 8), evento, canal, activo,
  }, `Preferencia actualizada: ${evento}/${canal} → ${activo ? 'ON' : 'OFF'}`)
}

/** Actualizar múltiples preferencias en una sola operación */
export async function setPreferenciasBulk(
  usuarioId:    string,
  preferencias: Array<{ evento: EventoNotif; canal: CanalNotif; activo: boolean }>
): Promise<{ actualizadas: number; errores: string[] }> {
  let actualizadas = 0
  const errores: string[] = []

  for (const p of preferencias) {
    try {
      await setPreferencia(usuarioId, p.evento, p.canal, p.activo)
      actualizadas++
    } catch (err) {
      errores.push(`${p.evento}/${p.canal}: ${(err as Error).message}`)
    }
  }

  return { actualizadas, errores }
}

/** Restaurar todos los defaults del usuario */
export async function resetarPreferencias(usuarioId: string): Promise<void> {
  await query(`DELETE FROM notif_preferencias WHERE usuario_id=$1`, [usuarioId])
  await invalidarCache(usuarioId)
  log.mensajeria.info({ usuarioId: usuarioId.slice(0, 8) }, 'Preferencias reseteadas a defaults')
}

/** Activar o desactivar todos los emails de una vez */
export async function toggleTodosEmail(usuarioId: string, activo: boolean): Promise<number> {
  const eventos = Object.keys(DEFAULTS) as EventoNotif[]
  let count = 0
  for (const evento of eventos) {
    if (DEFAULTS[evento]['email']) {  // solo modificar los que tienen email habilitado en defaults
      await query(
        `INSERT INTO notif_preferencias (usuario_id, evento, canal, activo)
         VALUES ($1, $2::evento_notif, 'email'::canal_notif, $3::boolean)
         ON CONFLICT (usuario_id, evento, canal) DO UPDATE SET activo=$3::boolean, actualizado_en=NOW()`,
        [usuarioId, evento, activo]
      )
      count++
    }
  }
  await invalidarCache(usuarioId)
  return count
}

/** Activar o desactivar todos los push de una vez */
export async function toggleTodosPush(usuarioId: string, activo: boolean): Promise<number> {
  const eventos = Object.keys(DEFAULTS) as EventoNotif[]
  let count = 0
  for (const evento of eventos) {
    if (DEFAULTS[evento]['push']) {
      await query(
        `INSERT INTO notif_preferencias (usuario_id, evento, canal, activo)
         VALUES ($1, $2::evento_notif, 'push'::canal_notif, $3::boolean)
         ON CONFLICT (usuario_id, evento, canal) DO UPDATE SET activo=$3::boolean, actualizado_en=NOW()`,
        [usuarioId, evento, activo]
      )
      count++
    }
  }
  await invalidarCache(usuarioId)
  return count
}

// ══════════════════════════════════════════════════════════
// GATE: ¿puede recibir esta notificación?
// ══════════════════════════════════════════════════════════

export async function puedeNotificar(
  usuarioId: string,
  evento:    EventoNotif,
  canal:     CanalNotif
): Promise<boolean> {
  // Regla de seguridad: in_app de eventos críticos siempre sí
  if (canal === 'in_app' && SIEMPRE_IN_APP.includes(evento)) return true

  // Leer preferencia (incluye default si no hay entrada en DB)
  const prefs = await getPreferencias(usuarioId)
  const pref  = prefs.find(p => p.evento === evento && p.canal === canal)

  if (!pref?.activo) return false

  // Verificar horario silencioso
  if (pref.horaInicio !== undefined && pref.horaFin !== undefined) {
    const horaActual = new Date().getUTCHours()
    const { horaInicio, horaFin } = pref
    if (horaInicio < horaFin) {
      // Rango normal: 22-08 → silencioso entre esas horas
      if (horaActual < horaInicio || horaActual >= horaFin) return false
    } else {
      // Rango overnight: 22-06 → silencioso de 22 a 06
      if (horaActual >= horaInicio || horaActual < horaFin) return false
    }
  }

  return true
}

// ══════════════════════════════════════════════════════════
// UNSUBSCRIBE TOKEN (one-click desde email)
// ══════════════════════════════════════════════════════════

export async function generarUnsubToken(
  usuarioId: string,
  evento?:   EventoNotif,
  canal?:    CanalNotif
): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url')
  await query(
    `INSERT INTO notif_unsub_tokens (token, usuario_id, evento, canal)
     VALUES ($1, $2, $3::evento_notif, $4::canal_notif)`,
    [token, usuarioId, evento ?? null, canal ?? 'email']
  )
  return token
}

export async function procesarUnsubToken(token: string): Promise<{
  ok: boolean; evento?: string; canal?: string; mensaje: string
}> {
  const row = await queryOne<{
    usuario_id: string; evento: string | null; canal: string; usado_en: Date | null; expira_en: Date
  }>(
    `SELECT usuario_id, evento::text, canal::text, usado_en, expira_en
     FROM notif_unsub_tokens WHERE token=$1`,
    [token]
  )

  if (!row) return { ok: false, mensaje: 'Token de desuscripción inválido.' }
  if (row.usado_en) return { ok: false, mensaje: 'Este link ya fue usado.' }
  if (new Date(row.expira_en) < new Date()) return { ok: false, mensaje: 'Link expirado.' }

  // Marcar como usado
  await query(`UPDATE notif_unsub_tokens SET usado_en=NOW() WHERE token=$1`, [token])

  if (row.evento) {
    // Desuscribir de un evento específico
    await setPreferencia(row.usuario_id, row.evento as EventoNotif, row.canal as CanalNotif, false)
    return { ok: true, evento: row.evento, canal: row.canal, mensaje: `Desuscripto de "${row.evento}" (${row.canal}).` }
  } else {
    // Desuscribir de todos los emails
    await toggleTodosEmail(row.usuario_id, false)
    return { ok: true, canal: 'email', mensaje: 'Desuscripto de todos los emails de RODAID.' }
  }
}

/** Generar link de desuscripción para incluir en emails */
export async function getLinkDesuscripcion(
  usuarioId: string,
  evento?:   EventoNotif,
  baseUrl?:  string
): Promise<string> {
  const token = await generarUnsubToken(usuarioId, evento, 'email')
  const base  = baseUrl ?? process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.com.ar'
  return `${base}/notificaciones/unsub?token=${token}`
}

// ══════════════════════════════════════════════════════════
// STATS ADMIN
// ══════════════════════════════════════════════════════════

export async function getEstadisticasPreferencias(): Promise<{
  usuariosConPreferencias: number
  desactivacionesPorCanal: Record<CanalNotif, number>
  eventosMasDesactivados: Array<{ evento: string; count: number }>
}> {
  const [usuarios, porCanal, porEvento] = await Promise.all([
    queryOne<{ count: string }>(
      `SELECT COUNT(DISTINCT usuario_id)::text AS count FROM notif_preferencias WHERE NOT activo`, []
    ),
    query<{ canal: string; count: string }>(
      `SELECT canal::text, COUNT(*)::text AS count FROM notif_preferencias
       WHERE NOT activo GROUP BY canal ORDER BY count DESC`, []
    ),
    query<{ evento: string; count: string }>(
      `SELECT evento::text, COUNT(*)::text AS count FROM notif_preferencias
       WHERE NOT activo GROUP BY evento ORDER BY count DESC LIMIT 10`, []
    ),
  ])

  const porCanalMap: any = { push: 0, email: 0, mxm: 0, in_app: 0 }
  for (const r of porCanal) porCanalMap[r.canal] = parseInt(r.count)

  return {
    usuariosConPreferencias: parseInt(usuarios?.count ?? '0'),
    desactivacionesPorCanal: porCanalMap,
    eventosMasDesactivados:  porEvento.map(r => ({ evento: r.evento, count: parseInt(r.count) })),
  }
}

// ══════════════════════════════════════════════════════════
// METADATA DE EVENTOS (para el UI)
// ══════════════════════════════════════════════════════════

export const EVENTO_META: Record<EventoNotif, { label: string; grupo: string; descripcion: string }> = {
  cit_aprobado:       { label: 'CIT emitido',              grupo: 'Certificación',  descripcion: 'Cuando tu bicicleta es certificada exitosamente' },
  cit_rechazado:      { label: 'CIT rechazado',            grupo: 'Certificación',  descripcion: 'Cuando tu certificación es rechazada' },
  cit_por_vencer:     { label: 'CIT próximo a vencer',     grupo: 'Certificación',  descripcion: 'Recordatorios 30, 15, 7 y 1 día antes del vencimiento' },
  cit_vencido:        { label: 'CIT vencido',              grupo: 'Certificación',  descripcion: 'Cuando tu certificado vence' },
  tasa_confirmada:    { label: 'Pago de tasa confirmado',  grupo: 'Pagos',          descripcion: 'Confirmación de pago de tasa CIT' },
  pago_rechazado:     { label: 'Pago rechazado',           grupo: 'Pagos',          descripcion: 'Cuando un pago no puede procesarse' },
  denuncia_registrada:{ label: 'Denuncia de robo',         grupo: 'Seguridad',      descripcion: 'Cuando se registra una denuncia de robo' },
  bici_recuperada:    { label: 'Bicicleta recuperada',      grupo: 'Seguridad',      descripcion: 'Cuando tu bicicleta es marcada como recuperada' },
  alerta_zona:        { label: 'Alertas de robo en tu zona', grupo: 'Seguridad',    descripcion: 'Robos reportados en tu área (opt-in)' },
  nueva_oferta:       { label: 'Nueva oferta recibida',    grupo: 'Marketplace',    descripcion: 'Cuando alguien hace una oferta por tu publicación' },
  venta_confirmada:   { label: 'Venta confirmada',         grupo: 'Marketplace',    descripcion: 'Cuando se completa una venta y se acreditan los fondos' },
  compra_completada:  { label: 'Compra completada',        grupo: 'Marketplace',    descripcion: 'Cuando confirmás la recepción de tu compra' },
  disputa_abierta:    { label: 'Disputa abierta',          grupo: 'Marketplace',    descripcion: 'Cuando se abre una disputa en una transacción' },
  disputa_resuelta:   { label: 'Disputa resuelta',         grupo: 'Marketplace',    descripcion: 'Cuando se resuelve una disputa' },
  nft_transferido:    { label: 'NFT / CIT transferido',    grupo: 'Blockchain',     descripcion: 'Cuando el CIT es transferido on-chain en la BFA' },
  sistema_general:    { label: 'Mensajes del sistema',     grupo: 'Sistema',        descripcion: 'Comunicaciones generales de RODAID' },
  token_expiracion:   { label: 'Token MxM por vencer',     grupo: 'Sistema',        descripcion: 'Aviso de renovación de tu sesión MxM' },
  newsletter:         { label: 'Newsletter RODAID',        grupo: 'Sistema',        descripcion: 'Novedades y actualizaciones de la plataforma (opt-out)' },
}

export const GRUPOS_ORDEN = ['Certificación', 'Pagos', 'Seguridad', 'Marketplace', 'Blockchain', 'Sistema']
