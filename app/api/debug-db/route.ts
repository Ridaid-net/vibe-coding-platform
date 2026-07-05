import { NextResponse } from 'next/server'

export async function GET() {
  const dbUrl = process.env.NETLIFY_DB_URL ?? ''
  let parsed = {}
  try {
    const url = new URL(dbUrl)
    parsed = {
      protocol: url.protocol,
      hostname: url.hostname,
      username: url.username ? 'SET' : 'EMPTY',
      password: url.password ? 'SET' : 'EMPTY',
      pathname: url.pathname,
    }
  } catch (e) {
    parsed = { error: String(e) }
  }
  return NextResponse.json({ parsed, driver: process.env.NETLIFY_DB_DRIVER })
}
