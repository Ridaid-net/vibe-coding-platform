import { getStore } from '@netlify/blobs'

/**
 * Servicio de cotización del dólar oficial Banco Nación Argentina.
 * Fuente: API pública dolarapi.com (sin autenticación).
 * Cache en memoria de 1 hora para no abusar de la API.
 */

const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hora

let cache: { valor: number; ts: number } | null = null

/**
 * Retorna el valor de venta del dólar oficial BNA en ARS.
 * Si la API falla, devuelve el fallback configurado o 1505.
 */
export async function getDolarOficialBNA(): Promise<number> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return cache.valor
  }
  try {
    const res = await fetch('https://dolarapi.com/v1/dolares/oficial', {
      next: { revalidate: 3600 },
    })
    if (!res.ok) throw new Error('API dolar error')
    const data = (await res.json()) as { venta: number }
    const valor = data.venta
    cache = { valor, ts: Date.now() }
    return valor
  } catch {
    const fallback = Number(process.env.RODAID_DOLAR_FALLBACK ?? 1505)
    return fallback
  }
}

/**
 * Convierte un monto en ARS a USD usando el dólar oficial BNA.
 */
export async function arsAUsd(montoARS: number): Promise<number> {
  const cotizacion = await getDolarOficialBNA()
  return Math.round((montoARS / cotizacion) * 100) / 100
}

const BCRA_SERIE_URL =
  'https://apis.datos.gob.ar/series/api/series/?ids=168.1_T_CAMBIOR_D_0_0_26&format=json&limit=1&sort=desc'

export interface CotizacionParaIndexacion {
  venta: number
  fuente: 'dolarapi'
  fechaActualizacion: string
}

export interface CorroboracionBcra {
  valor: number
  fecha: string
}

/**
 * Cotizacion para el mecanismo de indexacion de precios. A diferencia de
 * getDolarOficialBNA(), NUNCA devuelve un fallback silencioso: si la fuente
 * falla o da un dato invalido, tira. Este llamador no puede tratar un numero
 * viejo/de fallback como si fuera un dato real -- eso podria disparar (o
 * evitar) un ajuste de precio basado en informacion falsa.
 */
export async function obtenerCotizacionParaIndexacion(): Promise<CotizacionParaIndexacion> {
  const res = await fetch('https://dolarapi.com/v1/dolares/oficial', {
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`dolarapi.com respondio ${res.status}`)
  }
  const data = (await res.json()) as { venta?: unknown; fechaActualizacion?: unknown }
  const venta = Number(data.venta)
  if (!Number.isFinite(venta) || venta <= 0) {
    throw new Error('dolarapi.com devolvio un valor de venta invalido.')
  }
  return {
    venta,
    fuente: 'dolarapi',
    fechaActualizacion:
      typeof data.fechaActualizacion === 'string'
        ? data.fechaActualizacion
        : new Date().toISOString(),
  }
}

/**
 * Corroboracion informativa del BCRA (serie oficial "Tipo de Cambio BNA
 * Vendedor", datos.gob.ar). Tiene rezago de publicacion de varias semanas
 * (confirmado 2026-07-10) -- NUNCA se usa como gate de aborto, solo se
 * registra junto a cada ciclo para contexto humano. Best-effort: si falla,
 * devuelve null en vez de tirar, porque no es critica para la decision.
 */
