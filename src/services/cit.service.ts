import { randomUUID } from 'node:crypto'
import { ApiError, getPool, type DbClient } from '@/lib/marketplace'
import {
  CATEGORIAS,
  PUNTOS_PLANOS,
  PUNTOS_KEYS,
  evaluarInspeccion,
  type ResultadosPuntos,
} from '@/lib/cit'

/**
 * RODAID — Servicio del Modulo Inspector (CIT).
 *
 *   getColaTrabajo()       -> bicicletas sin CIT vigente (pendientes de inspeccion)
 *   getTalleres()          -> talleres aliados activos
 *   getResumenHoy()        -> KPIs del dia para el dashboard del inspector
 *   registrarInspeccion()  -> persiste los 20 puntos y gatilla APROBADO | RECHAZADO
 *   getCit()               -> lectura de un CIT con su detalle
 *
 * El CIT ACTIVO y vigente es el requisito que habilita la publicacion en el
 * Marketplace. Aprobacion: minimo 15/20 puntos (Ley 9556, Art. 12).
 */

// Vigencia del CIT aprobado: 12 meses.
const VIGENCIA_MESES = 12

export interface TallerRow {
  id: string
  nombre: string
  localidad: string | null
  provincia: string
  matricula: string | null
}

export interface ColaItem {
  bicicletaId: string
  propietarioId: string
  propietarioNombre: string | null
  numeroSerie: string
  marca: string
  modelo: string
  anio: number | null
  tipo: string | null
  color: string | null
  ultimoCitEstado: string | null
  ultimoCitNumero: string | null
}

async function withTx<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export async function getTalleres(): Promise<TallerRow[]> {
  const res = await getPool().query<TallerRow>(
    `
      SELECT id, nombre, localidad, provincia, matricula
      FROM talleres_aliados
      WHERE activo = TRUE
      ORDER BY nombre ASC
    `
  )
  return res.rows
}

/**
 * Cola de trabajo: bicicletas que NO tienen un CIT ACTIVO. Incluye las nunca
 * inspeccionadas y las que tienen un CIT rechazado o vencido (re-inspeccion).
 */
export async function getColaTrabajo(limite = 50): Promise<ColaItem[]> {
  const res = await getPool().query<{
    id: string
    propietario_id: string
    propietario_nombre: string | null
    numero_serie: string
    marca: string
    modelo: string
    anio: number | null
    tipo: string | null
    color: string | null
    ultimo_cit_estado: string | null
    ultimo_cit_numero: string | null
  }>(
    `
      SELECT
        b.id,
        b.propietario_id,
        b.propietario_nombre,
        b.numero_serie,
        b.marca,
        b.modelo,
        b.anio,
        b.tipo,
        b.color,
        ult.estado AS ultimo_cit_estado,
        ult.numero_cit AS ultimo_cit_numero
      FROM bicicletas b
      LEFT JOIN LATERAL (
        SELECT estado, numero_cit
        FROM cits c
        WHERE c.bicicleta_id = b.id
        ORDER BY c.creado_en DESC
        LIMIT 1
      ) ult ON TRUE
      WHERE NOT EXISTS (
        SELECT 1 FROM cits c2
        WHERE c2.bicicleta_id = b.id AND c2.estado = 'ACTIVO'
      )
      ORDER BY b.creado_en ASC
      LIMIT $1
    `,
    [limite]
  )

  return res.rows.map((row: {
    id: string
    propietario_id: string
    propietario_nombre: string | null
    numero_serie: string
    marca: string
    modelo: string
    anio: number | null
    tipo: string | null
    color: string | null
    ultimo_cit_estado: string | null
    ultimo_cit_numero: string | null
  }) => ({
    bicicletaId: row.id,
    propietarioId: row.propietario_id,
    propietarioNombre: row.propietario_nombre,
    numeroSerie: row.numero_serie,
    marca: row.marca,
    modelo: row.modelo,
    anio: row.anio === null ? null : Number(row.anio),
    tipo: row.tipo,
    color: row.color,
    ultimoCitEstado: row.ultimo_cit_estado,
    ultimoCitNumero: row.ultimo_cit_numero,
  }))
}

export interface ResumenHoy {
  total: number
  aprobados: number
  rechazados: number
}

export async function getResumenHoy(): Promise<ResumenHoy> {
  const res = await getPool().query<{
    total: string
    aprobados: string
    rechazados: string
  }>(
    `
      SELECT
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE estado = 'ACTIVO')::text AS aprobados,
        COUNT(*) FILTER (WHERE estado = 'RECHAZADO')::text AS rechazados
      FROM cits
      WHERE creado_en >= date_trunc('day', NOW())
    `
  )
  const row = res.rows[0]
  return {
    total: Number(row?.total ?? 0),
    aprobados: Number(row?.aprobados ?? 0),
    rechazados: Number(row?.rechazados ?? 0),
  }
}

export interface RegistrarInspeccionInput {
  bicicletaId: string
  tallerId?: string | null
  inspectorId?: string | null
  inspectorNombre: string
  resultados: ResultadosPuntos
  observaciones?: Record<string, string>
  notas?: string | null
  djFirmada: boolean
}

