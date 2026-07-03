import { getPool } from '@/lib/marketplace'
import { MENDOZA_BBOX, MENDOZA_CENTRO } from '@/src/services/analytics.service'

/**
 * RODAID — Hito 14: Garaje Digital (hub central del usuario).
 *
 * Concentra la lectura CONSOLIDADA del estado de cada activo del usuario y la
 * analitica personal del Garaje. Es la capa de datos del dashboard "Mi Garaje
 * Digital": deja a los endpoints como cascarones finos y reune en un solo lugar
 * las consultas que cruzan CIT, anclaje en la BFA, pipeline de 72hs, actas de
 * inspeccion firmadas y publicaciones del marketplace.
 *
 * PRIVACIDAD POR DISENO (restriccion del hito):
 *   - El mapa de calor PERSONAL no expone jamas una coordenada exacta. Reusa el
 *     geo ya RECORTADO a nivel barrio que guarda el verificador publico (centro
 *     de celda; la coordenada original se descarto al escribir). Ademas aplica
 *     k-anonimato (suprime celdas con muy pocos eventos) para que un unico evento
 *     —que podria caer cerca del domicilio del usuario— nunca quede aislado en el
 *     mapa. No se exponen rutas ni eventos sueltos: solo densidad agregada.
 */

// ---------------------------------------------------------------------------
// Estado consolidado de cada activo (bicicleta) del usuario
// ---------------------------------------------------------------------------

/** Estado de verificacion resumido para la tarjeta del activo. */
export type EstadoActivo =
  | 'verificado' // CIT activo y vigente
  | 'bloqueado' // CIT bloqueado (denuncia / cross-reference con alerta)
  | 'pendiente' // en el pipeline de 72hs (PENDIENTE / EN_PROCESO)
  | 'rechazado' // CIT rechazado
  | 'vencido' // CIT activo pero vencido (debe renovarse)
  | 'sin_verificar' // sin CIT todavia

export interface AnclajeBfa {
  estado: string
  txHash: string | null
  tokenId: string | null
  ancladoEn: string | null
}

export interface ActaFirmada {
  id: string
  resultado: 'APROBADA' | 'DISCREPANCIA'
  firmada: boolean
  algoritmo: string | null
  certSerie: string | null
  modo: string | null
  tallerNombre: string | null
  creadoEn: string
}

/** Estado del job del pipeline de validacion de 72hs (para el real-time). */
export interface EstadoPipeline {
  estado: 'PENDIENTE' | 'EN_PROCESO' | 'APROBADO' | 'BLOQUEADO' | 'ERROR'
  /** Momento en que el worker procesara el job (fin de la ventana de 72hs). */
  ejecutarEn: string | null
  resultado: string | null
  creadoEn: string
}

export interface ActivoGaraje {
  id: string
  marca: string
  modelo: string
  numeroSerie: string
  tipo: string
  anio: number | null
  color: string | null
  fotoUrl: string | null
  rodado: number | null
  talleCuadro: string | null
  creadoEn: string

  /** Estado resumido para la UI (semaforo del activo). */
  estado: EstadoActivo

  citId: string | null
  citEstado: string | null
  codigoCit: string | null
  /** Huella SHA-256 anclada del CIT (la que viaja a la BFA). */
  hashSha256: string | null
  citVencimiento: string | null
  citActivo: boolean

  /** Anclaje on-chain del CIT en la Blockchain Federal Argentina. */
  bfa: AnclajeBfa | null

  /** Estado en vivo del pipeline de 72hs (null si nunca se encolo). */
  pipeline: EstadoPipeline | null

  /** Actas de inspeccion fisica firmadas (Hito 6/11). */
  actas: ActaFirmada[]

  tienePublicacionActiva: boolean
  publicacionSlug: string | null
}

