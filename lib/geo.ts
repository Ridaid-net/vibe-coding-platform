/**
 * RODAID — Modulo 4 (CIT): motor de calculo geografico para el geocercado.
 *
 * Implementa la formula de Haversine sobre el modulo matematico nativo (sin
 * dependencias externas) para determinar, en metros, la distancia entre dos
 * coordenadas. Es la pieza que permite validar que el intake del CIT fue
 * levantado dentro del radio permitido del taller aliado emisor.
 *
 * Nota de ubicacion: la consigna nombraba `functions/utils/geoUtils.ts`, pero el
 * geocercado se evalua en el intake, que corre como route handler de Next.js y
 * consume `@/lib/*`. Para que el motor sea importable tanto desde el endpoint
 * como desde cualquier funcion, vive junto al resto del nucleo del modulo en
 * `lib/`, conservando intacta la API y la matematica pedidas.
 */

/** Radio de la Tierra en metros (esfera media). */
export const RADIO_TIERRA_METROS = 6371000

/** Radio permitido por defecto alrededor del taller, en metros. */
export const RADIO_GEOCERCA_DEFECTO_METROS = 50

const grados2rad = (grados: number): number => grados * (Math.PI / 180)

export interface Coordenada {
  lat: number
  lng: number
}

/**
 * Calcula la distancia en metros entre dos puntos geograficos usando Haversine.
 * Convierte grados a radianes con `rad = grad * (Math.PI / 180)` y emplea el
 * radio terrestre de 6.371.000 m.
 */
export function calcularDistanciaHaversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = grados2rad(lat2 - lat1)
  const dLng = grados2rad(lng2 - lng1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(grados2rad(lat1)) *
      Math.cos(grados2rad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return RADIO_TIERRA_METROS * c
}

export interface ResultadoGeocerca {
  /** `true` si el intake quedo dentro del radio permitido del taller. */
  esValido: boolean
  /** Distancia entre el taller y el intake, redondeada a metros. */
  distanciaMetros: number
}

/**
 * Valida si las coordenadas del celular del mecanico (intake) estan dentro del
 * radio del taller aliado. Devuelve `esValido: true` cuando la distancia es
 * menor o igual al radio permitido (50 m por defecto); `false` indica que se
 * debe levantar la bandera `alerta_gps` en el certificado.
 */
export function verificarGeofencing(
  aliadoLat: number,
  aliadoLng: number,
  intakeLat: number,
  intakeLng: number,
  radioMaximoMetros: number = RADIO_GEOCERCA_DEFECTO_METROS
): ResultadoGeocerca {
  const distancia = calcularDistanciaHaversine(
    aliadoLat,
    aliadoLng,
    intakeLat,
    intakeLng
  )

  return {
    esValido: distancia <= radioMaximoMetros,
    distanciaMetros: Math.round(distancia),
  }
}

/**
 * Extrae un par (lat, lng) finito y dentro de rango de un objeto de coordenadas
 * heterogeneo. Tolera las variantes `lat`/`latitud`/`latitude` y
 * `lng`/`lon`/`longitud`/`longitude`, y valores numericos o strings numericos.
 * Devuelve `null` si no se puede determinar un par valido.
 */
export function extraerCoordenada(
  origen: Record<string, unknown> | null | undefined
): Coordenada | null {
  if (!origen || typeof origen !== 'object') {
    return null
  }

  const fuente = origen as Record<string, unknown>
  const lat = aNumero(fuente.lat ?? fuente.latitud ?? fuente.latitude)
  const lng = aNumero(
    fuente.lng ?? fuente.lon ?? fuente.longitud ?? fuente.longitude
  )

  if (lat === null || lng === null) {
    return null
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null
  }

  return { lat, lng }
}

function aNumero(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}
