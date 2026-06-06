// ─── RODAID · GET /api/v1/admin/analytics/resumen ─────────────────────────
//
// Endpoint de administración: devuelve el ResumenPeriodo de analítica de los
// últimos ?dias=1|7|30 (por defecto 7). A diferencia del Verificador, NO es
// público: expone inteligencia de tráfico, por lo que exige un bearer token.
//
// Autenticación: header `Authorization: Bearer <ANALYTICS_ADMIN_TOKEN>`.
//   · Si ANALYTICS_ADMIN_TOKEN no está configurado → 503 (cierra por defecto).
//   · Token ausente o inválido → 401.
//
// El resumen incluye `tasaAcierto`, que tras la corrección del filtrado de bots
// nunca supera el 100%.

import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { resumenPeriodo, normalizarDias } from '@/lib/analytics'

export const dynamic = 'force-dynamic'

/** Comparación en tiempo constante, robusta a diferencias de longitud. */
function tokenValido(provisto: string, esperado: string): boolean {
  const a = Buffer.from(provisto)
  const b = Buffer.from(esperado)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function GET(req: Request) {
  const esperado = process.env.ANALYTICS_ADMIN_TOKEN
  if (!esperado) {
    return NextResponse.json(
      {
        error: 'No configurado',
        mensaje:
          'La analítica de administración requiere definir ANALYTICS_ADMIN_TOKEN.',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  const auth = req.headers.get('authorization') ?? ''
  const provisto = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!provisto || !tokenValido(provisto, esperado)) {
    return NextResponse.json(
      { error: 'No autorizado' },
      {
        status: 401,
        headers: { 'Cache-Control': 'no-store', 'WWW-Authenticate': 'Bearer' },
      }
    )
  }

  const dias = normalizarDias(new URL(req.url).searchParams.get('dias'))

  try {
    const resumen = await resumenPeriodo(dias)
    return NextResponse.json(resumen, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('[analytics] resumen falló', err)
    return NextResponse.json(
      { error: 'No se pudo calcular el resumen de analítica' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
