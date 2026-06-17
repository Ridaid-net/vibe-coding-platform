import { createHash } from 'node:crypto'
import { getPool } from '@/lib/marketplace'

/**
 * RODAID — Hito 8: Mapa de Calor y Analitica de Seguridad.
 *
 * Motor de inteligencia urbana. Agrega de forma ANONIMA y AGREGADA dos senales
 * de seguridad sobre la ciudad y las expone como un GeoJSON apto para un mapa de
 * calor:
 *
 *   1. Densidad de CONSULTAS del verificador publico (`logs_verificaciones`):
 *      el "indice de curiosidad" sobre bicis en una zona. Muchas consultas en
 *      un barrio pueden indicar interes inusual (compra/venta, reventa de
 *      unidades robadas).
 *   2. Densidad de DENUNCIAS/discrepancias (`discrepancias_reportadas`): los
 *      puntos rojos del mapa (robos reportados, discrepancias de inspeccion).
 *
 * PRIVACIDAD POR DISENO (restriccion del hito):
 *   - Nunca se procesa ni se expone la ubicacion exacta de una bicicleta ni de
 *     un usuario. La posicion aproximada de cada evento (derivada del geo de la
 *     request, nivel ciudad) se RECORTA (clipping) a una grilla de ~barrio antes
 *     de tocar la base: solo se guarda el CENTRO de la celda. El centro de la
 *     celda es lo unico que viaja al frontend.
 *   - La salida es siempre agregada por celda (conteos), nunca eventos sueltos
 *     con su coordenada original.
 */

// ── Geografia de referencia (Gran Mendoza) ───────────────────────────────────

/** Centro aproximado de la Ciudad de Mendoza (para centrar el mapa). */
export const MENDOZA_CENTRO = { lat: -32.8895, lon: -68.8458 } as const

/**
 * Caja contenedora del Gran Mendoza. Acota el area de interes del dashboard y,
 * en preview, el rango donde se simulan posiciones para ejercitar el mapa.
 */
export const MENDOZA_BBOX = {
  minLat: -33.06,
  maxLat: -32.78,
  minLon: -68.99,
  maxLon: -68.73,
} as const

/**
 * Departamentos/zonas del Gran Mendoza. Se usan como etiqueta LEGIBLE para
 * autoridades no tecnicas (en vez de coordenadas crudas). Cuando el geo real
 * trae una subdivision se usa esa; si no, se deriva de forma estable de la celda.
 */
const ZONAS_MENDOZA = [
  'Ciudad de Mendoza',
  'Godoy Cruz',
  'Guaymallén',
  'Las Heras',
  'Maipú',
  'Luján de Cuyo',
] as const

// ── Configuracion (grilla de clipping y umbrales) ────────────────────────────

/**
 * Tamano de la celda de la grilla, en grados. ~0.0045° ≈ 500 m a la latitud de
 * Mendoza: granularidad de barrio/manzana, suficiente para un mapa de calor y a
 * la vez lo bastante gruesa para no revelar una direccion puntual.
 */
function gridDeg(): number {
  const v = Number(process.env.ANALITICA_GRID_DEG)
  return Number.isFinite(v) && v > 0 ? v : 0.0045
}

/** Umbral critico de consultas por celda/ventana para marcar un "Punto Caliente". */
function hotspotUmbral(): number {
  const v = Number(process.env.ANALITICA_HOTSPOT_UMBRAL)
  return Number.isFinite(v) && v >= 3 ? Math.floor(v) : 12
}

/** Ventana (horas) sobre la que se evalua el volumen de un punto caliente. */
function hotspotVentanaHoras(): number {
  const v = Number(process.env.ANALITICA_HOTSPOT_VENTANA_HORAS)
  return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 72
}

function geoSalt(): string {
  return process.env.JWT_SECRET || process.env.RODAID_ADMIN_TOKEN || 'rodaid-geo-dev'
}

// ── Clipping: recorte de coordenadas a la grilla de barrio ───────────────────

export interface GeoRecortado {
  /** Identificador de celda de la grilla (NO una coordenada): "<latIdx>_<lonIdx>". */
  celda: string
  /** Centro de la celda recortada (lo unico que se persiste/expone). */
  lat: number
  lon: number
  ciudad: string
  zona: string
  /** true si la posicion fue simulada (sin geo real en la request). */
  simulada: boolean
}

function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5
}

