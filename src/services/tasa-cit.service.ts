import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { ApiError, getPool, type DbClient } from '@/lib/marketplace'
import { getTasaCitARS, registrarPagoLog } from '@/src/services/compensaciones.service'

/**
 * RODAID — Hito 13: Tasa CIT Oficial.
 *
 * Pago de la tasa de verificacion del CIT por el CANAL OFICIAL del Gobierno
 * (Mendoza por Mi, pasarela de pagos estatal). El flujo es analogo al de
 * MercadoPago: se crea una intencion de pago, la persona paga en la pasarela del
 * Estado y la confirmacion real llega de forma ASINCRONA por un webhook
 * idempotente. La logica de negocio nunca "toca" el dinero: solo reacciona a la
 * confirmacion de la pasarela.
 *
 * Modos (igual que el resto del proyecto):
 *   - LIVE: con `MXM_PAGOS_BASE_URL` + `MXM_PAGOS_API_KEY` configurados, crea la
 *     intencion contra la pasarela estatal real y valida la firma del webhook con
 *     `MXM_PAGOS_WEBHOOK_SECRET` si esta definido.
 *   - SIMULADO: sin esas credenciales (tipico en preview), genera una referencia
 *     y una URL de checkout interna para ejercitar el flujo de punta a punta sin
 *     tocar la pasarela real.
 */

export type MxmPagosModo = 'LIVE' | 'SIMULADO'

const TASA_EXPIRACION_MS = 24 * 60 * 60 * 1000 // 24 horas

function getApiKey(): string | null {
  const k = process.env.MXM_PAGOS_API_KEY
  return k && k.trim().length > 0 ? k.trim() : null
}

function getBaseUrl(): string | null {
  const u = process.env.MXM_PAGOS_BASE_URL
  return u && u.trim().length > 0 ? u.trim().replace(/\/+$/, '') : null
}

export function getModoPagosMxm(): MxmPagosModo {
  return getApiKey() && getBaseUrl() ? 'LIVE' : 'SIMULADO'
}

