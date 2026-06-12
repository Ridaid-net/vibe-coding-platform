import { NextResponse } from 'next/server'
import { jsonError, requireAdmin } from '@/lib/marketplace'
import { queueStats } from '@/src/services/queue.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/admin/queue/stats — contadores por cola
 * (waiting / active / completed / failed / delayed). Requiere x-admin-token.
 */
export async function GET(req: Request) {
  try {
    requireAdmin(req)
    return NextResponse.json({ ok: true, data: await queueStats() })
  } catch (error) {
    return jsonError(error)
  }
}