export async function obtenerCorroboracionBcra(): Promise<CorroboracionBcra | null> {
  try {
    const res = await fetch(BCRA_SERIE_URL, { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as { data?: [string, number][] }
    const punto = data.data?.[0]
    if (!punto) return null
    const [fecha, valor] = punto
    if (!Number.isFinite(valor)) return null
    return { valor, fecha }
  } catch {
    return null
  }
}

// ── Dólar BLUE/MEP para Swipe to Sell (precioSugerido()) ─────────────────────
//
// Dominio distinto al dólar oficial de arriba: el blue/MEP es el que rige el
// mercado real de bicicletas usadas en Argentina (ver lib/swipe-to-sell.ts).
// A diferencia de getDolarOficialBNA() (cache en memoria, se resetea en cada
// cold-start), esta usa Netlify Blobs -- decision explicita de Federico
// (2026-07-18): prefiere que sobreviva un cold-start aunque quede un
// mecanismo de cache distinto al de su vecina oficial en este mismo archivo.
//
// Orden de prioridad, nunca devuelve 0/undefined ni lanza:
//   1. Override manual (RODAID_DOLAR_BLUE_MEP_OVERRIDE_ARS) -- si esta
//      seteado, SIEMPRE gana (decision humana explicita de pisar el valor).
//   2. Cache vigente (Netlify Blobs, TTL configurable, default 6hs).
//   3. Fetch a dolarapi.com/v1/dolares/blue (timeout 3s) -- actualiza el cache.
//   4. Si el fetch falla: cae al ULTIMO valor cacheado, aunque este vencido.
//   5. Si nunca hubo cache exitoso: valor de referencia hardcodeado.

const BLUE_STORE = 'rodaid-cotizacion-dolar-blue'
const BLUE_CLAVE = 'blue'
const BLUE_VALOR_REFERENCIA_FALLBACK = 1000 // ultimo recurso -- NO es la cotizacion real
const BLUE_TIMEOUT_MS = 3000

export interface CotizacionDolarBlue {
  valor: number
  fuente: 'override_manual' | 'dolarapi.com' | 'cache_vencido' | 'referencia_fallback'
  actualizadoEn: string
}

interface CotizacionBlueCache {
  valor: number
  actualizadoEn: string
}

function blueTtlHoras(): number {
  const v = Number(process.env.RODAID_DOLAR_BLUE_CACHE_TTL_HORAS)
  return Number.isFinite(v) && v > 0 ? v : 6
}

function blueOverrideManual(): number | null {
  const v = Number(process.env.RODAID_DOLAR_BLUE_MEP_OVERRIDE_ARS)
  return Number.isFinite(v) && v > 0 ? v : null
}

async function leerCacheBlue(): Promise<CotizacionBlueCache | null> {
  try {
    return (await getStore(BLUE_STORE).get(BLUE_CLAVE, { type: 'json' })) as CotizacionBlueCache | null
  } catch {
    return null
  }
}

async function guardarCacheBlue(entry: CotizacionBlueCache): Promise<void> {
  try {
    await getStore(BLUE_STORE).setJSON(BLUE_CLAVE, entry)
  } catch {
    // Best-effort: el cache nunca debe romper el calculo de precio.
  }
}

/** Fetch a dolarapi.com con timeout corto -- nunca lanza, devuelve null si falla. */
async function fetchDolarApiBlue(): Promise<CotizacionBlueCache | null> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), BLUE_TIMEOUT_MS)
    const res = await fetch('https://dolarapi.com/v1/dolares/blue', { signal: controller.signal })
    clearTimeout(timeoutId)
    if (!res.ok) return null

    const data = (await res.json()) as { venta?: number; compra?: number }
    const valor = data.venta ?? data.compra
    if (!valor || !Number.isFinite(valor) || valor <= 0) return null

    return { valor, actualizadoEn: new Date().toISOString() }
  } catch (error) {
    console.warn('[cotizacion] fetch a dolarapi.com (blue) fallo o tardo demasiado', error)
    return null
  }
}

export async function obtenerCotizacionDolarBlue(): Promise<CotizacionDolarBlue> {
  const override = blueOverrideManual()
  if (override !== null) {
    return { valor: override, fuente: 'override_manual', actualizadoEn: new Date().toISOString() }
  }

  const cache = await leerCacheBlue()
  if (cache) {
    const edadHoras = (Date.now() - new Date(cache.actualizadoEn).getTime()) / 3_600_000
    if (edadHoras <= blueTtlHoras()) {
      return { valor: cache.valor, fuente: 'dolarapi.com', actualizadoEn: cache.actualizadoEn }
    }
  }

  const fresco = await fetchDolarApiBlue()
  if (fresco) {
    await guardarCacheBlue(fresco)
    return { valor: fresco.valor, fuente: 'dolarapi.com', actualizadoEn: fresco.actualizadoEn }
  }

  if (cache) {
    console.warn('[cotizacion] dolarapi.com (blue) no respondio -- usando ultimo valor cacheado (vencido)')
    return { valor: cache.valor, fuente: 'cache_vencido', actualizadoEn: cache.actualizadoEn }
  }

  console.warn('[cotizacion] dolarapi.com (blue) no respondio y no hay cache -- usando valor de referencia')
  return {
    valor: BLUE_VALOR_REFERENCIA_FALLBACK,
    fuente: 'referencia_fallback',
    actualizadoEn: new Date().toISOString(),
  }
}
