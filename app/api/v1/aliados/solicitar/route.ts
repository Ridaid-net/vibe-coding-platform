import { NextResponse } from 'next/server'
import { jsonError, requireAuth } from '@/lib/marketplace'
import { solicitarAliado } from '@/src/services/aliados.service'

export const runtime = 'nodejs'

interface Body {
  nombre?: unknown
  tipo?: unknown
  email?: unknown
  telefono?: unknown
  direccion?: unknown
  ciudad?: unknown
  cuit?: unknown
}

/**
 * POST /api/v1/aliados/solicitar — Solicitud de un taller/tienda para ser Aliado.
 *
 * Endpoint ABIERTO: cualquier taller puede solicitarlo. Si llega autenticado
 * (Bearer), esa cuenta queda como duena del aliado y, al aprobarse, recibe el
 * rol 'aliado' para acceder al panel de inspecciones. La solicitud queda en
 * estado 'pendiente' a la espera de la aprobacion de un admin.
 */
export async function POST(req: Request) {
  try {
    // Auth opcional: si hay un token valido, vinculamos la cuenta duena.
    let usuarioId: string | null = null
    if (/^Bearer\s+/i.test(req.headers.get('authorization') ?? '')) {
      try {
        const user = await requireAuth(req)
        usuarioId = user.id
      } catch {
        // Token invalido: se procesa como solicitud anonima.
      }
    }

    const body = (await req.json().catch(() => ({}))) as Body
    const aliado = await solicitarAliado(
      {
        nombre: String(body.nombre ?? ''),
        tipo: typeof body.tipo === 'string' ? body.tipo : undefined,
        email: String(body.email ?? ''),
        telefono: typeof body.telefono === 'string' ? body.telefono : null,
        direccion: typeof body.direccion === 'string' ? body.direccion : null,
        ciudad: typeof body.ciudad === 'string' ? body.ciudad : null,
        cuit: typeof body.cuit === 'string' ? body.cuit : null,
      },
      usuarioId
    )

    return NextResponse.json({ aliado }, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
