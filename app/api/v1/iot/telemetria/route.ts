import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import {
  autenticarDispositivo,
  ingestarTelemetria,
  type TramaTelemetria,
} from '@/src/services/iot.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/iot/telemetria — Hito 17: Ingesta de Telemetria (HTTP optimizado).
 *
 * Endpoint de alta concurrencia que recibe las tramas de los dispositivos GPS /
 * sensores IoT. Es la alternativa serverless al broker MQTT (un broker externo
 * puede puentear las tramas a este endpoint sin cambios): autentica el
 * dispositivo por sus credenciales, valida la trama contra el serial del cuadro
 * vinculado al CIT del usuario, persiste el estado y devuelve la directiva de
 * bajo consumo.
 *
 * Autenticacion del dispositivo (no es un usuario):
 *   - `x-device-uid` + `x-device-secret` (headers), o los mismos campos en el body.
 *
 * Respuesta: { aceptada, alertas, directiva } — la directiva indica la cadencia de
 * reporte sugerida para que la bateria dure >= 6 meses.
 */
interface Body extends TramaTelemetria {
  deviceUid?: string | null
  deviceSecret?: string | null
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body
    const deviceUid =
      req.headers.get('x-device-uid') ?? (body.deviceUid ?? '')
    const deviceSecret =
      req.headers.get('x-device-secret') ?? (body.deviceSecret ?? '')

    const device = await autenticarDispositivo(deviceUid, deviceSecret)
    const resultado = await ingestarTelemetria(device, {
      serial: body.serial ?? null,
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      precision: body.precision ?? null,
      nivelBateria: body.nivelBateria ?? null,
      velocidadKmh: body.velocidadKmh ?? null,
      acelerometro: body.acelerometro ?? null,
      ts: body.ts ?? null,
    })

    return NextResponse.json(resultado, {
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    return jsonError(error)
  }
}
