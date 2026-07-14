import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { solicitarCitExpressConPago } from '@/src/services/cit-express-pago.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/bicicletas/[id]/verificar — Solicitar la verificacion de
 * identidad (CIT Express) de una bicicleta.
 *
 * Hasta 2026-07-13 este endpoint creaba el CIT y arrancaba el pipeline de
 * validacion de 72hs de forma inmediata y GRATUITA (ver CLAUDE.md, hallazgo
 * CRITICO 2026-07-13: "CIT Express se emite y renueva hoy sin ningun cobro
 * real conectado"). Regla de negocio confirmada por Federico: el pago se
 * cobra ANTES de iniciar el tramite -- si no paga, no debe existir ni
 * siquiera una fila en `cits` todavia.
 *
 * Ahora este endpoint solo genera (o reanuda) la solicitud de pago
 * (cit-express-pago.service.ts::solicitarCitExpressConPago()) y devuelve el
 * link de checkout de MercadoPago. El CIT real y el pipeline de 72hs recien
 * se crean cuando el webhook (/api/v1/cit-express/webhook/mp) confirma el
 * pago contra la API real de MercadoPago -- nunca antes.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)

    const solicitud = await solicitarCitExpressConPago({
      bicicletaId: id,
      ciclistaId: user.id,
      ciclistaEmail: user.email,
    })

    return NextResponse.json(
      {
        estado: 'pago_pendiente',
        solicitudId: solicitud.solicitudId,
        initPoint: solicitud.initPoint,
        montoARS: solicitud.montoARS,
        reanudada: solicitud.reanudada,
      },
      { status: 201 }
    )
  } catch (error) {
    return jsonError(error)
  }
}
