import { getDatabase } from '@netlify/database'
import { NextResponse } from 'next/server'
import { requireAuth, requireRole, type UsuarioRol } from '@/lib/auth'
import { getModo } from '@/src/services/mercadopago.service'

export interface AuthenticatedUser {
  id: string
  email?: string | null
}

export interface PublicacionRow {
  id: string
  cit_id: string
  bicicleta_id: string
  vendedor_id: string
  titulo: string
  descripcion: string
  precio_ars: string
  precio_usd: string | null
  fotos_urls: string[]
  estado: string
  slug: string
  vistas: number
  contactos: number
  publicado_en: string
  vence_en: string
  vendido_en: string | null
  comprador_id: string | null
  precio_final_ars: string | null
  comision_rodaid: string | null
  marca?: string | null
  modelo?: string | null
  anio?: number | null
  tipo?: string | null
  numero_serie?: string | null
  rodado?: string | null
  talle_cuadro?: string | null
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message)
  }
}

export function getPool() {
  return getDatabase().pool
}

export type DbPool = ReturnType<typeof getPool>
export type DbClient = Awaited<ReturnType<DbPool['connect']>>

export function jsonError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.code, message: error.message },
      { status: error.status }
    )
  }

  console.error('Marketplace API error', error)
  return NextResponse.json(
    { error: 'INTERNAL_ERROR', message: 'No se pudo procesar la solicitud.' },
    { status: 500 }
  )
}

/**
 * Secreto de firma de los JWT de usuario. En produccion (modo LIVE de
 * MercadoPago) se EXIGE JWT_SECRET (o AUTH_SECRET): sin el, la autenticacion no
 * opera. Fuera de LIVE (preview/STUB), si no hay secreto configurado se usa un
 * secreto de desarrollo para poder ejercitar el flujo de punta a punta. En LIVE
 * nunca se usa el fallback.
 */
const DEV_AUTH_SECRET = 'rodaid-dev-secret-checkout-no-usar-en-produccion'

export function getAuthSecret(): string | null {
  const configured = process.env.JWT_SECRET ?? process.env.AUTH_SECRET
  if (configured && configured.trim().length > 0) {
    return configured.trim()
  }
  if (getModo() !== 'LIVE') {
    return DEV_AUTH_SECRET
  }
  return null
}

/**
 * Middleware de proteccion de endpoints privados. Exige un AccessToken valido y
 * devuelve el usuario autenticado. Delega en `requireAuth` (lib/auth), la unica
 * fuente de verdad de la autenticacion; se mantiene aqui por compatibilidad con
 * los servicios que ya lo importan desde `@/lib/marketplace`.
 */
export async function requireUser(req: Request): Promise<AuthenticatedUser> {
  return requireAuth(req)
}

// Re-exportes de la capa de autenticacion (Hito 1) para consumo desde la API.
export { requireAuth, requireRole } from '@/lib/auth'

/**
 * Guarda de endpoints administrativos / de sistema (resolucion de disputas,
 * barrido de auto-release). Exige el header `x-admin-token` igual a
 * RODAID_ADMIN_TOKEN.
 */
export function requireAdmin(req: Request): { id: string } {
  const expected = process.env.RODAID_ADMIN_TOKEN
  if (!expected) {
    throw new ApiError(
      500,
      'ADMIN_NOT_CONFIGURED',
      'RODAID_ADMIN_TOKEN no esta configurado.'
    )
  }
  const provided = req.headers.get('x-admin-token')
  if (!provided || provided !== expected) {
    throw new ApiError(403, 'ADMIN_REQUIRED', 'Credenciales de administrador requeridas.')
  }
  return { id: 'admin' }
}

/**
 * Guarda para acciones de back-office (resolucion de disputas, peritaje, etc.).
 * Acepta dos vias de acceso:
 *   - Un usuario autenticado con rol staff (admin/inspector) — panel humano.
 *   - El token de sistema `x-admin-token` — operaciones y funciones programadas.
 * Si llega un Bearer token, se autoriza por rol; si no, por el token de sistema.
 */
export async function requireStaff(
  req: Request,
  ...roles: UsuarioRol[]
): Promise<{ id: string }> {
  const hasBearer = /^Bearer\s+/i.test(req.headers.get('authorization') ?? '')
  if (hasBearer) {
    const permitidos = roles.length ? roles : (['admin', 'inspector'] as UsuarioRol[])
    return requireRole(...permitidos)(req)
  }
  return requireAdmin(req)
}

export function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}


export function parsePositiveNumber(
  value: unknown,
  field: string,
  required = true
) {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new ApiError(400, 'VALIDATION_ERROR', `${field} es obligatorio.`)
    }
    return null
  }

  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} debe ser mayor a cero.`)
  }

  return numberValue
}

export function parseText(value: unknown, field: string, maxLength?: number) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} es obligatorio.`)
  }

  const trimmed = value.trim()
  if (maxLength && trimmed.length > maxLength) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `${field} no puede superar ${maxLength} caracteres.`
    )
  }

  return trimmed
}

export function normalizeStringList(value: string | null) {
  if (!value) {
    return []
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function buildSpanishTsQuery(text: string) {
  return text
    .trim()
    .split(/\s+/)
    .map((term) =>
      term
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\p{L}\p{N}_-]/gu, '')
        .trim()
    )
    .filter(Boolean)
    .map((term) => `${term}:*`)
    .join(' & ')
}

export function slugify(parts: Array<string | number | null | undefined>) {
  return parts
    .filter((part) => part !== null && part !== undefined && `${part}`.trim())
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function mapPublicacion(row: PublicacionRow) {
  return {
    id: row.id,
    citId: row.cit_id,
    bicicletaId: row.bicicleta_id,
    vendedorId: row.vendedor_id,
    titulo: row.titulo,
    descripcion: row.descripcion,
    precioARS: Number(row.precio_ars),
    precioUSD: row.precio_usd === null ? null : Number(row.precio_usd),
    fotosUrls: row.fotos_urls ?? [],
    estado: row.estado,
    slug: row.slug,
    vistas: row.vistas,
    contactos: row.contactos,
    publicadoEn: row.publicado_en,
    venceEn: row.vence_en,
    vendidoEn: row.vendido_en,
    compradorId: row.comprador_id,
    precioFinalARS:
      row.precio_final_ars === null ? null : Number(row.precio_final_ars),
    comisionRodaid:
      row.comision_rodaid === null ? null : Number(row.comision_rodaid),
    bicicleta: {
      marca: row.marca ?? null,
      modelo: row.modelo ?? null,
      anio: row.anio ?? null,
      tipo: row.tipo ?? null,
      numeroSerie: row.numero_serie ?? null,
      rodado: row.rodado === null || row.rodado === undefined ? null : Number(row.rodado),
      talleCuadro: row.talle_cuadro ?? null,
    },
  }
}
