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
 *   - 20260616150000_create_usuarios_sesiones.sql
 *   - 20260616160000_create_logs_verificaciones.sql
 *   - 20260616170000_create_inspecciones_aliados.sql
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

/** Estado del anclaje on-chain del CIT en la BFA (enum `bfa_anclaje_estado`). */
export type BfaAnclajeEstado = 'pendiente' | 'anclando' | 'anclado' | 'error'

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
  /** FK a `usuarios(id)` (constraint agregada en el Hito 1). */
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
  // Anclaje en la BFA (Hito 4).
  bfa_estado: BfaAnclajeEstado
  bfa_tx_hash: string | null
  /** uint256 del tokenId; NUMERIC(78,0) llega como string desde Postgres. */
  bfa_token_id: string | null
  bfa_anclado_en: string | null
  bfa_intentos: number
  bfa_ultimo_error: string | null
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
  // Anclaje en la BFA (Hito 4).
  bfaEstado: BfaAnclajeEstado
  bfaTxHash: string | null
  bfaTokenId: string | null
  bfaAncladoEn: string | null
  bfaIntentos: number
  bfaUltimoError: string | null
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
    bfaEstado: row.bfa_estado,
    bfaTxHash: row.bfa_tx_hash,
    bfaTokenId: row.bfa_token_id,
    bfaAncladoEn: row.bfa_anclado_en,
    bfaIntentos: row.bfa_intentos,
    bfaUltimoError: row.bfa_ultimo_error,
  }
}

// ---------------------------------------------------------------------------
// usuarios / sesiones (Hito 1: Autenticacion Definitiva)
// ---------------------------------------------------------------------------

/** Rol del usuario (enum `usuario_rol` en Postgres). */
export type UsuarioRol = 'ciclista' | 'inspector' | 'admin' | 'aliado'

/** Fila cruda de la tabla `usuarios`. `password_hash` NUNCA se expone a la app. */
export interface UsuarioRow {
  id: string
  email: string
  password_hash: string | null
  rol: UsuarioRol
  datos_perfil: Record<string, unknown>
  /** 'local' (email + contrasena) o un proveedor federado (p. ej. 'mxm'). */
  proveedor: string
  proveedor_uid: string | null
  email_verificado: boolean
  /** Identidad digital del inspector (Hito 11). NULL si no la configuro. */
  wallet_address: string | null
  created_at: string
  updated_at: string
}

/** Fila cruda de la tabla `sesiones` (RefreshTokens). */
export interface SesionRow {
  id: string
  usuario_id: string
  refresh_token_hash: string
  emitido_en: string
  expira_en: string
  revocado_en: string | null
  reemplazada_por: string | null
  user_agent: string | null
  ip: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Verificador Publico (Hito 7): logs_verificaciones / rate_limit_verificaciones
// ---------------------------------------------------------------------------

/** Veredicto semaforico devuelto por el verificador publico. */
export type VeredictoEstado =
  | 'SEGURO'
  | 'ROBADA'
  | 'EN_VALIDACION'
  | 'SIN_VERIFICAR'
  | 'NO_ENCONTRADA'

/** Como se interpreto el termino consultado. */
export type TipoBusquedaVerificacion = 'serial' | 'cit'

/**
 * Fila cruda de `logs_verificaciones` (bitacora ANONIMA del verificador). No
 * contiene datos personales: la IP vive solo como hash (`ip_hash`).
 */
export interface LogVerificacionRow {
  id: string
  consulta: string
  tipo_busqueda: TipoBusquedaVerificacion
  encontrada: boolean
  veredicto: VeredictoEstado
  bicicleta_id: string | null
  cit_id: string | null
  ip_hash: string | null
  user_agent: string | null
  created_at: string
}

/** Fila cruda de `rate_limit_verificaciones` (contador fixed-window por IP). */
export interface RateLimitVerificacionRow {
  ip_hash: string
  ventana_inicio: string
  contador: number
}

// ---------------------------------------------------------------------------
// Inspecciones / Aliados (Hito 11: Portal de Inspectores y Aliados)
// ---------------------------------------------------------------------------

/** Estado de una solicitud de aliado (enum `aliado_estado`). */
export type AliadoEstado = 'pendiente' | 'aprobado' | 'rechazado'

/** Tipo de aliado (enum `aliado_tipo`). */
export type AliadoTipo = 'taller' | 'tienda' | 'otro'

/** Resultado de una inspeccion fisica (enum `inspeccion_resultado`). */
export type InspeccionResultado = 'APROBADA' | 'DISCREPANCIA'

/** Fila cruda de la tabla `aliados` (talleres/tiendas). */
export interface AliadoRow {
  id: string
  nombre: string
  tipo: AliadoTipo
  email: string
  telefono: string | null
  direccion: string | null
  ciudad: string | null
  cuit: string | null
  estado: AliadoEstado
  usuario_id: string | null
  datos: Record<string, unknown>
  solicitado_en: string
  resuelto_en: string | null
  resuelto_por: string | null
  motivo_rechazo: string | null
  created_at: string
  updated_at: string
}

/** Fila cruda de `aliado_servicios` (vinculo bici <-> aliado: alcance). */
export interface AliadoServicioRow {
  id: string
  aliado_id: string
  bicicleta_id: string
  tipo_servicio: string
  detalle: string | null
  created_at: string
}

/** Fila cruda de `inspecciones_fisicas` (acta de auditoria de la inspeccion). */
export interface InspeccionFisicaRow {
  id: string
  cit_id: string
  bicicleta_id: string
  inspector_id: string
  aliado_id: string | null
  resultado: InspeccionResultado
  inspector_wallet: string
  firma_hash: string
  notas: string | null
  discrepancia_motivo: string | null
  acelero_pipeline: boolean
  metadata: Record<string, unknown>
  created_at: string
}
