/**
 * Tipos de la base de datos de RODAID.
 *
 * Reflejan el esquema de Postgres administrado por Netlify Database. Las filas
 * (`*Row`) representan los datos tal como los devuelve el driver (`numeric` y
 * `decimal` llegan como `string` para no perder precision; las fechas como
 * `string` ISO). Los tipos de dominio (sin sufijo `Row`) son la forma ya
 * normalizada que conviene exponer a la aplicacion.
 *
 * Fuente de verdad: netlify/database/migrations/
 *   - 20260616120000_create_bicicletas_cits.sql
 *   - 20260616130000_create_validaciones_pipeline.sql
 */

// ---------------------------------------------------------------------------
// Enums / uniones de dominio
// ---------------------------------------------------------------------------

/** Estado de verificacion de un CIT (enum `cit_estado` en Postgres). */
export type CitEstado = 'pendiente' | 'activo' | 'bloqueado' | 'rechazado'

/**
 * Rodados admitidos para una bicicleta. NUMERIC en la base para permitir 27.5
 * junto a los enteros clasicos y el formato de ruta (700).
 */
export type Rodado = 12 | 16 | 20 | 24 | 26 | 27.5 | 29 | 700

/** Talle del cuadro como categoria de indumentaria. */
export type TalleCuadro = 'S' | 'M' | 'L' | 'XL'

/**
 * Estado de un job del Pipeline de Validacion de 72hs (enum `validacion_estado`
 * en Postgres). PENDIENTE -> EN_PROCESO -> APROBADO | BLOQUEADO; ERROR es el
 * dead-letter tras agotar los reintentos.
 */
export type ValidacionEstado =
  | 'PENDIENTE'
  | 'EN_PROCESO'
  | 'APROBADO'
  | 'BLOQUEADO'
  | 'ERROR'

/** Resultado final del cross-reference (decision del pipeline). */
export type ResultadoValidacion = 'APROBADO' | 'BLOQUEADO'

// ---------------------------------------------------------------------------
// bicicletas
// ---------------------------------------------------------------------------

/** Fila cruda de la tabla `bicicletas` tal como la devuelve el driver. */
export interface BicicletaRow {
  id: string
  marca: string
  modelo: string
  numero_serie: string
  tipo: string
  anio: number | null
  color: string | null
  foto_url: string | null
  /** FK logica a `usuarios` (la tabla se agrega en el Hito 1). */
  propietario_id: string
  /** NUMERIC(4,1): llega como string desde Postgres. */
  rodado: string | null
  talle_cuadro: TalleCuadro | null
  /** DECIMAL(4,1): llega como string desde Postgres. */
  medida_cuadro_pulgadas: string | null
  /** DECIMAL(5,1): llega como string desde Postgres. */
  medida_cuadro_cm: string | null
  creado_en: string
  actualizado_en: string
}

/** Bicicleta normalizada para uso en la aplicacion. */
export interface Bicicleta {
  id: string
  marca: string
  modelo: string
  numeroSerie: string
  tipo: string
  anio: number | null
  color: string | null
  fotoUrl: string | null
  propietarioId: string
  rodado: Rodado | null
  talleCuadro: TalleCuadro | null
  medidaCuadroPulgadas: number | null
  medidaCuadroCm: number | null
  creadoEn: string
  actualizadoEn: string
}

// ---------------------------------------------------------------------------
// cits — Cedula de Identidad de la bicicleta
// ---------------------------------------------------------------------------

/** Fila cruda de la tabla `cits` tal como la devuelve el driver. */
export interface CitRow {
  id: string
  bicicleta_id: string
  estado: CitEstado
  codigo_cit: string
  hash_sha256: string | null
  metadata_json: Record<string, unknown>
  fecha_vencimiento: string
  creado_en: string
  actualizado_en: string
}

/** CIT normalizado para uso en la aplicacion. */
export interface Cit {
  id: string
  bicicletaId: string
  estado: CitEstado
  codigoCit: string
  hashSha256: string | null
  metadataJson: Record<string, unknown>
  fechaVencimiento: string
  creadoEn: string
  actualizadoEn: string
}

// ---------------------------------------------------------------------------
// Helpers de mapeo fila -> dominio
// ---------------------------------------------------------------------------

const RODADOS_VALIDOS: ReadonlySet<number> = new Set([
  12, 16, 20, 24, 26, 27.5, 29, 700,
])

function toRodado(value: string | null): Rodado | null {
  if (value === null) {
    return null
  }
  const parsed = Number(value)
  return RODADOS_VALIDOS.has(parsed) ? (parsed as Rodado) : null
}

function toNumberOrNull(value: string | null): number | null {
  if (value === null) {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function mapBicicleta(row: BicicletaRow): Bicicleta {
  return {
    id: row.id,
    marca: row.marca,
    modelo: row.modelo,
    numeroSerie: row.numero_serie,
    tipo: row.tipo,
    anio: row.anio,
    color: row.color,
    fotoUrl: row.foto_url,
    propietarioId: row.propietario_id,
    rodado: toRodado(row.rodado),
    talleCuadro: row.talle_cuadro,
    medidaCuadroPulgadas: toNumberOrNull(row.medida_cuadro_pulgadas),
    medidaCuadroCm: toNumberOrNull(row.medida_cuadro_cm),
    creadoEn: row.creado_en,
    actualizadoEn: row.actualizado_en,
  }
}

export function mapCit(row: CitRow): Cit {
  return {
    id: row.id,
    bicicletaId: row.bicicleta_id,
    estado: row.estado,
    codigoCit: row.codigo_cit,
    hashSha256: row.hash_sha256,
    metadataJson: row.metadata_json ?? {},
    fechaVencimiento: row.fecha_vencimiento,
    creadoEn: row.creado_en,
    actualizadoEn: row.actualizado_en,
  }
}
