export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/marketplace'

async function getFCMAccessToken(): Promise<string | null> {
  try {
    const serviceAccount = JSON.parse(process.env.FCM_SERVICE_ACCOUNT ?? '{}')
    if (!serviceAccount.private_key) return null

    const { createSign } = await import('crypto')
    const now = Math.floor(Date.now() / 1000)
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })).toString('base64url')

    const sign = createSign('RSA-SHA256')
    sign.update(`${header}.${payload}`)
    const signature = sign.sign(serviceAccount.private_key, 'base64url')
    const jwt = `${header}.${payload}.${signature}`

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    })
    const data = await res.json()
    return data.access_token ?? null
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  const govToken = req.headers.get('x-gov-token')
  if (!govToken || govToken !== process.env.GOV_API_TOKEN) {
    return NextResponse.json({ error: 'NO_AUTORIZADO' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { titulo, mensaje, tipo, numeroSerie } = body

    if (!titulo || !mensaje) {
      return NextResponse.json({ error: 'PARAMETRO_REQUERIDO', message: 'titulo y mensaje son obligatorios.' }, { status: 400 })
    }

    const pool = getPool()
    const serviceAccount = JSON.parse(process.env.FCM_SERVICE_ACCOUNT ?? '{}')
    const projectId = serviceAccount.project_id

    let tokens: string[] = []
    if (numeroSerie) {
      try {
        const result = await pool.query(`
          SELECT u.fcm_token FROM usuarios u
          JOIN bicicletas b ON b.propietario_id = u.id
          WHERE lower(b.numero_serie) = lower($1)
            AND u.fcm_token IS NOT NULL AND u.fcm_token != ''
        `, [numeroSerie])
        tokens = result.rows.map((r: { fcm_token: string }) => r.fcm_token)
      } catch { /* fcm_token aun no existe */ }
    }

    let enviadas = 0
    if (projectId && tokens.length > 0) {
      const accessToken = await getFCMAccessToken()
      if (accessToken) {
        for (const token of tokens) {
          try {
            await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: {
                  token,
                  notification: { title: titulo, body: mensaje },
                  data: { tipo: tipo ?? 'GOV_ALERTA', numeroSerie: numeroSerie ?? '', timestamp: new Date().toISOString() },
                  android: { notification: { icon: 'ic_rodaid', color: '#F47B20' } }
                }
              })
            })
            enviadas++
          } catch { /* silencioso */ }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      enviadas,
      tokens_encontrados: tokens.length,
      fcm_v1_configurado: !!projectId,
      mensaje: tokens.length === 0
        ? 'Sin dispositivos registrados para esta bicicleta'
        : enviadas > 0
          ? `Notificación enviada a ${enviadas} dispositivo(s)`
          : 'Error enviando — verificar FCM_SERVICE_ACCOUNT'
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: 'ERROR_INTERNO', message: String(e) }, { status: 500 })
  }
}
