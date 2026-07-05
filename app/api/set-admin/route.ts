import { NextResponse } from 'next/server'

export async function GET() {
  const vars = Object.keys(process.env).filter(k => 
    k.includes('DB') || k.includes('DATABASE') || k.includes('NETLIFY') || k.includes('NEON') || k.includes('POSTGRES')
  )
  return NextResponse.json({ vars, nodeEnv: process.env.NODE_ENV })
}

export async function POST() {
  return NextResponse.json({ msg: 'use GET to debug' })
}
