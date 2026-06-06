// RODAID — Modulo 4 (CIT): endpoint de verificacion criptografica.
//
// Verifica la INTEGRIDAD y la AUTENTICIDAD de un Certificado de Identidad Tecnica
// ya sellado, recalculando su sello byte a byte. El sello tiene dos piezas, que se
// validan de forma independiente:
//
//   1. Huella  : SHA-256 sobre la cadena canonica EXACTA que se hasheo en el intake
//                (`snapshot_canonico`, guardada como texto plano sin reformatear).
//                Se recalcula y se compara contra `huella_sha256`. Detecta cualquier
//                manipulacion del contenido certificado -> INTEGRIDAD.
//   2. Firma   : HMAC-SHA256 de la huella con el secreto de RODAID. Se recalcula y
//                se compara contra `firma_hmac`. Acredita que la huella fue emitida
//                por la plataforma -> AUTENTICIDAD.
//
// Toda la criptografia usa exclusivamente el modulo nativo `node:crypto` (sin
// dependencias externas) y el secreto vive solo en la variable de entorno
// `CIT_FIRMA_SECRET`: nunca viaja en la request ni se devuelve en la respuesta. La
// comparacion final es byte a byte y en tiempo constante (`timingSafeEqual`), de
// modo que no filtre informacion por diferencias de tiempo.
//
// Es un endpoint de lectura: no muta el certificado ni toca el sello, por lo que la
// inmutabilidad garantizada por el trigger `cit_proteger_payload` no se ve afectada.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { getDatabase } from '@netlify/database'

// Forma minima del contexto de Netlify que usa esta funcion (parametros de ruta).
// Se declara localmente para no depender de los tipos de `@netlify/functions`.
type FnContext = { params?: Record<string, string | undefined> }

// Mismo algoritmo declarado por el nucleo de sellado (lib/cit.ts).
const CIT_ALGORITMO = 'SHA-256+HMAC-SHA256'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// La huella es un SHA-256 en hexadecimal (64 caracteres).
const SHA256_HEX_RE = /^[0-9a-f]{64}$/i

interface CitRow {
  id: string
  estado: string
  huella_sha256: string
  firma_hmac: string
  algoritmo: string
  snapshot_canonico: string
  sellado_en: string
  bfa_estado: string
  bfa_tx_hash: string | null
  acunado_en: string | null
}

/**
 * Secreto de firma de RODAID. Vive solo en la variable de entorno; si no esta
 * configurada se reutiliza el secreto de autenticacion de la plataforma, igual que
 * en el nucleo de sellado. Nunca se devuelve al cliente.
 */
function obtenerSecretoFirma(): string | null {
  return (
    Netlify.env.get('CIT_FIRMA_SECRET') ??
    Netlify.env.get('AUTH_SECRET') ??
    Netlify.env.get('JWT_SECRET') ??
    null
  )
}

/**
 * Comparacion byte a byte en tiempo constante de dos cadenas hexadecimales. Primero
 * descarta longitudes distintas (condicion previa de `timingSafeEqual`) y luego
 * delega en la primitiva nativa, que no corta al primer byte distinto.
 */
function igualesEnTiempoConstante(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) {
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function jsonError(status: number, code: string, message: string): Response {
  return jsonResponse({ error: code, message }, status)
}

/**
 * Resuelve la clave de busqueda del certificado a partir de la URL: el id de ruta
 * (`/api/cit/verificar/:id`), o los query params `?id=` / `?huella=`.
 */
function resolverConsulta(
  url: URL,
  paramId: string | undefined
): { sql: string; valor: string } | { error: Response } {
  const id = paramId ?? url.searchParams.get('id') ?? undefined
  if (id) {
    if (!UUID_RE.test(id)) {
      return {
        error: jsonError(400, 'VALIDATION_ERROR', 'El id del certificado debe ser un UUID valido.'),
      }
    }
    return { sql: `SELECT * FROM cits WHERE id = $1`, valor: id.toLowerCase() }
  }

  const huella = url.searchParams.get('huella') ?? undefined
  if (huella) {
    if (!SHA256_HEX_RE.test(huella)) {
      return {
        error: jsonError(400, 'VALIDATION_ERROR', 'La huella debe ser un SHA-256 hexadecimal de 64 caracteres.'),
      }
    }
    return { sql: `SELECT * FROM cits WHERE huella_sha256 = $1`, valor: huella.toLowerCase() }
  }

  return {
    error: jsonError(
      400,
      'VALIDATION_ERROR',
      'Indica el certificado a verificar por id (en la ruta o ?id=) o por ?huella=.'
    ),
  }
}

export default async (req: Request, context: FnContext): Promise<Response> => {
  if (req.method !== 'GET') {
    return jsonError(405, 'METHOD_NOT_ALLOWED', 'Este endpoint solo acepta GET.')
  }

  const secreto = obtenerSecretoFirma()
  if (!secreto) {
    // Sin secreto no se puede revalidar la firma: es un error de configuracion, no
    // del cliente. No se revela ningun detalle del secreto.
    return jsonError(
      500,
      'CIT_FIRMA_NO_CONFIGURADA',
      'No hay secreto de firma configurado para verificar certificados.'
    )
  }

  const url = new URL(req.url)
  const consulta = resolverConsulta(url, context.params?.id)
  if ('error' in consulta) {
    return consulta.error
  }

  let cit: CitRow | undefined
  try {
    const { rows } = await getDatabase().pool.query<CitRow>(consulta.sql, [consulta.valor])
    cit = rows[0]
  } catch (error) {
    console.error('[api-cit-verificar] fallo la consulta del certificado', error)
    return jsonError(500, 'INTERNAL_ERROR', 'No se pudo procesar la verificacion.')
  }

  if (!cit) {
    return jsonError(404, 'CIT_NOT_FOUND', 'El certificado no existe.')
  }

  // ── Validacion criptografica byte a byte ──────────────────────────────────
  // 1) Integridad: recalcular la huella desde la cadena canonica sellada (sin
  //    reserializar: se hashea el texto exacto guardado) y compararla con la huella
  //    persistida.
  const huellaRecalculada = createHash('sha256')
    .update(cit.snapshot_canonico, 'utf8')
    .digest('hex')
  const huellaCoincide = igualesEnTiempoConstante(huellaRecalculada, cit.huella_sha256)

  // 2) Autenticidad: recalcular el HMAC-SHA256 de la huella persistida con el
  //    secreto de RODAID y compararlo con la firma guardada.
  const firmaRecalculada = createHmac('sha256', secreto)
    .update(cit.huella_sha256)
    .digest('hex')
  const firmaValida = igualesEnTiempoConstante(firmaRecalculada, cit.firma_hmac)

  const integro = huellaCoincide && firmaValida

  return jsonResponse({
    citId: cit.id,
    estado: cit.estado,
    integro,
    huellaCoincide,
    firmaValida,
    algoritmo: cit.algoritmo ?? CIT_ALGORITMO,
    huellaSHA256: cit.huella_sha256,
    huellaRecalculada,
    selladoEn: cit.sellado_en,
    bfa: {
      estado: cit.bfa_estado,
      txHash: cit.bfa_tx_hash,
      acunadoEn: cit.acunado_en,
    },
  })
}

export const config = {
  // Ruta amigable propia. No colisiona con las rutas Next del proyecto (que viven
  // bajo /api/v1/...). Acepta el id como parametro de ruta o como query (?id=/?huella=).
  path: ['/api/cit/verificar/:id', '/api/cit/verificar'],
  method: 'GET',
}
