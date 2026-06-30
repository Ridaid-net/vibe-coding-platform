import { getStore } from '@netlify/blobs'
import { SignJWT, jwtVerify } from 'jose'
import { ApiError, getAuthSecret, getPool } from '@/lib/marketplace'
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
} from '@/src/services/ministerio.service'
import { emitirEvento } from '@/src/services/notification.service'
import { obtenerTextoDocumento } from '@/src/services/pdf-texto.service'

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
 * guarda CIFRADO, y —si valida— bloquea el CIT/Marketplace, marca la incidencia
 * en la BFA y notifica al Ministerio con el link seguro al PDF. Siempre asienta
 * el hash del PDF en la auditoria inmutable.
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

  // Si ya hay una denuncia judicial activa para esta bici, no se duplica.
  const yaActiva = await pool.query<{ id: string }>(
    `SELECT id FROM denuncias_mpf
     WHERE bicicleta_id = $1 AND estado = 'DENUNCIA_JUDICIAL_ACTIVA' LIMIT 1`,
    [bicicletaId]
  )
  if (yaActiva.rows[0]) {
    throw new DenunciaError(
      409,
      'DENUNCIA_YA_ACTIVA',
      'Esta bicicleta ya tiene una denuncia judicial activa.'
    )
  }

  // 4. VALIDACION DE INTEGRIDAD: extraer texto (OCR si es necesario) y cruzar.
  const extraccion = await obtenerTextoDocumento(bytes)
  const validacion = validarEstructuraDenuncia(extraccion, titularInfo.titular)

  // Decision: solo se BLOQUEA si la estructura es valida Y el titular coincide.
  // Si no, la denuncia queda EN_REVISION (no se bloquea automaticamente).
  const activar =
    validacion.estructuraValida &&
    validacion.titularCoincide &&
    !validacion.ilegible
  const estado: DenunciaEstado = activar ? 'DENUNCIA_JUDICIAL_ACTIVA' : 'EN_REVISION'

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

  // 6. Persistir la denuncia + auditoria de CARGA (con el hash del PDF).
  const insert = await pool.query<{ id: string }>(
    `
      INSERT INTO denuncias_mpf
        (bicicleta_id, cit_id, usuario_id, serial_normalizado, estado,
         numero_expediente, fecha_documento, estructura_valida, titular_coincide,
         validacion, pdf_blob_key, pdf_sha256, pdf_bytes, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14::jsonb)
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
    },
  })

  // 7. Si no se activa, queda en revision: no se bloquea nada.
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
    }
  }

  // 8. BLOQUEO DE ESTADO: desactivar el CIT (-> bloqueado) y bloquear Marketplace.
  await aplicarBloqueo(bicicletaId, denunciaId, validacion.expediente)

  // 9. Marcar la incidencia en la BFA (lock del NFT del CIT).
  const bfa = await fijarDenunciaBFA(bici.numero_serie, true).catch((err) => {
    console.error('[denuncia] no se pudo marcar la incidencia en la BFA', err)
    return null
  })
  const bfaEstado = bfa?.ok ? 'incidencia' : 'pendiente'
  await pool
    .query(
      `UPDATE denuncias_mpf SET bfa_estado = $2, bfa_tx_hash = $3 WHERE id = $1`,
      [denunciaId, bfaEstado, bfa?.txHash ?? null]
    )
    .catch(() => undefined)

  // El veredicto de seguridad cambio: invalidar la cache del cross-reference.
  await invalidarCache(serial).catch(() => undefined)

  // 10. Notificacion institucional (Hito 12) con el LINK SEGURO al PDF cifrado.
  const documentoUrl = await urlDocumentoSeguro(denunciaId)
  const aviso = await notificarDenunciaJudicial({
    serial,
    expediente: validacion.expediente,
    fechaDocumento: validacion.fechaDocumento,
    documentoUrl,
    documentoHash: pdfHash,
    denunciaId,
  }).catch((err) => {
    console.error('[denuncia] no se pudo notificar al Ministerio', err)
    return { enviado: false, modo: 'SIMULADO' as const }
  })

  await auditarDenuncia({
    denunciaId,
    bicicletaId,
    serial,
    usuarioId: userId,
    evento: 'BLOQUEO',
    pdfHash,
    detalle: {
      expediente: validacion.expediente,
      bfa: bfaEstado,
      bfaTxHash: bfa?.txHash ?? null,
      ministerioModo: aviso.modo,
    },
  })
  await auditarDenuncia({
    denunciaId,
    bicicletaId,
    serial,
    usuarioId: userId,
    evento: 'NOTIFICACION_MINISTERIO',
    pdfHash,
    detalle: { enviado: aviso.enviado, modo: aviso.modo, tokenized: true },
  })

  // Avisar al propietario por el bus de notificaciones (Hito 10). Best-effort.
  await emitirEvento({
    tipo: 'denuncia.activa',
    usuarioId: userId,
    data: { expediente: validacion.expediente ?? '', serial },
  }).catch(() => undefined)

  return {
    denunciaId,
    estado,
    bloqueada: true,
    validacion,
    pdfHash,
    expediente: validacion.expediente,
    fechaDocumento: validacion.fechaDocumento,
    bfa: { estado: bfaEstado, txHash: bfa?.txHash ?? null },
    ministerioNotificado: aviso.enviado,
  }
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
             d.creado_en
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
