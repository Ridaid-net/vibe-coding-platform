import { NextResponse } from 'next/server'
import { gateMinisterio } from '@/lib/ministerio-http'
import { procesarRecupero, auditar } from '@/src/services/ministerio.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/seguridad/institucional/recupero — Hito 12.
 *
 * Webhook INVERSO de recupero: el Ministerio de Seguridad notifica a RODAID que
 * una bicicleta fue recuperada. AISLADO y protegido por mTLS (misma CA que el
 * cross-reference).
 *
 * Al recibir el aviso, el sistema:
 *   a. localiza el CIT de la bici (por numero de serie),
 *   b. desbloquea su estado (bloqueado -> activo),
 *   c. dispara el evento de notificacion push al propietario (Hito 10).
 *
 * Idempotente por `evento_uid`. La comunicacion es ASINCRONA respecto a los
 * procesos de negocio: el aviso se registra de forma durable y el acuse al
 * Ministerio (202) no depende de la entrega del push, que se emite por el bus de
 * eventos best-effort. El payload del Ministerio se guarda CIFRADO en reposo.
 */
export async function POST(req: Request) {
  const gate = await gateMinisterio(req, 'RECUPERO_RECHAZADO')
  if (!gate.ok) return gate.response

  let body: {
    serial?: unknown
    numero_serie?: unknown
    expediente?: unknown
    evento_uid?: unknown
    eventoUid?: unknown
  } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    body = {}
  }

  const serial =
    typeof body.serial === 'string'
      ? body.serial
      : typeof body.numero_serie === 'string'
        ? body.numero_serie
        : ''

  if (!serial || serial.trim().length < 3) {
    await auditar({
      evento: 'RECUPERO',
      cliente: gate.cliente,
      serial: null,
      metadata: { modo: gate.modo, error: 'serial_invalido' },
    })
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: 'El número de serie es obligatorio.' },
      { status: 400 }
    )
  }

  const expediente =
    typeof body.expediente === 'string' ? body.expediente : null
  const eventoUid =
    typeof body.evento_uid === 'string'
      ? body.evento_uid
      : typeof body.eventoUid === 'string'
        ? body.eventoUid
        : null

  try {
    const resultado = await procesarRecupero({
      serial,
      expediente,
      eventoUid,
      payloadOriginal: body,
      cliente: gate.cliente,
    })

    await auditar({
      evento: 'RECUPERO',
      cliente: gate.cliente,
      serial: serial.toUpperCase().replace(/[^A-Z0-9]/g, ''),
      expediente,
      metadata: {
        modo: gate.modo,
        estado: resultado.estado,
        desbloqueada: resultado.desbloqueada,
        notificado: resultado.notificado,
      },
    })

    // 202 Accepted: el aviso fue recibido y registrado de forma durable; el
    // procesamiento de negocio (notificacion) es asincrono respecto al acuse.
    return NextResponse.json(
      {
        recibido: true,
        estado: resultado.estado,
        desbloqueada: resultado.desbloqueada,
      },
      { status: 202, headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('[ministerio] recupero fallo', error)
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'No se pudo procesar el aviso de recupero.' },
      { status: 500 }
    )
  }
}
