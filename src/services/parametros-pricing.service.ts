import { ApiError, getPool } from '@/lib/marketplace'

/**
 * RODAID — Fase 0: Parametros de Pricing CIT (Express / Completo).
 *
 * Lee/escribe `parametros_pricing_cit`, la tabla que reemplaza los precios y
 * comisiones antes hardcodeados o fijados por variable de entorno. Cachea cada
 * clave en memoria por un tiempo corto para no pegarle a la base en cada
 * calculo de pricing, mientras deja que un cambio desde el panel admin se vea
 * reflejado en menos de un minuto.
 */

const CACHE_TTL_MS = 60 * 1000

interface CacheEntry {
  valor: number
  ts: number
}

const cache = new Map<string, CacheEntry>()

export async function getParametroPricing(clave: string): Promise<number> {
  const cached = cache.get(clave)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.valor
  }

  const res = await getPool().query<{ valor: string }>(
    `SELECT valor FROM parametros_pricing_cit WHERE clave = $1`,
    [clave]
  )
  if (!res.rows[0]) {
    throw new ApiError(
      500,
      'PARAMETRO_PRICING_INEXISTENTE',
      `El parametro de pricing "${clave}" no esta seedeado en parametros_pricing_cit.`
    )
  }

  const valor = Number(res.rows[0].valor)
  cache.set(clave, { valor, ts: Date.now() })
  return valor
}

/** Trae varias claves en paralelo (una query por clave, todas concurrentes). */
export async function getParametrosPricing<K extends string>(
  claves: readonly K[]
): Promise<Record<K, number>> {
  const entradas = await Promise.all(
    claves.map(async (clave) => [clave, await getParametroPricing(clave)] as const)
  )
  return Object.fromEntries(entradas) as Record<K, number>
}

/** Actualiza un parametro (panel admin). Invalida la cache de esa clave. */
export async function setParametroPricing(
  clave: string,
  valor: number,
  actualizadoPor?: string | null
): Promise<void> {
  const res = await getPool().query(
    `
      UPDATE parametros_pricing_cit
      SET valor = $2, actualizado_por = $3, updated_at = NOW()
      WHERE clave = $1
    `,
    [clave, valor, actualizadoPor ?? null]
  )
  if (res.rowCount === 0) {
    throw new ApiError(
      404,
      'PARAMETRO_PRICING_INEXISTENTE',
      `El parametro de pricing "${clave}" no existe.`
    )
  }
  cache.delete(clave)
}
