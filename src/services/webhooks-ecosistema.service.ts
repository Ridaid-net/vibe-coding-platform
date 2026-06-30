import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { ApiError, getPool } from '@/lib/marketplace'

/**
 * RODAID — Hito 16: Webhooks de Ecosistema.
 *
 * Permite que un tercero (logística, seguros) se suscriba a EVENTOS PUBLICOS de
 * una bicicleta —fundamentalmente el cambio de estado de su propiedad/identidad—
 * y los reciba en tiempo real en su propio endpoint.
 *
 * Garantias:
 *   - PRIVACIDAD: el payload entregado SOLO contiene estado público verificado
 *     (serie, código CIT, veredicto, huella en la BFA). Nunca el propietario, su
 *     DNI, email ni ningún dato personal.
 *   - AUTENTICIDAD: cada entrega se firma con HMAC-SHA256 (cabecera
 *     `X-RODAID-Signature`, estilo `t=<ts>,v1=<hmac>`) usando el secreto de la
 *     suscripción, para que el receptor verifique que el evento vino de RODAID.
 *   - IDEMPOTENCIA: cada evento lleva un `id` único y la entrega se registra con
 *     un índice único `(webhook_id, evento_id)`; un reintento nunca duplica.
 *   - NO BLOQUEANTE: el despacho es best-effort y asíncrono respecto del proceso
 *     de negocio que originó el evento, para no afectar el SLA del sistema.
 */

// ───────────────────────────────────────────────────────────────────────────
// Catalogo de eventos publicos del ecosistema
// ───────────────────────────────────────────────────────────────────────────

export interface EventoEcosistemaDef {
  id: string
  titulo: string
  descripcion: string
}

export const EVENTOS_ECOSISTEMA: EventoEcosistemaDef[] = [
  {
    id: 'bici.verificada',
    titulo: 'Bicicleta verificada',
    descripcion: 'La identidad (CIT) de una bici fue aprobada y quedó verificada.',
  },
  {
    id: 'bici.bloqueada',
    titulo: 'Bicicleta bloqueada',
    descripcion: 'Una bici fue bloqueada por una denuncia (reportada como robada).',
  },
  {
    id: 'bici.recuperada',
    titulo: 'Bicicleta recuperada',
    descripcion: 'Una bici reportada como robada fue recuperada y su CIT se reactivó.',
  },
]

const EVENTOS_IDS: ReadonlySet<string> = new Set(EVENTOS_ECOSISTEMA.map((e) => e.id))

export function eventoValido(id: string): boolean {
  return EVENTOS_IDS.has(id)
}

/**
 * Traduce un evento de dominio interno (bus de notificaciones, Hito 10) al
 * catálogo público del ecosistema. Devuelve null si el evento no es público.
 */
