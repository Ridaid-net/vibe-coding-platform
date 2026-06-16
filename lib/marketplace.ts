import { getDatabase } from '@netlify/database'
import { jwtVerify } from 'jose'
import { NextResponse } from 'next/server'
import { getModo } from '@/src/services/mercadopago.service'

export interface AuthenticatedUser {
  id: string
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
 * Secreto de firma de los JWT de usuario. En produccion se exige
 * JWT_SECRET (o AUTH_SECRET). Mientras el sistema de cuentas todavia no
 * existe (Hito 1), y SOLO cuando no se opera con dinero real (modo
 * STUB/SANDBOX de MercadoPago), se habilita un secreto de desarrollo para
 * poder ejercitar el checkout de RODAID PAY de punta a punta. En modo LIVE
 * nunca se usa el fallback: se exige un secreto configurado.
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

export async function requireUser(req: Request): Promise<AuthenticatedUser> {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]

  if (!token) {
    throw new ApiError(401, 'AUTH_REQUIRED', 'Token de usuario requerido.')
  }

  const secret = getAuthSecret()
  if (!secret) {
    throw new ApiError(500, 'AUTH_NOT_CONFIGURED', 'Autenticacion no configurada.')
  }

  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret)
    )
    const id = payload.sub ?? payload.userId ?? payload.id

    if (typeof id !== 'string' || id.length === 0) {
      throw new ApiError(401, 'INVALID_TOKEN', 'Token de usuario invalido.')
    }

    return { id }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }
    throw new ApiError(401, 'INVALID_TOKEN', 'Token de usuario invalido.')
  }
}

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