interface ActivoRow {
  id: string
  marca: string
  modelo: string
  numero_serie: string
  tipo: string
  anio: number | null
  color: string | null
  foto_url: string | null
  rodado: string | null
  talle_cuadro: string | null
  created_at: string
  cit_id: string | null
  cit_estado: string | null
  codigo_cit: string | null
  hash_sha256: string | null
  cit_vencimiento: string | null
  cit_activo: boolean
  bfa_estado: string | null
  bfa_tx_hash: string | null
  bfa_token_id: string | null
  bfa_anclado_en: string | null
  job_estado: EstadoPipeline['estado'] | null
  job_ejecutar_en: string | null
  job_resultado: string | null
  job_creado_en: string | null
  tiene_publicacion_activa: boolean
  publicacion_slug: string | null
}

interface ActaRow {
  bicicleta_id: string
  id: string
  resultado: 'APROBADA' | 'DISCREPANCIA'
  firmada: boolean
  firma_algoritmo: string | null
  firma_cert_serie: string | null
  firma_modo: string | null
  taller_nombre: string | null
  created_at: string
}

function derivarEstado(row: ActivoRow): EstadoActivo {
  if (!row.cit_id || !row.cit_estado) return 'sin_verificar'
  if (row.cit_estado === 'bloqueado') return 'bloqueado'
  if (row.cit_estado === 'rechazado') return 'rechazado'
  if (row.cit_activo) return 'verificado'
  // CIT pendiente: si el pipeline ya resolvio pero el CIT aun no se reflejo, o
  // simplemente esta esperando la ventana, lo mostramos como pendiente.
  if (row.cit_estado === 'activo') return 'vencido' // activo pero no vigente
  return 'pendiente'
}

/**
 * Estado consolidado de todas las bicicletas del usuario: CIT, huella anclada en
 * la BFA, estado del pipeline de 72hs, actas firmadas y publicaciones. Es la
 * fuente de verdad del dashboard del Garaje Digital y del polling de tiempo real.
 */
