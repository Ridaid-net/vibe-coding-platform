/**
 * RODAID · Dispatcher de Webhooks Gubernamentales
 * Se dispara cuando ocurre un evento relevante (denuncia, bloqueo, recuperación)
 * Compatible con EDI X-Road · Ley 25.326
 */
import { getPool } from '@/lib/marketplace'

export type GovEventType = 'DENUNCIA_ACTIVA' | 'CIT_BLOQUEADO' | 'BICI_RECUPERADA' | 'CIT_EMITIDO'

export interface GovWebhookPayload {
  evento: GovEventType
  timestamp: string
  bicicleta: {
    id: string
    numero_serie: string
    marca?: string | null
    modelo?: string | null
  }
  datos?: Record<string, unknown>
  fuente: string
}

/** Dispara el webhook a todos los tenants suscritos a un evento */
export async function dispatchGovWebhook(
  evento: GovEventType,
  payload: Omit<GovWebhookPayload, 'evento' | 'timestamp' | 'fuente'>
) {
  try {
    const pool = getPool()
    
    // Obtener todos los webhooks activos suscritos a este evento
    const result = await pool.query(`
      SELECT id, tenant_slug, url, secret
      FROM gov_webhooks
      WHERE activo = true AND $1 = ANY(eventos)
    `, [evento])

    if (result.rows.length === 0) return

    const webhookPayload: GovWebhookPayload = {
      evento,
      timestamp: new Date().toISOString(),
      fuente: 'RODAID · Blockchain Federal Argentina · Ley Provincial N° 9556',
      ...payload,
    }

    // Disparar todos los webhooks en paralelo con timeout de 5 segundos
    const promises = result.rows.map(async (webhook: { id: string; tenant_slug: string; url: string; secret: string | null; eventos: string[] }) => {
      try {
        const body = JSON.stringify(webhookPayload)
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-RODAID-Event': evento,
          'X-RODAID-Tenant': webhook.tenant_slug,
          'X-RODAID-Timestamp': webhookPayload.timestamp,
        }
        
        // Agregar firma HMAC si tiene secret
        if (webhook.secret) {
          const { createHmac } = await import('crypto')
          const signature = createHmac('sha256', webhook.secret).update(body).digest('hex')
          headers['X-RODAID-Signature'] = `sha256=${signature}`
        }

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        
        const res = await fetch(webhook.url, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        })
        clearTimeout(timeout)

        // Registrar resultado en audit log
        await pool.query(`
          INSERT INTO tenant_audit_log (tenant_id, accion, tabla, metadata)
          VALUES (
            (SELECT id FROM tenants WHERE slug = $1),
            'GOV_WEBHOOK_DISPATCH',
            'gov_webhooks',
            $2
          )
        `, [
          webhook.tenant_slug,
          JSON.stringify({ webhook_id: webhook.id, evento, status: res.status, ok: res.ok })
        ])
      } catch (err) {
        console.error(`Error dispatch webhook ${webhook.url}:`, err)
      }
    })

    await Promise.allSettled(promises)
  } catch (err) {
    console.error('Error en dispatchGovWebhook:', err)
  }
}

/** Envia email de notificacion al equipo RODAID por eventos gubernamentales */
export async function notificarEventoGov({
  evento, numeroSerie, marca, modelo, expediente, organismo,
}: {
  evento: string; numeroSerie: string; marca?: string | null
  modelo?: string | null; expediente?: string | null; organismo?: string | null
}) {
  try {
    const { enviarEmail } = await import('@/lib/email')
    const colores: Record<string, string> = { DENUNCIA_ACTIVA: '#dc2626', BICI_RECUPERADA: '#16a34a', CIT_BLOQUEADO: '#F47B20', CIT_EMITIDO: '#2BBCB8' }
    const color = colores[evento] ?? '#0F1E35'
    const logoB64 = require('fs').readFileSync(process.cwd() + '/public/logo-rodaid.jpeg').toString('base64')
    const logoSrc = 'data:image/jpeg;base64,' + logoB64
    await enviarEmail({
      to: process.env.ZOHO_SMTP_USER ?? 'federicodegeaceo@rodaid.net',
      subject: `RODAID GOV · ${evento} · ${numeroSerie}`,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#f7f6f3;"><div style="background:#0F1E35;padding:24px;text-align:center;"><img src="${logoSrc}" alt="RODAID" style="height:60px;border-radius:10px;margin-bottom:10px;" /><h1 style="color:white;margin:0;font-size:26px;">RODAID · Alerta Gubernamental</h1></div><div style="padding:24px;"><div style="background:white;padding:20px;border-radius:12px;border-left:4px solid ${color};"><p style="margin:0 0 8px;color:${color};font-weight:700;font-size:16px;">${evento}</p><table style="width:100%;"><tr><td style="padding:6px 0;font-weight:700;color:#0F1E35;width:40%;">Serie</td><td>${numeroSerie}</td></tr><tr><td style="padding:6px 0;font-weight:700;color:#0F1E35;">Bicicleta</td><td>${marca ?? '-'} ${modelo ?? ''}</td></tr><tr><td style="padding:6px 0;font-weight:700;color:#0F1E35;">Expediente</td><td>${expediente ?? '-'}</td></tr><tr><td style="padding:6px 0;font-weight:700;color:#0F1E35;">Organismo</td><td>${organismo ?? '-'}</td></tr></table></div><div style="margin-top:16px;text-align:center;"><a href="https://rodaid.net/admin/gov" style="background:#0F1E35;color:white;padding:10px 24px;border-radius:999px;text-decoration:none;font-weight:700;">Ver Panel Gubernamental</a></div></div><div style="background:#0F1E35;padding:16px;text-align:center;"><p style="color:#888;font-size:11px;margin:0;">RODAID · API Gubernamental · rodaid.net</p></div></div>`
    })
  } catch (err) {
    console.error('Error email gov:', err)
  }
}
