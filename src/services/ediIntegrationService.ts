/**
 * RODAID — Hito 23: Integración con el Ecosistema Digital de Integrabilidad (EDI)
 * de la Provincia de Mendoza mediante protocolo X-Road.
 *
 * Arquitectura: RODAID actúa como Client Node dentro del Security Server provincial.
 * Cada petición lleva headers X-Road obligatorios + payload firmado digitalmente
 * con HMAC-SHA256 (o clave privada RSA en producción).
 *
 * Referencia técnica: Especificaciones X-Road v6/v7 (Nordic Institute for Interoperability Solutions)
 * adaptadas al contexto del EDI Mendoza.
 */

import crypto from 'node:crypto'
import { getPool } from '@/lib/marketplace'

// ─── Configuración de entorno ─────────────────────────────────────────────────

/** URL del Security Server del Ministerio de Seguridad de Mendoza. */
const EDI_ENDPOINT =
  process.env.EDI_ENDPOINT ?? 'https://security-server.mendoza.gov.ar/endpoint'

/** Clave de firma HMAC (desarrollo). En producción: clave privada RSA/EC en HSM. */
const EDI_SIGNING_KEY =
  process.env.EDI_SIGNING_KEY ?? process.env.JWT_SECRET ?? 'rodaid-dev-key'

/** Identificador del nodo RODAID dentro del Security Server provincial. */
const XROAD_CLIENT = process.env.XROAD_CLIENT ?? 'AR/GOV/RODAID/MENDOZA'

/** Timeout por petición al servidor gubernamental (ms). */
const TIMEOUT_MS = Number(process.env.EDI_TIMEOUT_MS ?? 12_000)

/** Máximo de reintentos ante fallo de conexión. */
const MAX_REINTENTOS = 3

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type XRoadService =
  | 'AR/GOV/SEGURIDAD/VERIFICAR_RODADO'
  | 'AR/GOV/SEGURIDAD/REGISTRAR_CIT'
  | 'AR/GOV/SEGURIDAD/CONSULTAR_DENUNCIA'
  | 'AR/GOV/SEGURIDAD/REGISTRAR_ALERTA_HURTO'

export interface XRoadPayload {
  [key: string]: unknown
}

export interface XRoadResponse<T = unknown> {
  transaccionId: string
  estado: 'EXITO' | 'ERROR'
  codigoRespuesta: number
  datos?: T
  error?: string
}

export interface AuditLog {
  transaccionId: string
  servicio: string
  timestamp: string
  estado: 'EXITO' | 'ERROR'
  codigoRespuesta: number
  duracionMs: number
  payload?: string
  respuesta?: string
  error?: string
}

// ─── Servicio de Auditoría ────────────────────────────────────────────────────

/**
 * auditService — Registra cada petición y respuesta en la DB local.
 * Cumple con el requisito de trazabilidad provincial (Art. 12, EDI Mendoza).
 * Los logs son inmutables: solo INSERT, nunca UPDATE/DELETE.
 */
