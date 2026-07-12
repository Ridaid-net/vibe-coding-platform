import { getStore } from '@netlify/blobs'
import { SignJWT, jwtVerify } from 'jose'
import { ApiError, getAuthSecret, getPool, type DbClient } from '@/lib/marketplace'
import { sha256Hex } from '@/src/services/firma.service'
import {
  cifrarBytesDenuncia,
  descifrarBytesDenuncia,
} from '@/src/services/cifrado.service'
import { fijarDenunciaBFA } from '@/src/services/blockchain.service'
import {
  invalidarCache,
  normalizarSerie,
  notificarDenunciaJudicial,
  ministerioNotificacionConfigurada,
  reclamarNotificacionMinisterio,
  marcarNotificacionMinisterioExitosa,
  marcarFalloNotificacionMinisterio,
} from '@/src/services/ministerio.service'
import { emitirEvento } from '@/src/services/notification.service'
import { obtenerTextoDocumento } from '@/src/services/pdf-texto.service'
import { tieneCitActivo } from '@/src/services/cit.service'
import { getParametroPricing } from '@/src/services/parametros-pricing.service'
import { consultarPago, crearPreferencia } from '@/src/services/mercadopago.service'

/**
 * RODAID — Hito 18: Denuncia Ciudadana con Validacion de Documento Oficial (MPF).
 *
 * Integra la denuncia ciudadana de robo/hurto con el PDF de la denuncia
 * realizada ante el Ministerio Publico Fiscal (MPF):
 *
 *   1) CARGA OBLIGATORIA del PDF oficial al reportar el robo.
 *   2) VALIDACION DE INTEGRIDAD: extrae texto del PDF (con OCR si es necesario) y
 *      valida que contenga el numero de expediente, la fecha y los datos del
 *      propietario (coincidentes con el perfil RODAID verificado por MxM).
 *   3) BLOQUEO DE ESTADO: si el documento valida, la denuncia pasa a
 *      DENUNCIA_JUDICIAL_ACTIVA -> desactiva el CIT, bloquea el Marketplace y
 *      marca la incidencia en la BFA. Si NO valida, queda EN_REVISION (no se
 *      bloquea automaticamente).
 *   4) NOTIFICACION INSTITUCIONAL (Hito 12): el webhook al Ministerio incluye un
 *      LINK SEGURO al PDF alojado en el bucket CIFRADO.
 *   5) TESTIGO VERIFICADO: el proceso esta restringido a usuarios con identidad
 *      gubernamental (MxM); el sistema cruza los datos del usuario con el PDF.
 *   6) AUDITORIA: la bitacora guarda el HASH del PDF (no alteracion post-carga).
 *
 * Fase 7 (sistema de tarifas de denuncia de robo, casos 1/2 -- dueño denuncia
 * su propia bici): la denuncia es GRATIS si el usuario tiene un CIT activo
 * (ya contribuyo al sistema), o cuesta lo mismo que CIT Express si nunca
 * certifico (incentivo deliberado: certificar desde el principio sale igual
 * y queda para siempre, en vez de un gasto puntual). El fee solo se evalua
 * cuando la denuncia efectivamente VALIDA (activar=true) -- si el PDF no
 * pasa la validacion de estructura/titular, queda EN_REVISION sin cobrar
 * nada. Si hay que cobrar, la denuncia queda en PENDIENTE_PAGO: el PDF ya se
 * valido y guardo (un solo submit del usuario), pero el bloqueo del CIT/
 * Marketplace, el marcado en BFA y la notificacion al Ministerio (steps que
 * antes corrian siempre al final de registrarDenuncia) se difieren hasta que
 * webhookPagoDenuncia() confirme el pago -- ver activarDenuncia().
 */

// Bucket CIFRADO de las denuncias del MPF (Netlify Blobs). El contenido se
// guarda cifrado AES-256-GCM (ver cifrado.service); nunca en claro.
const STORE_DENUNCIAS = 'rodaid-denuncias-mpf'

// Limites de aceptacion del PDF.
const MAX_PDF_BYTES = 15 * 1024 * 1024 // 15 MB
const MIN_PDF_BYTES = 200

/** Error de denuncia con un codigo estable para mapear a la respuesta HTTP. */
export class DenunciaError extends ApiError {}

// ── Tipos de dominio ───────────────────────────────────────────────────────────

export type DenunciaEstado =
  | 'DENUNCIA_JUDICIAL_ACTIVA'
  | 'EN_REVISION'
  | 'ANULADA'
  | 'PENDIENTE_PAGO'

export type DenunciaFeeMotivo = 'CIT_ACTIVO_GRATIS' | 'SIN_CIT_PAGO'

export interface DenunciaFeeResultado {
  montoARS: number
  motivo: DenunciaFeeMotivo
}

export interface TitularVerificado {
  nombre: string | null
  dni: string | null
  cuil: string | null
}

export interface ValidacionDenuncia {
  expediente: string | null
  fechaDocumento: string | null
  /** El texto contiene expediente + fecha (estructura minima del documento). */
  estructuraValida: boolean
  /** El DNI del titular verificado aparece en el documento. */
  dniCoincide: boolean
  /** El nombre del titular verificado aparece en el documento. */
  nombreCoincide: boolean
  /** El titular del documento coincide con el perfil verificado por MxM. */
  titularCoincide: boolean
  /** El PDF no pudo leerse (escaneado / sin texto / OCR no disponible). */
  ilegible: boolean
  /** Fuente del texto analizado. */
  fuenteTexto: 'pdf' | 'ocr' | 'ninguna'
  /** Motivos por los que (no) se valido, en lenguaje claro. */
  motivos: string[]
}

