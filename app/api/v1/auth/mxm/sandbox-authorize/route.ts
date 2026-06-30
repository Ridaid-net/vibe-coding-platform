import { NextResponse } from 'next/server'
import {
  firmarSandboxCode,
  getMxmConfig,
  sintetizarPersonaSandbox,
} from '@/src/services/mxm.service'
import { ApiError, jsonError } from '@/lib/marketplace'

export const runtime = 'nodejs'

/**
 * GET /api/v1/auth/mxm/sandbox-authorize — Sandbox interno de Mendoza por Mi.
 *
 * Simula la pantalla de consentimiento del IDP del Gobierno cuando NO hay
 * credenciales reales configuradas (modo SIMULADO, tipico en preview). Sin
 * `decision`, muestra el consentimiento con dos perfiles de prueba (ciudadano /
 * funcionario). Con `decision`, sintetiza la persona, firma un "authorization
 * code" y redirige al callback, replicando el ida y vuelta de OIDC.
 *
 * Esta ruta NO existe en modo LIVE: ahi el navegador va al IDP real.
 */
export async function GET(req: Request) {
  try {
    const config = getMxmConfig()
    if (config.modo !== 'SIMULADO') {
      throw new ApiError(
        404,
        'MXM_SANDBOX_DESHABILITADO',
        'El sandbox de Mendoza por Mi no esta disponible en modo LIVE.'
      )
    }

    const url = new URL(req.url)
    const redirectUri = url.searchParams.get('redirect_uri') ?? ''
    const state = url.searchParams.get('state') ?? ''
    const nonce = url.searchParams.get('nonce') ?? ''
    const decision = url.searchParams.get('decision')

    if (!redirectUri || !state) {
      throw new ApiError(400, 'MXM_SANDBOX_PARAMS', 'Faltan parametros del flujo.')
    }

    if (decision === 'ciudadano' || decision === 'funcionario') {
      const claims = sintetizarPersonaSandbox(decision === 'funcionario')
      const code = await firmarSandboxCode(claims, nonce)
      const back = new URL(redirectUri)
      back.searchParams.set('code', code)
      back.searchParams.set('state', state)
      return NextResponse.redirect(back.toString())
    }

    // Pantalla de consentimiento simulada.
    return new NextResponse(consentHtml(url.search), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  } catch (error) {
    return jsonError(error)
  }
}

function consentHtml(search: string): string {
  const ciudadano = `?${new URLSearchParams(search).toString()}&decision=ciudadano`
  const funcionario = `?${new URLSearchParams(search).toString()}&decision=funcionario`
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Mendoza por Mí — Sandbox</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background:#f4f6f8; color:#0f1f2e; display:grid; place-items:center; min-height:100vh; padding:24px; }
  .card { background:#fff; border:1px solid #e2e8f0; border-radius:20px; max-width:440px; width:100%; padding:32px; box-shadow:0 10px 40px rgba(15,31,46,.08); }
  .gob { display:flex; align-items:center; gap:10px; font-weight:700; letter-spacing:.02em; }
  .dot { width:34px; height:34px; border-radius:9px; background:linear-gradient(135deg,#0a7d5a,#06b6a3); }
  h1 { font-size:20px; margin:18px 0 6px; }
  p { color:#475569; font-size:14px; line-height:1.5; margin:0 0 8px; }
  .badge { display:inline-block; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; color:#0a7d5a; background:#e7f6f0; padding:4px 10px; border-radius:999px; }
  .btn { display:block; width:100%; text-align:center; text-decoration:none; padding:13px 16px; border-radius:12px; font-weight:600; font-size:15px; margin-top:12px; }
  .primary { background:#0a7d5a; color:#fff; }
  .ghost { background:#f1f5f9; color:#0f1f2e; }
  .foot { margin-top:18px; font-size:12px; color:#94a3b8; }
</style>
</head>
<body>
  <div class="card">
    <div class="gob"><span class="dot"></span> Mendoza por Mí</div>
    <span class="badge" style="margin-top:16px">Entorno de prueba (sandbox)</span>
    <h1>Autorizar acceso a RODAID</h1>
    <p>RODAID solicita verificar tu identidad para acelerar la confianza de tu cuenta. Se compartirán tu nombre, DNI y CUIL.</p>
    <p>Elegí con qué perfil de prueba querés ingresar:</p>
    <a class="btn primary" href="${ciudadano}">Ingresar como ciudadano/a</a>
    <a class="btn ghost" href="${funcionario}">Ingresar como funcionario/a público</a>
    <div class="foot">Este es un entorno de demostración. No se utilizan datos reales del padrón.</div>
  </div>
</body>
</html>`
}
