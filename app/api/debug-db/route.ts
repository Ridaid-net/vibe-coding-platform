import { NextResponse } from 'next/server'

export async function GET() {
  const vars = Object.keys(process.env).filter(k => 
    k.includes('DB') || k.includes('DATABASE') || k.includes('NETLIFY') || k.includes('NEON') || k.includes('POSTGRES') || k.includes('URL')
  )
  return NextResponse.json({ vars, nodeEnv: process.env.NODE_ENV })
}
