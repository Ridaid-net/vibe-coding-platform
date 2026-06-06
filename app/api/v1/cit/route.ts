import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { type CitEstado } from '@/lib/cit'
import { listarCITs } from '@/src/services/cit.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/cit — lista los certificados del usuario.
 * Por defecto los suyos como ciclista; con `?rol=aliado`, los que emitio como taller.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const url = new URL(req.url)
    const rol = url.searchParams.get('rol')
    const estado = url.searchParams.get('estado') as CitEstado | null

    const cits = await listarCITs({
      ciclistaId: rol === 'aliado' ? null : user.id,
      aliadoId: rol === 'aliado' ? user.id : null,
      estado,
    })

    return NextResponse.json({ cits })
  } catch (error) {
    return jsonError(error)
  }
}
