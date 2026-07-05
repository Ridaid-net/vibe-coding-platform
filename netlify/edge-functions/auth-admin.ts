/**
 * RODAID — Hito 19: control de acceso al borde para el panel de administración.
 *
 * Esta Edge Function se ejecuta en Deno, en el borde de la red, ANTES de que la
 * petición llegue a la función de origen. Es la capa de defensa en profundidad
 * del control de acceso basado en roles: asume que el cliente es un entorno NO
 * confiable y valida la FIRMA del JWT del usuario en el servidor, de modo que
 * ninguna manipulación del lado del cliente (editar localStorage, falsificar el
 * rol en la UI, llamar a la API a mano) puede saltarse la verificación.
 *
 * Cubre dos superficies (registradas en netlify.toml):
 *   - `/api/v1/admin/*`  → API del back-office. Si la credencial no autoriza, se
 *     devuelve 401 (sin credencial) o 403 (credencial válida sin privilegios)
 *     en JSON, bloqueando el endpoint antes de su ejecución.
 *   - `/admin` y `/admin/*` → páginas del panel. Sin sesión válida se redirige
 *     (301) al login; con sesión sin privilegios se responde 403.
 *
 * Política (espejo exacto de la autorización del origen, ni más laxa ni más
 * estricta — así nunca rompe un acceso legítimo y siempre frena al no
 * privilegiado):
 *   - El token de sistema `x-admin-token` (RODAID_ADMIN_TOKEN) autoriza las
 *     tareas programadas / back-office de sistema (auto-release, anclaje BFA,
 *     anonimización IoT, procesado de validaciones, etc.).
 *   - Un Bearer JWT con rol `admin` autoriza todo el subárbol.
 *   - Un Bearer JWT con rol `inspector` autoriza las rutas de back-office staff
 *     (las que en el origen usan `requireStaff`), pero NO el panel admin.
 *   - El subárbol del panel (`/api/v1/admin/panel/*`) exige estrictamente `admin`.
 *
 * La verificación fina (MFA step-up, sub-rol del panel, permisos puntuales)
 * permanece en la función de origen: el borde es un pre-filtro grueso.
 */

import type { Config, Context } from '@netlify/edge-functions'

/** Secreto de desarrollo: idéntico al fallback de `getAuthSecret` (lib/marketplace).
 *  Solo se usa cuando NO hay JWT_SECRET/AUTH_SECRET configurado (preview/STUB),
 *  para que las sesiones demo firmadas con ese mismo secreto validen al borde. */
const DEV_AUTH_SECRET = 'rodaid-dev-secret-checkout-no-usar-en-produccion'

const STAFF_ROLES = new Set(['admin', 'inspector'])

/** Resuelve el secreto de firma del JWT, replicando `getAuthSecret`. */
function resolveSecret(): string {
  const configured =
    Netlify.env.get('JWT_SECRET') ?? Netlify.env.get('AUTH_SECRET')
  if (configured && configured.trim().length > 0) {
    return configured.trim()
  }
  return DEV_AUTH_SECRET
}

/** base64url → Uint8Array (sin depender de Buffer). */
function b64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

interface AdminClaims {
  rol: string
}

/**
 * Valida un AccessToken JWT (HS256) firmado por la app: comprueba la firma con
 * el secreto compartido, que no haya expirado y que sea un token de acceso.
 * Devuelve los claims relevantes o `null` si el token es inválido/expirado.
 */
async function verifyAccessToken(
  token: string,
  secret: string
): Promise<AdminClaims | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerB64, payloadB64, signatureB64] = parts

  let header: { alg?: string; typ?: string }
  let payload: {
    exp?: number
    type?: string
    rol?: unknown
    sub?: unknown
  }
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(headerB64)))
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64)))
  } catch {
    return null
  }

  // Solo aceptamos HS256, el algoritmo con el que firma `issueAccessToken`.
  if (header.alg !== 'HS256') return null

  // Verificación de la firma con Web Crypto (HMAC-SHA256), en tiempo seguro.
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  )
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  let firmaValida: boolean
  try {
    firmaValida = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlToBytes(signatureB64),
      data
    )
  } catch {
    return null
  }
  if (!firmaValida) return null

  // El RefreshToken nunca es un JWT; rechazamos cualquier `type` que no sea de
  // acceso (los tokens legacy pueden no traer `type`).
  if (payload.type && payload.type !== 'access') return null

  // Expiración (claim `exp` en segundos).
  if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) {
    return null
  }

  if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null

  return { rol: typeof payload.rol === 'string' ? payload.rol : 'ciclista' }
}

/** Extrae el JWT del header Authorization (API/XHR) o de la cookie `nf_jwt`
 *  (navegación de página, donde no viaja el header Authorization). */
function extractToken(req: Request): string | null {
  const auth = req.headers.get('authorization')
  const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (bearer) return bearer

  const cookie = req.headers.get('cookie')
  if (cookie) {
    const m = cookie.match(/(?:^|;\s*)nf_jwt=([^;]+)/)
    if (m) {
      try {
        return decodeURIComponent(m[1])
      } catch {
        return m[1]
      }
    }
  }
  return null
}

