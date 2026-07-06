import { NextResponse } from 'next/server'
import { enviarEmail } from '@/lib/email'
import { getPool } from '@/lib/marketplace'
import { ApiError, jsonError, optionalText, requireStaff } from '@/lib/marketplace'
import { resolverAliado } from '@/src/services/aliados.service'

export const runtime = 'nodejs'

interface Body {
  accion?: unknown
  motivo?: unknown
}

/**
 * POST /api/v1/admin/aliados/[id]/aprobar — Aprueba o rechaza una solicitud.
 *
 * Restringido a staff (rol admin via JWT o token de sistema). Al aprobar, si el
 * aliado tiene una cuenta duena (ciclista), su rol pasa a 'aliado' para acceder
 * al panel de inspecciones. Body: { accion: 'aprobar' | 'rechazar', motivo? }.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const staff = await requireStaff(req, 'admin')
    const body = (await req.json().catch(() => ({}))) as Body

    const accion = optionalText(body.accion)?.toLowerCase()
    if (accion !== 'aprobar' && accion !== 'rechazar') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'accion debe ser aprobar o rechazar.')
    }

    const resultado = await resolverAliado({
      aliadoId: id,
      adminId: staff.id,
      accion,
      motivo: optionalText(body.motivo),
    })

    // Enviar email si fue aprobado
    if (accion === 'aprobar') {
      try {
        const pool = getPool()
        const aliado = await pool.query('SELECT nombre, email, ciudad FROM aliados WHERE id = $1', [id])
        const row = aliado.rows[0]
        if (row?.email) {
          const logoB64 = require('fs').readFileSync(process.cwd() + '/public/logo-rodaid.jpeg').toString('base64')
          const logoSrc = 'data:image/jpeg;base64,' + logoB64
          await enviarEmail({
            to: row.email,
            subject: 'RODAID — Tu solicitud fue aprobada. Convenio de Taller Aliado',
            html: '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#f7f6f3;"><div style="background:#0F1E35;padding:32px;text-align:center;"><img src="' + logoSrc + '" alt="RODAID" style="height:70px;margin-bottom:12px;border-radius:12px;" /><h1 style="color:white;margin:0;font-size:32px;font-weight:900;">RODAID</h1><p style="color:#2BBCB8;margin:6px 0 0;font-size:14px;">Red de Talleres Aliados · Mendoza</p></div><div style="padding:32px;"><div style="background:white;padding:28px;border-radius:16px;margin-bottom:20px;"><h2 style="color:#0F1E35;margin-top:0;">Felicitaciones ' + row.nombre + '!</h2><p style="color:#555;line-height:1.7;">Tu solicitud para ser <strong>Taller Aliado RODAID</strong> fue <strong style="color:#2BBCB8;">aprobada</strong>. Ya formas parte de la red oficial de talleres certificados de Mendoza.</p><div style="background:#f0fafa;padding:20px;border-radius:12px;margin:20px 0;border-left:4px solid #2BBCB8;"><p style="margin:0 0 8px;color:#0F1E35;font-weight:700;">Proximos pasos:</p><ul style="color:#555;margin:0;padding-left:20px;line-height:2;"><li>Firma del Convenio de Taller Aliado RODAID</li><li>Activacion de tu cuenta en el Panel Inspector</li><li>Capacitacion en el sistema CIT (20 puntos)</li><li>Primera emision de CIT — Comision: 0.800 ARS</li></ul></div><div style="background:#fff8f0;padding:16px;border-radius:12px;border:1px solid #F47B20;margin-bottom:16px;"><p style="margin:0;color:#F47B20;font-weight:700;">Convenio de Taller Aliado</p><p style="margin:8px 0 0;color:#555;">Para formalizar tu incorporacion a la red, necesitamos que firmes el Convenio de Taller Aliado RODAID. Nos pondremos en contacto en las proximas 24hs para coordinar la firma.</p></div><div style="background:#f7f6f3;padding:16px;border-radius:12px;"><p style="margin:0 0 8px;color:#0F1E35;font-weight:700;">Tus beneficios como Taller Aliado:</p><ul style="color:#555;margin:0;padding-left:20px;line-height:2;"><li>60% del valor de cada CIT emitido (0.800 ARS)</li><li>Clientes recurrentes via alertas de mantenimiento predictivo</li><li>Panel Inspector Digital profesional</li><li>Badge oficial Aliado RODAID</li><li>Participacion en el crecimiento del ecosistema</li></ul></div></div><div style="text-align:center;padding:16px;"><a href="https://rodaid.net/taller" style="background:#F47B20;color:white;padding:12px 28px;border-radius:999px;text-decoration:none;font-weight:700;font-size:14px;">Acceder a mi Panel de Taller</a></div></div><div style="background:#0F1E35;padding:20px;text-align:center;"><p style="color:#888;font-size:12px;margin:0;">RODAID SAS · San Martin, Mendoza · <a href="https://rodaid.net" style="color:#2BBCB8;">rodaid.net</a> · <a href="mailto:federicodegeaceo@rodaid.net" style="color:#2BBCB8;">federicodegeaceo@rodaid.net</a></p></div></div>'
          })
        }
      } catch (emailErr) {
        console.error('Error email aprobacion aliado:', emailErr)
      }
    }
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
