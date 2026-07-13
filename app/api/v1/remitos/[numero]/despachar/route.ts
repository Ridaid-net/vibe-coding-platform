import { NextResponse } from 'next/server'
import { jsonError, requireRole } from '@/lib/marketplace'
import { confirmarDespachoRemito } from '@/src/services/remito.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/remitos/:numero/despachar — el Taller Aliado confirma que
 * embalo y despacho la bici (boton "Despacho a Logistica"), firmado con su
 * propia wallet_address. Dispara la liquidacion del Fee de Logistica.
 *
 * Deliberado: SIN soporte de "ver como" / impersonacion de Admin View-As.
 * confirmarDespachoRemito() resuelve el aliado por ownership ESTRICTO
 * (resolverAliadoDeUsuario, usuario_id real), nunca por
 * resolverAliadoParaLectura() -- firmar el despacho y cobrar el fee son
 * acciones reales que un admin en modo lectura nunca puede ejecutar en
 * nombre de un Taller que no es el suyo. Mismo criterio que
 * aprobar/reportar discrepancia en /api/inspector/cit.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ numero: string }> }
) {
  try {
    const { numero } = await params
    const user = await requireRole('aliado', 'admin')(req)
    const resultado = await confirmarDespachoRemito({ numero, actorId: user.id })

    // TODO(siguiente pieza): notificar al comprador ("tu bici fue
    // despachada") -- misma dependencia de notif_tipo que /remito/generar.

    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
