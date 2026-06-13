import { NextResponse } from 'next/server'
import { ApiError, requireUser } from '@/lib/marketplace'
import { cargarGaraje, garajeMock, type GarajeResumen } from '@/lib/garaje'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/garaje/resumen
 *
 * Endpoint optimizado del Garaje Digital: en una sola consulta agrega cada
 * bicicleta del usuario con su CIT, certificado de asegurabilidad y poliza
 * vigente, y devuelve ademas los KPIs globales del garaje.
 *
 * Contrato de respuesta (consumido por `@/lib/garaje-api`):
 *   exito  → { data: GarajeResumen }
 *   error  → { error: { code, message } }
 *
 * Cache: 30s en el borde (s-maxage) con stale-while-revalidate.
 */
export async function GET(req: Request) {
  try {
    let resumen: GarajeResumen

    if (process.env.RODAID_MOCK === 'true') {
      // Fixture de desarrollo — ver lib/garaje.ts. No se usa en produccion.
      resumen = garajeMock()
    } else {
      const user = await requireUser(req)
      resumen = await cargarGaraje(user.id)
    }

    return NextResponse.json(
      { data: resumen },
      {
        headers: {
          'Cache-Control': 'private, s-maxage=30, stale-while-revalidate=60',
        },
      }
    )
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status }
      )
    }

    console.error('Garaje resumen error', error)
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'No se pudo cargar el Garaje Digital.',
        },
      },
      { status: 500 }
    )
  }
}