/**
 * Recorta (clipping) una coordenada exacta al CENTRO de su celda de grilla. La
 * coordenada original se descarta: jamas se persiste ni se expone. Esta es la
 * tecnica que garantiza que los datos no revelen una direccion puntual.
 */
export function clipCoordenada(
  lat: number,
  lon: number,
  grid = gridDeg()
): { celda: string; lat: number; lon: number } {
  const latIdx = Math.floor(lat / grid)
  const lonIdx = Math.floor(lon / grid)
  const centroLat = (latIdx + 0.5) * grid
  const centroLon = (lonIdx + 0.5) * grid
  return {
    celda: `${latIdx}_${lonIdx}`,
    lat: round5(centroLat),
    lon: round5(centroLon),
  }
}

/** Etiqueta de zona estable a partir de la celda (cuando no hay subdivision real). */
export function zonaDeCelda(celda: string): string {
  const h = createHash('sha256').update(celda).digest()
  return ZONAS_MENDOZA[h[0] % ZONAS_MENDOZA.length]!
}

/**
 * Decodifica el header `x-nf-geo` de Netlify (JSON en base64) con la geolocacion
 * aproximada de la request (nivel ciudad, derivada de la IP). Devuelve null si
 * no esta disponible o no trae coordenadas utilizables.
 */
