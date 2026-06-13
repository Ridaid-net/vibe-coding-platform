import { ApiError, getPool } from '@/lib/marketplace'

/**
 * RODAID — Garaje Digital.
 *
 * GET /api/v1/usuario/bicicletas carga los rodados del usuario autenticado junto
 * con su CIT más reciente (resuelto con un LATERAL JOIN en una sola consulta) y
 * un resumen del garaje. GET /api/v1/usuario/bicicletas/:id devuelve el detalle
 * de un rodado propio más el historial de sus últimos CITs.
 *
 * La forma de la respuesta está alineada con el componente de presentación del
 * Garaje Digital: cada bicicleta expone `cit` con su número, estado, puntaje,
 * hash e inspector, y el resumen usa las claves que el dashboard consume
 * directamente. El campo `nftTokenId` se mantiene en el contrato (siempre null):
 * el acuñado en blockchain es una integración aún no disponible.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface GarajeRow {
  id: string
  numero_serie: string
  marca: string
  modelo: string
  anio: number | null
  tipo: string | null
  bici_creada: string
  cit_id: string | null
  numero_cit: string | null
  cit_estado: string | null
  puntos: number | null
  fotos: string[] | null
  hash_sha256: string | null
  fecha_emision: string | null
  fecha_vencimiento: string | null
  cit_creada: string | null
  propietario_nombre: string | null
  inspector_nombre: string | null
}

const GARAJE_SELECT = `
  SELECT b.id,
         b.numero_serie,
         b.marca,
         b.modelo,
         b.anio,
         b.tipo,
         b.created_at        AS bici_creada,
         c.id                AS cit_id,
         c.numero_cit        AS numero_cit,
         c.estado            AS cit_estado,
         c.puntos            AS puntos,
         c.fotos             AS fotos,
         c.hash_sha256       AS hash_sha256,
         c.fecha_emision     AS fecha_emision,
         c.fecha_vencimiento AS fecha_vencimiento,
         c.created_at        AS cit_creada,
         pu.nombre           AS propietario_nombre,
         iu.nombre           AS inspector_nombre
    FROM bicicletas b
    LEFT JOIN LATERAL (
      SELECT * FROM cits
       WHERE bicicleta_id = b.id
       ORDER BY created_at DESC
       LIMIT 1
    ) c ON TRUE
    LEFT JOIN usuarios pu     ON pu.id = b.propietario_id
    LEFT JOIN inspectores i   ON i.id = c.inspector_id
    LEFT JOIN usuarios iu     ON iu.id = i.usuario_id
`

export interface CitGaraje {
  id: string
  numeroCIT: string | null
  estado: string
  puntosTotal: number | null
  fotosCount: number
  hashSHA256: string | null
  nftTokenId: null
  fechaEmision: string | null
  fechaVencimiento: string | null
  propietarioNombre: string | null
  inspector: string | null
  fechaCIT: string | null
}

export interface BicicletaGaraje {
  id: string
  numeroSerie: string
  marca: string
  modelo: string
  anio: number | null
  tipo: string | null
  creadaEn: string
  cit: CitGaraje | null
  alerta: string | null
}

const PROXIMO_A_VENCER_DIAS = 60

function mapCit(row: GarajeRow): CitGaraje | null {
  if (!row.cit_id) {
    return null
  }
  return {
    id: row.cit_id,
    numeroCIT: row.numero_cit,
    estado: row.cit_estado ?? 'BORRADOR',
    puntosTotal: row.puntos,
    fotosCount: row.fotos?.length ?? 0,
    hashSHA256: row.hash_sha256,
    nftTokenId: null,
    fechaEmision: row.fecha_emision,
    fechaVencimiento: row.fecha_vencimiento,
    propietarioNombre: row.propietario_nombre,
    inspector: row.inspector_nombre,
    fechaCIT: row.cit_creada,
  }
}

function calcularAlerta(cit: CitGaraje | null): string | null {
  if (!cit || !cit.fechaVencimiento || cit.estado !== 'ACTIVO') {
    return null
  }
  const dias = Math.ceil(
    (new Date(cit.fechaVencimiento).getTime() - Date.now()) / 86_400_000
  )
  if (dias <= 0) {
    return 'CIT vencido — renovación requerida'
  }
  if (dias < PROXIMO_A_VENCER_DIAS) {
    return `El CIT vence en ${dias} días`
  }
  return null
}

function mapBicicleta(row: GarajeRow): BicicletaGaraje {
  const cit = mapCit(row)
  return {
    id: row.id,
    numeroSerie: row.numero_serie,
    marca: row.marca,
    modelo: row.modelo,
    anio: row.anio,
    tipo: row.tipo,
    creadaEn: row.bici_creada,
    cit,
    alerta: calcularAlerta(cit),
  }
}

export interface GarajeResumen {
  total_bicicletas: number
  cits_activos: number
  cits_borrador: number
  cits_pago_pendiente: number
  proximos_a_vencer: number
}

function construirResumen(bicicletas: BicicletaGaraje[]): GarajeResumen {
  let activos = 0
  let borrador = 0
  let pagoPendiente = 0
  let proximos = 0

  for (const bici of bicicletas) {
    const estado = bici.cit?.estado
    if (estado === 'ACTIVO') {
      activos += 1
    } else if (estado === 'BORRADOR') {
      borrador += 1
    } else if (estado === 'PAGO_PENDIENTE') {
      pagoPendiente += 1
    }
    if (bici.alerta && bici.cit?.estado === 'ACTIVO') {
      const dias = bici.cit.fechaVencimiento
        ? Math.ceil((new Date(bici.cit.fechaVencimiento).getTime() - Date.now()) / 86_400_000)
        : null
      if (dias !== null && dias > 0 && dias < PROXIMO_A_VENCER_DIAS) {
        proximos += 1
      }
    }
  }

  return {
    total_bicicletas: bicicletas.length,
    cits_activos: activos,
    cits_borrador: borrador,
    cits_pago_pendiente: pagoPendiente,
    proximos_a_vencer: proximos,
  }
}

/** Garaje completo del propietario: rodados con su CIT más reciente + resumen. */
export async function listarGaraje(propietarioId: string): Promise<{
  bicicletas: BicicletaGaraje[]
  resumen: GarajeResumen
}> {
  const pool = getPool()
  const { rows } = await pool.query<GarajeRow>(
    `${GARAJE_SELECT}
      WHERE b.propietario_id = $1
      ORDER BY b.created_at DESC`,
    [propietarioId]
  )
  const bicicletas = rows.map(mapBicicleta)
  return { bicicletas, resumen: construirResumen(bicicletas) }
}

