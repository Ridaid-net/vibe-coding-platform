import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import {
  limpiarSerial,
  parseFotosHashes,
  parseGps,
  parseInspeccion,
  parseTextoOpcional,
  parseUuid,
} from '@/lib/cit'
import { iniciarCIT } from '@/src/services/cit.service'

export const runtime = 'nodejs'

interface IniciarBody {
  aliadoId?: unknown
  aliado_id?: unknown
  aliadoNombre?: unknown
  aliado_nombre?: unknown
  ciclistaId?: unknown
  ciclista_id?: unknown
  bicicletaSerial?: unknown
  bicicleta_serial?: unknown
  inspeccion20Puntos?: unknown
  inspeccion?: unknown
  coordenadasGPS?: unknown
  coordenadas_gps?: unknown
  fotosHashes?: unknown
  fotos_hashes?: unknown
}

/**
 * POST /api/v1/cit/iniciar
 *
 * El aliado (taller) envia la inspeccion de 20 puntos del rodado. En el intake
 * se calcula la huella SHA-256 + firma HMAC y se congelan los datos: el
 * certificado nace en PENDIENTE_VALIDACION con una ventana de 72 hs.
 */
export async function POST(req: Request) {
  try {
    const [user, body] = await Promise.all([
      requireUser(req),
      req.json().catch(() => ({})) as Promise<IniciarBody>,
    ])

    // Control de anomalias (fase temprana): aliadoId y bicicletaSerial no vacios.
    const aliadoId = parseUuid(body.aliadoId ?? body.aliado_id, 'aliadoId')
    const bicicletaSerial = limpiarSerial(body.bicicletaSerial ?? body.bicicleta_serial)

    // El intake debe provenir del propio aliado autenticado.
    if (aliadoId !== user.id) {
      throw new ApiError(
        403,
        'ALIADO_MISMATCH',
        'El aliadoId no coincide con el usuario autenticado.'
      )
    }

    const resultado = await iniciarCIT({
      aliadoId,
      ciclistaId: parseUuid(body.ciclistaId ?? body.ciclista_id, 'ciclistaId'),
      bicicletaSerial,
      aliadoNombre: parseTextoOpcional(
        body.aliadoNombre ?? body.aliado_nombre,
        'aliadoNombre',
        160
      ),
      inspeccion: parseInspeccion(body.inspeccion20Puntos ?? body.inspeccion),
      coordenadasGps: parseGps(body.coordenadasGPS ?? body.coordenadas_gps),
      fotosHashes: parseFotosHashes(body.fotosHashes ?? body.fotos_hashes),
    })

    return NextResponse.json(
      {
        success: true,
        mensaje: 'Inspección CIT recibida. Pipeline de 72 hs iniciado.',
        citId: resultado.cit.id,
        hash: resultado.huella,
        estado: 'PENDIENTE_VALIDACION',
        alerta_gps: resultado.alertaGps,
        geocerca: resultado.geocerca,
        expira_en: resultado.expiraEn,
        cit: resultado.cit,
      },
      { status: 201 }
    )
  } catch (error) {
    return jsonError(error)
  }
}