export interface RegistrarDenunciaResultado {
  denunciaId: string
  estado: DenunciaEstado
  /** true si la carga activo el bloqueo (DENUNCIA_JUDICIAL_ACTIVA). */
  bloqueada: boolean
  validacion: ValidacionDenuncia
  /** Huella SHA-256 del PDF cargado (asentada en la auditoria inmutable). */
  pdfHash: string
  expediente: string | null
  fechaDocumento: string | null
  bfa: { estado: string; txHash: string | null } | null
  ministerioNotificado: boolean
  fee: DenunciaFeeResultado
  /** Presente solo si estado === 'PENDIENTE_PAGO' (caso 2: sin CIT activo). */
  pago: {
    preferenceId: string
    initPoint: string
    sandboxPoint: string | null
    gateway: string
    montoARS: number
  } | null
}

// ── Normalizacion para el cruce de datos ───────────────────────────────────────

/** Quita acentos, pasa a mayusculas y deja solo [A-Z0-9 ]. */
function normalizarTexto(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
}

/** Solo digitos. */
function soloDigitos(value: string): string {
  return value.replace(/\D+/g, '')
}

// ── Validacion de estructura + cruce de titular ────────────────────────────────

const RE_EXPEDIENTE = [
  // MPF-12345/2026, P-12345/26, etc. (con prefijo alfabetico).
  /\b([A-Z]{1,5}[-\s]?\d{2,}[-/]\d{2,4})\b/,
  // "expediente/causa/legajo/actuacion N° 12345/2026".
  /(?:expediente|causa|legajo|actuaci[oó]n|carpeta|sumario)[^\dA-Z]{0,12}([A-Z]{0,5}[-\s]?\d{3,}[-/]?\d{0,4})/i,
  // "Exp. N° 12345-2026".
  /\bexp\.?\s*(?:n[º°ro.]*)?\s*([A-Z]{0,5}\d{3,}[-/]\d{2,4})/i,
]

const RE_FECHA = [
  /\b(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})\b/,
  /\b(\d{1,2}\s+de\s+[a-záéíóú]+\s+de\s+\d{4})\b/i,
]

/**
 * Valida la estructura del documento y cruza el titular contra el perfil
 * verificado por MxM. La estructura es valida cuando aparecen el expediente Y la
 * fecha; el titular coincide cuando aparece su DNI o su nombre.
 */
export function validarEstructuraDenuncia(
  extraccion: { texto: string; ilegible: boolean; fuente: 'pdf' | 'ocr' | 'ninguna' },
  titular: TitularVerificado
): ValidacionDenuncia {
  const motivos: string[] = []
  const texto = extraccion.texto ?? ''
  const norm = normalizarTexto(texto)

  // Expediente.
  let expediente: string | null = null
  for (const re of RE_EXPEDIENTE) {
    const m = texto.match(re)
    if (m && m[1]) {
      expediente = m[1].replace(/\s+/g, '').toUpperCase()
      break
    }
  }
  if (!expediente) motivos.push('No se encontró el número de expediente del MPF.')

  // Fecha.
  let fechaDocumento: string | null = null
  for (const re of RE_FECHA) {
    const m = texto.match(re)
    if (m && m[1]) {
      fechaDocumento = m[1].trim()
      break
    }
  }
  if (!fechaDocumento) motivos.push('No se encontró la fecha de la denuncia.')

  // Cruce de titular (DNI / nombre) contra el perfil verificado por MxM.
  const dni = titular.dni ? soloDigitos(titular.dni) : ''
  const dniCoincide =
    dni.length >= 7 && soloDigitos(texto).includes(dni)
  if (titular.dni && !dniCoincide) {
    motivos.push('El DNI del titular no aparece en el documento.')
  }

  const nombreTokens = titular.nombre
    ? normalizarTexto(titular.nombre)
        .split(' ')
        .filter((t) => t.length >= 3)
    : []
  const tokensPresentes = nombreTokens.filter((t) => norm.includes(t))
  // Coincide el nombre si aparecen al menos 2 tokens (nombre + apellido), o el
  // unico token disponible cuando el perfil solo tiene un nombre.
  const nombreCoincide =
    nombreTokens.length > 0 &&
    tokensPresentes.length >= Math.min(2, nombreTokens.length)
  if (nombreTokens.length > 0 && !nombreCoincide) {
    motivos.push('El nombre del titular no coincide con el documento.')
  }

  const titularCoincide = dniCoincide || nombreCoincide
  if (!titularCoincide && (titular.dni || titular.nombre)) {
    motivos.push(
      'Los datos del propietario no coinciden con el perfil verificado por MxM.'
    )
  }

  if (extraccion.ilegible) {
    motivos.unshift(
      'No se pudo leer el contenido del PDF (¿documento escaneado sin OCR?).'
    )
  }

  const estructuraValida = Boolean(expediente) && Boolean(fechaDocumento)

  return {
    expediente,
    fechaDocumento,
    estructuraValida,
    dniCoincide,
    nombreCoincide,
    titularCoincide,
    ilegible: extraccion.ilegible,
    fuenteTexto: extraccion.fuente,
    motivos,
  }
}

// ── Fee de la denuncia (Fase 7) ─────────────────────────────────────────────────

/**
 * Caso 1 (CIT activo): gratis -- ya contribuyo al sistema, la denuncia es un
 * servicio incluido. Caso 2 (cuenta gratis, sin CIT nunca): cuesta lo mismo
 * que CIT Express (leido en vivo -- no un valor congelado en un import).
 */
async function calcularFeeDenunciaPropia(usuarioId: string): Promise<DenunciaFeeResultado> {
  if (await tieneCitActivo(usuarioId)) {
    return { montoARS: 0, motivo: 'CIT_ACTIVO_GRATIS' }
  }
  const montoARS = await getParametroPricing('cit_express_precio_ars')
  return { montoARS, motivo: 'SIN_CIT_PAGO' }
}

// ── Helper de transaccion (para el webhook de pago) ─────────────────────────────

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

interface DenunciaPagoRow {
  id: string
  estado: DenunciaEstado
  fee_payment_id: string | null
}