export async function obtenerActivosUsuario(
  userId: string
): Promise<ActivoGaraje[]> {
  const pool = getPool()

  const result = await pool.query<ActivoRow>(
    `
      SELECT
        b.id, b.marca, b.modelo, b.numero_serie, b.tipo, b.anio, b.color,
        b.foto_url, b.rodado, b.talle_cuadro, b.created_at,
        c.id AS cit_id,
        c.estado AS cit_estado,
        NULL AS codigo_cit,
        c.huella_sha256 AS hash_sha256,
        c.fecha_vencimiento AS cit_vencimiento,
        COALESCE(c.estado = 'activo' AND c.fecha_vencimiento > NOW(), FALSE) AS cit_activo,
        c.bfa_estado, c.bfa_tx_hash, c.bfa_token_id, c.bfa_anclado_en,
        job.estado AS job_estado,
        job.ejecutar_en AS job_ejecutar_en,
        job.resultado AS job_resultado,
        job.created_at AS job_creado_en,
        EXISTS (
          SELECT 1 FROM marketplace_publicaciones mp
          WHERE mp.bicicleta_id = b.id AND mp.estado IN ('ACTIVA', 'PAUSADA')
        ) AS tiene_publicacion_activa,
        pub.slug AS publicacion_slug
      FROM bicicletas b
      LEFT JOIN LATERAL (
        SELECT *
        FROM cits
        WHERE cits.bicicleta_id = b.id
        ORDER BY
          CASE estado
            WHEN 'bloqueado' THEN 0
            WHEN 'activo' THEN 1
            WHEN 'pendiente' THEN 2
            ELSE 3
          END,
          acunado_en DESC
        LIMIT 1
      ) c ON TRUE
      LEFT JOIN LATERAL (
        SELECT estado, ejecutar_en, resultado, created_at
        FROM cola_validaciones
        WHERE cola_validaciones.cit_id = c.id
        ORDER BY created_at DESC
        LIMIT 1
      ) job ON c.id IS NOT NULL
      LEFT JOIN LATERAL (
        SELECT slug
        FROM marketplace_publicaciones mp
        WHERE mp.bicicleta_id = b.id AND mp.estado IN ('ACTIVA', 'PAUSADA')
        ORDER BY mp.publicado_en DESC
        LIMIT 1
      ) pub ON TRUE
      WHERE b.propietario_id = $1
      ORDER BY b.created_at DESC
    `,
    [userId]
  )

  const activos = result.rows.map((row: ActivoRow): ActivoGaraje => ({
    id: row.id,
    marca: row.marca,
    modelo: row.modelo,
    numeroSerie: row.numero_serie,
    tipo: row.tipo,
    anio: row.anio,
    color: row.color,
    fotoUrl: row.foto_url,
    rodado: row.rodado === null ? null : Number(row.rodado),
    talleCuadro: row.talle_cuadro,
    creadoEn: row.created_at,
    estado: derivarEstado(row),
    citId: row.cit_id,
    citEstado: row.cit_estado,
    codigoCit: row.codigo_cit,
    hashSha256: row.hash_sha256,
    citVencimiento: row.cit_vencimiento,
    citActivo: row.cit_activo,
    bfa: row.cit_id
      ? {
          estado: row.bfa_estado ?? 'pendiente',
          txHash: row.bfa_tx_hash,
          tokenId: row.bfa_token_id,
          ancladoEn: row.bfa_anclado_en,
        }
      : null,
    pipeline: row.job_estado
      ? {
          estado: row.job_estado,
          ejecutarEn: row.job_ejecutar_en,
          resultado: row.job_resultado,
          creadoEn: row.job_creado_en ?? row.created_at,
        }
      : null,
    actas: [],
    tienePublicacionActiva: row.tiene_publicacion_activa,
    publicacionSlug: row.publicacion_slug,
  }))

  if (activos.length === 0) return activos

  // Actas de inspeccion firmadas de TODAS las bicis del usuario (una sola query).
  const ids = activos.map((a: ActivoGaraje) => a.id)
  const actasRes = await pool.query<ActaRow>(
    `
      SELECT
        i.bicicleta_id,
        i.id,
        i.resultado,
        (i.firma_valor IS NOT NULL) AS firmada,
        i.firma_algoritmo,
        i.firma_cert_serie,
        i.firma_modo,
        a.nombre AS taller_nombre,
        i.created_at
      FROM inspecciones_fisicas i
      LEFT JOIN aliados a ON a.id = i.taller_id
      WHERE i.bicicleta_id = ANY($1::uuid[])
      ORDER BY i.created_at DESC
    `,
    [ids]
  )

  const porBici = new Map<string, ActaFirmada[]>()
  for (const r of actasRes.rows) {
    const lista = porBici.get(r.bicicleta_id) ?? []
    lista.push({
      id: r.id,
      resultado: r.resultado,
      firmada: r.firmada,
      algoritmo: r.firma_algoritmo,
      certSerie: r.firma_cert_serie,
      modo: r.firma_modo,
      tallerNombre: r.taller_nombre,
      creadoEn: r.created_at,
    })
    porBici.set(r.bicicleta_id, lista)
  }
  for (const a of activos) {
    a.actas = porBici.get(a.id) ?? []
  }

  return activos
}

// ---------------------------------------------------------------------------
// Mis publicaciones (gestion de venta)
// ---------------------------------------------------------------------------

export interface MiPublicacion {
  id: string
  slug: string
  titulo: string
  estado: string
  precioARS: number
  precioUSD: number | null
  fotoUrl: string | null
  vistas: number
  contactos: number
  publicadoEn: string
  venceEn: string
  vendidoEn: string | null
  bicicleta: {
    marca: string | null
    modelo: string | null
    numeroSerie: string | null
    tipo: string | null
  }
  /** Transaccion de escrow viva sobre la publicacion (RODAID PAY), si existe. */
  transaccion: {
    id: string
    estado: string
    precioARS: number
    montoVendedor: number
    comisionRodaid: number
  } | null
}

