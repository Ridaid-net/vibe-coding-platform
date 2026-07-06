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
    const promises = result.rows.map(async (webhook) => {
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
