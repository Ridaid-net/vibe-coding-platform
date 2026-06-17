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
 *   - 20260616190000_create_analitica_geo.sql
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
  /** Sello gubernamental (Hito 9): identidad verificada contra el Estado (MxM). */
  sello_gubernamental: boolean
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
// identidades_federadas (Hito 9: Integracion Institucional MxM)
// ---------------------------------------------------------------------------

/**
 * Fila cruda de `identidades_federadas`: mapeo entre una cuenta de RODAID y la
 * identidad de la persona en un IDP externo (hoy 'mxm'). NUNCA guarda el
 * access_token del proveedor: solo `external_uid` y los datos oficiales para
 * pre-llenar el perfil (cuil, dni, nombre) en `datos_oficiales`.
 */
export interface IdentidadFederadaRow {
  id: string
  user_id: string
  provider_id: string
  external_uid: string
  verified_at: string
  datos_oficiales: Record<string, unknown>
  created_at: string
  updated_at: string
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
  // Geo RECORTADO a nivel barrio (Hito 8). Nunca la coordenada exacta: solo el
  // centro de la celda de grilla. Nullable en filas previas a la migracion.
  geo_celda: string | null
  geo_lat: string | null
  geo_lon: string | null
  geo_ciudad: string | null
  geo_zona: string | null
  geo_simulada: boolean
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
  /** Taller (aliado) asociado a la validacion. Trazabilidad del Hito 11. */
  taller_id: string | null
  resultado: InspeccionResultado
  inspector_wallet: string
  /** Huella SHA-256 (hex) del payload canonico del acta (sello de integridad). */
  firma_hash: string
  /** Firma digital (Web Crypto / PKCS#12). NULL en actas historicas. */
  firma_algoritmo: string | null
  firma_valor: string | null
  firma_certificado: string | null
  firma_cert_serie: string | null
  firma_cert_fingerprint: string | null
  firma_modo: string | null
  notas: string | null
  discrepancia_motivo: string | null
  acelero_pipeline: boolean
  metadata: Record<string, unknown>
  created_at: string
}

// ---------------------------------------------------------------------------
// Hito 10 — Notificaciones Push (arquitectura de eventos).
// Fuente: 20260616180000_create_notificaciones_suscripciones.sql
// ---------------------------------------------------------------------------

/**
 * Fila cruda de `notificaciones_suscripciones`: la suscripcion de Web Push de un
 * navegador (opt-in). `p256dh` y `auth` son las claves de cifrado de la Web Push
 * API (`subscription.keys`).
 */
export interface NotificacionSuscripcionRow {
  id: string
  usuario_id: string
  endpoint: string
  p256dh: string
  auth: string
  user_agent: string | null
  created_at: string
  updated_at: string
}

/** Fila cruda de `notificaciones_enviadas` (bitacora de envios por evento). */
export interface NotificacionEnviadaRow {
  id: string
  usuario_id: string | null
  evento: string
  canal: string
  titulo: string
  cuerpo: string
  entregas: number
  exito: boolean
  error: string | null
  metadata: Record<string, unknown>
  created_at: string
}

// ---------------------------------------------------------------------------
// Analitica de Seguridad (Hito 8: Mapa de Calor)
// ---------------------------------------------------------------------------

/** Tipo de denuncia/discrepancia geolocalizada (enum `discrepancia_tipo`). */
export type DiscrepanciaTipo = 'discrepancia' | 'robo' | 'sospecha'

/** Severidad de una alerta de seguridad (enum `alerta_severidad`). */
export type AlertaSeveridad = 'media' | 'alta' | 'critica'

/** Estado de una alerta de seguridad (enum `alerta_estado`). */
export type AlertaEstado = 'abierta' | 'reconocida' | 'descartada'

/**
 * Fila cruda de `discrepancias_reportadas`: denuncias/discrepancias ANONIMAS y
 * geolocalizadas a nivel barrio (centro de celda recortada, nunca el punto real).
 */
