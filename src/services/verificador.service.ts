import { ApiError, getPool } from '@/lib/marketplace'

/**
 * RODAID — Verificación pública de CITs.
 *
 * Consulta real contra la base de datos: dado un número de serie (o un número de
 * CIT) ensambla la verificación pública de una bicicleta cruzando `cits`,
 * `bicicletas`, su propietario, y —si el CIT fue emitido por un inspector— el
 * inspector y su taller. En paralelo busca denuncias de robo activas para
 * levantar alertas.
 *
 * Privacidad: el nombre del propietario se ofusca (apellido enmascarado) y el
 * hash del acta se trunca antes de exponerlos públicamente. Cada consulta se
 * audita en `verificaciones_log` (serial, origen, IP, User-Agent, duración) sin
 * que un fallo de auditoría afecte la respuesta.
 *
 * No hay capa de caché Redis (no disponible en Netlify); la verificación
 * consulta siempre la base de datos. `fromCache` se mantiene en el contrato por
 * compatibilidad y es siempre `false`.
 */

export type OrigenVerificacion = 'API' | 'WEB' | 'APP' | 'QR'

export interface VerificacionContexto {
  origen?: OrigenVerificacion
  ip?: string | null
  userAgent?: string | null
}

interface CitRow {
  cit_id: string
  numero_cit: string | null
  estado: string
  fecha_vencimiento: string
  puntos: number | null
  hash_sha256: string | null
  bicicleta_id: string
  marca: string
  modelo: string
  anio: number | null
  tipo: string | null
  numero_serie: string
  propietario_nombre: string | null
  inspector_nombre: string | null
  taller_nombre: string | null
  taller_localidad: string | null
}

const CIT_SELECT = `
  SELECT c.id            AS cit_id,
         c.numero_cit    AS numero_cit,
         c.estado        AS estado,
         c.fecha_vencimiento,
         c.puntos        AS puntos,
         c.hash_sha256   AS hash_sha256,
         b.id            AS bicicleta_id,
         b.marca, b.modelo, b.anio, b.tipo, b.numero_serie,
         pu.nombre       AS propietario_nombre,
         iu.nombre       AS inspector_nombre,
         ta.nombre       AS taller_nombre,
         ta.localidad    AS taller_localidad
    FROM cits c
    JOIN bicicletas b        ON b.id = c.bicicleta_id
    LEFT JOIN usuarios pu    ON pu.id = b.propietario_id
    LEFT JOIN inspectores i  ON i.id = c.inspector_id
    LEFT JOIN usuarios iu    ON iu.id = i.usuario_id
    LEFT JOIN talleres_aliados ta ON ta.id = c.taller_aliado_id
`

/** Enmascara el apellido: "Federico Alejandro De Gea" → "Federico A.**". */
export function ocultarApellido(nombre: string | null | undefined): string | null {
  if (!nombre) {
    return null
  }
  const partes = nombre.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) {
    return null
  }
  if (partes.length === 1) {
    return partes[0]
  }
  const inicial = partes[1][0]?.toUpperCase() ?? ''
  return `${partes[0]} ${inicial}.**`
}

/** Trunca un hash de acta para exposición pública: "0xabcdef…123" → "abcdef…". */
function hashTruncado(hash: string | null): string | null {
  if (!hash) {
    return null
  }
  const limpio = hash.replace(/^0x/i, '')
  return limpio.slice(0, 14) + '…'
}

function estadoLabel(estado: string, vigente: boolean): string {
  if (estado === 'ACTIVO') {
    return vigente ? '✓ Certificado activo y vigente' : '⚠ Certificado activo pero vencido'
  }
  if (estado === 'PENDIENTE') {
    return '⏳ Certificado en validación'
  }
  if (estado === 'REVOCADO') {
    return '✗ Certificado revocado'
  }
  return `Certificado en estado ${estado}`
}

