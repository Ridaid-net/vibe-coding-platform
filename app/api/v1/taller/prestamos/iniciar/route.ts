import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireRole } from '@/lib/marketplace'
import { resolverAliadoDeUsuario } from '@/src/services/inspeccion.service'
import { iniciarPrestamo } from '@/src/services/prestamos-bici.service'

export const runtime = 'nodejs'

interface Body {
  bicicletaId?: unknown
  prestatarioNombre?: unknown
  prestatarioContacto?: unknown
  horaEsperadaDevolucion?: unknown
}

/**
 * POST /api/v1/taller/prestamos/iniciar — el taller entrega la bici a quien
 * decida, caso por caso. Sin cuenta RODAID verificada ni ninguna otra
 * validación del prestatario -- solo datos de contacto en texto libre.
 */
export async function POST(req: Request) {
  try {
    const [user, body] = await Promise.all([
      requireRole('aliado', 'admin')(req),
      req.json().catch(() => ({})) as Promise<Body>,
    ])

    const bicicletaId = typeof body.bicicletaId === 'string' ? body.bicicletaId : ''
    const prestatarioNombre =
      typeof body.prestatarioNombre === 'string' ? body.prestatarioNombre.trim() : ''
    const prestatarioContacto =
      typeof body.prestatarioContacto === 'string' ? body.prestatarioContacto.trim() : undefined
    const horaEsperadaDevolucion =
      typeof body.horaEsperadaDevolucion === 'string' ? body.horaEsperadaDevolucion : ''

    if (!bicicletaId || !prestatarioNombre || !horaEsperadaDevolucion) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'bicicletaId, prestatarioNombre y horaEsperadaDevolucion son obligatorios.'
      )
    }
    if (Number.isNaN(new Date(horaEsperadaDevolucion).getTime())) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'horaEsperadaDevolucion debe ser una fecha valida.')
    }

    const aliado = await resolverAliadoDeUsuario(user.id)
    if (!aliado) {
      throw new ApiError(403, 'SIN_ALIADO', 'No tenes un Taller Aliado propio vinculado.')
    }

    const prestamo = await iniciarPrestamo(aliado.id, {
      bicicletaId,
      prestatarioNombre,
      prestatarioContacto,
      horaEsperadaDevolucion,
    })
    return NextResponse.json({ prestamo })
  } catch (error) {
    return jsonError(error)
  }
}
