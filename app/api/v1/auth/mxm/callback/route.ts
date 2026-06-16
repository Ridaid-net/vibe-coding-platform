import { NextResponse } from 'next/server'
import {
  getMxmConfig,
  guardarHandoff,
  intercambiarCode,
  leerFlowState,
  MXM_FLOW_COOKIE,
  rolDesdeClaims,
  vincularIdentidadFederada,
} from '@/src/services/mxm.service'
import { buildAuthResponse } from '@/lib/auth-http'
import { ApiError, jsonError } from '@/lib/marketplace'

export const runtime = 'nodejs'

/**
 * GET /api/v1/auth/mxm/callback — Retorno del IDP de Mendoza por Mi.
 *
 * Valida el estado del flujo (cookie firmada) contra el `state` recibido,
 * intercambia el `code` por el ID token, extrae los claims (cuil, dni,
 * nombre_completo, funcionario) y mapea la identidad a una cuenta de RODAID
 * (creando, vinculando o reingresando). Emite la MISMA sesion que el login local
 * y entrega un ticket de un solo uso al frontend para que la persista.
 *
 * Nunca persiste el access_token del Gobierno: solo el identificador unico.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  try {
    const error = url.searchParams.get('error')
    if (error) {
      return redirectError(url.origin, 'No autorizaste el acceso con Mendoza por Mí.')
    }

    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    if (!code || !state) {
      throw new ApiError(400, 'MXM_CALLBACK_INCOMPLETO', 'Respuesta del IDP incompleta.')
    }

    // Estado del flujo desde la cookie httpOnly.
    const cookie = req.headers
      .get('cookie')
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${MXM_FLOW_COOKIE}=`))
    const cookieValue = cookie?.slice(MXM_FLOW_COOKIE.length + 1)
    if (!cookieValue) {
      throw new ApiError(400, 'MXM_SIN_FLUJO', 'El inicio de sesion expiro. Proba de nuevo.')
    }
    const flow = await leerFlowState(decodeURIComponent(cookieValue))

    // Anti-CSRF: el state recibido debe coincidir con el del flujo.
    if (state !== flow.state) {
      throw new ApiError(400, 'MXM_STATE_INVALIDO', 'La validacion de seguridad fallo.')
    }

    const config = getMxmConfig()
    const { claims, rolGobierno } = await intercambiarCode(config, code, flow)
    const rol = rolDesdeClaims(claims, config, rolGobierno)

    const { row } = await vincularIdentidadFederada(claims, rol)

    // Misma sesion que el login local: AccessToken + RefreshToken sobre `usuarios`.
    const sesion = await buildAuthResponse(row, req)
    const nombre =
      (row.datos_perfil?.nombre as string | undefined) ??
      claims.nombreCompleto ??
      row.email

    const ticket = await guardarHandoff({
      accessToken: sesion.accessToken,
      refreshToken: sesion.refreshToken,
      userId: row.id,
      nombre,
      rol: row.rol,
      selloGubernamental: true,
    })

    const destino = new URL('/ingresar/mxm', url.origin)
    destino.searchParams.set('ticket', ticket)
    destino.searchParams.set('returnTo', flow.returnTo)

    const res = NextResponse.redirect(destino.toString())
    // Limpiar la cookie del flujo (ya consumida).
    res.cookies.set(MXM_FLOW_COOKIE, '', {
      httpOnly: true,
      path: '/api/v1/auth/mxm',
      maxAge: 0,
    })
    return res
  } catch (error) {
    if (error instanceof ApiError) {
      return redirectError(url.origin, error.message)
    }
    return jsonError(error)
  }
}

/** Redirige a la pantalla de ingreso con el mensaje de error visible. */
function redirectError(origin: string, mensaje: string): NextResponse {
  const destino = new URL('/ingresar', origin)
  destino.searchParams.set('mxm_error', mensaje)
  return NextResponse.redirect(destino.toString())
}
