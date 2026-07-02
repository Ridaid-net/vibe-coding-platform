// @ts-nocheck
/**
 * RODAID — Hito 17 BYOD: Flujo OAuth 2.0 con Strava
 *
 * FASE 2: Autenticación y almacenamiento de tokens.
 * El parámetro `state` viaja cifrado en Base64 con el contexto
 * de multitenancia (userId + tenantId) para recuperarlo en el callback.
 */


import { getPool } from '@/lib/marketplace'

const router = Router()

// ─── Configuración de entorno ─────────────────────────────────────────────────
const STRAVA_CLIENT_ID     = process.env.STRAVA_CLIENT_ID     ?? ''
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET ?? ''
const REDIRECT_URI         = process.env.STRAVA_REDIRECT_URI  ?? 'https://rodaid.net/api/v1/auth/strava/callback'

// ─── RUTA 1: Iniciar OAuth con Strava ────────────────────────────────────────

/**
 * GET /api/v1/auth/strava
 * Recibe userId y tenantId, empaqueta en Base64 como `state` y
 * redirige al flujo oficial de autorización de Strava.
 */
router.get('/', (req: Request, res: Response) => {
  const { userId, tenantId } = req.query as { userId?: string; tenantId?: string }

  if (!userId || !tenantId) {
    return res.status(400).json({ error: 'userId y tenantId son requeridos.' })
  }

  // Empaquetar contexto de tenant en state Base64 (recuperado en callback)
  const statePayload = Buffer.from(
    JSON.stringify({ userId, tenantId, ts: Date.now() })
  ).toString('base64url')

  const params = new URLSearchParams({
    client_id:     STRAVA_CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    // read + activity:read_all para obtener rutas completas con polyline
    scope:         'read,activity:read_all',
    state:         statePayload,
    approval_prompt: 'auto',
  })

  return res.redirect(`https://www.strava.com/oauth/authorize?${params}`)
})

// ─── RUTA 2: Callback OAuth de Strava ────────────────────────────────────────

/**
 * GET /api/v1/auth/strava/callback
 * Strava devuelve `code` + `state`. Decodificamos el state para recuperar
 * el contexto de tenant, canjeamos el code por tokens y los persistimos.
 */
router.get('/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query as {
    code?: string; state?: string; error?: string
  }

  if (error || !code || !state) {
    return res.redirect('/garaje?error=strava_auth_cancelada')
  }

  // 1. Decodificar state → contexto de tenant
  let userId: string, tenantId: string
  try {
    const decoded = JSON.parse(
      Buffer.from(state, 'base64url').toString('utf8')
    )
    userId   = decoded.userId
    tenantId = decoded.tenantId
    if (!userId || !tenantId) throw new Error('Estado inválido')
  } catch {
    return res.redirect('/garaje?error=strava_state_invalido')
  }

  // 2. Intercambiar code por access_token + refresh_token
  let tokenData: {
    access_token: string
    refresh_token: string
    expires_at: number
    athlete: { id: number }
  }
  try {
    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:     STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
      }),
    })
    if (!tokenRes.ok) throw new Error(`Strava token error: ${tokenRes.status}`)
    tokenData = await tokenRes.json()
  } catch (err) {
    console.error('[Strava OAuth] Error al obtener token:', err)
    return res.redirect('/garaje?error=strava_token_error')
  }

  // 3. Persistir o actualizar la conexión OAuth
  const pool = getPool()
  await pool.query(
    `
    INSERT INTO oauth_connections
      (user_id, tenant_id, provider, provider_user_id, access_token, refresh_token, expires_at)
    VALUES ($1, $2, 'strava', $3, $4, $5, to_timestamp($6))
    ON CONFLICT (provider, provider_user_id)
    DO UPDATE SET
      access_token  = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      expires_at    = EXCLUDED.expires_at,
      updated_at    = NOW()
    `,
    [
      userId,
      tenantId,
      String(tokenData.athlete.id),
      tokenData.access_token,
      tokenData.refresh_token,
      tokenData.expires_at,
    ]
  )

  return res.redirect('/garaje?strava=vinculada')
})

export { router as stravaAuthRouter }