export const auditService = {
  async registrar(log: AuditLog): Promise<void> {
    try {
      const pool = getPool()
      await pool.query(
        `
        INSERT INTO edi_audit_logs (
          transaccion_id, servicio, timestamp, estado,
          codigo_respuesta, duracion_ms, payload_hash, respuesta_hash, error
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          log.transaccionId,
          log.servicio,
          log.timestamp,
          log.estado,
          log.codigoRespuesta,
          log.duracionMs,
          // Almacenamos el HASH del payload, nunca el contenido raw (privacidad)
          log.payload ? crypto.createHash('sha256').update(log.payload).digest('hex') : null,
          log.respuesta ? crypto.createHash('sha256').update(log.respuesta).digest('hex') : null,
          log.error ?? null,
        ]
      )
    } catch (err) {
      // El fallo de auditoría NO debe interrumpir el flujo principal
      console.error('[EDI Audit] Error al registrar log:', err)
    }
  },
}

// ─── Firma Digital ────────────────────────────────────────────────────────────

/**
 * signPayload — Firma el payload con HMAC-SHA256.
 *
 * En DESARROLLO: usa HMAC con JWT_SECRET como clave simétrica.
 * En PRODUCCIÓN: reemplazar por firma asimétrica RSA-PSS o ECDSA con
 * la clave privada custodiada en HSM (Hardware Security Module) o
 * AWS KMS / Azure Key Vault. La clave NUNCA debe residir en variables
 * de entorno en producción.
 *
 * El timestamp incluido en la firma previene ataques de replay.
 */
async function signPayload(
  payload: XRoadPayload,
  transaccionId: string
): Promise<{ payload: XRoadPayload; firma: string; timestamp: string }> {
  const timestamp = new Date().toISOString()

  // Canonicalización: orden alfabético de claves para firma determinista
  const canonico = JSON.stringify({
    transaccionId,
    timestamp,
    payload,
  }, Object.keys({ transaccionId, timestamp, payload }).sort())

  // HMAC-SHA256 — reemplazar por RSA-PSS en producción
  const firma = crypto
    .createHmac('sha256', EDI_SIGNING_KEY)
    .update(canonico)
    .digest('hex')

  return { payload, firma, timestamp }
}

// ─── Retry con Exponential Backoff ───────────────────────────────────────────

/**
 * conBackoff — Ejecuta fn con reintentos exponenciales.
 * Backoff: 500ms → 1000ms → 2000ms (base 2, máx. 3 intentos).
 *
 * Solo reintenta ante errores de red/timeout (no ante 4xx del servidor).
 */
async function conBackoff<T>(
  fn: () => Promise<T>,
  intentosRestantes = MAX_REINTENTOS,
  delayMs = 500
): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const esErrorRed =
      err instanceof TypeError || // fetch network error
      (err instanceof Error && err.name === 'AbortError') // timeout

    if (!esErrorRed || intentosRestantes <= 1) throw err

    console.warn(`[EDI] Reintentando en ${delayMs}ms (intentos restantes: ${intentosRestantes - 1})`)
    await new Promise((res) => setTimeout(res, delayMs))
    return conBackoff(fn, intentosRestantes - 1, delayMs * 2)
  }
}

// ─── Cliente X-Road Principal ─────────────────────────────────────────────────

/**
 * enviarPeticionXRoad — Envía una petición firmada al Security Server provincial.
 *
 * Headers X-Road obligatorios (especificación EDI Mendoza):
 *   - X-Road-Client: Identifica el nodo origen (RODAID)
 *   - X-Road-Service: Identifica el servicio destino en el Ministerio
 *   - X-Road-Id: UUID único de la transacción para auditoría cruzada
 *   - X-Road-Signature: Firma digital del payload (RODAID → Ministerio)
 *   - X-Road-Timestamp: Timestamp ISO del momento de la firma
 */
export async function enviarPeticionXRoad<T = unknown>(
  servicio: XRoadService,
  payload: XRoadPayload
): Promise<XRoadResponse<T>> {
  const transaccionId = crypto.randomUUID()
  const inicio = Date.now()

  let codigoRespuesta = 0
  let estado: 'EXITO' | 'ERROR' = 'ERROR'
  let respuestaRaw: string | undefined
  let errorMsg: string | undefined

  try {
    // 1. Firmar el payload antes de enviarlo
    const { payload: payloadFinal, firma, timestamp } = await signPayload(payload, transaccionId)

    // 2. Construir headers X-Road
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Road-Client': XROAD_CLIENT,
      'X-Road-Service': servicio,
      'X-Road-Id': transaccionId,
      'X-Road-Signature': firma,
      'X-Road-Timestamp': timestamp,
      // Header adicional RODAID: versión del protocolo
      'X-Road-Protocol-Version': '4.0',
    }

    // 3. Petición con AbortController (timeout estricto)
    const resultado = await conBackoff(async () => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

      try {
        const res = await fetch(EDI_ENDPOINT, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            transaccionId,
            timestamp,
            servicio,
            payload: payloadFinal,
            firma,
          }),
          signal: controller.signal,
        })

        codigoRespuesta = res.status
        respuestaRaw = await res.text()

        if (!res.ok) {
          throw new Error(`EDI respondió ${res.status}: ${respuestaRaw}`)
        }

        return JSON.parse(respuestaRaw) as T
      } finally {
        clearTimeout(timer)
      }
    })

    estado = 'EXITO'

    // 4. Registrar auditoría exitosa
    await auditService.registrar({
      transaccionId,
      servicio,
      timestamp: new Date().toISOString(),
      estado,
      codigoRespuesta,
      duracionMs: Date.now() - inicio,
      payload: JSON.stringify(payload),
      respuesta: respuestaRaw,
    })

    return {
      transaccionId,
      estado,
      codigoRespuesta,
      datos: resultado,
    }
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err)
    estado = 'ERROR'

    // 5. Registrar auditoría del error
    await auditService.registrar({
      transaccionId,
      servicio,
      timestamp: new Date().toISOString(),
      estado,
      codigoRespuesta,
      duracionMs: Date.now() - inicio,
      payload: JSON.stringify(payload),
      error: errorMsg,
    })

    console.error(`[EDI] Error en petición ${transaccionId} → ${servicio}:`, errorMsg)

    return {
      transaccionId,
      estado,
      codigoRespuesta,
      error: errorMsg,
    }
  }
}

// ─── Funciones de dominio RODAID ──────────────────────────────────────────────

/**
 * registrarCITenMinisterio — Notifica al Ministerio de Seguridad
 * la emisión de un nuevo Certificado de Identidad Técnica.
 *
 * Esto otorga validez jurídica al CIT ante controles en vía pública.
 */
export async function registrarCITenMinisterio(params: {
  citId: string
  codigoCit: string
  bicicletaSerial: string
  huellaSha256: string
  titular: string
  aliadoNombre: string
  fechaEmision: string
  fechaVencimiento: string
}): Promise<XRoadResponse> {
  return enviarPeticionXRoad('AR/GOV/SEGURIDAD/REGISTRAR_CIT', {
    tipo: 'CIT_EMISION',
    version: '1.0',
    ...params,
    sistema: 'RODAID',
    provinciaOrigen: 'MENDOZA',
  })
}

/**
 * verificarRodadoEnMinisterio — Consulta el historial de un rodado
 * en el sistema provincial (robos, denuncias, inhabilitaciones).
 */
export async function verificarRodadoEnMinisterio(params: {
  numeroSerie: string
  marca?: string
  modelo?: string
}): Promise<XRoadResponse> {
  return enviarPeticionXRoad('AR/GOV/SEGURIDAD/VERIFICAR_RODADO', {
    tipo: 'CONSULTA_RODADO',
    version: '1.0',
    ...params,
  })
}

/**
 * registrarAlertaHurto — Notifica al Ministerio una denuncia de hurto/robo.
 * Activa la alerta en el sistema provincial para controles en tiempo real.
 */
export async function registrarAlertaHurto(params: {
  citId: string
  numeroSerie: string
  titularCuil?: string
  fechaDenuncia: string
  expedienteMpf?: string
}): Promise<XRoadResponse> {
  return enviarPeticionXRoad('AR/GOV/SEGURIDAD/REGISTRAR_ALERTA_HURTO', {
    tipo: 'ALERTA_HURTO',
    version: '1.0',
    ...params,
  })
}
