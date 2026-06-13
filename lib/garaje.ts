import { ApiError, getPool } from '@/lib/marketplace'

// ─── Tipos del Garaje Digital (contrato del endpoint) ──────────────────
// Coinciden con los tipos del cliente tipado en `@/lib/garaje-api`.

export type EstadoCIT =
  | 'ACTIVO'
  | 'EXPIRADO'
  | 'BORRADOR'
  | 'PENDIENTE_PAGO'
  | 'SIN_CIT'

export interface CITResumen {
  id: string
  numeroCIT: string
  estado: EstadoCIT
  puntosTotal: number
  puntajeMax: number
  hasHashBFA: boolean
  nftTokenId: string | null
  tasaPagada: boolean
  fechaEmision: string | null
  fechaVencimiento: string | null
  diasRestantes: number | null
  hashSHA256: string | null
}

export interface CertAsegResumen {
  numero: string
  score: number
  nivel: 'EXCELENTE' | 'BUENO' | 'REGULAR' | 'INSUFICIENTE'
  asegurable: boolean
}

export interface PolizaResumen {
  numeroPoliza: string
  aseguradora: string
  primaFinalARS: string
  estado: string
  finVigencia: string
}

export interface BicicletaGaraje {
  id: string
  marca: string
  modelo: string
  numeroSerie: string
  cit: CITResumen | null
  certAseg: CertAsegResumen | null
  poliza: PolizaResumen | null
  scoreSalud: number
}

export interface GarajeResumen {
  bicicletas: BicicletaGaraje[]
  resumen: {
    totalBicicletas: number
    citsActivos: number
    citsBorrador: number
    polizasActivas: number
    scorePromedioSalud: number
  }
}

// ─── Fila cruda devuelta por la consulta agregada ──────────────────────

interface GarajeRow {
  id: string
  marca: string
  modelo: string
  numero_serie: string
  cit_id: string | null
  numero_cit: string | null
  cit_estado: Exclude<EstadoCIT, 'SIN_CIT'> | null
  puntos_total: number | null
  puntaje_max: number | null
  hash_sha256: string | null
  hash_bfa: boolean | null
  nft_token_id: string | null
  tasa_pagada: boolean | null
  fecha_emision: Date | string | null
  fecha_vencimiento: Date | string | null
  cert_numero: string | null
  cert_score: string | null
  cert_nivel: CertAsegResumen['nivel'] | null
  cert_asegurable: boolean | null
  numero_poliza: string | null
  aseguradora: string | null
  prima_final_ars: string | null
  poliza_estado: string | null
  fin_vigencia: Date | string | null
}

const MS_POR_DIA = 1000 * 60 * 60 * 24

