'use client'

import { authedFetch } from '@/lib/session'
import type { ActivoGaraje } from '@/lib/garaje-digital'

/**
 * RODAID — Swipe to Sell (Garaje Digital → Marketplace, sin formulario).
 *
 * Título/descripción/precio se generan 100% a partir de `ActivoGaraje`, que
 * el Garaje ya trae hoy -- CERO queries nuevas para esto. La única pieza de
 * datos nueva de todo el feature es `tieneDatosBancarios` (ver
 * garaje.service.ts / lib/garaje-digital.ts), porque hoy solo se chequea
 * dentro del propio POST /api/v1/marketplace/publicar (409 al final del
 * flujo) -- acá hace falta chequearlo de entrada, antes de ofrecer el swipe.
 */

// ── Título y descripción (plantilla fija, sin IA) ───────────────────────────

export function generarTitulo(activo: ActivoGaraje): string {
  return `${activo.marca} ${activo.modelo}${activo.anio ? ` ${activo.anio}` : ''}`
}

/**
 * Descripción en lenguaje llano. El factor BiciSalud ya viene calculado en
 * `scoreConfianza.factores.biciSalud` -- se interpreta el NÚMERO (25 = sin
 * alertas, 13 = sin dispositivo vinculado, <13 = con alertas), sin volver a
 * consultar `bicisalud_resumen_publico`. Mismo criterio ya establecido en el
 * Gemelo Digital/Score de Confianza: "sin dato" nunca se redacta como "sana".
 *
 * NO referencia `activo.codigoCit`: confirmado que `obtenerActivosUsuario()`
 * lo devuelve siempre `NULL` hoy (la query trae `NULL AS codigo_cit`, un gap
 * preexistente y ajeno a este feature) -- referenciarlo mostraría "código
 * null" en una publicación real.
 */
export function generarDescripcion(activo: ActivoGaraje): string {
  const { marca, modelo, anio, color, scoreConfianza } = activo
  const partes = [
    `${marca} ${modelo}${anio ? `, año ${anio}` : ''}${color ? `, color ${color}` : ''}.`,
    'Identidad verificada con CIT RODAID.',
    `Score de Confianza RODAID: ${scoreConfianza.total}/100${
      scoreConfianza.badge ? ` (${scoreConfianza.badge === 'oro' ? 'Oro' : 'Bronce'})` : ''
    }.`,
  ]

  const bs = scoreConfianza.factores.biciSalud
  if (bs >= 25) partes.push('Sin alertas de mantenimiento activas en el sensor IoT vinculado.')
  else if (bs === 13) partes.push('Sin telemetría IoT vinculada todavía.')
  else partes.push('Con alertas de mantenimiento recientes registradas — a revisar antes de la entrega.')

  return partes.join(' ')
}

// ── Precio sugerido (regla simple, etiquetada como estimación) ──────────────

/**
 * Precio base por tipo, en USD (gama media) -- más estable frente a la
 * inflación argentina que un valor fijo en ARS. Valores reales confirmados
 * por Federico (2026-07-18), a ajustar si cambian las condiciones de mercado.
 */
const BASE_POR_TIPO_USD: Record<string, number> = {
  Urbana: 275,
  Plegable: 400,
  BMX: 350,
  Gravel: 900,
  MTB: 700,
  Ruta: 875,
  Eléctrica: 1200,
}

// Modificadores sobre la base, antes de depreciación/Score.
const AJUSTE_SUSPENSION_TRASERA_MTB = 1.25 // MTB doble suspensión vs. rígida

// Modificador sobre el resultado final (ya con depreciación/Score aplicados).
const AJUSTE_BATERIA_FALLA = 0.5 // PR08 (batería e-bike) en 'falla' en la última inspección Premium

export interface PrecioSugerido {
  monto: number
  esEstimacion: true
}