export interface CitHistorial {
  id: string
  numeroCIT: string | null
  estado: string
  puntosTotal: number | null
  hashSHA256: string | null
  fechaEmision: string | null
  fechaVencimiento: string | null
  inspector: string | null
  emitidoEn: string | null
}

interface HistorialRow {
  id: string
  numero_cit: string | null
  estado: string
  puntos: number | null
  hash_sha256: string | null
  fecha_emision: string | null
  fecha_vencimiento: string | null
  created_at: string
  inspector_nombre: string | null
}

/** Detalle de un rodado propio + historial de hasta 10 CITs. */
export async function detalleBicicleta(
  propietarioId: string,
  bicicletaId: string
): Promise<{ bicicleta: BicicletaGaraje; historial: CitHistorial[] }> {
  if (!UUID_RE.test(bicicletaId)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'El id de bicicleta debe ser un UUID válido.')
  }

  const pool = getPool()
  const { rows } = await pool.query<GarajeRow>(
    `${GARAJE_SELECT}
      WHERE b.id = $1 AND b.propietario_id = $2
      LIMIT 1`,
    [bicicletaId, propietarioId]
  )
  const row = rows[0]
  if (!row) {
    throw new ApiError(404, 'BICICLETA_NO_ENCONTRADA', 'No se encontró el rodado en tu garaje.')
  }

  const historial = await pool.query<HistorialRow>(
    `SELECT c.id, c.numero_cit, c.estado, c.puntos, c.hash_sha256,
            c.fecha_emision, c.fecha_vencimiento, c.created_at,
            iu.nombre AS inspector_nombre
       FROM cits c
       LEFT JOIN inspectores i ON i.id = c.inspector_id
       LEFT JOIN usuarios iu   ON iu.id = i.usuario_id
      WHERE c.bicicleta_id = $1
      ORDER BY c.created_at DESC
      LIMIT 10`,
    [bicicletaId]
  )

  return {
    bicicleta: mapBicicleta(row),
    historial: historial.rows.map((h: HistorialRow) => ({
      id: h.id,
      numeroCIT: h.numero_cit,
      estado: h.estado,
      puntosTotal: h.puntos,
      hashSHA256: h.hash_sha256,
      fechaEmision: h.fecha_emision,
      fechaVencimiento: h.fecha_vencimiento,
      inspector: h.inspector_nombre,
      emitidoEn: h.created_at,
    })),
  }
}
