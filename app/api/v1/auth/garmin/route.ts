import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.redirect(
    'https://rodaid.net/garaje?info=garmin_proximamente'
  )
}