/**
 * Regla simple: base en USD por tipo (× ajuste por suspensión trasera si es
 * MTB doble suspensión) × depreciación por antigüedad (~10%/año, piso 30%
 * del valor base) × ajuste por Score de Confianza (oro +10%, bronce neutro,
 * sin badge -10%) × ajuste por batería en falla (si aplica) -- todo en USD,
 * agnostico de la unidad. La conversión a ARS es el ÚNICO paso que usa el
 * tipo de cambio, al final. CERO datos de mercado reales detrás de la regla
 * en si -- ver BASE_POR_TIPO_USD. Se muestra SIEMPRE editable en la UI, con
 * el texto "estimación automática, sin datos de mercado reales todavía".
 *
 * `tipoDeCambioBlueMep` llega YA RESUELTO desde el servidor (ver
 * ActivosResponse.tipoDeCambioBlueMep / cotizacion.service.ts) -- esta
 * función es puramente sincrónica, sin fetch ni env var: separa la REGLA de
 * precio (negocio) de CÓMO se consigue el tipo de cambio (infraestructura,
 * con su propio cache/fallback resuelto server-side).
 */
export function precioSugerido(activo: ActivoGaraje, tipoDeCambioBlueMep: number): PrecioSugerido {
  let baseUsd = BASE_POR_TIPO_USD[activo.tipo] ?? BASE_POR_TIPO_USD.Urbana
  if (activo.tipo === 'MTB' && activo.suspensionTrasera === true) {
    baseUsd *= AJUSTE_SUSPENSION_TRASERA_MTB
  }

  const anios = activo.anio ? Math.max(0, new Date().getFullYear() - activo.anio) : 3
  const depreciacion = Math.max(0.3, 0.9 ** anios)
  const ajusteScore =
    activo.scoreConfianza.badge === 'oro' ? 1.1 : activo.scoreConfianza.badge === 'bronce' ? 1.0 : 0.9

  let montoUsd = baseUsd * depreciacion * ajusteScore
  if (activo.bateriaFalla) montoUsd *= AJUSTE_BATERIA_FALLA

  const montoArs = montoUsd * tipoDeCambioBlueMep
  const monto = Math.round(montoArs / 1000) * 1000
  return { monto, esEstimacion: true }
}

// ── Precondiciones (chequeadas de entrada, no al final del gesto) ──────────

export type PrecondicionFaltante = 'CIT_INACTIVO' | 'SIN_DATOS_BANCARIOS' | 'YA_PUBLICADA' | null

export function precondicionFaltante(
  activo: ActivoGaraje,
  tieneDatosBancarios: boolean
): PrecondicionFaltante {
  if (!activo.citActivo) return 'CIT_INACTIVO'
  if (!tieneDatosBancarios) return 'SIN_DATOS_BANCARIOS'
  if (activo.tienePublicacionActiva) return 'YA_PUBLICADA'
  return null
}

// ── Fetchers cliente ─────────────────────────────────────────────────────

async function leer<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detalle = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(detalle?.message ?? `HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

export interface PublicarSwipeResultado {
  publicacion: { id: string; slug: string }
}

/** Publica la bici con los datos generados/editados. Reusa el endpoint normal
 * de publicación (POST /api/v1/marketplace/publicar) -- Swipe to Sell no
 * duplica esa lógica de negocio (CIT activo, datos bancarios, duplicados),
 * solo evita el formulario del lado del cliente. */
export async function publicarPorSwipe(input: {
  bicicletaId: string
  titulo: string
  descripcion: string
  precioARS: number
  fotoUrl: string | null
}): Promise<PublicarSwipeResultado> {
  return leer(
    await authedFetch('/api/v1/marketplace/publicar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bicicletaId: input.bicicletaId,
        titulo: input.titulo,
        descripcion: input.descripcion,
        precioARS: input.precioARS,
        fotosUrls: input.fotoUrl ? [input.fotoUrl] : [],
      }),
    })
  )
}

/** Carga el CBU/alias del usuario -- mismo endpoint que ya existe
 * (POST /api/v1/usuario/datos-bancarios), sin UI hasta este formulario mínimo. */
export async function guardarDatosBancariosCliente(input: {
  cbu: string | null
  alias: string | null
  titularDeclarado: string
}): Promise<void> {
  await leer(
    await authedFetch('/api/v1/usuario/datos-bancarios', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
  )
}
