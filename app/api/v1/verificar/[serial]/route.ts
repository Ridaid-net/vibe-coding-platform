// ─── RODAID · GET /api/v1/verificar/[serial] ──────────────────────────────
//
// Endpoint público del Verificador (Tarea 6). Recibe un número de serie,
// consulta la capa de datos (mockApi + Netlify Blobs) y devuelve la
// respuesta pública unificada: estado canónico, datos de la bicicleta,
// inspección, propietario anonimizado, validación BFA, sello temporal y firma.
//
// No requiere autenticación: la respuesta ya viene anonimizada y sin datos
// internos. Cachea en CDN respuestas encontradas (5 min) y acota las no
// encontradas (30 s) para mitigar DoS por sondeo de seriales.
//
// Al ser un endpoint público sin auth, se protege con el escudo perimetral
// anti-abuso (lib/rateLimiter): blocklist + burst (20/10s) + verificador
// (100/min) por IP, con bloqueos escalonados por strikes. Todas las respuestas
// —200 y 429— inyectan los headers estándar RFC 6585.

import { NextResponse } from 'next/server'
import { getCITBySerial } from '@/lib/mockApi'
import { armarVerificacion, respuestaNoEncontrada } from '@/lib/verificador'
import { aplicarRateLimit } from '@/lib/rateLimiter'

export const dynamic = 'force-dynamic'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ serial: string }> }
) {
  const t0 = Date.now()

  // ── Escudo perimetral: rate limiting por IP ──────────────────────────────
  // Se evalúa antes de tocar la capa de datos. Si la guardia rechaza, se
  // responde 429 con los headers RFC 6585 (incluido Retry-After) ya armados.
  const guardia = await aplicarRateLimit(req)
  if (!guardia.ok) {
    return NextResponse.json(guardia.body, {
      status: guardia.status,
      headers: { ...guardia.headers, 'Cache-Control': 'no-store' },
    })
  }
  // Headers de rate limit inyectados en toda respuesta exitosa.
  const rlHeaders = guardia.headers

  const { serial: rawSerial } = await params
  const serial = decodeURIComponent(rawSerial ?? '').trim().toUpperCase()

  if (!serial) {
    return NextResponse.json(
      { error: 'Serial requerido' },
      { status: 400, headers: rlHeaders }
    )
  }

  try {
    const registro = await getCITBySerial(serial)

    if (!registro) {
      // Se responde 200 con `encontrado: false` (no 404): la consulta de
      // verificación se resolvió correctamente, la bicicleta simplemente no
      // está registrada. Devolver 404 haría que la capa estática de Netlify
      // sirviera su página HTML de error en lugar de este JSON. El TTL corto
      // acota el sondeo de seriales.
      const resp = respuestaNoEncontrada(serial, t0)
      return NextResponse.json(resp, {
        status: 200,
        headers: { ...rlHeaders, 'Cache-Control': 'public, max-age=30' },
      })
    }

    const resp = armarVerificacion(registro, t0)
    return NextResponse.json(resp, {
      status: 200,
      headers: {
        ...rlHeaders,
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
      },
    })
  } catch (err) {
    // La capa BFA y la anonimización son resilientes por diseño; un error aquí
    // es de infraestructura. Se responde 200 con "no encontrado" antes que
    // exponer un 500 al público.
    console.error('verificar error', err)
    const resp = respuestaNoEncontrada(serial, t0)
    return NextResponse.json(resp, {
      status: 200,
      headers: { ...rlHeaders, 'Cache-Control': 'no-store' },
    })
  }
}