function toIso(value: Date | string | null): string | null {
  if (value === null) {
    return null
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function diasRestantes(fechaVencimiento: Date | string | null): number | null {
  if (fechaVencimiento === null) {
    return null
  }
  const vence = fechaVencimiento instanceof Date
    ? fechaVencimiento.getTime()
    : new Date(fechaVencimiento).getTime()
  return Math.ceil((vence - Date.now()) / MS_POR_DIA)
}

function formatARS(value: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(value)
}

/**
 * Score de salud (0-100) derivado de los activos de la bicicleta.
 * Pondera el avance del CIT, su estado, la asegurabilidad y la poliza.
 */
function calcularScoreSalud(
  cit: CITResumen | null,
  certAseg: CertAsegResumen | null,
  poliza: PolizaResumen | null
): number {
  let score = 0

  if (cit) {
    const avance = cit.puntajeMax > 0 ? cit.puntosTotal / cit.puntajeMax : 0
    score += Math.min(50, avance * 50)
    score +=
      cit.estado === 'ACTIVO'
        ? 20
        : cit.estado === 'PENDIENTE_PAGO'
        ? 10
        : cit.estado === 'BORRADOR'
        ? 5
        : 0
  }

  if (certAseg) {
    score += certAseg.asegurable ? 15 : 5
  }

  if (poliza) {
    score += 15
  }

  return Math.max(0, Math.min(100, Math.round(score)))
}

function mapRow(row: GarajeRow): BicicletaGaraje {
  const cit: CITResumen | null =
    row.cit_id && row.cit_estado
      ? {
          id: row.cit_id,
          numeroCIT: row.numero_cit ?? '',
          estado: row.cit_estado,
          puntosTotal: row.puntos_total ?? 0,
          puntajeMax: row.puntaje_max ?? 20,
          hasHashBFA: row.hash_bfa ?? false,
          nftTokenId: row.nft_token_id,
          tasaPagada: row.tasa_pagada ?? false,
          fechaEmision: toIso(row.fecha_emision),
          fechaVencimiento: toIso(row.fecha_vencimiento),
          diasRestantes: diasRestantes(row.fecha_vencimiento),
          hashSHA256: row.hash_sha256,
        }
      : null

  const certAseg: CertAsegResumen | null =
    row.cert_numero && row.cert_nivel
      ? {
          numero: row.cert_numero,
          score: Number(row.cert_score ?? 0),
          nivel: row.cert_nivel,
          asegurable: row.cert_asegurable ?? false,
        }
      : null

  const poliza: PolizaResumen | null =
    row.numero_poliza && row.prima_final_ars
      ? {
          numeroPoliza: row.numero_poliza,
          aseguradora: row.aseguradora ?? '',
          primaFinalARS: formatARS(Number(row.prima_final_ars)),
          estado: row.poliza_estado ?? 'ACTIVA',
          finVigencia: toIso(row.fin_vigencia) ?? '',
        }
      : null

  return {
    id: row.id,
    marca: row.marca,
    modelo: row.modelo,
    numeroSerie: row.numero_serie,
    cit,
    certAseg,
    poliza,
    scoreSalud: calcularScoreSalud(cit, certAseg, poliza),
  }
}

function construirResumen(bicicletas: BicicletaGaraje[]): GarajeResumen['resumen'] {
  const totalBicicletas = bicicletas.length
  const citsActivos = bicicletas.filter((b) => b.cit?.estado === 'ACTIVO').length
  const citsBorrador = bicicletas.filter((b) => b.cit?.estado === 'BORRADOR').length
  const polizasActivas = bicicletas.filter((b) => b.poliza !== null).length
  const scorePromedioSalud = totalBicicletas
    ? Math.round(
        bicicletas.reduce((sum, b) => sum + b.scoreSalud, 0) / totalBicicletas
      )
    : 0

  return {
    totalBicicletas,
    citsActivos,
    citsBorrador,
    polizasActivas,
    scorePromedioSalud,
  }
}

/**
 * Carga el Garaje Digital completo de un usuario en una sola consulta:
 * bicicletas + CIT + certificado de asegurabilidad + poliza vigente.
 */
export async function cargarGaraje(usuarioId: string): Promise<GarajeResumen> {
  const pool = getPool()
  const { rows } = await pool.query<GarajeRow>(
    `
      SELECT
        b.id,
        b.marca,
        b.modelo,
        b.numero_serie,
        c.id                AS cit_id,
        c.numero_cit        AS numero_cit,
        c.estado            AS cit_estado,
        c.puntos_total      AS puntos_total,
        c.puntaje_max       AS puntaje_max,
        c.hash_sha256       AS hash_sha256,
        c.hash_bfa          AS hash_bfa,
        c.nft_token_id      AS nft_token_id,
        c.tasa_pagada       AS tasa_pagada,
        c.fecha_emision     AS fecha_emision,
        c.fecha_vencimiento AS fecha_vencimiento,
        ca.numero           AS cert_numero,
        ca.score            AS cert_score,
        ca.nivel            AS cert_nivel,
        ca.asegurable       AS cert_asegurable,
        p.numero_poliza     AS numero_poliza,
        p.aseguradora       AS aseguradora,
        p.prima_final_ars   AS prima_final_ars,
        p.estado            AS poliza_estado,
        p.fin_vigencia      AS fin_vigencia
      FROM bicicletas b
      LEFT JOIN cits c ON c.bicicleta_id = b.id
      LEFT JOIN certificados_asegurabilidad ca ON ca.bicicleta_id = b.id
      LEFT JOIN LATERAL (
        SELECT pz.*
        FROM polizas pz
        WHERE pz.bicicleta_id = b.id
          AND pz.estado = 'ACTIVA'
        ORDER BY pz.fin_vigencia DESC
        LIMIT 1
      ) p ON TRUE
      WHERE b.propietario_id = $1
      ORDER BY b.creado_en DESC
    `,
    [usuarioId]
  )

  const bicicletas = rows.map(mapRow)
  return { bicicletas, resumen: construirResumen(bicicletas) }
}

/**
 * Fixture de desarrollo. Se activa unicamente con RODAID_MOCK=true para
 * poder demostrar el estado "con datos" de la UI sin un flujo de login
 * completo. NO es una via de persistencia: en produccion el endpoint
 * siempre lee de Postgres mediante `cargarGaraje`.
 */
export function garajeMock(): GarajeResumen {
  const ahora = Date.now()
  const enDias = (d: number) => new Date(ahora + d * MS_POR_DIA).toISOString()
  const haceDias = (d: number) => new Date(ahora - d * MS_POR_DIA).toISOString()

  const bicicletas: BicicletaGaraje[] = [
    {
      id: 'demo-1',
      marca: 'Trek',
      modelo: 'Marlin 7',
      numeroSerie: 'WTU123F0023A',
      cit: {
        id: 'cit-demo-1',
        numeroCIT: 'CIT-2026-000123',
        estado: 'ACTIVO',
        puntosTotal: 19,
        puntajeMax: 20,
        hasHashBFA: true,
        nftTokenId: '4821',
        tasaPagada: true,
        fechaEmision: haceDias(120),
        fechaVencimiento: enDias(245),
        diasRestantes: 245,
        hashSHA256:
          'a3f1c9e84b27d6105f8e2c44b9a7138e6d05f21c8b4e0934a7c61d2f8e93b4a1',
      },
      certAseg: {
        numero: 'CA-2026-000123',
        score: 87,
        nivel: 'EXCELENTE',
        asegurable: true,
      },
      poliza: {
        numeroPoliza: 'POL-99812',
        aseguradora: 'RODAID Seguros',
        primaFinalARS: '$12.500',
        estado: 'ACTIVA',
        finVigencia: enDias(245),
      },
      scoreSalud: 96,
    },
    {
      id: 'demo-2',
      marca: 'Specialized',
      modelo: 'Rockhopper',
      numeroSerie: 'SPZ881K0451B',
      cit: {
        id: 'cit-demo-2',
        numeroCIT: 'CIT-2026-000456',
        estado: 'BORRADOR',
        puntosTotal: 11,
        puntajeMax: 20,
        hasHashBFA: false,
        nftTokenId: null,
        tasaPagada: false,
        fechaEmision: null,
        fechaVencimiento: null,
        diasRestantes: null,
        hashSHA256: null,
      },
      certAseg: {
        numero: 'CA-2026-000456',
        score: 54,
        nivel: 'REGULAR',
        asegurable: true,
      },
      poliza: null,
      scoreSalud: 42,
    },
    {
      id: 'demo-3',
      marca: 'Giant',
      modelo: 'Escape 3',
      numeroSerie: 'GNT552M0098C',
      cit: {
        id: 'cit-demo-3',
        numeroCIT: 'CIT-2026-000789',
        estado: 'PENDIENTE_PAGO',
        puntosTotal: 17,
        puntajeMax: 20,
        hasHashBFA: true,
        nftTokenId: null,
        tasaPagada: false,
        fechaEmision: haceDias(2),
        fechaVencimiento: enDias(363),
        diasRestantes: 363,
        hashSHA256:
          'f7b2a1083c54e9216d0a7b38c1f49e25a6803b71d29e4c50f8a3162b7d04e9c5',
      },
      certAseg: null,
      poliza: null,
      scoreSalud: 58,
    },
  ]

  return { bicicletas, resumen: construirResumen(bicicletas) }
}

export { ApiError }
