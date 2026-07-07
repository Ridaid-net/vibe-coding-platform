/**
 * RODAID · Pronóstico del Tiempo
 * GET /api/v1/clima/pronostico
 * Usa Open-Meteo API (gratuita, sin API key)
 * Por defecto: San Martín, Mendoza, Argentina
 */
export const runtime = 'nodejs'
import { NextResponse } from 'next/server'

// Coordenadas por defecto: San Martín, Mendoza
const DEFAULT_LAT = -33.0782
const DEFAULT_LON = -68.4671
const DEFAULT_CIUDAD = 'San Martín, Mendoza'

const WMO_DESCRIPCIONES: Record<number, string> = {
  0: 'Cielo despejado', 1: 'Mayormente despejado', 2: 'Parcialmente nublado',
  3: 'Nublado', 45: 'Neblina', 48: 'Neblina con escarcha',
  51: 'Llovizna leve', 53: 'Llovizna moderada', 55: 'Llovizna intensa',
  61: 'Lluvia leve', 63: 'Lluvia moderada', 65: 'Lluvia intensa',
  71: 'Nevada leve', 73: 'Nevada moderada', 75: 'Nevada intensa',
  80: 'Chubascos leves', 81: 'Chubascos moderados', 82: 'Chubascos intensos',
  95: 'Tormenta eléctrica', 99: 'Tormenta con granizo',
}

function womoToOpenWeatherCode(wmo: number): number {
  if (wmo === 0 || wmo === 1) return 800
  if (wmo === 2 || wmo === 3) return 803
  if (wmo >= 51 && wmo <= 55) return 300
  if (wmo >= 61 && wmo <= 65) return 500
  if (wmo >= 71 && wmo <= 75) return 600
  if (wmo >= 80 && wmo <= 82) return 520
  if (wmo >= 95) return 200
  return 801
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const lat = parseFloat(url.searchParams.get('lat') ?? String(DEFAULT_LAT))
    const lon = parseFloat(url.searchParams.get('lon') ?? String(DEFAULT_LON))
    const ciudad = url.searchParams.get('ciudad') ?? DEFAULT_CIUDAD

    const apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,weathercode,precipitation_probability_max,windspeed_10m_max,relative_humidity_2m_max&timezone=America%2FArgentina%2FBuenos_Aires&forecast_days=7`

    const res = await fetch(apiUrl, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 3600 } // Cache 1 hora
    })

    if (!res.ok) throw new Error('Error en Open-Meteo API')
    const data = await res.json()

    const pronostico = data.daily.time.map((fecha: string, i: number) => ({
      fecha,
      temp_max: data.daily.temperature_2m_max[i],
      temp_min: data.daily.temperature_2m_min[i],
      codigo_clima: womoToOpenWeatherCode(data.daily.weathercode[i]),
      descripcion: WMO_DESCRIPCIONES[data.daily.weathercode[i]] ?? 'Variable',
      probabilidad_lluvia: data.daily.precipitation_probability_max[i] ?? 0,
      viento_kmh: data.daily.windspeed_10m_max[i] ?? 0,
      humedad: data.daily.relative_humidity_2m_max[i] ?? 0,
    }))

    return NextResponse.json({ ok: true, ciudad, lat, lon, pronostico })
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
