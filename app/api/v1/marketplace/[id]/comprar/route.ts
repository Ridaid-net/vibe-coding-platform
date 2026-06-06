import { NextResponse } from 'next/server'
import { jsonError, optionalText, requireUser } from '@/lib/marketplace'
import { iniciarCompra } from '@/src/services/escrow.service'

export const runtime = 'nodejs'

interface ComprarBody {
  email?: unknown
  compradorEmail?: unknown
  nombre?: unknown
  compradorNombre?: unknown
}

/**
 * POST /api/v1/marketplace/:id/comprar
 * Inicia el escrow: genera la preferencia de MercadoPago (Checkout Pro,
 * vencimiento 48 hs, binary_mode:false) y PAUSA la publicacion para evitar
 * la doble compra.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as ComprarBody

    const resultado = await iniciarCompra({
      publicacionId: id,
      compradorId: user.id,
      compradorEmail: optionalText(body.compradorEmail ?? body.email),
      compradorNombre: optionalText(body.compradorNombre ?? body.nombre),
    })

    return NextResponse.json(resultado, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
