export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { enviarEmail } from '@/lib/email'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { nombre, email, telefono, localidad, plan } = body

    if (!nombre || !email) {
      return NextResponse.json({ error: 'Nombre y email son obligatorios' }, { status: 400 })
    }

    // Email al taller
    await enviarEmail({
      to: email,
      subject: 'Bienvenido a la Red de Talleres Aliados RODAID',
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f7f6f3;">
          <div style="background:#0F1E35;padding:24px;border-radius:12px;text-align:center;margin-bottom:24px;">
            <h1 style="color:white;margin:0;font-size:28px;">RODAID</h1>
            <p style="color:#2BBCB8;margin:8px 0 0;">Red de Talleres Aliados</p>
          </div>
          <div style="background:white;padding:24px;border-radius:12px;margin-bottom:16px;">
            <h2 style="color:#0F1E35;">Hola ${nombre},</h2>
            <p style="color:#555;line-height:1.6;">Gracias por tu interés en ser parte de la red de talleres aliados RODAID. Hemos recibido tu solicitud y nos pondremos en contacto contigo en las próximas 24 horas.</p>
            <div style="background:#f0fafa;padding:16px;border-radius:8px;margin:16px 0;border-left:4px solid #2BBCB8;">
              <p style="margin:0;color:#0F1E35;font-weight:bold;">¿Qué sigue?</p>
              <ul style="color:#555;margin:8px 0;padding-left:20px;">
                <li>Revisaremos tu solicitud</li>
                <li>Te contactaremos para agendar una visita</li>
                <li>Firmaremos el convenio de taller aliado</li>
                <li>Recibirás acceso al Panel Inspector RODAID</li>
              </ul>
            </div>
            <p style="color:#555;">Plan seleccionado: <strong style="color:#F47B20;">${plan ?? 'Aliado RODAID'}</strong></p>
            <p style="color:#555;">Localidad: <strong>${localidad ?? 'Mendoza'}</strong></p>
          </div>
          <div style="text-align:center;padding:16px;">
            <p style="color:#888;font-size:13px;">RODAID · San Martín, Mendoza · <a href="https://rodaid.net" style="color:#2BBCB8;">rodaid.net</a></p>
          </div>
        </div>
      `
    })

    // Email interno a RODAID
    await enviarEmail({
      to: process.env.ZOHO_SMTP_USER!,
      subject: `Nueva solicitud de taller aliado: ${nombre}`,
      html: `
        <div style="font-family:sans-serif;padding:24px;">
          <h2 style="color:#0F1E35;">Nueva solicitud de taller aliado</h2>
          <table style="border-collapse:collapse;width:100%;">
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Nombre</td><td style="padding:8px;border:1px solid #ddd;">${nombre}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Email</td><td style="padding:8px;border:1px solid #ddd;">${email}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Teléfono</td><td style="padding:8px;border:1px solid #ddd;">${telefono ?? 'No informado'}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Localidad</td><td style="padding:8px;border:1px solid #ddd;">${localidad ?? 'No informada'}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Plan</td><td style="padding:8px;border:1px solid #ddd;">${plan ?? 'No seleccionado'}</td></tr>
          </table>
        </div>
      `
    })

    return NextResponse.json({ ok: true, mensaje: 'Solicitud recibida. Te contactaremos pronto.' })
  } catch (e: unknown) {
    console.error('Error enviando email:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
