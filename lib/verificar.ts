// ─── RODAID · Verificacion publica del CIT ─────────────────────────────
//
// Resuelve un Certificado de Identidad Tecnologica a partir del hash SHA-256
// con el que fue sellado (el "serialHash"). Es la pieza que da soporte a la
// pagina publica /verificar/:serialHash, a la que apunta el codigo QR que el
// Modulo de Documentos PDF imprime en cada certificado.
//
// La vista que se expone es deliberadamente acotada: confirma la autenticidad
// y el estado del certificado y describe el rodado, pero NO revela la
// identidad del propietario. No requiere sesion: cualquiera que escanee el QR
// (por ejemplo, al comprar una bici usada) puede comprobar el certificado.

import { getPool } from '@/lib/marketplace'
import { evaluarVencimientoCIT, type ZonaVencimientoCIT } from '@/lib/cit'
import { garajeMock } from '@/lib/garaje'

/** Estado del CIT tal como se guarda en la base (sin el SIN_CIT de la UI). */
type EstadoCITDb = 'ACTIVO' | 'EXPIRADO' | 'BORRADOR' | 'PENDIENTE_PAGO'

export interface VerificacionCIT {
  /** El hash existe en el registro de RODAID: el certificado es autentico. */
  autentico: boolean
  /** Vigente = activo y todavia no vencido. */
  vigente: boolean
  numeroCIT: string
  estado: EstadoCITDb
  zonaVencimiento: ZonaVencimientoCIT
  diasRestantes: number | null
  hashSHA256: string
  hasHashBFA: boolean
  nftTokenId: string | null
  tasaPagada: boolean
  fechaEmision: string | null
  fechaVencimiento: string | null
  bicicleta: {
    marca: string
    modelo: string
    numeroSerie: string
  }
}

interface VerificacionRow {
  numero_cit: string
  estado: EstadoCITDb
  hash_sha256: string
  hash_bfa: boolean
  nft_token_id: string | null
  tasa_pagada: boolean
  fecha_emision: Date | string | null
  fecha_vencimiento: Date | string | null
  marca: string
  modelo: string
  numero_serie: string
}

function toIso(value: Date | string | null): string | null {
  if (value === null) {
    return null
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function construirVerificacion(row: VerificacionRow): VerificacionCIT {
  const evaluacion = evaluarVencimientoCIT({
    estado: row.estado,
    fechaVencimiento: row.fecha_vencimiento,
  })

  return {
    autentico: true,
    vigente: row.estado === 'ACTIVO' && evaluacion.zona !== 'VENCIDO',
    numeroCIT: row.numero_cit,
    estado: row.estado,
    zonaVencimiento: evaluacion.zona,
    diasRestantes: evaluacion.diasRestantes,
    hashSHA256: row.hash_sha256,
    hasHashBFA: row.hash_bfa,
    nftTokenId: row.nft_token_id,
    tasaPagada: row.tasa_pagada,
    fechaEmision: toIso(row.fecha_emision),
    fechaVencimiento: toIso(row.fecha_vencimiento),
    bicicleta: {
      marca: row.marca,
      modelo: row.modelo,
      numeroSerie: row.numero_serie,
    },
  }
}

/**
 * Normaliza el serialHash de la URL: lo deja en minusculas y descarta cualquier
 * caracter que no sea hexadecimal. Un hash SHA-256 tiene 64 caracteres hex; si
 * lo recibido no encaja, se devuelve null y la verificacion responde "no
 * encontrado" sin tocar la base.
 */
export function normalizarSerialHash(raw: string): string | null {
  const limpio = raw.trim().toLowerCase().replace(/[^0-9a-f]/g, '')
  return limpio.length === 64 ? limpio : null
}

/** Busca el CIT en el fixture de desarrollo (RODAID_MOCK=true). */
function verificarMock(hash: string): VerificacionCIT | null {
  for (const bici of garajeMock().bicicletas) {
    const cit = bici.cit
    if (cit?.hashSHA256 && cit.hashSHA256.toLowerCase() === hash) {
      const estado = (cit.estado === 'SIN_CIT' ? 'BORRADOR' : cit.estado) as EstadoCITDb
      return construirVerificacion({
        numero_cit: cit.numeroCIT,
        estado,
        hash_sha256: cit.hashSHA256,
        hash_bfa: cit.hasHashBFA,
        nft_token_id: cit.nftTokenId,
        tasa_pagada: cit.tasaPagada,
        fecha_emision: cit.fechaEmision,
        fecha_vencimiento: cit.fechaVencimiento,
        marca: bici.marca,
        modelo: bici.modelo,
        numero_serie: bici.numeroSerie,
      })
    }
  }
  return null
}

/**
 * Verifica un CIT por su serialHash. Devuelve la vista publica del
 * certificado, o `null` si ningun certificado fue sellado con ese hash.
 */
export async function verificarCIT(serialHash: string): Promise<VerificacionCIT | null> {
  const hash = normalizarSerialHash(serialHash)
  if (!hash) {
    return null
  }

  if (process.env.RODAID_MOCK === 'true') {
    return verificarMock(hash)
  }

  const pool = getPool()
  const { rows } = await pool.query<VerificacionRow>(
    `
      SELECT
        c.numero_cit        AS numero_cit,
        c.estado            AS estado,
        c.hash_sha256       AS hash_sha256,
        c.hash_bfa          AS hash_bfa,
        c.nft_token_id      AS nft_token_id,
        c.tasa_pagada       AS tasa_pagada,
        c.fecha_emision     AS fecha_emision,
        c.fecha_vencimiento AS fecha_vencimiento,
        b.marca             AS marca,
        b.modelo            AS modelo,
        b.numero_serie      AS numero_serie
      FROM cits c
      JOIN bicicletas b ON b.id = c.bicicleta_id
      WHERE c.hash_sha256 = $1
      LIMIT 1
    `,
    [hash]
  )

  const row = rows[0]
  return row ? construirVerificacion(row) : null
}
