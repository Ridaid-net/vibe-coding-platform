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