export function mapearEventoDominio(tipoDominio: string): string | null {
  switch (tipoDominio) {
    case 'cit.aprobado':
      return 'bici.verificada'
    case 'cit.bloqueado':
      return 'bici.bloqueada'
    case 'cit.recuperada':
      return 'bici.recuperada'
    default:
      return null
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Suscripciones (CRUD)
// ───────────────────────────────────────────────────────────────────────────

export interface WebhookRow {
  id: string
  app_id: string
  url: string
  eventos: string[]
  secret: string
  estado: string
  created_at: string
  updated_at: string
}

export interface WebhookPublic {
  id: string
  appId: string
  url: string
  eventos: string[]
  estado: string
  /** Solo se incluye al crear/rotar (se muestra una vez). */
  secret?: string
  createdAt: string
  updatedAt: string
}

export function toWebhookPublic(row: WebhookRow, incluirSecret = false): WebhookPublic {
  return {
    id: row.id,
    appId: row.app_id,
    url: row.url,
    eventos: row.eventos ?? [],
    estado: row.estado,
    ...(incluirSecret ? { secret: row.secret } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function validarUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'La URL del webhook es obligatoria.')
  }
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', 'La URL del webhook no es válida.')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'La URL del webhook debe usar http(s).')
  }
  return parsed.toString()
}

function validarEventos(value: unknown): string[] {
  const arr = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  const limpios = arr
    .map((e) => (typeof e === 'string' ? e.trim() : ''))
    .filter(Boolean)
  for (const e of limpios) {
    if (!eventoValido(e)) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Evento desconocido: ${e}`)
    }
  }
  if (!limpios.length) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Suscribite al menos a un evento.')
  }
  return [...new Set(limpios)]
}

export async function crearWebhook(
  appId: string,
  input: { url?: unknown; eventos?: unknown }
): Promise<WebhookPublic> {
  const url = validarUrl(input.url)
  const eventos = validarEventos(input.eventos)
  const secret = `whsec_${randomBytes(24).toString('base64url')}`

  const res = await getPool().query<WebhookRow>(
    `
      INSERT INTO ecosystem_webhooks (app_id, url, eventos, secret)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `,
    [appId, url, eventos, secret]
  )
  // El secreto se muestra UNA vez (para que el receptor pueda verificar firmas).
  return toWebhookPublic(res.rows[0], true)
}

export async function listarWebhooksDeApp(appId: string): Promise<WebhookPublic[]> {
  const res = await getPool().query<WebhookRow>(
    `SELECT * FROM ecosystem_webhooks WHERE app_id = $1 ORDER BY created_at DESC`,
    [appId]
  )
  return res.rows.map((r: WebhookRow) => toWebhookPublic(r))
}

export async function actualizarWebhook(
  webhookId: string,
  appId: string,
  cambios: { url?: unknown; eventos?: unknown; estado?: unknown }
): Promise<WebhookPublic> {
  const sets: string[] = []
  const valores: unknown[] = []
  let i = 1
  if (cambios.url !== undefined) {
    sets.push(`url = $${i++}`)
    valores.push(validarUrl(cambios.url))
  }
  if (cambios.eventos !== undefined) {
    sets.push(`eventos = $${i++}`)
    valores.push(validarEventos(cambios.eventos))
  }
  if (cambios.estado !== undefined) {
    sets.push(`estado = $${i++}`)
    valores.push(cambios.estado === 'pausado' ? 'pausado' : 'activo')
  }
  if (!sets.length) {
    const cur = await getPool().query<WebhookRow>(
      `SELECT * FROM ecosystem_webhooks WHERE id = $1 AND app_id = $2`,
      [webhookId, appId]
    )
    if (!cur.rows[0]) throw new ApiError(404, 'WEBHOOK_NOT_FOUND', 'No encontramos la suscripción.')
    return toWebhookPublic(cur.rows[0])
  }
  valores.push(webhookId, appId)
  const res = await getPool().query<WebhookRow>(
    `UPDATE ecosystem_webhooks SET ${sets.join(', ')} WHERE id = $${i++} AND app_id = $${i} RETURNING *`,
    valores
  )
  if (!res.rows[0]) throw new ApiError(404, 'WEBHOOK_NOT_FOUND', 'No encontramos la suscripción.')
  return toWebhookPublic(res.rows[0])
}

export async function eliminarWebhook(webhookId: string, appId: string): Promise<void> {
  const res = await getPool().query(
    `DELETE FROM ecosystem_webhooks WHERE id = $1 AND app_id = $2`,
    [webhookId, appId]
  )
  if (res.rowCount === 0) {
    throw new ApiError(404, 'WEBHOOK_NOT_FOUND', 'No encontramos la suscripción.')
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Construccion del payload PUBLICO (sin datos personales)
// ───────────────────────────────────────────────────────────────────────────

export interface PayloadPublicoBici {
  bicicleta: {
    numeroSerie: string
    marca: string | null
    modelo: string | null
    tipo: string | null
  }
  cit: {
    codigo: string | null
    estado: string | null
    veredicto: string
  }
  bfa: {
    estado: string | null
    txHash: string | null
    anclado: boolean
  }
}

interface FilaCitPublica {
  numero_serie: string
  marca: string | null
  modelo: string | null
  tipo: string | null
  codigo_cit: string | null
  estado: string | null
  bfa_estado: string | null
  bfa_tx_hash: string | null
}

const VEREDICTO_POR_EVENTO: Record<string, string> = {
  'bici.verificada': 'SEGURO',
  'bici.bloqueada': 'ROBADA',
  'bici.recuperada': 'SEGURO',
}

/**
 * Arma el payload público a partir del CIT afectado. Solo datos NO sensibles del
 * bien y su estado. Devuelve null si no se puede resolver la bici (no se despacha).
 */
async function construirPayload(
  citId: string | null,
  eventoPublico: string
): Promise<PayloadPublicoBici | null> {
  if (!citId) return null
  const res = await getPool().query<FilaCitPublica>(
    `
      SELECT b.numero_serie, b.marca, b.modelo, b.tipo,
             c.codigo_cit, c.estado, c.bfa_estado, c.bfa_tx_hash
      FROM cits c
      JOIN bicicletas b ON b.id = c.bicicleta_id
      WHERE c.id = $1
      LIMIT 1
    `,
    [citId]
  )
  const fila = res.rows[0]
  if (!fila) return null
  return {
    bicicleta: {
      numeroSerie: fila.numero_serie,
      marca: fila.marca,
      modelo: fila.modelo,
      tipo: fila.tipo,
    },
    cit: {
      codigo: fila.codigo_cit,
      estado: fila.estado,
      veredicto: VEREDICTO_POR_EVENTO[eventoPublico] ?? 'EN_VALIDACION',
    },
    bfa: {
      estado: fila.bfa_estado,
      txHash: fila.bfa_tx_hash,
      anclado: fila.bfa_estado === 'anclado',
    },
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Firma y despacho
// ───────────────────────────────────────────────────────────────────────────

/** Firma estilo `t=<ts>,v1=<hmac>` sobre `<ts>.<body>`. */
export function firmarPayload(body: string, secret: string, ts: number): string {
  const firma = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')
  return `t=${ts},v1=${firma}`
}

const ENTREGA_TIMEOUT_MS = 4000

/** Entrega un evento a UNA suscripción, con idempotencia y registro de la entrega. */
async function entregar(
  webhook: WebhookRow,
  evento: { id: string; tipo: string; ts: number; cuerpo: Record<string, unknown> }
): Promise<void> {
  const pool = getPool()
  // Idempotencia: si ya existe una entrega exitosa para (webhook, evento), no repetir.
  const reserva = await pool
    .query(
      `
        INSERT INTO ecosystem_webhook_entregas
          (webhook_id, evento_id, evento_tipo, payload, intentos)
        VALUES ($1, $2, $3, $4::jsonb, 1)
        ON CONFLICT (webhook_id, evento_id) DO NOTHING
        RETURNING id
      `,
      [webhook.id, evento.id, evento.tipo, JSON.stringify(evento.cuerpo)]
    )
    .catch(() => null)
  if (!reserva || reserva.rowCount === 0) return // ya entregado/encolado

  const body = JSON.stringify(evento.cuerpo)
  const signature = firmarPayload(body, webhook.secret, evento.ts)

  let statusCode: number | null = null
  let exito = false
  let error: string | null = null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ENTREGA_TIMEOUT_MS)
  try {
    const res = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'RODAID-Open-Connect/1.0',
        'x-rodaid-event': evento.tipo,
        'x-rodaid-event-id': evento.id,
        'x-rodaid-signature': signature,
      },
      body,
      signal: controller.signal,
    })
    statusCode = res.status
    exito = res.ok
    if (!res.ok) error = `HTTP ${res.status}`
  } catch (err) {
    error = err instanceof Error ? err.message : 'fallo de red'
  } finally {
    clearTimeout(timer)
  }

  await pool
    .query(
      `
        UPDATE ecosystem_webhook_entregas
        SET status_code = $2, exito = $3, ultimo_error = $4,
            entregado_en = CASE WHEN $3 THEN NOW() ELSE entregado_en END
        WHERE webhook_id = $1 AND evento_id = $5
      `,
      [webhook.id, statusCode, exito, error, evento.id]
    )
    .catch(() => undefined)
}

/**
 * Despacha un evento de dominio al ecosistema. Traduce a evento público, arma el
 * payload sin datos personales y entrega a todas las suscripciones activas que lo
 * escuchan. NO BLOQUEANTE: se invoca sin await desde el bus de eventos.
 */
export async function despacharEventoEcosistema(domain: {
  tipo: string
  data?: Record<string, unknown>
}): Promise<void> {
  try {
    const eventoPublico = mapearEventoDominio(domain.tipo)
    if (!eventoPublico) return

    const subs = await getPool().query<WebhookRow>(
      `SELECT * FROM ecosystem_webhooks WHERE estado = 'activo' AND $1 = ANY(eventos)`,
      [eventoPublico]
    )
    if (subs.rowCount === 0) return

    const citId = typeof domain.data?.citId === 'string' ? domain.data.citId : null
    const payload = await construirPayload(citId, eventoPublico)
    if (!payload) return

    const id = randomUUID()
    const ts = Math.floor(Date.now() / 1000)
    const cuerpo = {
      id,
      type: eventoPublico,
      createdAt: new Date(ts * 1000).toISOString(),
      data: payload,
    }

    await Promise.all(
      subs.rows.map((w: WebhookRow) =>
        entregar(w, { id, tipo: eventoPublico, ts, cuerpo }).catch((err) =>
          console.error('[webhooks-ecosistema] fallo de entrega', err)
        )
      )
    )
  } catch (error) {
    console.error('[webhooks-ecosistema] fallo al despachar', error)
  }
}
