import { NextResponse } from 'next/server'
import { jsonError, parseText, requireUser } from '@/lib/marketplace'
import { abrirDisputa } from '@/src/services/escrow.service'

export const runtime = 'nodejs'

interface Body {
  motivo?: unknown
}

/** POST /api/v1/transacciones/:id/disputar — abre una disputa (fondos en hold). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as Body

    const motivo = parseText(body.motivo, 'motivo', 1000)

    const transaccion = await abrirDisputa({
      transaccionId: id,
      actorId: user.id,
      motivo,
    })

    return NextResponse.json({ transaccion })
  } catch (error) {
    return jsonError(error)
  }
}
