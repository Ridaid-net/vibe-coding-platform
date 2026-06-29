import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import { parseTextoOpcional } from '@/lib/cit'
import { RADIO_GEOCERCA_DEFECTO_METROS } from '@/lib/geo'
import {
  obtenerGeocercaTaller,
  registrarGeocercaTaller,
} from '@/src/services/cit.service'

export const runtime = 'nodejs'

interface GeocercaBody {
  nombre?: unknown
  lat?: unknown
  lng?: unknown
  longitud?: unknown
  latitud?: unknown
  radioMetros?: unknown
  radio_metros?: unknown
}

function parseCoordenada(value: unknown, campo: string, min: number, max: number): number {
  if (value === undefined || value === null || value === '') {
    throw new ApiError(400, 'VALIDATION_ERROR', `${campo} es obligatorio.`)
  }
  const numero = Number(value)
  if (!Number.isFinite(numero) || numero < min || numero > max) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `${campo} debe ser un numero entre ${min} y ${max}.`
    )
  }
  return numero
}

/**
 * GET /api/v1/aliados/geocerca — devuelve la geocerca registrada del taller
 * aliado autenticado (su coordenada y radio permitido), o `null` si no la
 * configuro todavia.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const geocerca = await obtenerGeocercaTaller(user.id)
    return NextResponse.json({ geocerca })
  } catch (error) {
    return jsonError(error)
  }
}

/**
 * PUT /api/v1/aliados/geocerca — el taller aliado registra (o actualiza) la
 * ubicacion de su local y el radio permitido. Es la referencia que el intake del
 * CIT cruza con la formula de Haversine para activar el geocercado real.
 */
export async function PUT(req: Request) {
  try {
    const [user, body] = await Promise.all([
      requireUser(req),
      req.json().catch(() => ({})) as Promise<GeocercaBody>,
    ])

    const lat = parseCoordenada(body.lat ?? body.latitud, 'lat', -90, 90)
    const lng = parseCoordenada(body.lng ?? body.longitud, 'lng', -180, 180)

    const radioCrudo = body.radioMetros ?? body.radio_metros
    let radioMetros = RADIO_GEOCERCA_DEFECTO_METROS
    if (radioCrudo !== undefined && radioCrudo !== null && radioCrudo !== '') {
      const numero = Number(radioCrudo)
      if (!Number.isInteger(numero) || numero <= 0) {
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          'radioMetros debe ser un entero mayor a cero.'
        )
      }
      radioMetros = numero
    }

    const geocerca = await registrarGeocercaTaller({
      aliadoId: user.id,
      nombre: parseTextoOpcional(body.nombre, 'nombre', 160),
      lat,
      lng,
      radioMetros,
    })

    return NextResponse.json({ geocerca })
  } catch (error) {
    return jsonError(error)
  }
}
