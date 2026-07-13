import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import { ApiError } from '@/lib/marketplace'

/**
 * RODAID — Modulo 4: nucleo criptografico del Certificado de Identidad Tecnica.
 *
 * Construido exclusivamente sobre `node:crypto` (sin dependencias externas), de
 * modo que la logica de inmutabilidad sea autocontenida, reproducible y testeable
 * de forma unitaria.
 *
 * El sello de inmutabilidad se compone de dos piezas:
 *   1. Huella  : SHA-256 sobre una serializacion canonica y determinista del
 *                snapshot del certificado. Es el valor que se ancla en BFA.
 *   2. Firma   : HMAC-SHA256 de la huella con el secreto de RODAID. Acredita que
 *                la huella fue emitida por la plataforma (autenticidad), no solo
 *                que el contenido coincide (integridad).
 */

export const CIT_ALGORITMO = 'SHA-256+HMAC-SHA256'
export const CIT_ESQUEMA = 'RODAID-CIT-v1'

export type CitEstado =
  | 'PENDIENTE_VALIDACION'
  | 'ACTIVO'
  | 'VENCIDO'
  | 'REVOCADO'
export type CitBfaEstado =
  | 'NO_INICIADA'
  | 'PENDIENTE'
  | 'ACUNADO'
  | 'ERROR'
  | 'FALLIDO'

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json }

// ── Serializacion canonica ───────────────────────────────────────────────────

/**
 * Reordena recursivamente las claves de los objetos para que la serializacion
 * sea independiente del orden de insercion (incluyendo los objetos anidados
 * dentro de arrays). Los arrays preservan su orden (es significativo), las
 * claves `undefined` se descartan y se rechazan los numeros no finitos.
 */
function ordenarCanonico(value: unknown): Json | undefined {
  if (value === null) {
    return null
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ApiError(
        400,
        'CIT_DATO_INVALIDO',
        'Los datos del certificado contienen un numero no finito.'
      )
    }
    return value
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value
  }

  if (value === undefined) {
    return undefined
  }

  if (Array.isArray(value)) {
    return value.map((item) => {
      const normalizado = ordenarCanonico(item)
      // En un array, undefined se serializa como null en JSON; lo hacemos explicito.
      return normalizado === undefined ? null : normalizado
    })
  }

  if (typeof value === 'object') {
    const entrada = value as Record<string, unknown>
    const salida: Record<string, Json> = {}
    for (const clave of Object.keys(entrada).sort()) {
      const normalizado = ordenarCanonico(entrada[clave])
      if (normalizado !== undefined) {
        salida[clave] = normalizado
      }
    }
    return salida
  }

  // Funciones, symbols, bigint, etc. no pueden certificarse.
  throw new ApiError(
    400,
    'CIT_DATO_INVALIDO',
    'Los datos del certificado contienen un valor no serializable.'
  )
}

/** Devuelve la representacion canonica determinista de un valor. */
export function canonicalizar(value: unknown): string {
  return JSON.stringify(ordenarCanonico(value) ?? null)
}

// ── Huella y firma ───────────────────────────────────────────────────────────

/** SHA-256 (hex) de una cadena canonica ya serializada. */
export function huellaDeCanonico(canonico: string): string {
  return createHash('sha256').update(canonico, 'utf8').digest('hex')
}

/**
 * Genera la huella SHA-256 (hex) de un payload de CIT. El payload se serializa
 * primero de forma canonica (claves ordenadas recursivamente) para que la huella
 * sea deterministica e independiente del orden de las propiedades.
 */
export function generarHashCIT(payload: unknown): string {
  return huellaDeCanonico(canonicalizar(payload))
}

function obtenerSecretoFirma(): string {
  const secret =
    process.env.CIT_FIRMA_SECRET ??
    process.env.AUTH_SECRET ??
    process.env.JWT_SECRET
  if (!secret) {
    throw new ApiError(
      500,
      'CIT_FIRMA_NO_CONFIGURADA',
      'No hay secreto de firma configurado para el sellado de CITs.'
    )
  }
  return secret
}

/** HMAC-SHA256 (hex) de la huella con el secreto de RODAID. */
export function firmarHuella(huella: string): string {
  return createHmac('sha256', obtenerSecretoFirma()).update(huella).digest('hex')
}

/** Comparacion en tiempo constante de dos cadenas hexadecimales. */
function igualesEnTiempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false
  }
  const bufferA = Buffer.from(a, 'utf8')
  const bufferB = Buffer.from(b, 'utf8')
  if (bufferA.length !== bufferB.length) {
    return false
  }
  return timingSafeEqual(bufferA, bufferB)
}

export interface ResultadoVerificacion {
  integro: boolean
  huellaCoincide: boolean
  firmaValida: boolean
  huellaRecalculada: string
}

/**
 * Verifica la integridad y autenticidad de un certificado sellado a partir de su
 * cadena canonica almacenada (byte a byte, sin reserializar): recalcula la huella
 * y la compara contra la huella guardada, y revalida la firma HMAC. Cualquier
 * alteracion de la cadena canonica, la huella o la firma da `integro: false`.
 */
export function verificarSello(
  canonico: string,
  huellaGuardada: string,
  firmaGuardada: string
): ResultadoVerificacion {
  const huellaRecalculada = huellaDeCanonico(canonico)
  const huellaCoincide = igualesEnTiempoConstante(huellaRecalculada, huellaGuardada)
  const firmaValida = igualesEnTiempoConstante(
    firmarHuella(huellaGuardada),
    firmaGuardada
  )
  return {
    integro: huellaCoincide && firmaValida,
    huellaCoincide,
    firmaValida,
    huellaRecalculada,
  }
}

// ── Construccion del snapshot certificable ───────────────────────────────────

export interface SnapshotInput {
  citId: string
  version: number
  aliadoId: string
  ciclistaId: string
  bicicletaSerial: string
  inspeccion: unknown[]
  coordenadasGps: Record<string, unknown> | null
  fotosHashes: Record<string, unknown> | null
  capturadoEn: string
}

/**
 * Arma el objeto exacto que se hashea y firma. Incluye el esquema y el emisor
 * para que la huella quede ligada a la version del formato y a RODAID.
 */
export function construirSnapshot(datos: SnapshotInput) {
  return {
    esquema: CIT_ESQUEMA,
    emisor: 'RODAID',
    algoritmo: CIT_ALGORITMO,
    citId: datos.citId,
    version: datos.version,
    aliadoId: datos.aliadoId,
    ciclistaId: datos.ciclistaId,
    bicicletaSerial: datos.bicicletaSerial,
    inspeccion: datos.inspeccion,
    coordenadasGps: datos.coordenadasGps,
    fotosHashes: datos.fotosHashes,
    capturadoEn: datos.capturadoEn,
  }
}

// ── Validacion y normalizacion de entrada ────────────────────────────────────

export function nuevoId(): string {
  return randomUUID()
}

export function parseTexto(value: unknown, campo: string, maxLength?: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${campo} es obligatorio.`)
  }
  const trimmed = value.trim()
  if (maxLength && trimmed.length > maxLength) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `${campo} no puede superar ${maxLength} caracteres.`
    )
  }
  return trimmed
}

export function parseTextoOpcional(
  value: unknown,
  campo: string,
  maxLength?: number
): string | null {
  if (value === undefined || value === null || value === '') {
    return null
  }
  return parseTexto(value, campo, maxLength)
}

