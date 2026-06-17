import { NextResponse } from 'next/server'
import {
  verificarClienteMtls,
  type ClienteMtls,
  type MtlsResultado,
} from '@/src/services/mtls.service'
import { auditar } from '@/src/services/ministerio.service'

/**
 * RODAID — Hito 12: utilidades HTTP de la integracion institucional.
 *
 * Aislamiento del endpoint (restriccion del hito): los endpoints del Ministerio
 * DENIEGAN por defecto. Antes de tocar cualquier logica de negocio se exige:
 *
 *   1) Aislamiento de red (opcional, defensa en profundidad): si esta definida
 *      `RODAID_MINISTERIO_IP_ALLOWLIST` (IPs separadas por coma), solo se atienden
 *      peticiones desde esas IPs. Pensado para combinarse con el aislamiento de
 *      red real de la plataforma (la lista es la ultima linea, no la unica).
 *   2) mTLS: certificado de cliente valido firmado por la CA del Ministerio.
 *
 * Cualquier fallo se audita (intento rechazado) y se responde 403, sin filtrar
 * detalle util a un atacante.
 */

/** IP de origen confiable en Netlify. */
export function obtenerIp(req: Request): string | null {
  const nf = req.headers.get('x-nf-client-connection-ip')
  if (nf && nf.trim()) return nf.trim()
  const xff = req.headers.get('x-forwarded-for')
  if (xff && xff.trim()) return xff.split(',')[0]!.trim()
  return req.headers.get('x-real-ip')?.trim() || null
}

function ipAllowlist(): Set<string> {
  const raw = process.env.RODAID_MINISTERIO_IP_ALLOWLIST ?? ''
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  )
}

export interface GateOk {
  ok: true
  cliente: ClienteMtls
  modo: MtlsResultado['modo']
}
export interface GateDenegado {
  ok: false
  response: NextResponse
}

/**
 * Aplica el aislamiento de red + el gate mTLS. Devuelve la identidad del cliente
 * si pasa, o una respuesta 403 ya construida (y auditada) si no.
 */
export async function gateMinisterio(
  req: Request,
  eventoRechazo: string
): Promise<GateOk | GateDenegado> {
  // 1) Aislamiento de red (si hay allowlist configurada).
  const allow = ipAllowlist()
  if (allow.size > 0) {
    const ip = obtenerIp(req)
    if (!ip || !allow.has(ip)) {
      await auditar({
        evento: eventoRechazo,
        cliente: null,
        serial: null,
        metadata: { motivo: 'ip_no_autorizada' },
      })
      return { ok: false, response: denegado('Acceso no autorizado.') }
    }
  }

  // 2) mTLS: certificado de cliente firmado por la CA del Ministerio.
  const mtls = verificarClienteMtls(req)
  if (!mtls.ok || !mtls.cliente) {
    await auditar({
      evento: eventoRechazo,
      cliente: null,
      serial: null,
      metadata: { motivo: mtls.motivo ?? 'mtls_rechazado', modo: mtls.modo },
    })
    return { ok: false, response: denegado('Se requiere un certificado de cliente válido del Ministerio.') }
  }

  return { ok: true, cliente: mtls.cliente, modo: mtls.modo }
}

function denegado(message: string): NextResponse {
  return NextResponse.json(
    { error: 'MTLS_REQUERIDO', message },
    {
      status: 403,
      // Pista estandar de que el recurso exige autenticacion por certificado.
      headers: { 'WWW-Authenticate': 'mTLS' },
    }
  )
}