export interface RegistrarInspeccionResultado {
  citId: string
  numeroCIT: string
  estado: 'ACTIVO' | 'RECHAZADO'
  aprobado: boolean
  puntos: number
  puntaje: number
  motivoRechazo: string | null
  criticosFallidos: string[]
  fechaEmision: string | null
  fechaVencimiento: string | null
  bicicleta: { marca: string; modelo: string; numeroSerie: string }
}

/**
 * Registra la inspeccion de los 20 puntos y gatilla el evento del CIT:
 *   >= 15 puntos -> CIT ACTIVO  (Aprobado)  + fecha de emision y vencimiento
 *   <  15 puntos -> CIT RECHAZADO            + motivo
 * Persiste el cabecera del CIT, el detalle de los 20 puntos y el audit trail.
 */
export async function registrarInspeccion(
  input: RegistrarInspeccionInput
): Promise<RegistrarInspeccionResultado> {
  if (!input.djFirmada) {
    throw new ApiError(
      422,
      'DJ_NO_FIRMADA',
      'La declaracion jurada del inspector debe estar firmada.'
    )
  }
  const inspectorNombre = (input.inspectorNombre ?? '').trim()
  if (inspectorNombre.length < 3) {
    throw new ApiError(
      400,
      'INSPECTOR_REQUERIDO',
      'Se requiere el nombre del inspector que firma la inspeccion.'
    )
  }

  // Normalizar los resultados al universo de los 20 puntos conocidos.
  const resultados: ResultadosPuntos = {}
  for (const key of PUNTOS_KEYS) {
    resultados[key] = input.resultados?.[key] === true
  }

  const evaluacion = evaluarInspeccion(resultados)
  const estado: 'ACTIVO' | 'RECHAZADO' = evaluacion.aprobado ? 'ACTIVO' : 'RECHAZADO'
  const observaciones = input.observaciones ?? {}

  return withTx(async (client) => {
    const biciRes = await client.query<{
      id: string
      propietario_id: string
      marca: string
      modelo: string
      numero_serie: string
    }>(
      `
        SELECT id, propietario_id, marca, modelo, numero_serie
        FROM bicicletas
        WHERE id = $1
        FOR UPDATE
      `,
      [input.bicicletaId]
    )
    const bici = biciRes.rows[0]
    if (!bici) {
      throw new ApiError(404, 'BICICLETA_NOT_FOUND', 'La bicicleta no existe.')
    }

    // No permitir una segunda inspeccion mientras haya un CIT vivo.
    const vivo = await client.query<{ numero_cit: string; estado: string }>(
      `
        SELECT numero_cit, estado FROM cits
        WHERE bicicleta_id = $1 AND estado IN ('ACTIVO', 'PENDIENTE')
        LIMIT 1
      `,
      [input.bicicletaId]
    )
    if (vivo.rowCount && vivo.rowCount > 0) {
      throw new ApiError(
        409,
        'CIT_VIVO_EXISTENTE',
        `La bicicleta ya tiene un CIT ${vivo.rows[0].estado} (${vivo.rows[0].numero_cit}).`
      )
    }

    const numeroRes = await client.query<{ numero: string }>(
      `SELECT next_numero_cit() AS numero`
    )
    const numeroCIT = numeroRes.rows[0].numero
    const citId = randomUUID()

    const insertCit = await client.query<{
      fecha_emision: string | null
      fecha_vencimiento: string | null
    }>(
      `
        INSERT INTO cits (
          id, numero_cit, bicicleta_id, propietario_id, inspector_id,
          inspector_nombre, taller_aliado_id, estado, puntos, puntaje,
          dj_firmada, dj_firmada_en, firma_inspector, motivo_rechazo, notas,
          fecha_emision, fecha_vencimiento
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          TRUE, NOW(), $11, $12, $13,
          CASE WHEN $8 = 'ACTIVO' THEN NOW() ELSE NULL END,
          CASE WHEN $8 = 'ACTIVO' THEN NOW() + ($14 || ' months')::interval ELSE NULL END
        )
        RETURNING fecha_emision, fecha_vencimiento
      `,
      [
        citId,
        numeroCIT,
        input.bicicletaId,
        bici.propietario_id,
        input.inspectorId ?? null,
        inspectorNombre,
        input.tallerId ?? null,
        estado,
        evaluacion.puntos,
        evaluacion.puntaje,
        inspectorNombre,
        evaluacion.motivoRechazo,
        input.notas ?? null,
        String(VIGENCIA_MESES),
      ]
    )

    // Detalle de los 20 puntos de control.
    for (const punto of PUNTOS_PLANOS) {
      await client.query(
        `
          INSERT INTO cit_puntos_control
            (cit_id, codigo, categoria, etiqueta, peso, critico, aprobado, observacion, orden)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          citId,
          punto.key,
          punto.categoria,
          punto.label,
          Math.round(punto.peso),
          punto.critico ?? false,
          resultados[punto.key] === true,
          observaciones[punto.key]?.trim() || null,
          punto.orden,
        ]
      )
    }

    // Audit trail: inspeccion registrada + evento de resultado.
    await client.query(
      `
        INSERT INTO cit_eventos (cit_id, tipo, actor_id, actor_rol, metadata)
        VALUES ($1, 'INSPECCION_REGISTRADA', $2, 'inspector', $3::jsonb)
      `,
      [
        citId,
        input.inspectorId ?? null,
        JSON.stringify({
          inspector: inspectorNombre,
          tallerId: input.tallerId ?? null,
          puntos: evaluacion.puntos,
          puntaje: evaluacion.puntaje,
        }),
      ]
    )
    await client.query(
      `
        INSERT INTO cit_eventos (cit_id, tipo, actor_id, actor_rol, metadata)
        VALUES ($1, $2, $3, 'inspector', $4::jsonb)
      `,
      [
        citId,
        evaluacion.aprobado ? 'CIT_APROBADO' : 'CIT_RECHAZADO',
        input.inspectorId ?? null,
        JSON.stringify({
          numeroCIT,
          estado,
          puntos: evaluacion.puntos,
          puntaje: evaluacion.puntaje,
          criticosFallidos: evaluacion.criticosFallidos,
          motivoRechazo: evaluacion.motivoRechazo,
        }),
      ]
    )

    return {
      citId,
      numeroCIT,
      estado,
      aprobado: evaluacion.aprobado,
      puntos: evaluacion.puntos,
      puntaje: evaluacion.puntaje,
      motivoRechazo: evaluacion.motivoRechazo,
      criticosFallidos: evaluacion.criticosFallidos,
      fechaEmision: insertCit.rows[0]?.fecha_emision ?? null,
      fechaVencimiento: insertCit.rows[0]?.fecha_vencimiento ?? null,
      bicicleta: {
        marca: bici.marca,
        modelo: bici.modelo,
        numeroSerie: bici.numero_serie,
      },
    }
  })
}

export interface CitDetalle {
  id: string
  numeroCIT: string
  estado: string
  puntos: number
  puntaje: number
  inspectorNombre: string
  tallerId: string | null
  motivoRechazo: string | null
  notas: string | null
  fechaEmision: string | null
  fechaVencimiento: string | null
  creadoEn: string
  bicicleta: {
    id: string
    marca: string
    modelo: string
    numeroSerie: string
    propietarioId: string
    propietarioNombre: string | null
  }
  puntosControl: Array<{
    codigo: string
    categoria: string
    etiqueta: string
    critico: boolean
    aprobado: boolean
    observacion: string | null
  }>
}

export async function getCit(citId: string): Promise<CitDetalle> {
  const pool = getPool()
  const res = await pool.query(
    `
      SELECT
        c.id, c.numero_cit, c.estado, c.puntos, c.puntaje, c.inspector_nombre,
        c.taller_aliado_id, c.motivo_rechazo, c.notas, c.fecha_emision,
        c.fecha_vencimiento, c.creado_en,
        b.id AS bici_id, b.marca, b.modelo, b.numero_serie,
        b.propietario_id, b.propietario_nombre
      FROM cits c
      INNER JOIN bicicletas b ON b.id = c.bicicleta_id
      WHERE c.id = $1
    `,
    [citId]
  )
  const row = res.rows[0]
  if (!row) {
    throw new ApiError(404, 'CIT_NOT_FOUND', 'El CIT no existe.')
  }

  const puntosRes = await pool.query<{
    codigo: string
    categoria: string
    etiqueta: string
    critico: boolean
    aprobado: boolean
    observacion: string | null
  }>(
    `
      SELECT codigo, categoria, etiqueta, critico, aprobado, observacion
      FROM cit_puntos_control
      WHERE cit_id = $1
      ORDER BY orden ASC, codigo ASC
    `,
    [citId]
  )

  return {
    id: row.id,
    numeroCIT: row.numero_cit,
    estado: row.estado,
    puntos: Number(row.puntos),
    puntaje: Number(row.puntaje),
    inspectorNombre: row.inspector_nombre,
    tallerId: row.taller_aliado_id,
    motivoRechazo: row.motivo_rechazo,
    notas: row.notas,
    fechaEmision: row.fecha_emision,
    fechaVencimiento: row.fecha_vencimiento,
    creadoEn: row.creado_en,
    bicicleta: {
      id: row.bici_id,
      marca: row.marca,
      modelo: row.modelo,
      numeroSerie: row.numero_serie,
      propietarioId: row.propietario_id,
      propietarioNombre: row.propietario_nombre,
    },
    puntosControl: puntosRes.rows.map((p: {
      codigo: string
      categoria: string
      etiqueta: string
      critico: boolean
      aprobado: boolean
      observacion: string | null
    }) => ({
      codigo: p.codigo,
      categoria: p.categoria,
      etiqueta: p.etiqueta,
      critico: p.critico,
      aprobado: p.aprobado,
      observacion: p.observacion,
    })),
  }
}

// Re-export del catalogo para consumidores del servicio.
export { CATEGORIAS }