export interface DiscrepanciaReportadaRow {
  id: string
  tipo: DiscrepanciaTipo
  bicicleta_id: string | null
  cit_id: string | null
  inspeccion_id: string | null
  geo_celda: string | null
  geo_lat: string | null
  geo_lon: string | null
  geo_ciudad: string | null
  geo_zona: string | null
  geo_simulada: boolean
  detalle: string | null
  created_at: string
}

/**
 * Fila cruda de `alertas_seguridad`: "Puntos Calientes" detectados por el motor
 * de analitica (zonas con volumen de consultas sobre el umbral critico).
 */
export interface AlertaSeguridadRow {
  id: string
  tipo: string
  geo_celda: string
  geo_lat: string | null
  geo_lon: string | null
  geo_ciudad: string | null
  geo_zona: string | null
  volumen: number
  umbral: number
  ventana_horas: number
  severidad: AlertaSeveridad
  estado: AlertaEstado
  detalle: Record<string, unknown>
  primera_deteccion: string
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Integracion Institucional — Ministerio de Seguridad (Hito 12)
// Fuente: 20260617120000_create_seguridad_institucional.sql
// ---------------------------------------------------------------------------

/** Tipo de alerta devuelto por el cross-reference institucional. */
export type MinisterioTipoAlerta = 'robo' | 'discrepancia' | 'normal'

/**
 * Fila cruda de `ministerio_auditoria`: bitacora INMUTABLE (append-only) de la
 * integracion. El DNI nunca se guarda en claro: solo `dni_cifrado` (AES-256-GCM)
 * y `dni_hash` (no reversible). La tabla no admite UPDATE ni DELETE.
 */
export interface MinisterioAuditoriaRow {
  id: string
  evento: string
  cliente_cn: string | null
  cliente_serie: string | null
  cliente_fingerprint: string | null
  serial_consultado: string | null
  dni_cifrado: string | null
  dni_hash: string | null
  alerta_activa: boolean | null
  tipo_alerta: MinisterioTipoAlerta | null
  expediente: string | null
  metadata: Record<string, unknown>
  created_at: string
}

/**
 * Fila cruda de `seguridad_alertas_cache`: cache read-through del veredicto de
 * alerta por numero de serie (SLA < 2 s del cross-reference).
 */
export interface SeguridadAlertaCacheRow {
  serial_normalizado: string
  bicicleta_id: string | null
  cit_id: string | null
  alerta_activa: boolean
  tipo_alerta: MinisterioTipoAlerta
  expediente: string | null
  refrescado_en: string
}

/** Fila cruda de `recuperos_ministerio`: avisos de recupero del webhook inverso. */
export interface RecuperoMinisterioRow {
  id: string
  evento_uid: string
  serial_normalizado: string
  bicicleta_id: string | null
  cit_id: string | null
  expediente: string | null
  payload_cifrado: string | null
  estado: 'PROCESADO' | 'SIN_COINCIDENCIA'
  desbloqueada: boolean
  notificado: boolean
  cliente_cn: string | null
  cliente_fingerprint: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// RODAID PAY — Hito 13 (motor de pagos y compensaciones).
// Fuente: 20260617130000_rodaid_pay_compensaciones.sql
// ---------------------------------------------------------------------------

/** Tipo de una liquidacion / compensacion (enum `liquidacion_tipo`). */
export type LiquidacionTipo = 'VENDEDOR' | 'ALIADO_RETRIBUCION'

/** Estado de una liquidacion (enum `liquidacion_estado`). */
export type LiquidacionEstado = 'PENDIENTE' | 'PAGADA' | 'FALLIDA' | 'CANCELADA'

/**
 * Fila cruda de `pagos_liquidaciones`: libro de compensaciones (deudas a pagar).
 * Cubre el pago al vendedor al liberarse el escrow (precio - comision) y la
 * retribucion proporcional al Taller Aliado por un CIT validado.
 */
export interface PagosLiquidacionRow {
  id: string
  tipo: LiquidacionTipo
  estado: LiquidacionEstado
  beneficiario_id: string
  beneficiario_tipo: string
  origen_tipo: string
  origen_id: string
  transaccion_id: string | null
  cit_id: string | null
  monto: string
  base_calculo: string | null
  tasa_aplicada: string | null
  intentos: number
  transferencia_ref: string | null
  ultimo_error: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  pagado_en: string | null
}

/** Estado del pago de la Tasa CIT oficial (enum `tasa_cit_estado`). */
export type TasaCitEstado = 'PENDIENTE' | 'PAGADA' | 'RECHAZADA' | 'EXPIRADA'

/**
 * Fila cruda de `tasas_cit`: pago de la tasa de verificacion del CIT por el canal
 * oficial del Gobierno (Mendoza por Mi, pasarela estatal).
 */
export interface TasaCitRow {
  id: string
  cit_id: string | null
  bicicleta_id: string | null
  solicitante_id: string | null
  monto: string
  canal: string
  estado: TasaCitEstado
  referencia_externa: string | null
  comprobante: string | null
  external_uid: string | null
  checkout_url: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  pagado_en: string | null
}

/**
 * Fila cruda de `pagos_log`: bitacora financiera INMUTABLE (append-only). La
 * tabla no admite UPDATE ni DELETE (trigger + REVOKE).
 */
export interface PagoLogRow {
  id: string
  evento: string
  origen_tipo: string | null
  origen_id: string | null
  monto: string | null
  beneficiario_id: string | null
  actor_id: string | null
  actor_rol: string | null
  metadata: Record<string, unknown>
  created_at: string
}

// ---------------------------------------------------------------------------
// RODAID Open-Connect — Hito 16 (apertura al ecosistema externo).
// Fuente: 20260617150000_create_open_connect.sql
// ---------------------------------------------------------------------------

/** Entorno de una app de terceros. */
export type DeveloperAppEntorno = 'sandbox' | 'produccion'
/** Estado de una app de terceros. */
export type DeveloperAppEstado = 'activa' | 'suspendida'

/**
 * Fila cruda de `developer_apps`: una app de terceros (cliente OAuth2 + API Key).
 * Del client_secret y de la API Key SOLO se guarda el hash SHA-256.
 */
export interface DeveloperAppRow {
  id: string
  owner_usuario_id: string
  nombre: string
  descripcion: string | null
  sitio_url: string | null
  client_id: string
  client_secret_hash: string
  api_key_prefix: string
  api_key_hash: string
  redirect_uris: string[]
  scopes: string[]
  entorno: DeveloperAppEntorno
  estado: DeveloperAppEstado
  rate_limit_rpm: number
  created_at: string
  updated_at: string
}

/** Fila cruda de `oauth_codes`: códigos de autorización de un solo uso (PKCE). */
export interface OauthCodeRow {
  id: string
  code_hash: string
  app_id: string
  usuario_id: string
  bicicleta_id: string | null
  scopes: string[]
  redirect_uri: string
  code_challenge: string | null
  code_challenge_method: string | null
  expira_en: string
  usado_en: string | null
  created_at: string
}

/** Fila cruda de `oauth_tokens`: access tokens opacos (se guarda solo el hash). */
export interface OauthTokenRow {
  id: string
  token_hash: string
  app_id: string
  usuario_id: string
  bicicleta_id: string | null
  scopes: string[]
  expira_en: string
  revocado_en: string | null
  ultimo_uso_en: string | null
  created_at: string
}

/** Fila cruda de `developer_api_logs`: bitácora INMUTABLE de uso por app. */
export interface DeveloperApiLogRow {
  id: string
  app_id: string
  endpoint: string
  metodo: string
  status: number
  scope_usado: string | null
  latencia_ms: number | null
  ip_hash: string | null
  created_at: string
}

/** Estado de una suscripción de webhook del ecosistema. */
export type EcosystemWebhookEstado = 'activo' | 'pausado'

/** Fila cruda de `ecosystem_webhooks`: suscripción de un tercero a eventos públicos. */
export interface EcosystemWebhookRow {
  id: string
  app_id: string
  url: string
  eventos: string[]
  secret: string
  estado: EcosystemWebhookEstado
  created_at: string
  updated_at: string
}

/** Fila cruda de `ecosystem_webhook_entregas`: bitácora idempotente de entregas. */
export interface EcosystemWebhookEntregaRow {
  id: string
  webhook_id: string
  evento_id: string
  evento_tipo: string
  payload: Record<string, unknown>
  status_code: number | null
  exito: boolean
  intentos: number
  ultimo_error: string | null
  created_at: string
  entregado_en: string | null
}

// ---------------------------------------------------------------------------
// RODAID-IoT — Hito 17 (telemetria, tiempo real y mantenimiento predictivo).
// Fuente: 20260617160000_create_rodaid_iot.sql
// ---------------------------------------------------------------------------

/** Estado de un dispositivo de telemetria en el registro. */
export type IotDispositivoEstado = 'activo' | 'revocado'

/**
 * Fila cruda de `iot_dispositivos`: un dispositivo de telemetria VINCULADO a una
 * bici (y por ella, al CIT del usuario). Del secreto del dispositivo solo se
 * guarda el hash SHA-256. `transmision_activa` es el opt-in EXPRESO del usuario al
 * seguimiento en tiempo real.
 */
export interface IotDispositivoRow {
  id: string
  bicicleta_id: string
  usuario_id: string
  serial_normalizado: string
  device_uid: string
  device_secret_hash: string
  nombre: string | null
  estado: IotDispositivoEstado
  transmision_activa: boolean
  modo_bajo_consumo: boolean
  intervalo_reporte_seg: number
  nivel_bateria: number | null
  ultima_trama_en: string | null
  created_at: string
  updated_at: string
}

/**
 * Fila cruda de `telemetria_activa`: estado ACTUAL de la bici conectada (una fila
 * por dispositivo). La posicion PRECISA vive cifrada E2E en `posicion_cifrada`
 * (nunca en claro); el geo recortado a barrio es lo unico no cifrado.
 */
export interface TelemetriaActivaRow {
  dispositivo_id: string
  bicicleta_id: string
  usuario_id: string
  serial: string
  posicion_cifrada: string | null
  geo_celda: string | null
  geo_lat: string | null
  geo_lon: string | null
  geo_zona: string | null
  geo_ciudad: string | null
  nivel_bateria: number | null
  velocidad_kmh: string | null
  acelerometro_data: Record<string, unknown>
  ts: string
  actualizado_en: string
}

/**
 * Fila cruda de `telemetria_historica`: traza historica para el recorrido y el
 * mantenimiento predictivo. A los 30 dias se anonimiza (se borra
 * `posicion_cifrada` y queda solo el geo recortado), como el mapa de calor.
 */
export interface TelemetriaHistoricaRow {
  id: string
  dispositivo_id: string
  bicicleta_id: string
  usuario_id: string
  posicion_cifrada: string | null
  geo_celda: string | null
  geo_lat: string | null
  geo_lon: string | null
  geo_zona: string | null
  geo_ciudad: string | null
  nivel_bateria: number | null
  velocidad_kmh: string | null
  acelerometro_data: Record<string, unknown>
  anonimizada: boolean
  ts: string
  created_at: string
}

/** Fila cruda de `iot_geovallas`: "zona segura" circular configurada por el dueño. */
export interface IotGeovallaRow {
  id: string
  bicicleta_id: string
  usuario_id: string
  nombre: string
  center_lat: string
  center_lng: string
  radio_m: number
  activa: boolean
  autorizada_salida: boolean
  created_at: string
  updated_at: string
}

/** Tipo de una alerta de telemetria. */
export type IotAlertaTipo =
  | 'geovalla_salida'
  | 'mantenimiento_cadena'
  | 'mantenimiento_cubiertas'
  | 'mantenimiento_servicio'
  | 'robo_en_curso'
  | 'bateria_baja'

/** Fila cruda de `iot_alertas`: alertas disparadas por la telemetria (con dedupe). */
export interface IotAlertaRow {
  id: string
  dispositivo_id: string | null
  bicicleta_id: string
  usuario_id: string
  tipo: IotAlertaTipo
  severidad: string
  titulo: string
  mensaje: string
  dedupe_key: string | null
  metadata: Record<string, unknown>
  reconocida: boolean
  created_at: string
}
