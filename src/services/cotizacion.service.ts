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
