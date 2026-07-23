import Holidays from 'date-holidays'

/**
 * RODAID — Cálculo de días hábiles (Argentina, calendario nacional).
 *
 * Usado por el mecanismo de prioridad de recompra de 3 días hábiles (Esquema 1
 * Caso A, ver CLAUDE.md). Un día hábil es lunes a viernes que no sea un
 * feriado NACIONAL de tipo 'public' (los feriados 'optional'/'bank' —
 * "días no laborables con fines turísticos", Jueves Santo, etc. — NO cierran
 * el comercio en general, así que no cuentan como día inhábil acá).
 *
 * Deliberadamente solo calendario nacional, sin feriados provinciales de
 * Mendoza: no existe un calendario provincial general de días inhábiles para
 * el comercio privado (confirmado 2026-07-23) — si en el futuro hace falta
 * contemplar una fecha puntual, agregarla a EXCEPCIONES_MANUALES abajo.
 *
 * Todo el cálculo se hace en el día civil de Argentina (UTC-3, sin horario de
 * verano) para no depender de en qué huso horario corre el servidor.
 */

const AR_OFFSET_MS = -3 * 60 * 60 * 1000
const EXCEPCIONES_MANUALES: ReadonlySet<string> = new Set([])

let cachedHolidaysByYear: Map<number, Set<string>> = new Map()

function feriadosDelAnio(year: number): Set<string> {
  const cached = cachedHolidaysByYear.get(year)
  if (cached) return cached
  const hd = new Holidays('AR')
  const feriados = (hd.getHolidays(year) ?? [])
    .filter((h) => h.type === 'public')
    .map((h) => h.date.slice(0, 10))
  const set = new Set([...feriados, ...EXCEPCIONES_MANUALES])
  cachedHolidaysByYear.set(year, set)
  return set
}

/** Fecha civil (YYYY-MM-DD) en horario de Argentina para un instante dado. */
function fechaCivilAR(fecha: Date): string {
  const ajustada = new Date(fecha.getTime() + AR_OFFSET_MS)
  return ajustada.toISOString().slice(0, 10)
}

function esDiaHabil(fecha: Date): boolean {
  const civilISO = fechaCivilAR(fecha)
  const ajustada = new Date(fecha.getTime() + AR_OFFSET_MS)
  const diaSemana = ajustada.getUTCDay() // 0=domingo, 6=sabado (en horario AR)
  if (diaSemana === 0 || diaSemana === 6) return false
  const year = Number(civilISO.slice(0, 4))
  return !feriadosDelAnio(year).has(civilISO)
}

/**
 * Suma `dias` días hábiles a partir de `desde` (exclusive: no cuenta el
 * propio día `desde`, aunque sea hábil) y devuelve el instante correspondiente
 * al FIN del día civil de Argentina (23:59:59.999 AR) del último día hábil
 * contado, como Date en UTC listo para guardar en una columna TIMESTAMPTZ.
 */
export function sumarDiasHabiles(desde: Date, dias: number): Date {
  const cursor = new Date(desde.getTime() + AR_OFFSET_MS) // a civil AR, en un reloj UTC "corrido"
  let restantes = dias
  while (restantes > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    const diaSemana = cursor.getUTCDay()
    if (diaSemana === 0 || diaSemana === 6) continue
    const civilISO = cursor.toISOString().slice(0, 10)
    const year = Number(civilISO.slice(0, 4))
    if (feriadosDelAnio(year).has(civilISO)) continue
    restantes--
  }
  // Fin del día civil AR del último día hábil contado -> instante UTC real.
  const finDiaCivilAR = new Date(
    Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(), 23, 59, 59, 999)
  )
  return new Date(finDiaCivilAR.getTime() - AR_OFFSET_MS)
}

/** true si `fecha` (un instante cualquiera) ya pasó el día hábil de Argentina. */
export function esDiaHabilAR(fecha: Date): boolean {
  return esDiaHabil(fecha)
}