function siteBaseUrl(): string {
  const explicit = process.env.RODAID_BASE_URL?.trim()
  const netlify = process.env.URL?.trim() || process.env.DEPLOY_PRIME_URL?.trim()
  return (explicit || netlify || 'https://rodaid.com.ar').replace(/\/+$/, '')
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface TasaCitRow {
  id: string
  cit_id: string | null
  bicicleta_id: string | null
  solicitante_id: string | null
  monto: string
  canal: string
  estado: 'PENDIENTE' | 'PAGADA' | 'RECHAZADA' | 'EXPIRADA'
  referencia_externa: string | null
  comprobante: string | null
  external_uid: string | null
  checkout_url: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  pagado_en: string | null
}

export function mapTasa(row: TasaCitRow) {
  return {
    id: row.id,
    citId: row.cit_id,
    bicicletaId: row.bicicleta_id,
    solicitanteId: row.solicitante_id,
    monto: Number(row.monto),
    canal: row.canal,
    estado: row.estado,
    referenciaExterna: row.referencia_externa,
    comprobante: row.comprobante,
    checkoutUrl: row.checkout_url,
    createdAt: row.created_at,
    pagadoEn: row.pagado_en,
  }
}

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

// ── Crear la intencion de pago de la tasa ─────────────────────────────────────

export interface CrearPagoTasaInput {
  solicitanteId: string
  citId?: string | null
  bicicletaId?: string | null
  externalUid?: string | null
}

/**
 * Crea la intencion de pago de la Tasa CIT contra la pasarela estatal (MxM). El
 * monto lo fija la configuracion del sistema (`RODAID_TASA_CIT_ARS`). Devuelve la
 * tasa creada (PENDIENTE) con la URL de checkout para redirigir a la persona.
 */
export async function crearPagoTasaCit(input: CrearPagoTasaInput) {
  const monto = await getTasaCitARS()
  const modo = getModoPagosMxm()

  // Si se indico un CIT, validar que exista (relacion estricta con el bien).
  let bicicletaId = input.bicicletaId ?? null
  if (input.citId) {
    const cit = await getPool().query<{ id: string; bicicleta_id: string; estado: string }>(
      `SELECT id, bicicleta_id, estado FROM cits WHERE id = $1`,
      [input.citId]
    )
    if (!cit.rows[0]) {
      throw new ApiError(404, 'CIT_NOT_FOUND', 'El CIT indicado no existe.')
    }
    bicicletaId = bicicletaId ?? cit.rows[0].bicicleta_id
  }

  const referencia = await generarIntencionPasarela({ monto, modo, input })

  const tasa = await getPool().query<TasaCitRow>(
    `
      INSERT INTO tasas_cit
        (cit_id, bicicleta_id, solicitante_id, monto, canal, estado,
         referencia_externa, external_uid, checkout_url, metadata)
      VALUES ($1, $2, $3, $4, 'MxM', 'PENDIENTE', $5, $6, $7, $8::jsonb)
      RETURNING *
    `,
    [
      input.citId ?? null,
      bicicletaId,
      input.solicitanteId,
      monto,
      referencia.referenciaExterna,
      input.externalUid ?? null,
      referencia.checkoutUrl,
      JSON.stringify({ modo, expiraEn: referencia.expiraEn }),
    ]
  )

  await withTx((client) =>
    registrarPagoLog(client, {
      evento: 'TASA_CIT_INICIADA',
      origenTipo: 'TASA',
      origenId: tasa.rows[0].id,
      monto,
      actorId: input.solicitanteId,
      actorRol: 'ciclista',
      metadata: { modo, citId: input.citId ?? null },
    })
  )

  return { tasa: mapTasa(tasa.rows[0]), modo }
}

interface IntencionPasarela {
  referenciaExterna: string
  checkoutUrl: string
  expiraEn: string
}

async function generarIntencionPasarela(opts: {
  monto: number
  modo: MxmPagosModo
  input: CrearPagoTasaInput
}): Promise<IntencionPasarela> {
  const expiraEn = new Date(Date.now() + TASA_EXPIRACION_MS).toISOString()

  if (opts.modo === 'SIMULADO') {
    // Pasarela estatal simulada: referencia interna + checkout local.
    const referenciaExterna = `mxm-tasa-${randomUUID()}`
    return {
      referenciaExterna,
      checkoutUrl: `/mxm/pagos/checkout?ref=${encodeURIComponent(referenciaExterna)}`,
      expiraEn,
    }
  }

  // LIVE: crea la intencion contra la pasarela estatal real.
  const base = getBaseUrl()!
  const res = await fetch(`${base}/v1/pagos`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      concepto: 'Tasa de verificacion CIT — RODAID',
      monto: opts.monto,
      moneda: 'ARS',
      referencia_comercio: opts.input.citId ?? opts.input.bicicletaId ?? randomUUID(),
      notification_url: `${siteBaseUrl()}/api/mxm/pagos/webhook`,
      return_url: `${siteBaseUrl()}/mxm/pagos/resultado`,
      cuil: opts.input.externalUid ?? undefined,
    }),
  })
  if (!res.ok) {
    const detalle = await res.text().catch(() => '')
    throw new ApiError(
      502,
      'PASARELA_MXM_ERROR',
      `La pasarela de pagos del Gobierno no pudo crear la intencion (${res.status}). ${detalle.slice(0, 200)}`
    )
  }
  const data = (await res.json()) as {
    id?: string | number
    referencia?: string
    checkout_url?: string
    url?: string
  }
  const referenciaExterna = String(data.referencia ?? data.id ?? randomUUID())
  return {
    referenciaExterna,
    checkoutUrl: data.checkout_url ?? data.url ?? `${siteBaseUrl()}/mxm/pagos/resultado`,
    expiraEn,
  }
}

// ── Confirmacion ASINCRONA (webhook idempotente) ──────────────────────────────

export interface ConfirmarPagoTasaInput {
  referenciaExterna: string
  estado: 'PAGADA' | 'RECHAZADA'
  comprobante?: string | null
}

export type AccionTasa = 'CONFIRMADA' | 'RECHAZADA' | 'IGNORADA' | 'SIN_COINCIDENCIA'

/**
 * Procesa la confirmacion de la pasarela estatal. Idempotente: si la tasa ya esta
 * en un estado final, no se reprocesa. Localiza la tasa por su referencia externa.
 */