export interface VerificacionPublica {
  serial: string
  numeroCIT: string | null
  estado: string
  estadoLabel: string
  vigente: boolean
  bicicleta: {
    marca: string
    modelo: string
    anio: number | null
    tipo: string | null
  }
  inspeccion: { puntos: number | null; maximo: number; porcentaje: number | null }
  propietario: { nombre: string | null }
  inspector: { nombre: string | null; taller: string | null; localidad: string | null } | null
  integridad: { hash: string | null }
  alertas: string[]
  duracionMs: number
  fromCache: false
}

async function registrarConsulta(input: {
  serial: string | null
  numeroCIT: string | null
  encontrado: boolean
  estado: string | null
  duracionMs: number
  ctx: VerificacionContexto
}): Promise<void> {
  try {
    const pool = getPool()
    await pool.query(
      `INSERT INTO verificaciones_log
         (serial, numero_cit, encontrado, estado_cit, origen, ip, user_agent, duracion_ms, desde_cache)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE)`,
      [
        input.serial,
        input.numeroCIT,
        input.encontrado,
        input.estado,
        input.ctx.origen ?? 'API',
        input.ctx.ip ?? null,
        input.ctx.userAgent ?? null,
        input.duracionMs,
      ]
    )
  } catch (error) {
    // La auditoría nunca debe tumbar una verificación.
    console.error('verificaciones_log insert failed', error)
  }
}

function ensamblar(row: CitRow, alertas: string[], duracionMs: number): VerificacionPublica {
  const vigente =
    row.estado === 'ACTIVO' && new Date(row.fecha_vencimiento).getTime() > Date.now()
  const porcentaje = row.puntos === null ? null : Math.round((row.puntos / 20) * 100)

  return {
    serial: row.numero_serie,
    numeroCIT: row.numero_cit,
    estado: row.estado,
    estadoLabel: estadoLabel(row.estado, vigente),
    vigente,
    bicicleta: {
      marca: row.marca,
      modelo: row.modelo,
      anio: row.anio,
      tipo: row.tipo,
    },
    inspeccion: { puntos: row.puntos, maximo: 20, porcentaje },
    propietario: { nombre: ocultarApellido(row.propietario_nombre) },
    inspector: row.inspector_nombre
      ? {
          nombre: ocultarApellido(row.inspector_nombre),
          taller: row.taller_nombre,
          localidad: row.taller_localidad,
        }
      : null,
    integridad: { hash: hashTruncado(row.hash_sha256) },
    alertas,
    duracionMs,
    fromCache: false,
  }
}

async function denunciasActivas(serial: string): Promise<string[]> {
  const pool = getPool()
  const { rows } = await pool.query<{ motivo: string | null; localidad: string | null }>(
    `SELECT motivo, localidad FROM denuncias_robo
      WHERE numero_serie = $1 AND estado = 'ACTIVA'`,
    [serial]
  )
  return rows.map((r: { motivo: string | null; localidad: string | null }) =>
    `🚨 DENUNCIA DE ROBO ACTIVA${r.localidad ? ` (${r.localidad})` : ''}${r.motivo ? `: ${r.motivo}` : ''}`
  )
}

/** Verifica una bicicleta por su número de serie. */
export async function verificarSerial(
  serialRaw: string,
  ctx: VerificacionContexto = {}
): Promise<VerificacionPublica> {
  const inicio = Date.now()
  const serial = serialRaw.trim()
  if (serial.length === 0) {
    throw new ApiError(400, 'SERIAL_REQUERIDO', 'Debe indicar un número de serie.')
  }

  const pool = getPool()
  // El CIT activo tiene prioridad; si no hay, se muestra el más reciente.
  const [citResult, alertas] = await Promise.all([
    pool.query<CitRow>(
      `${CIT_SELECT}
        WHERE b.numero_serie = $1
        ORDER BY (c.estado = 'ACTIVO') DESC, c.created_at DESC
        LIMIT 1`,
      [serial]
    ),
    denunciasActivas(serial),
  ])

  const row = citResult.rows[0]
  const duracionMs = Date.now() - inicio

  if (!row) {
    await registrarConsulta({
      serial,
      numeroCIT: null,
      encontrado: false,
      estado: null,
      duracionMs,
      ctx,
    })
    throw new ApiError(
      404,
      'CIT_NO_ENCONTRADO',
      `No se encontró ningún CIT para el serial ${serial}.`
    )
  }

  await registrarConsulta({
    serial,
    numeroCIT: row.numero_cit,
    encontrado: true,
    estado: row.estado,
    duracionMs,
    ctx,
  })

  return ensamblar(row, alertas, duracionMs)
}

