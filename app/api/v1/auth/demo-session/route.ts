import { NextResponse } from 'next/server'
import { randomBytes, randomUUID } from 'node:crypto'
import {
  hashPassword,
  USUARIO_PUBLIC_COLUMNS,
  type UsuarioRol,
  type UsuarioRow,
} from '@/lib/auth'
import { buildAuthResponse } from '@/lib/auth-http'
import { ApiError, getPool, jsonError, optionalText } from '@/lib/marketplace'
import { getModo } from '@/src/services/mercadopago.service'

export const runtime = 'nodejs'

interface Body {
  nombre?: unknown
  email?: unknown
}

/**
 * Hosts reales de este sitio (confirmados via `netlify api getSite`):
 * dominio propio + alias + subdominio default de Netlify + alias de rama
 * main. Netlify rechaza en el borde (404, antes de llegar a esta funcion)
 * cualquier request cuyo header Host no matchee un dominio configurado para
 * el sitio -- verificado empiricamente: un Host falsificado con SNI real de
 * rodaid.net igual da 404 de Netlify, nunca llega a este codigo. Por eso,
 * si una request llega hasta aca, su Host ya tuvo que ser uno de estos.
 */
const PRODUCTION_HOSTS: ReadonlySet<string> = new Set([
  'rodaid.net',
  'www.betarodaid.net',
  'rodaid.netlify.app',
  'main--rodaid.netlify.app',
])

function esHostDeProduccion(req: Request): boolean {
  const host = req.headers.get('host')?.toLowerCase().split(':')[0] ?? ''
  return PRODUCTION_HOSTS.has(host)
}

/**
 * POST /api/v1/auth/demo-session
 *
 * Conveniencia para ejercitar el checkout de RODAID PAY en los entornos de
 * preview (sin pagos reales), donde todavia no hay un alta de usuarios cargada.
 *
 * A diferencia del atajo anterior —que firmaba un JWT con un id arbitrario no
 * respaldado por ninguna fila—, ahora CREA un usuario real en `usuarios` (mismo
 * camino que el registro: contrasena hasheada, sesion con RefreshToken) y
 * devuelve tokens validos. Asi el `propietario_id` / `vendedor_id` que produce
 * este usuario referencia siempre una fila real y respeta las claves foraneas.
 *
 * Deshabilitado en produccion real (el Host de la request matchea uno de los
 * dominios reales del sitio, ver PRODUCTION_HOSTS) y en modo LIVE de
 * MercadoPago: con dinero real solo se permite la autenticacion definitiva
 * (registro / login).
 *
 * SEGURIDAD: este endpoint NO tiene autenticacion. Hasta el fix de 2026-07-08
 * el rol se tomaba de `body.rol` sin ninguna restriccion — cualquiera en
 * internet podia pedir `{"rol":"admin"}` y obtener un AccessToken real con
 * privilegios de admin (confirmado explotable en produccion). El rol queda
 * hardcodeado a 'ciclista', sin excepcion, sin importar que mande el body.
 * Efecto colateral aceptado: ensureRoleSession() (lib/session.ts), que usaban
 * los paneles de inspector/admin para auto-elevarse en preview/dev, ya no
 * puede elevar el rol via este endpoint en ningun entorno.
 *
 * NOTA: se probo primero con `process.env.CONTEXT === 'production'`, pero esa
 * variable de build-time de Netlify no se propaga al runtime de esta ruta de
 * Next.js (App Router via @netlify/plugin-nextjs) -- confirmado explotable en
 * produccion pese al chequeo (devolvia 200, no 403). El chequeo por Host es
 * el que efectivamente corta el request antes de llegar aca.
 */
export async function POST(req: Request) {
  try {
    if (getModo() === 'LIVE' || esHostDeProduccion(req)) {
      throw new ApiError(
        403,
        'DEMO_DESHABILITADO',
        'La sesion de prueba no esta disponible en produccion.'
      )
    }

    const body = (await req.json().catch(() => ({}))) as Body
    const nombre = optionalText(body.nombre) ?? 'Comprador de prueba'
    const email =
      optionalText(body.email)?.toLowerCase() ??
      `demo-${randomUUID().slice(0, 12)}@rodaid.test`

    // SEGURIDAD: nunca aceptar el rol del caller (ver nota arriba). Hardcodeado
    // sin excepcion, sin importar que pida el body.
    const rol: UsuarioRol = 'ciclista'
    const wallet: string | null = null

    // Contrasena aleatoria (no se devuelve): la cuenta demo opera por tokens.
    const passwordHash = await hashPassword(randomBytes(24).toString('base64url'))

    const pool = getPool()
    const insert = await pool.query<UsuarioRow>(
      `
        INSERT INTO usuarios (email, password_hash, rol, datos_perfil, proveedor, wallet_address)
        VALUES ($1, $2, $3::usuario_rol, $4::jsonb, 'local', $5)
        RETURNING ${USUARIO_PUBLIC_COLUMNS}, password_hash
      `,
      [email, passwordHash, rol, JSON.stringify({ nombre, demo: true }), wallet]
    ).catch(async (error: unknown) => {
      // Email demo ya existente (poco probable): reutilizamos esa cuenta.
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: string }).code === '23505'
      ) {
        return pool.query<UsuarioRow>(
          `SELECT ${USUARIO_PUBLIC_COLUMNS}, password_hash FROM usuarios WHERE lower(email) = lower($1) LIMIT 1`,
          [email]
        )
      }
      throw error
    })

    const row = insert.rows[0]
    if (!row) {
      throw new ApiError(500, 'DEMO_ERROR', 'No se pudo crear la sesion de prueba.')
    }

    const sesion = await buildAuthResponse(row, req)
    return NextResponse.json({
      ...sesion,
      userId: row.id,
      nombre,
      email: row.email,
      rol: row.rol,
      modo: getModo(),
    })
  } catch (error) {
    return jsonError(error)
  }
}
