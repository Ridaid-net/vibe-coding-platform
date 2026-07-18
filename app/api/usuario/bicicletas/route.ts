import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { obtenerActivosUsuario, usuarioTieneDatosBancarios } from '@/src/services/garaje.service'
import { obtenerCotizacionDolarBlue } from '@/src/services/cotizacion.service'

export const runtime = 'nodejs'

/**
 * GET /api/usuario/bicicletas — Hito 14: Garaje Digital.
 *
 * Devuelve el estado CONSOLIDADO de cada rodado del usuario autenticado: CIT,
 * huella SHA-256 anclada en la BFA, estado de verificacion, estado en vivo del
 * pipeline de 72hs y las actas de inspeccion firmadas. Es la fuente del dashboard
 * y del polling de tiempo real (la UI se refresca cuando el CIT pasa a APROBADO o
 * BLOQUEADO).
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const [activos, tieneDatosBancarios, tipoDeCambioBlueMep] = await Promise.all([
      obtenerActivosUsuario(user.id),
      usuarioTieneDatosBancarios(user.id),
      obtenerCotizacionDolarBlue(),
    ])
    return NextResponse.json(
      {
        activos,
        // Atajo: si hay algun activo todavia en el pipeline (o esperando que el
        // webhook de MercadoPago confirme el pago del CIT Express), el cliente
        // sabe que debe seguir refrescando (polling).
        hayPendientes: activos.some(
          (a) => a.estado === 'pendiente' || a.estado === 'pago_pendiente'
        ),
        // Swipe to Sell: chequeado de entrada, no al final del gesto (ver
        // usuarioTieneDatosBancarios() en garaje.service.ts).
        tieneDatosBancarios,
        // Swipe to Sell: resuelto en el servidor (ver cotizacion.service.ts) --
        // precioSugerido() lo recibe ya resuelto, nunca hace su propio fetch.
        tipoDeCambioBlueMep,
      },
      { headers: { 'cache-control': 'no-store' } }
    )
  } catch (error) {
    return jsonError(error)
  }
}
