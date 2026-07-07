/**
 * RODAID · Push Notifications para App Android
 * POST /api/v1/gov/push
 * Envia notificacion a dispositivos Android registrados
 * Compatible con Firebase Cloud Messaging (FCM)
 */
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
    const { titulo, mensaje, tipo, numeroSerie, usuarioId } = body

    if (!titulo || !mensaje) {
      return NextResponse.json({ error: 'PARAMETRO_REQUERIDO', message: 'titulo y mensaje son obligatorios.' }, { status: 400 })
    }

    const pool = getPool()
    
    // Obtener tokens FCM de usuarios con la bici
    let tokens: string[] = []
    if (numeroSerie) {
      const result = await pool.query(`
        SELECT u.fcm_token 
        FROM usuarios u
        JOIN bicicletas b ON b.propietario_id = u.id
        WHERE lower(b.numero_serie) = lower($1) AND u.fcm_token IS NOT NULL
      `, [numeroSerie])
      tokens = result.rows.map((r: { fcm_token: string }) => r.fcm_token)
    } else if (usuarioId) {
      const result = await pool.query('SELECT fcm_token FROM usuarios WHERE id = $1 AND fcm_token IS NOT NULL', [usuarioId])
      tokens = result.rows.map((r: { fcm_token: string }) => r.fcm_token)
    }

    // Enviar via FCM si hay token configurado
    const fcmKey = process.env.FCM_SERVER_KEY
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

    // Guardar notificacion en DB para mostrar en la app
    await pool.query(`
      INSERT INTO notificaciones (usuario_id, tipo, titulo, mensaje, metadata)
      SELECT b.propietario_id, $1, $2, $3, $4
      FROM bicicletas b
      WHERE lower(b.numero_serie) = lower($5) AND b.propietario_id IS NOT NULL
    `, [
      tipo ?? 'GOV_ALERTA',
      titulo,
      mensaje,
      JSON.stringify({ numeroSerie, origen: 'API_GUBERNAMENTAL' }),
      numeroSerie ?? ''
    ]).catch(() => undefined) // No falla si no existe la tabla

    return NextResponse.json({
      ok: true,
      enviadas,
      tokens_encontrados: tokens.length,
      fcm_configurado: !!fcmKey,
      mensaje: enviadas > 0 
        ? `Notificación enviada a ${enviadas} dispositivo(s)` 
        : 'Notificación registrada (FCM pendiente de configuración)'
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: 'ERROR_INTERNO', message: String(e) }, { status: 500 })
  }
}
