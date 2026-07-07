export const runtime = 'nodejs'
import { NextResponse } from 'next/server'

export async function GET() {
  // Garmin Activity API pendiente de aprobación developer
  // https://developer.garmin.com/gc-developer-program/activity-api/
  return NextResponse.json({
    ok: false,
    proximamente: true,
    conectado: false,
    mensaje: 'Integración Garmin en proceso de aprobación. Disponible próximamente.'
  })
}
