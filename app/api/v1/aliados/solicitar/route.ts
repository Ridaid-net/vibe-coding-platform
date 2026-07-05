import { NextResponse } from 'next/server'
import { enviarEmail } from '@/lib/email'
import { jsonError, requireAuth } from '@/lib/marketplace'
import { solicitarAliado } from '@/src/services/aliados.service'

export const runtime = 'nodejs'

interface Body {
  nombre?: unknown
  tipo?: unknown
  email?: unknown
  telefono?: unknown
  direccion?: unknown
  ciudad?: unknown
  cuit?: unknown
}

/**
 * POST /api/v1/aliados/solicitar — Solicitud de un taller/tienda para ser Aliado.
 *
 * Endpoint ABIERTO: cualquier taller puede solicitarlo. Si llega autenticado
 * (Bearer), esa cuenta queda como duena del aliado y, al aprobarse, recibe el
 * rol 'aliado' para acceder al panel de inspecciones. La solicitud queda en
 * estado 'pendiente' a la espera de la aprobacion de un admin.
 */
export async function POST(req: Request) {
  try {
    // Auth opcional: si hay un token valido, vinculamos la cuenta duena.
    let usuarioId: string | null = null
    if (/^Bearer\s+/i.test(req.headers.get('authorization') ?? '')) {
      try {
        const user = await requireAuth(req)
        usuarioId = user.id
      } catch {
        // Token invalido: se procesa como solicitud anonima.
      }
    }

    const body = (await req.json().catch(() => ({}))) as Body
    const aliado = await solicitarAliado(
      {
        nombre: String(body.nombre ?? ''),
        tipo: typeof body.tipo === 'string' ? body.tipo : undefined,
        email: String(body.email ?? ''),
        telefono: typeof body.telefono === 'string' ? body.telefono : null,
        direccion: typeof body.direccion === 'string' ? body.direccion : null,
        ciudad: typeof body.ciudad === 'string' ? body.ciudad : null,
        cuit: typeof body.cuit === 'string' ? body.cuit : null,
      },
      usuarioId
    )


    const nombreTaller = String(body.nombre ?? '')
    const emailTaller = String(body.email ?? '')
    const ciudadTaller = typeof body.ciudad === 'string' ? body.ciudad : 'Mendoza'
    const telefonoTaller = typeof body.telefono === 'string' ? body.telefono : 'No informado'
    try {
      await enviarEmail({
        to: emailTaller,
        subject: 'Bienvenido a la Red de Talleres Aliados RODAID',
        html: '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#f7f6f3;"><div style="background:#0F1E35;padding:32px;text-align:center;"><h1 style="color:white;margin:0;font-size:32px;font-weight:900;">RODAID</h1><p style="color:#2BBCB8;margin:6px 0 0;font-size:14px;">Red de Talleres Aliados · Mendoza</p></div><div style="padding:32px;"><div style="background:white;padding:28px;border-radius:16px;margin-bottom:20px;"><h2 style="color:#0F1E35;margin-top:0;">Hola ' + nombreTaller + ',</h2><p style="color:#555;line-height:1.7;">Gracias por tu interés en ser parte de la <strong>red de talleres aliados RODAID</strong>. Hemos recibido tu solicitud y nos pondremos en contacto contigo en las próximas <strong>24 horas hábiles</strong>.</p><div style="background:#f0fafa;padding:20px;border-radius:12px;margin:20px 0;border-left:4px solid #2BBCB8;"><p style="margin:0 0 8px;color:#0F1E35;font-weight:700;">Que sigue?</p><ul style="color:#555;margin:0;padding-left:20px;line-height:2;"><li>Revisaremos tu solicitud</li><li>Te contactaremos para coordinar una visita</li><li>Firmaremos el convenio de Taller Aliado RODAID</li><li>Recibirás acceso al Panel Inspector Digital</li><li>Comenzarás a emitir CITs y generar ingresos desde el mes 1</li></ul></div><div style="background:#fff8f0;padding:16px;border-radius:12px;border:1px solid #F47B20;"><p style="margin:0;color:#F47B20;font-weight:700;">Tu beneficio como taller aliado</p><p style="margin:8px 0 0;color:#555;">Recibis el <strong>60% del valor de cada CIT emitido</strong> — $10.800 ARS por certificacion. Las alertas de mantenimiento predictivo generan visitas recurrentes.</p></div></div><div style="text-align:center;padding:16px;"><a href="https://rodaid.net/aliados" style="background:#F47B20;color:white;padding:12px 28px;border-radius:999px;text-decoration:none;font-weight:700;">Ver mas sobre ser Aliado RODAID</a></div></div><div style="background:#0F1E35;padding:20px;text-align:center;"><p style="color:#888;font-size:12px;margin:0;">RODAID SAS · San Martin, Mendoza · <a href="https://rodaid.net" style="color:#2BBCB8;">rodaid.net</a></p></div></div>'
      })
      await enviarEmail({
        to: process.env.ZOHO_SMTP_USER ?? 'federicodegeaceo@rodaid.net',
        subject: 'Nueva solicitud de taller aliado: ' + nombreTaller,
        html: '<div style="font-family:sans-serif;max-width:600px;padding:24px;"><div style="background:#0F1E35;padding:20px;border-radius:12px;text-align:center;margin-bottom:20px;"><h2 style="color:white;margin:0;">RODAID · Nueva Solicitud Aliado</h2></div><table style="border-collapse:collapse;width:100%;background:white;"><tr style="background:#f7f6f3;"><td style="padding:10px 16px;font-weight:700;color:#0F1E35;">Taller</td><td style="padding:10px 16px;">' + nombreTaller + '</td></tr><tr><td style="padding:10px 16px;font-weight:700;color:#0F1E35;border-top:1px solid #eee;">Email</td><td style="padding:10px 16px;border-top:1px solid #eee;">' + emailTaller + '</td></tr><tr style="background:#f7f6f3;"><td style="padding:10px 16px;font-weight:700;color:#0F1E35;border-top:1px solid #eee;">Telefono</td><td style="padding:10px 16px;border-top:1px solid #eee;">' + telefonoTaller + '</td></tr><tr><td style="padding:10px 16px;font-weight:700;color:#0F1E35;border-top:1px solid #eee;">Ciudad</td><td style="padding:10px 16px;border-top:1px solid #eee;">' + ciudadTaller + '</td></tr></table><div style="margin-top:20px;text-align:center;"><a href="https://rodaid.net/admin" style="background:#0F1E35;color:white;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:700;">Ver en Panel Admin</a></div></div>'
      })
    } catch (emailErr) {
      console.error('Error email aliado:', emailErr)
    }
    return NextResponse.json({ aliado }, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
