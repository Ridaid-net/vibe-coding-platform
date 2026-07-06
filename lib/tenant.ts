/**
 * RODAID · Multi-Tenant Middleware
 * Inyecta app.current_tenant_id en cada transacción PostgreSQL
 * Compatible con EDI X-Road · Ley 25.326 · RLS Neon
 */

import { getPool } from '@/lib/marketplace'

// Slugs válidos de tenants
export type TenantSlug =
  | 'rodaid'
  | 'ministerio_seguridad'
  | 'mpf_mendoza'
  | 'municipio_san_martin'
  | 'municipio_junin'
  | 'municipio_rivadavia'

// Cache en memoria de tenant slugs → UUIDs
const tenantCache = new Map<TenantSlug, string>()

/** Resuelve el UUID de un tenant por slug */
export async function getTenantId(slug: TenantSlug): Promise<string> {
  if (tenantCache.has(slug)) return tenantCache.get(slug)!
  const pool = getPool()
  const result = await pool.query('SELECT id FROM tenants WHERE slug = $1 AND activo = true', [slug])
  if (!result.rows[0]) throw new Error(`Tenant no encontrado: ${slug}`)
  tenantCache.set(slug, result.rows[0].id)
  return result.rows[0].id
}

/** Ejecuta una query con aislamiento RLS del tenant */
export async function withTenant<T>(
  slug: TenantSlug,
  fn: (client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: T[] }> }) => Promise<T[]>
): Promise<T[]> {
  const pool = getPool()
  const client = await pool.connect()
  try {
    const tenantId = await getTenantId(slug)
    await client.query('BEGIN')
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}'`)
    await client.query(`SET LOCAL app.bypass_rls = 'false'`)
    const result = await fn(client as never)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** Ejecuta una query como RODAID admin (bypass RLS) — solo para procesos internos */
export async function withBypassRLS<T>(
  fn: (client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: T[] }> }) => Promise<T[]>
): Promise<T[]> {
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL app.bypass_rls = 'true'`)
    const result = await fn(client as never)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** Registra una acción en el audit log del tenant (cumple EDI X-Road) */
export async function auditTenant({
  tenantSlug,
  usuarioId,
  accion,
  tabla,
  ipOrigen,
  metadata,
}: {
  tenantSlug: TenantSlug
  usuarioId?: string
  accion: string
  tabla?: string
  ipOrigen?: string
  metadata?: Record<string, unknown>
}) {
  try {
    const pool = getPool()
    const tenantId = await getTenantId(tenantSlug)
    await pool.query(
      `INSERT INTO tenant_audit_log (tenant_id, usuario_id, accion, tabla, ip_origen, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId, usuarioId ?? null, accion, tabla ?? null, ipOrigen ?? null, metadata ? JSON.stringify(metadata) : null]
    )
  } catch {
    // Audit log nunca debe romper el flujo principal
  }
}

/** Resuelve el tenant desde el header X-Tenant-ID (para APIs gubernamentales) */
export function getTenantFromHeader(req: Request): TenantSlug {
  const header = req.headers.get('x-tenant-id') as TenantSlug | null
  const validTenants: TenantSlug[] = [
    'rodaid',
    'ministerio_seguridad',
    'mpf_mendoza',
    'municipio_san_martin',
    'municipio_junin',
    'municipio_rivadavia',
  ]
  if (header && validTenants.includes(header)) return header
  return 'rodaid' // default: plataforma principal
}