interface PublicacionRow {
  id: string
  slug: string
  titulo: string
  estado: string
  precio_ars: string
  precio_usd: string | null
  fotos_urls: string[]
  vistas: number
  contactos: number
  publicado_en: string
  vence_en: string
  vendido_en: string | null
  marca: string | null
  modelo: string | null
  numero_serie: string | null
  tipo: string | null
  tx_id: string | null
  tx_estado: string | null
  tx_precio: string | null
  tx_monto_vendedor: string | null
  tx_comision: string | null
}

/**
 * Publicaciones del usuario como VENDEDOR, con la transaccion de escrow viva
 * asociada (gestion de venta). No expone datos del comprador: solo el estado de
 * la operacion para que el vendedor sepa donde esta cada venta.
 */
export async function obtenerMisPublicaciones(
  userId: string
): Promise<MiPublicacion[]> {
  const pool = getPool()
  const res = await pool.query<PublicacionRow>(
    `
      SELECT
        mp.id, mp.slug, mp.titulo, mp.estado,
        mp.precio_ars, mp.precio_usd, mp.fotos_urls,
        mp.vistas, mp.contactos, mp.publicado_en, mp.vence_en, mp.vendido_en,
        b.marca, b.modelo, b.numero_serie, b.tipo,
        tx.id AS tx_id,
        tx.estado AS tx_estado,
        tx.precio_ars AS tx_precio,
        tx.monto_vendedor AS tx_monto_vendedor,
        tx.comision_rodaid AS tx_comision
      FROM marketplace_publicaciones mp
      INNER JOIN bicicletas b ON b.id = mp.bicicleta_id
      LEFT JOIN LATERAL (
        SELECT id, estado, precio_ars, monto_vendedor, comision_rodaid
        FROM escrow_transacciones et
        WHERE et.publicacion_id = mp.id
        ORDER BY
          CASE
            WHEN et.estado IN ('DEPOSITO_PENDIENTE','FONDOS_RETENIDOS','EN_CAMINO','DISPUTADA') THEN 0
            ELSE 1
          END,
          et.created_at DESC
        LIMIT 1
      ) tx ON TRUE
      WHERE mp.vendedor_id = $1
      ORDER BY mp.publicado_en DESC
    `,
    [userId]
  )

  return res.rows.map((row: PublicacionRow): MiPublicacion => ({
    id: row.id,
    slug: row.slug,
    titulo: row.titulo,
    estado: row.estado,
    precioARS: Number(row.precio_ars),
    precioUSD: row.precio_usd === null ? null : Number(row.precio_usd),
    fotoUrl: row.fotos_urls?.[0] ?? null,
    vistas: row.vistas,
    contactos: row.contactos,
    publicadoEn: row.publicado_en,
    venceEn: row.vence_en,
    vendidoEn: row.vendido_en,
    bicicleta: {
      marca: row.marca,
      modelo: row.modelo,
      numeroSerie: row.numero_serie,
      tipo: row.tipo,
    },
    transaccion: row.tx_id
      ? {
          id: row.tx_id,
          estado: row.tx_estado ?? 'DESCONOCIDO',
          precioARS: Number(row.tx_precio ?? 0),
          montoVendedor: Number(row.tx_monto_vendedor ?? 0),
          comisionRodaid: Number(row.tx_comision ?? 0),
        }
      : null,
  }))
}

// ---------------------------------------------------------------------------
// Analitica personal del Garaje (metricas + mapa de calor personal)
// ---------------------------------------------------------------------------

export interface MetricasGaraje {
  totalBicis: number
  verificadas: number
  enProceso: number
  bloqueadas: number
  sinVerificar: number
  actasFirmadas: number
  certificadosDisponibles: number
  publicacionesActivas: number
  /** Consultas del verificador publico sobre las bicis del usuario (uso). */
  verificacionesRecibidas: number
  /** Consultas en los ultimos 30 dias (tendencia de uso reciente). */
  verificacionesUltimos30: number
  ultimaVerificacion: string | null
}

export interface PuntoCalorPersonal {
  celda: string
  lat: number
  lon: number
  zona: string
  ciudad: string
  total: number
  intensidad: number
}

