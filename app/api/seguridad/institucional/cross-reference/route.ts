import { NextResponse } from 'next/server'
import { gateMinisterio } from '@/lib/ministerio-http'
import {
  crossReference,
  auditar,
  DniInvalidoError,
  SerialInvalidoError,
} from '@/src/services/ministerio.service'

export const runtime = 'nodejs'
// Endpoint institucional: nunca cacheable a nivel framework (cada consulta se
// audita y la cache de denuncias se gestiona en el servicio, no en el CDN).
export const dynamic = 'force-dynamic'

/**
 * POST /api/seguridad/institucional/cross-reference — Hito 12.
 *
 * Intercambio seguro RODAID <-> Ministerio de Seguridad. AISLADO y protegido por
 * mTLS: rechaza toda peticion que no presente un certificado de cliente valido
 * firmado por la Autoridad Certificadora del Ministerio.
 *
 * Recibe : { serial, propietario_dni }  (DNI con validacion estricta)
 * Retorna: { alerta_activa, tipo_alerta (robo|discrepancia|normal), expediente }
 *
 * SLA: la resolucion se apoya en una cache read-through de denuncias activas para
 * responder en < 2 s. Cada consulta queda en la bitacora inmutable
 * `ministerio_auditoria` (quien / cuando / que serial), con el DNI cifrado.
 */
export async function POST(req: Request) {
  const inicio = Date.now()

  const gate = await gateMinisterio(req, 'CROSS_REFERENCE_RECHAZADO')
  if (!gate.ok) return gate.response

  let body: { serial?: unknown; propietario_dni?: unknown; dni?: unknown } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    body = {}
  }

  const serial = typeof body.serial === 'string' ? body.serial : ''
  const dniRaw =
    typeof body.propietario_dni === 'string'
      ? body.propietario_dni
      : typeof body.dni === 'string'
        ? body.dni
        : ''

  try {
    const { respuesta, interno, serialNorm, dniNorm } = await crossReference({
      serial,
      dni: dniRaw,
      cliente: gate.cliente,
    })

    const latenciaMs = Date.now() - inicio

    // Auditoria inmutable (quien / cuando / que serial). DNI cifrado en reposo.
    await auditar({
      evento: 'CROSS_REFERENCE',
      cliente: gate.cliente,
      serial: serialNorm,
      dni: dniNorm,
      alertaActiva: respuesta.alerta_activa,
      tipoAlerta: respuesta.tipo_alerta,
      expediente: respuesta.expediente,
      metadata: { modo: gate.modo, latencia_ms: latenciaMs, bicicleta_id: interno.bicicletaId },
    })

    return NextResponse.json(
      {
        alerta_activa: respuesta.alerta_activa,
        tipo_alerta: respuesta.tipo_alerta,
        expediente: respuesta.expediente,
        consultado_en: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'X-Response-Time-ms': String(latenciaMs),
        },
      }
    )
  } catch (error) {
    if (error instanceof DniInvalidoError || error instanceof SerialInvalidoError) {
      await auditar({
        evento: 'CROSS_REFERENCE',
        cliente: gate.cliente,
        serial: serial.slice(0, 120) || null,
        metadata: { modo: gate.modo, error: 'validacion', detalle: error.name },
      })
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: error.message },
        { status: 400 }
      )
    }
    console.error('[ministerio] cross-reference fallo', error)
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'No se pudo procesar la consulta.' },
      { status: 500 }
    )
  }
}
