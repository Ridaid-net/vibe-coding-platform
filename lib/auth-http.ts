/**
 * Helpers HTTP compartidos por los endpoints de autenticacion (Hito 1).
 *
 * Centraliza la validacion de credenciales, la lectura de metadatos del request
 * (user-agent / IP, para auditar sesiones) y la construccion de la respuesta de
 * sesion (AccessToken + RefreshToken + usuario publico SIN contrasena).
 */

import { z } from 'zod'
import {
  createSession,
  issueAccessToken,
  toUsuarioPublico,
  type UsuarioRow,
} from '@/lib/auth'

export const emailSchema = z
  .string({ required_error: 'El email es obligatorio.' })
  .trim()
  .toLowerCase()
  .email('Ingresa un email valido.')
  .max(254, 'El email es demasiado largo.')

export const passwordSchema = z
  .string({ required_error: 'La contrasena es obligatoria.' })
  .min(8, 'La contrasena debe tener al menos 8 caracteres.')
  .max(200, 'La contrasena es demasiado larga.')

/** Lee metadatos del request para auditar la sesion creada. */
export function getRequestMeta(req: Request): {
  userAgent: string | null
  ip: string | null
} {
  const userAgent = req.headers.get('user-agent')
  const fwd = req.headers.get('x-forwarded-for')
  const ip =
    req.headers.get('x-nf-client-connection-ip') ??
    (fwd ? fwd.split(',')[0]?.trim() : null) ??
    null
  return { userAgent: userAgent ?? null, ip: ip ?? null }
}

/**
 * Construye la respuesta de una sesion recien iniciada: emite el AccessToken,
 * crea el RefreshToken (persistido en `sesiones`) y devuelve el usuario en su
 * forma publica. La contrasena nunca forma parte de esta respuesta.
 */
export async function buildAuthResponse(row: UsuarioRow, req: Request) {
  const meta = getRequestMeta(req)
  const accessToken = await issueAccessToken({
    id: row.id,
    rol: row.rol,
    email: row.email,
  })
  const { refreshToken, expiraEn } = await createSession(row.id, meta)

  return {
    usuario: toUsuarioPublico(row),
    accessToken,
    // Alias por compatibilidad con clientes que esperan `token`.
    token: accessToken,
    refreshToken,
    refreshTokenExpiraEn: expiraEn.toISOString(),
    tokenType: 'Bearer' as const,
  }
}
