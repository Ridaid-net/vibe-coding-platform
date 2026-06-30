import { NextResponse } from 'next/server'
import { jsonError, requireStaff } from '@/lib/marketplace'
import { emitirCredencialDemo, getMtlsModo } from '@/src/services/mtls.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/seguridad/institucional/credencial-demo — Hito 12 (solo preview/DEV).
 *
 * Emite una credencial de cliente (certificado + clave privada) firmada por la CA
 * efimera de preview del Ministerio, para poder EJERCITAR el flujo mTLS de punta
 * a punta sin una CA real. El PEM resultante (campo `header_value`, URL-encoded)
 * se envia luego en el header `x-client-cert` al llamar al cross-reference o al
 * webhook de recupero.
 *
 * Restringido al back-office (rol admin / token de sistema). En modo LIVE NO esta
 * disponible: alli el Ministerio emite las credenciales con su propia CA y RODAID
 * nunca posee su clave privada.
 */
export async function GET(req: Request) {
  try {
    await requireStaff(req, 'admin')

    if (getMtlsModo() === 'LIVE') {
      return NextResponse.json(
        {
          error: 'NO_DISPONIBLE_EN_LIVE',
          message:
            'La credencial de demo solo existe en modo preview. En LIVE el Ministerio emite las credenciales con su CA.',
        },
        { status: 409 }
      )
    }

    const cred = emitirCredencialDemo()
    return NextResponse.json(
      {
        modo: 'DEV',
        descripcion:
          'Credencial de cliente de DEMO firmada por la CA efimera del Ministerio. Enviá el certificado en el header x-client-cert (usá header_value, ya URL-encoded).',
        common_name: cred.commonName,
        certificado_pem: cred.certificadoPem,
        clave_privada_pem: cred.clavePrivadaPem,
        ca_pem: cred.caPem,
        header_name: 'x-client-cert',
        header_value: cred.headerValue,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    return jsonError(error)
  }
}
