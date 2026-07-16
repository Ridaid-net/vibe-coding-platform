import { NextResponse } from 'next/server'
import { ApiError, jsonError, optionalText, requireUser } from '@/lib/marketplace'
import { guardarDatosBancarios } from '@/src/services/compensaciones.service'
import { validarAlias, validarCBU } from '@/lib/cbu'

export const runtime = 'nodejs'

interface DatosBancariosBody {
  cbu?: unknown
  alias?: unknown
  titularDeclarado?: unknown
  titular_declarado?: unknown
}

/**
 * POST /api/v1/usuario/datos-bancarios — carga o actualiza el CBU/alias del
 * vendedor autenticado para poder cobrar el payout de una venta (ver
 * datos_bancarios_payout / compensaciones.service.ts). Endpoint minimo, sin
 * UI todavia: habilita la salida real del bloqueo 409 en
 * POST /api/v1/marketplace/publicar.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const body = (await req.json().catch(() => {
      throw new ApiError(400, 'INVALID_BODY', 'El cuerpo debe ser JSON valido.')
    })) as DatosBancariosBody

    const cbu = optionalText(body.cbu)
    const alias = optionalText(body.alias)
    const titularDeclarado = optionalText(body.titularDeclarado ?? body.titular_declarado)

    if (!cbu && !alias) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Cargá al menos un CBU o un alias.'
      )
    }
    if (!titularDeclarado) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'titular_declarado es obligatorio.'
      )
    }
    if (cbu && !validarCBU(cbu)) {
      throw new ApiError(400, 'CBU_INVALIDO', 'El CBU ingresado no es válido.')
    }
    if (alias && !validarAlias(alias)) {
      throw new ApiError(400, 'ALIAS_INVALIDO', 'El alias ingresado no es válido.')
    }

    await guardarDatosBancarios({
      beneficiarioTipo: 'usuario',
      beneficiarioId: user.id,
      cbu,
      alias,
      titularDeclarado,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return jsonError(error)
  }
}