async function lockDenunciaPago(client: DbClient, denunciaId: string): Promise<DenunciaPagoRow> {
  const res = await client.query<DenunciaPagoRow>(
    `SELECT id, estado, fee_payment_id FROM denuncias_mpf WHERE id = $1 FOR UPDATE`,
    [denunciaId]
  )
  const row = res.rows[0]
  if (!row) {
    throw new ApiError(404, 'DENUNCIA_NOT_FOUND', 'No se encontró la denuncia.')
  }
  return row
}

// ── Link seguro al PDF (token firmado, vida acotada) ───────────────────────────

/** Vida del token del documento (segundos). Configurable; por defecto 7 dias. */
function docTokenTtlSeg(): number {
  const raw = process.env.RODAID_DENUNCIA_DOC_TTL_SEG
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 7 * 24 * 3600
}

function secretKey(): Uint8Array {
  const secret = getAuthSecret()
  if (!secret) {
    throw new ApiError(500, 'AUTH_NOT_CONFIGURED', 'Autenticación no configurada.')
  }
  return new TextEncoder().encode(secret)
}

/** Firma un token de acceso al PDF de una denuncia (un solo recurso, vida corta). */
export async function firmarTokenDocumento(denunciaId: string): Promise<string> {
  return new SignJWT({ kind: 'denuncia_doc' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(denunciaId)
    .setIssuedAt()
    .setExpirationTime(`${docTokenTtlSeg()}s`)
    .sign(secretKey())
}

/** Verifica el token y devuelve el id de la denuncia, o lanza si es invalido. */
export async function verificarTokenDocumento(token: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, secretKey())
    if (payload.kind !== 'denuncia_doc' || typeof payload.sub !== 'string') {
      throw new Error('tipo invalido')
    }
    return payload.sub
  } catch {
    throw new ApiError(
      403,
      'DOC_TOKEN_INVALIDO',
      'El enlace al documento es inválido o expiró.'
    )
  }
}

/** Construye la URL absoluta (si hay base) del documento seguro. */
export async function urlDocumentoSeguro(denunciaId: string): Promise<string> {
  const token = await firmarTokenDocumento(denunciaId)
  const path = `/api/seguridad/denuncias/${denunciaId}/documento?token=${encodeURIComponent(
    token
  )}`
  const base = process.env.RODAID_BASE_URL?.replace(/\/+$/, '')
  return base ? `${base}${path}` : path
}

// ── Bucket cifrado ─────────────────────────────────────────────────────────────

async function subirPdfCifrado(key: string, bytes: Uint8Array): Promise<void> {
  const cifrado = cifrarBytesDenuncia(bytes)
  // Netlify Blobs espera un ArrayBuffer (no un Buffer de Node).
  const ab = cifrado.buffer.slice(
    cifrado.byteOffset,
    cifrado.byteOffset + cifrado.byteLength
  ) as ArrayBuffer
  await getStore(STORE_DENUNCIAS).set(key, ab)
}

/** Lee y descifra el PDF de una denuncia desde el bucket cifrado. */
export async function leerPdfCifrado(key: string): Promise<Buffer | null> {
  const data = await getStore(STORE_DENUNCIAS).get(key, { type: 'arrayBuffer' })
  if (data === null) return null
  return descifrarBytesDenuncia(Buffer.from(data as ArrayBuffer))
}

// ── Auditoria inmutable (guarda el hash del PDF) ───────────────────────────────

interface AuditoriaDenuncia {
  denunciaId: string | null
  bicicletaId: string | null
  serial: string | null
  usuarioId: string | null
  evento: string
  pdfHash: string | null
  detalle?: Record<string, unknown>
}

/** Asienta un hecho en la bitacora inmutable, con el hash del PDF. Best-effort. */
export async function auditarDenuncia(a: AuditoriaDenuncia): Promise<void> {
  await getPool()
    .query(
      `
        INSERT INTO denuncias_mpf_auditoria
          (denuncia_id, bicicleta_id, serial_normalizado, usuario_id, evento, pdf_sha256, detalle)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      `,
      [
        a.denunciaId,
        a.bicicletaId,
        a.serial,
        a.usuarioId,
        a.evento,
        a.pdfHash,
        JSON.stringify(a.detalle ?? {}),
      ]
    )
    .catch((err: unknown) =>
      console.error('[denuncia] no se pudo registrar la auditoría', err)
    )
}

// ── Datos del titular verificado por MxM ───────────────────────────────────────

interface UsuarioTitularRow {
  rol: string
  sello_gubernamental: boolean
  datos_perfil: Record<string, unknown> | null
  datos_oficiales: Record<string, unknown> | null
}

/**
 * Resuelve el perfil verificado del usuario (sello MxM + datos oficiales). Los
 * datos oficiales de la identidad federada (cuil/dni/nombre) tienen prioridad
 * sobre los del perfil cargado a mano.
 */
async function obtenerTitularVerificado(userId: string): Promise<{
  selloGubernamental: boolean
  titular: TitularVerificado
} | null> {
  const res = await getPool().query<UsuarioTitularRow>(
    `
      SELECT u.rol, u.sello_gubernamental, u.datos_perfil,
             (SELECT datos_oficiales FROM identidades_federadas f
               WHERE f.user_id = u.id AND f.provider_id = 'mxm'
               ORDER BY f.verified_at DESC LIMIT 1) AS datos_oficiales
      FROM usuarios u
      WHERE u.id = $1
      LIMIT 1
    `,
    [userId]
  )
  const row = res.rows[0]
  if (!row) return null

  const perfil = row.datos_perfil ?? {}
  const oficial = row.datos_oficiales ?? {}
  const pick = (...vals: unknown[]): string | null => {
    for (const v of vals) {
      if (typeof v === 'string' && v.trim().length > 0) return v.trim()
    }
    return null
  }
  return {
    selloGubernamental: row.sello_gubernamental === true,
    titular: {
      nombre: pick(oficial.nombreCompleto, perfil.nombre, perfil.nombreCompleto),
      dni: pick(oficial.dni, perfil.dni),
      cuil: pick(oficial.cuil, perfil.cuil),
    },
  }
}

