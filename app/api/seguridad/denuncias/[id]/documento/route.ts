import { jsonError } from '@/lib/marketplace'
import { obtenerIp } from '@/lib/ministerio-http'
import { accederDocumentoSeguro } from '@/src/services/denuncia-mpf.service'
import { getPool } from '@/lib/marketplace'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const token = new URL(req.url).searchParams.get('token') ?? ''

    // Verificar si es denuncia de API gubernamental (sin PDF real)
    const pool = getPool()
    const check = await pool.query(
      'SELECT pdf_blob_key, numero_expediente, estado FROM denuncias_mpf WHERE id = $1',
      [id]
    )
    const row = check.rows[0]

    if (row?.pdf_blob_key === 'gov-api-no-pdf') {
      const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<title>Denuncia API Gubernamental — RODAID</title>
<style>
body{font-family:sans-serif;max-width:700px;margin:40px auto;color:#0F1E35;padding:20px}
h1{color:#0F1E35;border-bottom:3px solid #2BBCB8;padding-bottom:10px}
.badge{background:#F47B20;color:white;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:700}
table{width:100%;border-collapse:collapse;margin:20px 0}
td{padding:10px;border:1px solid #ddd}
td:first-child{font-weight:bold;background:#f7f6f3;width:35%}
.footer{margin-top:40px;padding:15px;background:#f7f6f3;border-radius:8px;font-size:12px;color:#888}
</style></head><body>
<h1>RODAID · Certificado de Denuncia Gubernamental</h1>
<p><span class="badge">Registrada via API Gubernamental RODAID</span></p>
<table>
<tr><td>ID Denuncia</td><td>${id}</td></tr>
<tr><td>Expediente</td><td>${row.numero_expediente ?? 'Sin expediente'}</td></tr>
<tr><td>Estado</td><td>${row.estado}</td></tr>
<tr><td>Origen</td><td>API Gubernamental RODAID v1.0</td></tr>
<tr><td>Generado</td><td>${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</td></tr>
</table>
<p style="color:#555;line-height:1.6">Esta denuncia fue registrada directamente por un organismo gubernamental via la API RODAID. No tiene PDF adjunto del MPF. El bloqueo en la red RODAID fue aplicado automáticamente al momento del registro.</p>
<div class="footer">RODAID · rodaid.net · Ley Provincial N° 9.556 · Blockchain Federal Argentina · EDI X-Road Mendoza</div>
</body></html>`
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      })
    }

    const { pdf, pdfHash, expediente } = await accederDocumentoSeguro(id, token, {
      ip: obtenerIp(req),
      cliente: req.headers.get('user-agent'),
    })
    const nombre = `denuncia-mpf-${expediente ?? id}.pdf`.replace(/[^a-zA-Z0-9.\-]/g, '_')
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${nombre}"`,
      },
    })
  } catch (error) {
    return jsonError(error)
  }
}