export interface AnaliticaPersonal {
  metricas: MetricasGaraje
  mapa: {
    centro: { lat: number; lon: number }
    bbox: typeof MENDOZA_BBOX
    gridDeg: number
    puntos: PuntoCalorPersonal[]
    /** Celdas con muy pocos eventos, suprimidas por k-anonimato (privacidad). */
    suprimidasPorKAnon: number
    generadoEn: string
  }
}

/**
 * Minimo de eventos por celda para incluirla en el mapa PERSONAL (k-anonimato).
 * Mas estricto que el mapa publico: un evento aislado podria caer cerca del
 * domicilio del usuario, asi que por defecto se exige al menos 2.
 */
function kAnonPersonal(): number {
  const v = Number(process.env.GARAJE_MAPA_KANON_MIN)
  return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 2
}

function gridDegPersonal(): number {
  const v = Number(process.env.ANALITICA_GRID_DEG)
  return Number.isFinite(v) && v > 0 ? v : 0.0045
}

function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5
}

interface CeldaPersonalRow {
  geo_celda: string
  geo_lat: string | null
  geo_lon: string | null
  geo_zona: string | null
  geo_ciudad: string | null
  total: string
}

/**
 * Analitica personal del Garaje: metricas de mantenimiento/uso y el mapa de calor
 * PERSONAL (donde fueron verificadas/auditadas las bicis del usuario), recortado
 * a barrio y agregado con k-anonimato. Nunca expone una coordenada exacta.
 */