// ── Registro de la denuncia ────────────────────────────────────────────────────

interface BiciDenunciaRow {
  id: string
  propietario_id: string
  numero_serie: string
  cit_id: string | null
  cit_estado: string | null
}

/**
 * Registra una denuncia ciudadana respaldada por el PDF del MPF. Valida la
 * identidad gubernamental del testigo, cruza los datos con el documento, lo
 * guarda CIFRADO, y —si valida— calcula el fee (Fase 7): si el usuario tiene
 * CIT activo, activa de inmediato (bloqueo del CIT/Marketplace, incidencia en
 * la BFA y notificacion al Ministerio); si no, la denuncia queda PENDIENTE_PAGO
 * y esa activacion se difiere hasta que webhookPagoDenuncia() confirme el
 * cobro. Siempre asienta el hash del PDF en la auditoria inmutable.
 */
export async function registrarDenuncia(args: {
  userId: string
  bicicletaId: string
  file: Blob
  fileName?: string | null
}): Promise<RegistrarDenunciaResultado> {
  const { userId, bicicletaId, file } = args

  // 1. Carga OBLIGATORIA y valida del PDF (tipo + tamaño).
  const tipo = file.type || ''
  if (!/^application\/pdf$/i.test(tipo) && !/\.pdf$/i.test(args.fileName ?? '')) {
    throw new DenunciaError(
      400,
      'PDF_REQUERIDO',
      'Tenés que adjuntar el PDF de la denuncia realizada ante el MPF.'
    )
  }
  if (file.size < MIN_PDF_BYTES) {
    throw new DenunciaError(400, 'PDF_VACIO', 'El archivo de la denuncia está vacío o es inválido.')
  }
  if (file.size > MAX_PDF_BYTES) {
    throw new DenunciaError(413, 'PDF_GRANDE', 'El PDF no puede superar los 15 MB.')
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  // Firma rapida de PDF (%PDF) para rechazar archivos que no son PDF.
  if (Buffer.from(bytes.subarray(0, 5)).toString('latin1') !== '%PDF-') {
    throw new DenunciaError(400, 'PDF_INVALIDO', 'El archivo adjunto no es un PDF válido.')
  }
  const pdfHash = sha256Hex(bytes)

  // 2. Testigo verificado: el usuario debe tener identidad gubernamental (MxM).
  const titularInfo = await obtenerTitularVerificado(userId)
  if (!titularInfo) {
    throw new DenunciaError(404, 'USUARIO_NOT_FOUND', 'No encontramos tu cuenta.')
  }
  if (!titularInfo.selloGubernamental) {
    throw new DenunciaError(
      403,
      'IDENTIDAD_GUBERNAMENTAL_REQUERIDA',
      'La denuncia ciudadana requiere identidad verificada con Mendoza por Mí (MxM).'
    )
  }

  // 3. La bici debe existir y pertenecer al usuario (propietario = denunciante).
  const pool = getPool()
  const biciRes = await pool.query<BiciDenunciaRow>(
    `
      SELECT b.id, b.propietario_id, b.numero_serie,
             c.id AS cit_id, c.estado AS cit_estado
      FROM bicicletas b
      LEFT JOIN LATERAL (
        SELECT id, estado FROM cits
        WHERE bicicleta_id = b.id
        ORDER BY CASE estado WHEN 'activo' THEN 0 WHEN 'pendiente' THEN 1 ELSE 2 END,
                 creado_en DESC
        LIMIT 1
      ) c ON TRUE
      WHERE b.id = $1
      LIMIT 1
    `,
    [bicicletaId]
  )
  const bici = biciRes.rows[0]
  if (!bici) {
    throw new DenunciaError(404, 'BICI_NOT_FOUND', 'No encontramos esa bici.')
  }
  if (bici.propietario_id !== userId) {
    throw new DenunciaError(403, 'NOT_OWNER', 'No sos el propietario de esta bicicleta.')
  }

  const serial = normalizarSerie(bici.numero_serie)

  // Si ya hay una denuncia activa (o esperando su pago) para esta bici, no se duplica.
  const yaActiva = await pool.query<{ id: string }>(
    `SELECT id FROM denuncias_mpf
     WHERE bicicleta_id = $1 AND estado IN ('DENUNCIA_JUDICIAL_ACTIVA', 'PENDIENTE_PAGO') LIMIT 1`,
    [bicicletaId]
  )
  if (yaActiva.rows[0]) {
    throw new DenunciaError(
      409,
      'DENUNCIA_YA_ACTIVA',
      'Esta bicicleta ya tiene una denuncia judicial activa o pendiente de pago.'
    )
  }

  // 4. VALIDACION DE INTEGRIDAD: extraer texto (OCR si es necesario) y cruzar.
  const extraccion = await obtenerTextoDocumento(bytes)
  const validacion = validarEstructuraDenuncia(extraccion, titularInfo.titular)

  // Decision: solo se BLOQUEA si la estructura es valida Y el titular coincide.
  // Si no, la denuncia queda EN_REVISION (no se bloquea automaticamente, y no
  // se evalua ningun fee -- no hay nada que cobrar por una carga que no activa).
  const activar =
    validacion.estructuraValida &&
    validacion.titularCoincide &&
    !validacion.ilegible

  const fee: DenunciaFeeResultado = activar
    ? await calcularFeeDenunciaPropia(userId)
    : { montoARS: 0, motivo: 'CIT_ACTIVO_GRATIS' }

  const estado: DenunciaEstado = !activar
    ? 'EN_REVISION'
    : fee.montoARS === 0
      ? 'DENUNCIA_JUDICIAL_ACTIVA'
      : 'PENDIENTE_PAGO'

  // 5. Guardar el PDF CIFRADO en el bucket.
  const blobKey = `denuncias/${bicicletaId}/${pdfHash}.pdf.enc`
  try {
    await subirPdfCifrado(blobKey, bytes)
  } catch (error) {
    console.error('[denuncia] no se pudo guardar el PDF cifrado', error)
    throw new DenunciaError(
      502,
      'STORAGE_ERROR',
      'No pudimos guardar el documento de la denuncia. Probá de nuevo.'
    )
  }

  // 6. Persistir la denuncia (con el fee ya congelado) + auditoria de CARGA.
  const insert = await pool.query<{ id: string }>(
    `
      INSERT INTO denuncias_mpf
        (bicicleta_id, cit_id, usuario_id, serial_normalizado, estado,
         numero_expediente, fecha_documento, estructura_valida, titular_coincide,
         validacion, pdf_blob_key, pdf_sha256, pdf_bytes, metadata,
         fee_ars, fee_motivo)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14::jsonb, $15, $16)
      RETURNING id
    `,
    [
      bicicletaId,
      bici.cit_id,
      userId,
      serial,
      estado,
      validacion.expediente,
      validacion.fechaDocumento,
      validacion.estructuraValida,
      validacion.titularCoincide,
      JSON.stringify(validacion),
      blobKey,
      pdfHash,
      bytes.byteLength,
      JSON.stringify({ fuenteTexto: validacion.fuenteTexto, usoOcr: extraccion.usoOcr }),
      fee.montoARS,
      fee.motivo,
    ]
  )
  const denunciaId = insert.rows[0].id

  await auditarDenuncia({
    denunciaId,
    bicicletaId,
    serial,
    usuarioId: userId,
    evento: 'CARGA',
    pdfHash,
    detalle: {
      estado,
      expediente: validacion.expediente,
      fechaDocumento: validacion.fechaDocumento,
      estructuraValida: validacion.estructuraValida,
      titularCoincide: validacion.titularCoincide,
      fuenteTexto: validacion.fuenteTexto,
      feeArs: fee.montoARS,
      feeMotivo: fee.motivo,
    },
  })

  // 7. Si no se activa, queda en revision: no se bloquea nada, no se cobra nada.
  if (!activar) {
    await auditarDenuncia({
      denunciaId,
      bicicletaId,
      serial,
      usuarioId: userId,
      evento: 'REVISION',
      pdfHash,
      detalle: { motivos: validacion.motivos },
    })
    return {
      denunciaId,
      estado,
      bloqueada: false,
      validacion,
      pdfHash,
      expediente: validacion.expediente,
      fechaDocumento: validacion.fechaDocumento,
      bfa: null,
      ministerioNotificado: false,
      fee,
      pago: null,
    }
  }

  // Caso 2 (sin CIT activo): generar la preferencia de pago y devolver SIN
  // activar todavia -- el bloqueo/BFA/notificacion corren recien cuando
  // webhookPagoDenuncia() confirme el cobro (ver activarDenuncia() mas abajo).
  if (fee.montoARS > 0) {
    const preferencia = await crearPreferencia({
      transaccionId: denunciaId,
      titulo: `Servicio RODAID de bloqueo y alerta — ${bici.numero_serie}`,
      descripcion: 'Servicio RODAID de bloqueo y alerta de red (cuenta sin CIT activo).',
      precioARS: fee.montoARS,
      notificationPath: '/api/v1/denuncias/webhook/mp',
    })
    await pool.query(
      `UPDATE denuncias_mpf SET fee_preference_id = $2, fee_init_point = $3 WHERE id = $1`,
      [denunciaId, preferencia.preferenceId, preferencia.initPoint]
    )
    return {
      denunciaId,
      estado: 'PENDIENTE_PAGO',
      bloqueada: false,
      validacion,
      pdfHash,
      expediente: validacion.expediente,
      fechaDocumento: validacion.fechaDocumento,
      bfa: null,
      ministerioNotificado: false,
      fee,
      pago: {
        preferenceId: preferencia.preferenceId,
        initPoint: preferencia.initPoint,
        sandboxPoint: preferencia.sandboxPoint,
        gateway: preferencia.gateway,
        montoARS: fee.montoARS,
      },
    }
  }

  // Caso 1 (CIT activo, gratis): activar de inmediato, igual que el flujo original.
  const activado = await activarDenuncia({
    denunciaId,
    bicicletaId,
    userId,
    numeroSerieOriginal: bici.numero_serie,
    serial,
    expediente: validacion.expediente,
    fechaDocumento: validacion.fechaDocumento,
    pdfHash,
  })

  return {
    denunciaId,
    estado,
    bloqueada: true,
    validacion,
    pdfHash,
    expediente: validacion.expediente,
    fechaDocumento: validacion.fechaDocumento,
    bfa: { estado: activado.bfaEstado, txHash: activado.bfaTxHash },
    ministerioNotificado: activado.ministerioNotificado,
    fee,
    pago: null,
  }
}

/**
 * Ejecuta el bloqueo final de la denuncia -- comun a los dos caminos de
 * activacion (caso 1: corre de inmediato desde registrarDenuncia; caso 2:
 * corre desde webhookPagoDenuncia una vez confirmado el pago). Desactiva el
 * CIT (-> bloqueado), pausa el Marketplace, marca la incidencia en la BFA,
 * invalida la cache del cross-reference y notifica al Ministerio con el link
 * seguro al PDF. NO toca el campo `estado` de denuncias_mpf -- eso ya lo dejo
 * resuelto quien la llama (el INSERT para el caso 1, el UPDATE del webhook
 * para el caso 2), para que el cambio de estado y la confirmacion del pago
 * sean atomicos en el caso 2.
 */
interface IntentoNotificacionMinisterio {
  enviado: boolean
  modo: 'LIVE' | 'SIMULADO'
  estado: 'enviado' | 'pendiente' | 'error'
}

/**
 * Intenta notificar al Ministerio una denuncia ya activa, con el ciclo
 * reclamar -> enviar -> marcar (mismo patron que el anclaje BFA en
 * blockchain.service.ts). Nunca lanza: el resultado queda reflejado en
 * denuncias_mpf.ministerio_estado para que el worker
 * (notificarDenunciasJudicialesPendientes) reintente si hace falta. Usado
 * tanto por el intento sincrono inicial (activarDenuncia) como por el
 * barrido periodico.
 */
async function intentarNotificarMinisterio(
  denunciaId: string,
  datos: { serial: string; expediente: string | null; fechaDocumento: string | null; pdfHash: string }
): Promise<IntentoNotificacionMinisterio> {
  if (!ministerioNotificacionConfigurada()) {
    console.info(
      `[denuncia] Ministerio no configurado; notificacion de ${denunciaId} queda pendiente.`
    )
    return { enviado: false, modo: 'SIMULADO', estado: 'pendiente' }
  }

  const claim = await reclamarNotificacionMinisterio(denunciaId)
  if (claim === 'ya-notificado') return { enviado: true, modo: 'LIVE', estado: 'enviado' }
  if (claim === 'no-existe') return { enviado: false, modo: 'LIVE', estado: 'error' }

  try {
    const documentoUrl = await urlDocumentoSeguro(denunciaId)
    await notificarDenunciaJudicial({
      serial: datos.serial,
      expediente: datos.expediente,
      fechaDocumento: datos.fechaDocumento,
      documentoUrl,
      documentoHash: datos.pdfHash,
      denunciaId,
    })
    await marcarNotificacionMinisterioExitosa(denunciaId)
    return { enviado: true, modo: 'LIVE', estado: 'enviado' }
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : 'Fallo la notificacion al Ministerio.'
    console.error('[denuncia] no se pudo notificar al Ministerio', denunciaId, mensaje)
    const estadoFinal = await marcarFalloNotificacionMinisterio(denunciaId, mensaje)
    return { enviado: false, modo: 'LIVE', estado: estadoFinal }
  }
}

/**
 * Barre las denuncias DENUNCIA_JUDICIAL_ACTIVA cuya notificacion al
 * Ministerio quedo pendiente y reintenta. Pensado para un endpoint de sistema
 * / Scheduled Function, mismo patron que anclarPendientes()
 * (blockchain.service.ts). Procesa secuencialmente. Las que ya agotaron sus
 * intentos ('error') NO se reintentan automaticamente -- dead-letter,
 * requiere revision manual, mismo criterio que bfa_estado = 'error'.
 */
export async function notificarDenunciasJudicialesPendientes(limite = 25): Promise<{
  encontradas: number
  enviadas: number
}> {
  if (!ministerioNotificacionConfigurada()) {
    return { encontradas: 0, enviadas: 0 }
  }

  const res = await getPool().query<{
    id: string
    serial_normalizado: string
    numero_expediente: string | null
    fecha_documento: string | null
    pdf_sha256: string
  }>(
    `
      SELECT id, serial_normalizado, numero_expediente, fecha_documento, pdf_sha256
      FROM denuncias_mpf
      WHERE estado = 'DENUNCIA_JUDICIAL_ACTIVA'
        AND ministerio_estado = 'pendiente'
      ORDER BY creado_en ASC
      LIMIT $1
    `,
    [limite]
  )

  let enviadas = 0
  for (const row of res.rows) {
    const resultado = await intentarNotificarMinisterio(row.id, {
      serial: row.serial_normalizado,
      expediente: row.numero_expediente,
      fechaDocumento: row.fecha_documento,
      pdfHash: row.pdf_sha256,
    })
    if (resultado.estado === 'enviado') enviadas += 1
  }
  return { encontradas: res.rows.length, enviadas }
}

async function activarDenuncia(opts: {
  denunciaId: string
  bicicletaId: string
  userId: string
  numeroSerieOriginal: string
  serial: string
  expediente: string | null
  fechaDocumento: string | null
  pdfHash: string
}): Promise<{ bfaEstado: string; bfaTxHash: string | null; ministerioNotificado: boolean }> {
  const pool = getPool()

  // BLOQUEO DE ESTADO: desactivar el CIT (-> 'bloqueado') y bloquear Marketplace.
  await aplicarBloqueo(opts.bicicletaId, opts.denunciaId, opts.expediente)

  // Marcar la incidencia en la BFA (lock del NFT del CIT).
  const bfa = await fijarDenunciaBFA(opts.numeroSerieOriginal, true).catch((err) => {
    console.error('[denuncia] no se pudo marcar la incidencia en la BFA', err)
    return null
  })
  const bfaEstado = bfa?.ok ? 'incidencia' : 'pendiente'
  await pool
    .query(
      `UPDATE denuncias_mpf SET bfa_estado = $2, bfa_tx_hash = $3 WHERE id = $1`,
      [opts.denunciaId, bfaEstado, bfa?.txHash ?? null]
    )
    .catch(() => undefined)

  // El veredicto de seguridad cambio: invalidar la cache del cross-reference.
  await invalidarCache(opts.serial).catch(() => undefined)

  // Notificacion institucional (Hito 12) con el LINK SEGURO al PDF cifrado.
  // Reintento confiable via worker si falla o se cuelga (ver
  // notificarDenunciasJudicialesPendientes) -- no basta con loguearlo, es un
  // aviso a fuerzas de seguridad.
  const aviso = await intentarNotificarMinisterio(opts.denunciaId, {
    serial: opts.serial,
    expediente: opts.expediente,
    fechaDocumento: opts.fechaDocumento,
    pdfHash: opts.pdfHash,
  })

  await auditarDenuncia({
    denunciaId: opts.denunciaId,
    bicicletaId: opts.bicicletaId,
    serial: opts.serial,
    usuarioId: opts.userId,
    evento: 'BLOQUEO',
    pdfHash: opts.pdfHash,
    detalle: {
      expediente: opts.expediente,
      bfa: bfaEstado,
      bfaTxHash: bfa?.txHash ?? null,
      ministerioModo: aviso.modo,
      ministerioEstado: aviso.estado,
    },
  })
  await auditarDenuncia({
    denunciaId: opts.denunciaId,
    bicicletaId: opts.bicicletaId,
    serial: opts.serial,
    usuarioId: opts.userId,
    evento: 'NOTIFICACION_MINISTERIO',
    pdfHash: opts.pdfHash,
    detalle: { enviado: aviso.enviado, modo: aviso.modo, estado: aviso.estado, tokenized: true },
  })

  // Avisar al propietario por el bus de notificaciones (Hito 10). Best-effort.
  await emitirEvento({
    tipo: 'denuncia.activa',
    usuarioId: opts.userId,
    data: { expediente: opts.expediente ?? '', serial: opts.serial },
  }).catch(() => undefined)

  return { bfaEstado, bfaTxHash: bfa?.txHash ?? null, ministerioNotificado: aviso.enviado }
}

/**
 * Aplica el bloqueo de la denuncia: desactiva el CIT (-> 'bloqueado') y pausa las
 * publicaciones activas del Marketplace de esa bici, de forma atomica.
 */
async function aplicarBloqueo(
  bicicletaId: string,
  denunciaId: string,
  expediente: string | null
): Promise<void> {
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Desactivar el CIT: cualquier CIT activo/pendiente de la bici pasa a
    // 'bloqueado' (esto deshabilita la publicacion en el Marketplace, que exige
    // un CIT 'activo'). Se deja constancia de la denuncia en su metadata.
    await client.query(
      `
        UPDATE cits
        SET estado = 'bloqueado',
            metadata_json = metadata_json || $2::jsonb,
            actualizado_en = NOW()
        WHERE bicicleta_id = $1 AND estado IN ('activo', 'pendiente')
      `,
      [
        bicicletaId,
        JSON.stringify({
          denuncia: {
            denunciaId,
            expediente,
            estado: 'DENUNCIA_JUDICIAL_ACTIVA',
            bloqueadoEn: new Date().toISOString(),
          },
        }),
      ]
    )

    // Bloquear el Marketplace: pausar publicaciones activas/pausadas de la bici.
    // (Las publicaciones PAUSADA no se muestran en el listado publico.)
    await client.query(
      `
        UPDATE marketplace_publicaciones
        SET estado = 'PAUSADA'
        WHERE bicicleta_id = $1 AND estado = 'ACTIVA'
      `,
      [bicicletaId]
    )

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

// ── Webhook de pago (Fase 7, caso 2) ────────────────────────────────────────────

export interface ProcesarPagoDenunciaInput {
  paymentId: string
  externalReferenceHint?: string | null
}

export type AccionWebhookDenuncia = 'APROBADO' | 'RECHAZADO' | 'IGNORADO'

/**
 * Procesa el webhook de MercadoPago del fee de denuncia (caso 2: cuenta sin
 * CIT activo). Re-consulta el estado real a MercadoPago (nunca el payload) y,
 * si esta approved, confirma el pago y la transicion a DENUNCIA_JUDICIAL_ACTIVA
 * de forma atomica -- y fuera de la transaccion, dispara activarDenuncia()
 * (bloqueo + BFA + notificacion al Ministerio, los mismos efectos que corren
 * de inmediato para el caso 1). Idempotente por payment_id.
 */
export async function webhookPagoDenuncia(
  input: ProcesarPagoDenunciaInput
): Promise<{ accion: AccionWebhookDenuncia; denunciaId: string | null }> {
  const pago = await consultarPago(input.paymentId)
  const denunciaId = pago.externalReference ?? input.externalReferenceHint ?? null
  if (!denunciaId) {
    return { accion: 'IGNORADO', denunciaId: null }
  }

  const accion = await withTx(async (client) => {
    const row = await lockDenunciaPago(client, denunciaId)

    if (pago.status === 'approved') {
      if (row.estado !== 'PENDIENTE_PAGO') {
        return 'IGNORADO' as const
      }
      if (row.fee_payment_id === input.paymentId) {
        return 'IGNORADO' as const
      }
      await client.query(
        `
          UPDATE denuncias_mpf
          SET estado = 'DENUNCIA_JUDICIAL_ACTIVA',
              fee_payment_id = $2,
              fee_pagado_en = NOW(),
              updated_at = NOW()
          WHERE id = $1
        `,
        [denunciaId, input.paymentId]
      )
      return 'APROBADO' as const
    }

    if (pago.status === 'rejected' || pago.status === 'cancelled') {
      // Se queda en PENDIENTE_PAGO -- binary_mode:false permite reintentar.
      return 'RECHAZADO' as const
    }

    return 'IGNORADO' as const
  })

  if (accion === 'APROBADO') {
    const detalleRes = await getPool().query<{
      bicicleta_id: string
      usuario_id: string
      serial_normalizado: string
      numero_expediente: string | null
      fecha_documento: string | null
      pdf_sha256: string
    }>(
      `
        SELECT bicicleta_id, usuario_id, serial_normalizado, numero_expediente,
               fecha_documento, pdf_sha256
        FROM denuncias_mpf WHERE id = $1
      `,
      [denunciaId]
    )
    const detalle = detalleRes.rows[0]
    if (detalle) {
      const biciRes = await getPool().query<{ numero_serie: string }>(
        `SELECT numero_serie FROM bicicletas WHERE id = $1`,
        [detalle.bicicleta_id]
      )
      await activarDenuncia({
        denunciaId,
        bicicletaId: detalle.bicicleta_id,
        userId: detalle.usuario_id,
        numeroSerieOriginal: biciRes.rows[0]?.numero_serie ?? detalle.serial_normalizado,
        serial: detalle.serial_normalizado,
        expediente: detalle.numero_expediente,
        fechaDocumento: detalle.fecha_documento,
        pdfHash: detalle.pdf_sha256,
      }).catch((err) => {
        // activarDenuncia() solo puede llegar a este catch si aplicarBloqueo()
        // fallo -- todo lo demas que hace (BFA, cache, Ministerio, evento) ya
        // atrapa sus propios errores internamente. O sea: el pago ya se
        // confirmo y el estado ya quedo en DENUNCIA_JUDICIAL_ACTIVA, pero el
        // CIT/Marketplace de esta bici puede NO haber quedado bloqueado de
        // verdad. Esto nunca debe pasar en silencio -- requiere revision manual.
        console.error(
          `[denuncia] CRITICO: pago confirmado pero aplicarBloqueo() fallo -- el CIT/Marketplace de la bici puede NO estar bloqueado pese a estado=DENUNCIA_JUDICIAL_ACTIVA. Revision manual inmediata.`,
          { denunciaId, bicicletaId: detalle.bicicleta_id, error: err }
        )
      })
    }
  }

  return { accion, denunciaId }
}

// ── Consulta de estado para la UI ──────────────────────────────────────────────

export interface DenunciaResumen {
  id: string
  estado: DenunciaEstado
  expediente: string | null
  fechaDocumento: string | null
  estructuraValida: boolean
  titularCoincide: boolean
  pdfHash: string
  creadoEn: string
  motivos: string[]
  feeArs: number
  feeMotivo: DenunciaFeeMotivo
  /** Presente solo si estado === 'PENDIENTE_PAGO'. */
  pagoPendiente: { preferenceId: string; initPoint: string; montoARS: number } | null
}

interface DenunciaRow {
  id: string
  estado: DenunciaEstado
  numero_expediente: string | null
  fecha_documento: string | null
  estructura_valida: boolean
  titular_coincide: boolean
  pdf_sha256: string
  validacion: ValidacionDenuncia | null
  creado_en: string
  fee_ars: string
  fee_motivo: DenunciaFeeMotivo
  fee_preference_id: string | null
  fee_init_point: string | null
}

/** Devuelve la denuncia mas reciente de una bici del usuario (o null). */
export async function obtenerDenunciaDeBici(
  userId: string,
  bicicletaId: string
): Promise<DenunciaResumen | null> {
  const res = await getPool().query<DenunciaRow>(
    `
      SELECT d.id, d.estado, d.numero_expediente, d.fecha_documento,
             d.estructura_valida, d.titular_coincide, d.pdf_sha256, d.validacion,
             d.creado_en, d.fee_ars, d.fee_motivo, d.fee_preference_id, d.fee_init_point
      FROM denuncias_mpf d
      JOIN bicicletas b ON b.id = d.bicicleta_id
      WHERE d.bicicleta_id = $1 AND b.propietario_id = $2
      ORDER BY d.creado_en DESC
      LIMIT 1
    `,
    [bicicletaId, userId]
  )
  const row = res.rows[0]
  if (!row) return null
  return {
    id: row.id,
    estado: row.estado,
    expediente: row.numero_expediente,
    fechaDocumento: row.fecha_documento,
    estructuraValida: row.estructura_valida,
    titularCoincide: row.titular_coincide,
    pdfHash: row.pdf_sha256,
    creadoEn: row.creado_en,
    motivos: row.validacion?.motivos ?? [],
    feeArs: Number(row.fee_ars),
    feeMotivo: row.fee_motivo,
    pagoPendiente:
      row.estado === 'PENDIENTE_PAGO' && row.fee_preference_id && row.fee_init_point
        ? {
            preferenceId: row.fee_preference_id,
            initPoint: row.fee_init_point,
            montoARS: Number(row.fee_ars),
          }
        : null,
  }
}

// ── Acceso al documento por la autoridad (link seguro) ─────────────────────────

export interface DocumentoSeguro {
  pdf: Buffer
  pdfHash: string
  expediente: string | null
}

/**
 * Resuelve el PDF de una denuncia a partir de su id y el token firmado del link
 * seguro. Verifica el token, lee y descifra el PDF del bucket cifrado, y asienta
 * el ACCESO en la auditoria inmutable (trazabilidad de quien accedio).
 */
export async function accederDocumentoSeguro(
  denunciaId: string,
  token: string,
  contexto: { ip?: string | null; cliente?: string | null }
): Promise<DocumentoSeguro> {
  const idDelToken = await verificarTokenDocumento(token)
  if (idDelToken !== denunciaId) {
    throw new ApiError(403, 'DOC_TOKEN_INVALIDO', 'El enlace al documento es inválido.')
  }

  const res = await getPool().query<{
    pdf_blob_key: string
    pdf_sha256: string
    serial_normalizado: string
    bicicleta_id: string
    numero_expediente: string | null
  }>(
    `SELECT pdf_blob_key, pdf_sha256, serial_normalizado, bicicleta_id, numero_expediente
     FROM denuncias_mpf WHERE id = $1 LIMIT 1`,
    [denunciaId]
  )
  const row = res.rows[0]
  if (!row) {
    throw new ApiError(404, 'DENUNCIA_NOT_FOUND', 'No se encontró la denuncia.')
  }

  if (row.pdf_blob_key === 'gov-api-no-pdf') {
    throw new ApiError(404, 'DOCUMENTO_NOT_FOUND', 'Denuncia registrada via API gubernamental sin PDF adjunto.')
  }
  const pdf = await leerPdfCifrado(row.pdf_blob_key)
  if (!pdf) {
    throw new ApiError(404, 'DOCUMENTO_NOT_FOUND', 'El documento no está disponible.')
  }

  // Verificacion de integridad: el hash del PDF descifrado debe coincidir con el
  // asentado al cargarlo. Si no, el documento fue alterado en reposo.
  const hashActual = sha256Hex(pdf)
  if (hashActual !== row.pdf_sha256) {
    throw new ApiError(
      409,
      'DOCUMENTO_ALTERADO',
      'La integridad del documento no pudo verificarse.'
    )
  }

  await auditarDenuncia({
    denunciaId,
    bicicletaId: row.bicicleta_id,
    serial: row.serial_normalizado,
    usuarioId: null,
    evento: 'ACCESO_DOCUMENTO',
    pdfHash: row.pdf_sha256,
    detalle: { ip: contexto.ip ?? null, cliente: contexto.cliente ?? null },
  })

  return { pdf, pdfHash: row.pdf_sha256, expediente: row.numero_expediente }
}
