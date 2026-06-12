import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import { rolesInfo } from '@/src/services/roles.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/roles — información pública de los 4 roles de RODAID y los
 * permisos que concede cada uno.
 */
export async function GET() {
  try {
    return NextResponse.json({ ok: true, data: rolesInfo() })
  } catch (error) {
    return jsonError(error)
  }
}