function leerGeoHeader(req: Request): {
  lat: number
  lon: number
  ciudad: string | null
  zona: string | null
} | null {
  const raw = req.headers.get('x-nf-geo')
  if (!raw) return null
  try {
    const json = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as {
      city?: string
      subdivision?: { name?: string; code?: string }
      latitude?: number
      longitude?: number
    }
    const lat = Number(json.latitude)
    const lon = Number(json.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
    return {
      lat,
      lon,
      ciudad: json.city ?? null,
      zona: json.subdivision?.name ?? null,
    }
  } catch {
    return null
  }
}

/**
 * Posicion SIMULADA, estable y determinista, dentro del Gran Mendoza, derivada
 * de una semilla (p. ej. el hash de IP o el termino consultado). Permite
 * ejercitar el mapa de calor de punta a punta en preview, sin geo real, igual
 * que el resto de los modos simulados del proyecto. Nunca corresponde a una
 * ubicacion real de nadie.
 */
function posicionSimulada(seed: string): { lat: number; lon: number } {
  const h = createHash('sha256').update(`${geoSalt()}:${seed}`).digest('hex')
  const a = parseInt(h.slice(0, 8), 16) / 0xffffffff
  const b = parseInt(h.slice(8, 16), 16) / 0xffffffff
  // Sesgo leve hacia el centro para que el mapa luzca como una ciudad real.
  const bias = (x: number) => (x + (parseInt(h.slice(16, 24), 16) / 0xffffffff)) / 2
  const lat =
    MENDOZA_BBOX.minLat + bias(a) * (MENDOZA_BBOX.maxLat - MENDOZA_BBOX.minLat)
  const lon =
    MENDOZA_BBOX.minLon + bias(b) * (MENDOZA_BBOX.maxLon - MENDOZA_BBOX.minLon)
  return { lat, lon }
}

/**
 * Resuelve el geo RECORTADO de una request para la analitica. Usa el geo real de
 * Netlify si esta disponible; si no, simula una posicion estable dentro de
 * Mendoza a partir de `seed`. En ambos casos recorta a la grilla de barrio antes
 * de devolver (la coordenada exacta nunca sale de esta funcion).
 */
export function resolverGeoRecortado(req: Request, seed: string): GeoRecortado {
  const real = leerGeoHeader(req)
  const simulada = !real
  const punto = real ?? posicionSimulada(seed)
  const clip = clipCoordenada(punto.lat, punto.lon)
  const ciudad = real?.ciudad ?? 'Mendoza'
  const zona = real?.zona ?? zonaDeCelda(clip.celda)
  return {
    celda: clip.celda,
    lat: clip.lat,
    lon: clip.lon,
    ciudad,
    zona,
    simulada,
  }
}

// ── Registro de denuncias/discrepancias geolocalizadas ───────────────────────

export type DiscrepanciaTipo = 'discrepancia' | 'robo' | 'sospecha'

export interface RegistroDiscrepancia {
  tipo: DiscrepanciaTipo
  geo: GeoRecortado | null
  bicicletaId?: string | null
  citId?: string | null
  inspeccionId?: string | null
  detalle?: string | null
}

/**
 * Asienta una denuncia/discrepancia geolocalizada (anonima, recortada a barrio)
 * en `discrepancias_reportadas`. Best-effort: nunca tira abajo la operacion de
 * negocio que la dispara.
 */
export async function registrarDiscrepancia(
  reg: RegistroDiscrepancia
): Promise<void> {
  try {
    const g = reg.geo
    await getPool().query(
      `
        INSERT INTO discrepancias_reportadas
          (tipo, bicicleta_id, cit_id, inspeccion_id,
           geo_celda, geo_lat, geo_lon, geo_ciudad, geo_zona, geo_simulada,
           detalle)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        reg.tipo,
        reg.bicicletaId ?? null,
        reg.citId ?? null,
        reg.inspeccionId ?? null,
        g?.celda ?? null,
        g?.lat ?? null,
        g?.lon ?? null,
        g?.ciudad ?? null,
        g?.zona ?? null,
        g?.simulada ?? false,
        reg.detalle ? reg.detalle.slice(0, 300) : null,
      ]
    )
  } catch (error) {
    console.error('[analytics] no se pudo registrar la discrepancia', error)
  }
}

// ── Mapa de calor (GeoJSON) ──────────────────────────────────────────────────

export type CapaMapa = 'consultas' | 'denuncias'

export interface MapaCalorFeatureProps {
  capa: CapaMapa
  celda: string
  zona: string
  ciudad: string
  /** Conteo de eventos en la celda dentro de la ventana. */
  total: number
  /** Intensidad normalizada 0..1 respecto del maximo de la capa (para el heat). */
  intensidad: number
  /** Solo en consultas: IPs (hash) distintas y seriales distintos consultados. */
  consultantesDistintos?: number
  seriesDistintas?: number
}

export interface GeoJSONFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: MapaCalorFeatureProps
}

export interface MapaCalorGeoJSON {
  type: 'FeatureCollection'
  features: GeoJSONFeature[]
  metadata: {
    ciudad: string
    centro: { lat: number; lon: number }
    bbox: typeof MENDOZA_BBOX
    dias: number
    gridDeg: number
    generadoEn: string
    totales: {
      consultas: number
      denuncias: number
      celdasConsultas: number
      celdasDenuncias: number
    }
    /** Celdas con muy pocos eventos suprimidas por k-anonimato (si aplica). */
    suprimidasPorKAnon: number
  }
}

interface CeldaConsultaRow {
  geo_celda: string
  geo_lat: string
  geo_lon: string
  geo_zona: string | null
  geo_ciudad: string | null
  total: string
  consultantes: string
  series: string
}

interface CeldaDenunciaRow {
  geo_celda: string
  geo_lat: string
  geo_lon: string
  geo_zona: string | null
  geo_ciudad: string | null
  total: string
}

/**
 * Minimo de eventos por celda en la capa de consultas para incluirla en el mapa
 * (k-anonimato). Refuerza el caracter agregado: una celda con un unico evento no
 * se publica. Las denuncias se muestran siempre (ya estan recortadas a barrio).
 */
function kAnonConsultas(): number {
  const v = Number(process.env.ANALITICA_KANON_MIN)
  return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1
}

function feature(
  lat: number,
  lon: number,
  props: MapaCalorFeatureProps
): GeoJSONFeature {
  // GeoJSON usa [lon, lat].
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [round5(lon), round5(lat)] },
    properties: props,
  }
}

/**
 * Construye el GeoJSON del mapa de calor para una ventana de `dias`. Agrega por
 * celda recortada y devuelve dos capas de puntos (consultas y denuncias) con su
 * intensidad normalizada. No expone jamas eventos sueltos ni coordenadas reales.
 */
export async function construirMapaCalor(opts: {
  dias: number
}): Promise<MapaCalorGeoJSON> {
  const dias = clampDias(opts.dias)
  const pool = getPool()
  const kMin = kAnonConsultas()

  const [consultasRes, denunciasRes] = await Promise.all([
    pool.query<CeldaConsultaRow>(
      `
        SELECT
          geo_celda,
          MAX(geo_lat) AS geo_lat,
          MAX(geo_lon) AS geo_lon,
          MAX(geo_zona) AS geo_zona,
          MAX(geo_ciudad) AS geo_ciudad,
          COUNT(*) AS total,
          COUNT(DISTINCT ip_hash) AS consultantes,
          COUNT(DISTINCT consulta) AS series
        FROM logs_verificaciones
        WHERE geo_celda IS NOT NULL
          AND created_at >= NOW() - ($1 || ' days')::interval
        GROUP BY geo_celda
        HAVING COUNT(*) >= $2
        ORDER BY total DESC
        LIMIT 2000
      `,
      [String(dias), kMin]
    ),
    pool.query<CeldaDenunciaRow>(
      `
        SELECT
          geo_celda,
          MAX(geo_lat) AS geo_lat,
          MAX(geo_lon) AS geo_lon,
          MAX(geo_zona) AS geo_zona,
          MAX(geo_ciudad) AS geo_ciudad,
          COUNT(*) AS total
        FROM discrepancias_reportadas
        WHERE geo_celda IS NOT NULL
          AND created_at >= NOW() - ($1 || ' days')::interval
        GROUP BY geo_celda
        ORDER BY total DESC
        LIMIT 2000
      `,
      [String(dias)]
    ),
  ])

  // Conteo de celdas suprimidas por k-anonimato (solo informativo).
  let suprimidas = 0
  if (kMin > 1) {
    const sup = await pool.query<{ n: string }>(
      `
        SELECT COUNT(*) AS n FROM (
          SELECT geo_celda
          FROM logs_verificaciones
          WHERE geo_celda IS NOT NULL
            AND created_at >= NOW() - ($1 || ' days')::interval
          GROUP BY geo_celda
          HAVING COUNT(*) < $2
        ) s
      `,
      [String(dias), kMin]
    )
    suprimidas = Number(sup.rows[0]?.n ?? 0)
  }

  const maxConsultas = consultasRes.rows.reduce(
    (m: number, r: CeldaConsultaRow) => Math.max(m, Number(r.total)),
    0
  )
  const maxDenuncias = denunciasRes.rows.reduce(
    (m: number, r: CeldaDenunciaRow) => Math.max(m, Number(r.total)),
    0
  )

  const features: GeoJSONFeature[] = []
  let totalConsultas = 0
  let totalDenuncias = 0

  for (const r of consultasRes.rows) {
    const total = Number(r.total)
    totalConsultas += total
    features.push(
      feature(Number(r.geo_lat), Number(r.geo_lon), {
        capa: 'consultas',
        celda: r.geo_celda,
        zona: r.geo_zona ?? 'Zona sin identificar',
        ciudad: r.geo_ciudad ?? 'Mendoza',
        total,
        intensidad: maxConsultas > 0 ? round5(total / maxConsultas) : 0,
        consultantesDistintos: Number(r.consultantes),
        seriesDistintas: Number(r.series),
      })
    )
  }

  for (const r of denunciasRes.rows) {
    const total = Number(r.total)
    totalDenuncias += total
    features.push(
      feature(Number(r.geo_lat), Number(r.geo_lon), {
        capa: 'denuncias',
        celda: r.geo_celda,
        zona: r.geo_zona ?? 'Zona sin identificar',
        ciudad: r.geo_ciudad ?? 'Mendoza',
        total,
        intensidad: maxDenuncias > 0 ? round5(total / maxDenuncias) : 0,
      })
    )
  }

  return {
    type: 'FeatureCollection',
    features,
    metadata: {
      ciudad: 'Mendoza',
      centro: { ...MENDOZA_CENTRO },
      bbox: MENDOZA_BBOX,
      dias,
      gridDeg: gridDeg(),
      generadoEn: new Date().toISOString(),
      totales: {
        consultas: totalConsultas,
        denuncias: totalDenuncias,
        celdasConsultas: consultasRes.rows.length,
        celdasDenuncias: denunciasRes.rows.length,
      },
      suprimidasPorKAnon: suprimidas,
    },
  }
}

function clampDias(dias: number): number {
  if (!Number.isFinite(dias)) return 7
  // El dashboard ofrece 7 / 30 / 90; se admite cualquier valor 1..365.
  return Math.min(365, Math.max(1, Math.floor(dias)))
}

// ── Alertas de comportamiento: deteccion de "Puntos Calientes" ───────────────

export type AlertaSeveridad = 'media' | 'alta' | 'critica'
export type AlertaEstado = 'abierta' | 'reconocida' | 'descartada'

export interface AlertaSeguridad {
  id: string
  tipo: string
  celda: string
  zona: string
  ciudad: string
  lat: number | null
  lon: number | null
  volumen: number
  umbral: number
  ventanaHoras: number
  severidad: AlertaSeveridad
  estado: AlertaEstado
  detalle: Record<string, unknown>
  primeraDeteccion: string
  actualizadaEn: string
}

interface AlertaRow {
  id: string
  tipo: string
  geo_celda: string
  geo_zona: string | null
  geo_ciudad: string | null
  geo_lat: string | null
  geo_lon: string | null
  volumen: number
  umbral: number
  ventana_horas: number
  severidad: AlertaSeveridad
  estado: AlertaEstado
  detalle: Record<string, unknown>
  primera_deteccion: string
  updated_at: string
}

function mapAlerta(r: AlertaRow): AlertaSeguridad {
  return {
    id: r.id,
    tipo: r.tipo,
    celda: r.geo_celda,
    zona: r.geo_zona ?? 'Zona sin identificar',
    ciudad: r.geo_ciudad ?? 'Mendoza',
    lat: r.geo_lat != null ? Number(r.geo_lat) : null,
    lon: r.geo_lon != null ? Number(r.geo_lon) : null,
    volumen: Number(r.volumen),
    umbral: Number(r.umbral),
    ventanaHoras: Number(r.ventana_horas),
    severidad: r.severidad,
    estado: r.estado,
    detalle: r.detalle ?? {},
    primeraDeteccion: r.primera_deteccion,
    actualizadaEn: r.updated_at,
  }
}

function severidadDe(volumen: number, umbral: number): AlertaSeveridad {
  const ratio = volumen / Math.max(1, umbral)
  if (ratio >= 4) return 'critica'
  if (ratio >= 2) return 'alta'
  return 'media'
}

export interface DeteccionResultado {
  ventanaHoras: number
  umbral: number
  detectados: number
  nuevos: number
  alertas: AlertaSeguridad[]
}

interface HotspotRow {
  geo_celda: string
  geo_lat: string
  geo_lon: string
  geo_zona: string | null
  geo_ciudad: string | null
  volumen: string
  consultantes: string
  series: string
}

/**
 * Detecta "Puntos Calientes": celdas donde el volumen de CONSULTAS de
 * verificacion supera el umbral critico dentro de la ventana. Por cada una,
 * crea o actualiza una alerta para el equipo de seguridad (una sola alerta
 * ABIERTA por celda; re-detectar refresca el volumen/severidad). Devuelve las
 * alertas vigentes resultantes.
 */
export async function detectarPuntosCalientes(
  opts: { ventanaHoras?: number; umbral?: number; persistir?: boolean } = {}
): Promise<DeteccionResultado> {
  const ventanaHoras = opts.ventanaHoras ?? hotspotVentanaHoras()
  const umbral = opts.umbral ?? hotspotUmbral()
  const persistir = opts.persistir ?? true
  const pool = getPool()

  const calientes = await pool.query<HotspotRow>(
    `
      SELECT
        geo_celda,
        MAX(geo_lat) AS geo_lat,
        MAX(geo_lon) AS geo_lon,
        MAX(geo_zona) AS geo_zona,
        MAX(geo_ciudad) AS geo_ciudad,
        COUNT(*) AS volumen,
        COUNT(DISTINCT ip_hash) AS consultantes,
        COUNT(DISTINCT consulta) AS series
      FROM logs_verificaciones
      WHERE geo_celda IS NOT NULL
        AND created_at >= NOW() - ($1 || ' hours')::interval
      GROUP BY geo_celda
      HAVING COUNT(*) >= $2
      ORDER BY volumen DESC
      LIMIT 200
    `,
    [String(ventanaHoras), umbral]
  )

  const alertas: AlertaSeguridad[] = []
  let nuevos = 0

  if (!persistir) {
    // Vista previa de la deteccion sin tocar la tabla de alertas.
    for (const r of calientes.rows) {
      const volumen = Number(r.volumen)
      alertas.push({
        id: `tmp:${r.geo_celda}`,
        tipo: 'PUNTO_CALIENTE',
        celda: r.geo_celda,
        zona: r.geo_zona ?? zonaDeCelda(r.geo_celda),
        ciudad: r.geo_ciudad ?? 'Mendoza',
        lat: Number(r.geo_lat),
        lon: Number(r.geo_lon),
        volumen,
        umbral,
        ventanaHoras,
        severidad: severidadDe(volumen, umbral),
        estado: 'abierta',
        detalle: {
          consultantesDistintos: Number(r.consultantes),
          seriesDistintas: Number(r.series),
        },
        primeraDeteccion: new Date().toISOString(),
        actualizadaEn: new Date().toISOString(),
      })
    }
    return { ventanaHoras, umbral, detectados: alertas.length, nuevos: 0, alertas }
  }

  for (const r of calientes.rows) {
    const volumen = Number(r.volumen)
    const severidad = severidadDe(volumen, umbral)
    const detalle = {
      consultantesDistintos: Number(r.consultantes),
      seriesDistintas: Number(r.series),
    }
    // Upsert: una sola alerta ABIERTA por celda (indice unico parcial). Si ya
    // existe, refresca volumen/severidad/detalle. ON CONFLICT necesita apuntar
    // al indice parcial mediante su predicado.
    const up = await pool.query<AlertaRow & { inserted: boolean }>(
      `
        INSERT INTO alertas_seguridad
          (tipo, geo_celda, geo_lat, geo_lon, geo_ciudad, geo_zona,
           volumen, umbral, ventana_horas, severidad, estado, detalle)
        VALUES ('PUNTO_CALIENTE', $1, $2, $3, $4, $5, $6, $7, $8, $9, 'abierta', $10::jsonb)
        ON CONFLICT (geo_celda) WHERE (estado = 'abierta')
        DO UPDATE SET
          volumen = EXCLUDED.volumen,
          severidad = EXCLUDED.severidad,
          umbral = EXCLUDED.umbral,
          ventana_horas = EXCLUDED.ventana_horas,
          geo_lat = EXCLUDED.geo_lat,
          geo_lon = EXCLUDED.geo_lon,
          geo_zona = EXCLUDED.geo_zona,
          geo_ciudad = EXCLUDED.geo_ciudad,
          detalle = EXCLUDED.detalle,
          updated_at = NOW()
        RETURNING *, (xmax = 0) AS inserted
      `,
      [
        r.geo_celda,
        Number(r.geo_lat),
        Number(r.geo_lon),
        r.geo_ciudad ?? 'Mendoza',
        r.geo_zona ?? zonaDeCelda(r.geo_celda),
        volumen,
        umbral,
        ventanaHoras,
        severidad,
        JSON.stringify(detalle),
      ]
    )
    const row = up.rows[0]
    if (row) {
      if ((row as AlertaRow & { inserted: boolean }).inserted) nuevos += 1
      alertas.push(mapAlerta(row))
      if ((row as AlertaRow & { inserted: boolean }).inserted) {
        // Aviso para el equipo de seguridad (queda en el log de la plataforma;
        // la alerta persistida es la fuente de verdad del dashboard).
        console.warn(
          `[analytics] PUNTO CALIENTE detectado — zona ${row.geo_zona ?? r.geo_celda}: ` +
            `${volumen} consultas en ${ventanaHoras}h (umbral ${umbral}, ${severidad})`
        )
      }
    }
  }

  return {
    ventanaHoras,
    umbral,
    detectados: calientes.rows.length,
    nuevos,
    alertas,
  }
}

/** Lista las alertas de seguridad para el dashboard (por defecto, las abiertas). */
export async function listarAlertas(opts: {
  estado?: AlertaEstado
  limite?: number
} = {}): Promise<AlertaSeguridad[]> {
  const limite = Math.min(opts.limite ?? 100, 500)
  const where = opts.estado ? `WHERE estado = $1` : ''
  const params = opts.estado ? [opts.estado, limite] : [limite]
  const res = await getPool().query<AlertaRow>(
    `
      SELECT * FROM alertas_seguridad
      ${where}
      ORDER BY
        CASE severidad WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 ELSE 2 END,
        volumen DESC,
        updated_at DESC
      LIMIT $${opts.estado ? 2 : 1}
    `,
    params
  )
  return res.rows.map(mapAlerta)
}

/** Cambia el estado de una alerta (reconocida/descartada) desde el dashboard. */
export async function actualizarEstadoAlerta(
  id: string,
  estado: AlertaEstado
): Promise<AlertaSeguridad | null> {
  const res = await getPool().query<AlertaRow>(
    `UPDATE alertas_seguridad SET estado = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, estado]
  )
  return res.rows[0] ? mapAlerta(res.rows[0]) : null
}