export async function obtenerAnaliticaPersonal(
  userId: string
): Promise<AnaliticaPersonal> {
  const pool = getPool()

  // Ids de las bicis del usuario (acotan TODAS las consultas a sus activos).
  const bicisRes = await pool.query<{ id: string }>(
    `SELECT id FROM bicicletas WHERE propietario_id = $1`,
    [userId]
  )
  const bicisIds = bicisRes.rows.map((r: { id: string }) => r.id)

  const kMin = kAnonPersonal()
  const grid = gridDegPersonal()

  if (bicisIds.length === 0) {
    return {
      metricas: {
        totalBicis: 0,
        verificadas: 0,
        enProceso: 0,
        bloqueadas: 0,
        sinVerificar: 0,
        actasFirmadas: 0,
        certificadosDisponibles: 0,
        publicacionesActivas: 0,
        verificacionesRecibidas: 0,
        verificacionesUltimos30: 0,
        ultimaVerificacion: null,
      },
      mapa: {
        centro: { ...MENDOZA_CENTRO },
        bbox: MENDOZA_BBOX,
        gridDeg: grid,
        puntos: [],
        suprimidasPorKAnon: 0,
        generadoEn: new Date().toISOString(),
      },
    }
  }

  const [estados, actas, publicaciones, consultas, mapaRes, suprimidasRes] =
    await Promise.all([
      // Estado de verificacion por bici (CIT mas relevante).
      pool.query<{
        verificadas: string
        bloqueadas: string
        en_proceso: string
        sin_verificar: string
      }>(
        `
          WITH cit_relevante AS (
            SELECT DISTINCT ON (b.id)
              b.id AS bici_id,
              c.estado AS cit_estado,
              (c.estado = 'activo' AND c.fecha_vencimiento > NOW()) AS activo_vigente
            FROM bicicletas b
            LEFT JOIN cits c ON c.bicicleta_id = b.id
            WHERE b.propietario_id = $1
            ORDER BY b.id,
              CASE c.estado
                WHEN 'bloqueado' THEN 0 WHEN 'activo' THEN 1
                WHEN 'pendiente' THEN 2 ELSE 3 END,
              acunado_en DESC
          )
          SELECT
            COUNT(*) FILTER (WHERE activo_vigente) AS verificadas,
            COUNT(*) FILTER (WHERE cit_estado = 'bloqueado') AS bloqueadas,
            COUNT(*) FILTER (WHERE cit_estado = 'pendiente') AS en_proceso,
            COUNT(*) FILTER (WHERE cit_estado IS NULL) AS sin_verificar
          FROM cit_relevante
        `,
        [userId]
      ),
      pool.query<{ total: string }>(
        `SELECT COUNT(*) AS total FROM inspecciones_fisicas
         WHERE bicicleta_id = ANY($1::uuid[]) AND firma_valor IS NOT NULL`,
        [bicisIds]
      ),
      pool.query<{ total: string }>(
        `SELECT COUNT(*) AS total FROM marketplace_publicaciones
         WHERE vendedor_id = $1 AND estado IN ('ACTIVA','PAUSADA')`,
        [userId]
      ),
      pool.query<{ total: string; ult30: string; ultima: string | null }>(
        `
          SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS ult30,
            MAX(created_at) AS ultima
          FROM logs_verificaciones
          WHERE bicicleta_id = ANY($1::uuid[])
        `,
        [bicisIds]
      ),
      // Mapa de calor personal: densidad por celda (ya recortada a barrio).
      pool.query<CeldaPersonalRow>(
        `
          SELECT
            geo_celda,
            MAX(geo_lat) AS geo_lat,
            MAX(geo_lon) AS geo_lon,
            MAX(geo_zona) AS geo_zona,
            MAX(geo_ciudad) AS geo_ciudad,
            COUNT(*) AS total
          FROM logs_verificaciones
          WHERE bicicleta_id = ANY($1::uuid[])
            AND geo_celda IS NOT NULL
          GROUP BY geo_celda
          HAVING COUNT(*) >= $2
          ORDER BY total DESC
          LIMIT 500
        `,
        [bicisIds, kMin]
      ),
      pool.query<{ n: string }>(
        `
          SELECT COUNT(*) AS n FROM (
            SELECT geo_celda
            FROM logs_verificaciones
            WHERE bicicleta_id = ANY($1::uuid[])
              AND geo_celda IS NOT NULL
            GROUP BY geo_celda
            HAVING COUNT(*) < $2
          ) s
        `,
        [bicisIds, kMin]
      ),
    ])

  const e = estados.rows[0]
  const verificadas = Number(e?.verificadas ?? 0)
  const bloqueadas = Number(e?.bloqueadas ?? 0)
  const enProceso = Number(e?.en_proceso ?? 0)
  const sinVerificar = Number(e?.sin_verificar ?? 0)

  const maxTotal = mapaRes.rows.reduce(
    (m: number, r: CeldaPersonalRow) => Math.max(m, Number(r.total)),
    0
  )
  const puntos: PuntoCalorPersonal[] = mapaRes.rows
    .filter((r: CeldaPersonalRow) => r.geo_lat !== null && r.geo_lon !== null)
    .map((r: CeldaPersonalRow) => {
      const total = Number(r.total)
      return {
        celda: r.geo_celda,
        lat: Number(r.geo_lat),
        lon: Number(r.geo_lon),
        zona: r.geo_zona ?? 'Zona sin identificar',
        ciudad: r.geo_ciudad ?? 'Mendoza',
        total,
        intensidad: maxTotal > 0 ? round5(total / maxTotal) : 0,
      }
    })

  return {
    metricas: {
      totalBicis: bicisIds.length,
      verificadas,
      enProceso,
      bloqueadas,
      sinVerificar,
      actasFirmadas: Number(actas.rows[0]?.total ?? 0),
      certificadosDisponibles: verificadas,
      publicacionesActivas: Number(publicaciones.rows[0]?.total ?? 0),
      verificacionesRecibidas: Number(consultas.rows[0]?.total ?? 0),
      verificacionesUltimos30: Number(consultas.rows[0]?.ult30 ?? 0),
      ultimaVerificacion: consultas.rows[0]?.ultima ?? null,
    },
    mapa: {
      centro: { ...MENDOZA_CENTRO },
      bbox: MENDOZA_BBOX,
      gridDeg: grid,
      puntos,
      suprimidasPorKAnon: Number(suprimidasRes.rows[0]?.n ?? 0),
      generadoEn: new Date().toISOString(),
    },
  }
}
