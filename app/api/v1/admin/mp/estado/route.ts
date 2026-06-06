import { NextResponse } from 'next/server'
import { jsonError, requireAdmin } from '@/lib/marketplace'
import { getModo, getBaseUrl } from '@/src/services/mercadopago.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/admin/mp/estado — diagnostico del gateway: modo activo, base URL
 * y si el secreto de webhook esta configurado. No expone valores sensibles.
 */
export async function GET(req: Request) {
  try {
    requireAdmin(req)
    return NextResponse.json({
      modo: getModo(),
      baseUrl: getBaseUrl(),
      webhookSecretConfigurado: Boolean(process.env.RODAID_MP_WEBHOOK_SECRET),
      accessTokenConfigurado: Boolean(process.env.RODAID_MP_ACCESS_TOKEN),
    })
  } catch (error) {
    return jsonError(error)
  }
}