export async function confirmarPagoTasa(
  input: ConfirmarPagoTasaInput
): Promise<{ accion: AccionTasa; tasaId: string | null }> {
  return withTx(async (client) => {
    const res = await client.query<TasaCitRow>(
      `SELECT * FROM tasas_cit WHERE referencia_externa = $1 FOR UPDATE`,
      [input.referenciaExterna]
    )
    const tasa = res.rows[0]
    if (!tasa) {
      return { accion: 'SIN_COINCIDENCIA' as const, tasaId: null }
    }
    // Idempotencia: un estado final no se reprocesa.
    if (tasa.estado !== 'PENDIENTE') {
      return { accion: 'IGNORADA' as const, tasaId: tasa.id }
    }

    if (input.estado === 'PAGADA') {
      await client.query(
        `
          UPDATE tasas_cit
          SET estado = 'PAGADA', comprobante = $2, pagado_en = NOW(), updated_at = NOW()
          WHERE id = $1
        `,
        [tasa.id, input.comprobante ?? null]
      )
      await registrarPagoLog(client, {
        evento: 'TASA_CIT_PAGADA',
        origenTipo: 'TASA',
        origenId: tasa.id,
        monto: Number(tasa.monto),
        beneficiarioId: tasa.solicitante_id,
        actorRol: 'gateway',
        metadata: {
          comprobante: input.comprobante ?? null,
          citId: tasa.cit_id,
          canal: tasa.canal,
        },
      })
      return { accion: 'CONFIRMADA' as const, tasaId: tasa.id }
    }

    await client.query(
      `UPDATE tasas_cit SET estado = 'RECHAZADA', updated_at = NOW() WHERE id = $1`,
      [tasa.id]
    )
    await registrarPagoLog(client, {
      evento: 'TASA_CIT_RECHAZADA',
      origenTipo: 'TASA',
      origenId: tasa.id,
      monto: Number(tasa.monto),
      beneficiarioId: tasa.solicitante_id,
      actorRol: 'gateway',
      metadata: { citId: tasa.cit_id },
    })
    return { accion: 'RECHAZADA' as const, tasaId: tasa.id }
  })
}

/**
 * Valida la firma del webhook de la pasarela estatal (HMAC-SHA256 sobre el raw
 * body con `MXM_PAGOS_WEBHOOK_SECRET`). En SIMULADO o sin secreto se omite.
 */
export function validarFirmaWebhookMxm(params: {
  rawBody: string
  firma: string | null
}): { valido: boolean; omitido: boolean } {
  const secret = process.env.MXM_PAGOS_WEBHOOK_SECRET
  if (getModoPagosMxm() !== 'LIVE' || !secret) {
    return { valido: true, omitido: true }
  }
  if (!params.firma) {
    return { valido: false, omitido: false }
  }
  const esperado = createHmac('sha256', secret).update(params.rawBody).digest('hex')
  return { valido: safeEqualHex(esperado, params.firma.trim()), omitido: false }
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'hex')
    const bufB = Buffer.from(b, 'hex')
    if (bufA.length !== bufB.length || bufA.length === 0) {
      return false
    }
    return timingSafeEqual(bufA, bufB)
  } catch {
    return false
  }
}

// ── Lectura ───────────────────────────────────────────────────────────────────

export async function getPagoTasa(id: string) {
  const res = await getPool().query<TasaCitRow>(`SELECT * FROM tasas_cit WHERE id = $1`, [id])
  return res.rows[0] ? mapTasa(res.rows[0]) : null
}

export async function listarTasasDeUsuario(usuarioId: string) {
  const res = await getPool().query<TasaCitRow>(
    `SELECT * FROM tasas_cit WHERE solicitante_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [usuarioId]
  )
  return res.rows.map(mapTasa)
}

/**
 * Simula el pago de una tasa (solo fuera de LIVE). Permite ejercitar el flujo de
 * confirmacion asincrona en preview sin tocar la pasarela real.
 */
export async function simularPagoTasa(referenciaExterna: string) {
  if (getModoPagosMxm() === 'LIVE') {
    throw new ApiError(403, 'SIMULACION_DESHABILITADA', 'La simulacion no esta disponible en modo LIVE.')
  }
  return confirmarPagoTasa({
    referenciaExterna,
    estado: 'PAGADA',
    comprobante: `sim-${createHash('sha256').update(referenciaExterna).digest('hex').slice(0, 12)}`,
  })
}
