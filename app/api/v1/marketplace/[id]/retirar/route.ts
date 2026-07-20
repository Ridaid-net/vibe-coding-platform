import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { retirarPublicacion } from '@/src/services/escrow.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/marketplace/:id/retirar
 *
 * El vendedor retira su propia publicacion. Solo permitido si no hay ninguna
 * operacion de escrow en curso (ver ESTADOS_PUBLICACION_RETIRABLES en
 * escrow.service.ts) -- si ya hay un comprador con seña o pago activo, no
 * puede ser una cancelacion unilateral del vendedor (409 PUBLICACION_NO_RETIRABLE).
 * Nunca toca el CIT ni la titularidad de la bicicleta.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)

    const resultado = await retirarPublicacion({
      publicacionId: id,
      vendedorId: user.id,
    })

    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
