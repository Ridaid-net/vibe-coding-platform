export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/marketplace'

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
    const fcmKey = process.env.FCM_SERVER_KEY

    // Buscar tokens FCM si la columna existe
    let tokens: string[] = []
    if (numeroSerie) {
      try {
        const result = await pool.query(`
          SELECT u.fcm_token
          FROM usuarios u
          JOIN bicicletas b ON b.propietario_id = u.id
          WHERE lower(b.numero_serie) = lower($1)
            AND u.fcm_token IS NOT NULL
            AND u.fcm_token != ''
        `, [numeroSerie])
        tokens = result.rows.map((r: { fcm_token: string }) => r.fcm_token)
      } catch {
        // fcm_token columna no existe aun — ignorar
      }
    }

    // Enviar via FCM
    let enviadas = 0
    if (fcmKey && tokens.length > 0) {
      for (const token of tokens) {
        try {
          await fetch('https://fcm.googleapis.com/fcm/send', {
            method: 'POST',
            headers: { 'Authorization': `key=${fcmKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: token,
              notification: { title: titulo, body: mensaje, icon: 'ic_rodaid', color: '#F47B20' },
              data: { tipo: tipo ?? 'GOV_ALERTA', numeroSerie: numeroSerie ?? '', timestamp: new Date().toISOString() }
            })
          })
          enviadas++
        } catch { /* silencioso */ }
      }
    }

    return NextResponse.json({
      ok: true,
      enviadas,
      tokens_encontrados: tokens.length,
      fcm_configurado: !!fcmKey,
      mensaje: fcmKey
        ? (enviadas > 0 ? `Notificación enviada a ${enviadas} dispositivo(s)` : 'Sin dispositivos registrados para esta bicicleta')
        : 'FCM_SERVER_KEY no configurado — agregar en variables de entorno Netlify'
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: 'ERROR_INTERNO', message: String(e) }, { status: 500 })
  }
}
