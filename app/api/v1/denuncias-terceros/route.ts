import { NextResponse } from 'next/server'
import { ApiError, jsonError, optionalText, requireUser } from '@/lib/marketplace'
import { iniciarDenunciaTercero } from '@/src/services/denuncia-tercero.service'

export const runtime = 'nodejs'

interface Body {
  numeroSerie?: unknown
  numero_serie?: unknown
}

/**
 * POST /api/v1/denuncias-terceros — Fase 7, caso 3: un tercero denuncia una
 * bici ajena que sospecha robada.
 *
 * DESHABILITADO DELIBERADAMENTE hoy: iniciarDenunciaTercero() siempre tira
 * 403 CANAL_POLICIAL_NO_DISPONIBLE (ver el TODO fechado en
 * denuncia-tercero.service.ts) -- falta el canal real de confirmacion con la
 * Policia de Mendoza.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as Body
    const numeroSerie = optionalText(body.numeroSerie ?? body.numero_serie)
    if (!numeroSerie) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Ingresa el numero de serie de la bici.')
    }

    const resultado = await iniciarDenunciaTercero({
      numeroSerie,
      denuncianteId: user.id,
      denuncianteEmail: user.email,
      denuncianteNombre: null,
    })

    return NextResponse.json(resultado, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