/** Verifica una bicicleta por su número de CIT (RCIT-2026-00139). */
export async function verificarNumeroCIT(
  numeroRaw: string,
  ctx: VerificacionContexto = {}
): Promise<VerificacionPublica> {
  const inicio = Date.now()
  const numeroCIT = numeroRaw.trim()
  if (numeroCIT.length === 0) {
    throw new ApiError(400, 'NUMERO_CIT_REQUERIDO', 'Debe indicar un número de CIT.')
  }

  const pool = getPool()
  const citResult = await pool.query<CitRow>(
    `${CIT_SELECT}
      WHERE c.numero_cit = $1
      LIMIT 1`,
    [numeroCIT]
  )
  const row = citResult.rows[0]

  if (!row) {
    const duracionMs = Date.now() - inicio
    await registrarConsulta({
      serial: null,
      numeroCIT,
      encontrado: false,
      estado: null,
      duracionMs,
      ctx,
    })
    throw new ApiError(404, 'CIT_NO_ENCONTRADO', `No se encontró el CIT ${numeroCIT}.`)
  }

  const alertas = await denunciasActivas(row.numero_serie)
  const duracionMs = Date.now() - inicio

  await registrarConsulta({
    serial: row.numero_serie,
    numeroCIT: row.numero_cit,
    encontrado: true,
    estado: row.estado,
    duracionMs,
    ctx,
  })

  return ensamblar(row, alertas, duracionMs)
}

/** Analytics de verificaciones para el panel admin (últimos N días). */
export async function verificadorStats(dias = 30) {
  const pool = getPool()
  const [totales, porOrigen, porEstado, recientes] = await Promise.all([
    pool.query<{ total: string; encontradas: string; promedio_ms: string | null }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE encontrado)::text AS encontradas,
              ROUND(AVG(duracion_ms))::text AS promedio_ms
         FROM verificaciones_log
        WHERE creado_en > NOW() - ($1 || ' days')::interval`,
      [String(dias)]
    ),
    pool.query<{ origen: string; total: string }>(
      `SELECT origen, COUNT(*)::text AS total
         FROM verificaciones_log
        WHERE creado_en > NOW() - ($1 || ' days')::interval
        GROUP BY origen ORDER BY COUNT(*) DESC`,
      [String(dias)]
    ),
    pool.query<{ estado_cit: string | null; total: string }>(
      `SELECT estado_cit, COUNT(*)::text AS total
         FROM verificaciones_log
        WHERE creado_en > NOW() - ($1 || ' days')::interval AND encontrado
        GROUP BY estado_cit ORDER BY COUNT(*) DESC`,
      [String(dias)]
    ),
    pool.query<Record<string, unknown>>(
      `SELECT serial, numero_cit, encontrado, estado_cit, origen, duracion_ms, creado_en
         FROM verificaciones_log
        ORDER BY creado_en DESC
        LIMIT 20`
    ),
  ])

  const t = totales.rows[0]
  return {
    ventanaDias: dias,
    total: Number(t?.total ?? 0),
    encontradas: Number(t?.encontradas ?? 0),
    noEncontradas: Number(t?.total ?? 0) - Number(t?.encontradas ?? 0),
    promedioMs: t?.promedio_ms === null || t?.promedio_ms === undefined ? null : Number(t.promedio_ms),
    porOrigen: porOrigen.rows.map((r: { origen: string; total: string }) => ({ origen: r.origen, total: Number(r.total) })),
    porEstado: porEstado.rows.map((r: { estado_cit: string | null; total: string }) => ({ estado: r.estado_cit, total: Number(r.total) })),
    recientes: recientes.rows,
  }
}