/** Comparación en tiempo constante de dos strings (token de sistema). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function jsonForbidden(message: string, code: string, status: number): Response {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/** Página 403 mínima con la identidad visual Bianco Sport. */
function forbiddenPage(): Response {
  const html = `<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Acceso restringido — RODAID</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #f7f6f3; color: #15140f;
    font-family: "Hanken Grotesk", ui-sans-serif, system-ui, -apple-system, sans-serif;
    padding: 24px;
  }
  .card {
    max-width: 460px; width: 100%; text-align: center;
    background: #fff; border: 1px solid rgba(21,20,15,.08);
    border-radius: 20px; padding: 40px 32px;
    box-shadow: 0 18px 48px -24px rgba(21,20,15,.35);
  }
  .badge {
    display: inline-flex; align-items: center; justify-content: center;
    width: 56px; height: 56px; border-radius: 16px; margin-bottom: 20px;
    background: #15140f; color: #f7f6f3; font-size: 26px;
  }
  h1 { font-size: 22px; font-weight: 700; letter-spacing: -.02em; margin: 0 0 8px; }
  p { font-size: 15px; line-height: 1.55; color: rgba(21,20,15,.66); margin: 0 0 24px; }
  a {
    display: inline-flex; align-items: center; gap: 8px;
    background: #15140f; color: #f7f6f3; text-decoration: none;
    padding: 11px 20px; border-radius: 999px; font-weight: 600; font-size: 14px;
  }
</style>
</head>
<body>
  <main class="card">
    <div class="badge" aria-hidden="true">&#128274;</div>
    <h1>Acceso restringido</h1>
    <p>Tu cuenta no tiene privilegios de administrador para acceder a esta
       sección. Si creés que es un error, contactá al equipo de RODAID.</p>
    <a href="/">Volver al inicio</a>
  </main>
</body>
</html>`
  return new Response(html, {
    status: 403,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

export default async (req: Request, context: Context): Promise<Response | void> => {
  const url = new URL(req.url)
  const path = url.pathname
  const isAdminApi = path.startsWith('/api/v1/admin')
  const isPanelApi = path.startsWith('/api/v1/admin/panel')
  const isProd = context.deploy?.context === 'production'

  // 1) Token de sistema para tareas programadas / back-office (solo API).
  //    Espeja `requireAdmin`/`requireStaff` del origen: las funciones programadas
  //    (auto-release, anclaje BFA, anonimización IoT, procesado de validaciones)
  //    invocan estas rutas con `x-admin-token`, no con un Bearer JWT.
  if (isAdminApi) {
    const sysExpected = Netlify.env.get('RODAID_ADMIN_TOKEN')
    const sysProvided = req.headers.get('x-admin-token')
    if (sysExpected && sysProvided && safeEqual(sysProvided, sysExpected)) {
      return // invocación de sistema autorizada: pasa al origen
    }
  }

  // 2) Validación del JWT de usuario (firma + expiración).
  const token = extractToken(req)
  const claims = token
    ? await verifyAccessToken(token, resolveSecret())
    : null
  const esAdmin = claims?.rol === 'admin'
  const esStaff = !!claims && STAFF_ROLES.has(claims.rol)

  // 3a) API del back-office: bloqueo ANTES de ejecutar el endpoint.
  if (isAdminApi) {
    if (!claims) {
      return jsonForbidden('Token de usuario requerido.', 'AUTH_REQUIRED', 401)
    }
    // El panel admin exige estrictamente rol admin; el resto del back-office
    // admite staff (admin/inspector), igual que `requireStaff` en el origen.
    const autorizado = isPanelApi ? esAdmin : esStaff
    if (!autorizado) {
      return jsonForbidden(
        'No tenés permisos para acceder a este recurso.',
        'FORBIDDEN',
        403
      )
    }
    return // autorizado: pasa al origen
  }

  // 3b) Páginas `/admin` y `/admin/*`.
  //
  // En PRODUCCIÓN se aplica el RBAC estricto que pide el control de acceso:
  // sin sesión válida → 301 al login; sesión sin privilegios → 403. Devolver una
  // respuesta DETIENE la cadena de procesamiento, así el bloqueo es definitivo y
  // no evadible desde el cliente.
  //
  // Fuera de producción (deploy preview / branch) el panel queda explorable de
  // punta a punta como en el resto del proyecto: la sesión demo se eleva a admin
  // y la MFA de demostración (Hito 19) operan al cargar la página. El acceso a
  // los DATOS sigue protegido por la API (paso 3a) en todos los entornos.
  //
  // Para el acceso PERMITIDO devolvemos vacío (lo más performante): la petición
  // continúa la cadena hacia el origen y sirve la página. Las reglas de
  // _redirects para /admin/* no incluyen ningún bloqueo incondicional, de modo
  // que esta continuación nunca redirige por error a un administrador legítimo.
  if (!isProd) {
    return // preview: panel explorable de punta a punta
  }
  if (!claims) {
    const next = encodeURIComponent(path + url.search)
    return Response.redirect(`${url.origin}/ingresar?next=${next}`, 301)
  }
  if (!esStaff) {
    return forbiddenPage()
  }
  return // administrador/staff autorizado: continúa al origen
}

export const config: Config = {
  path: ['/api/v1/admin/*'],
}
