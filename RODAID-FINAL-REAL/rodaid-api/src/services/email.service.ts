// ─── RODAID · Email Service (Resend) ─────────────────────
// Producción : Resend API (resend.com)
// Desarrollo : stub que loguea el email en lugar de enviarlo

import { env, isDev } from '../config/env'
import { log } from '../middleware/logger'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export interface EmailResult {
  ok:       boolean
  emailId?: string
  stub?:    boolean
  error?:   string
}

interface EmailPayload {
  to:      string
  subject: string
  html:    string
  text:    string
}

// ══════════════════════════════════════════════════════════
// TEMPLATES HTML
// ══════════════════════════════════════════════════════════

const BASE_STYLE = `
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #f5f5f5; padding: 40px 20px;
`
const CARD_STYLE = `
  background: white; border-radius: 12px; padding: 40px;
  max-width: 500px; margin: 0 auto;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
`
const BTN_STYLE = `
  display: inline-block; background: #E2541A; color: white;
  text-decoration: none; padding: 14px 32px; border-radius: 8px;
  font-size: 16px; font-weight: 700; margin: 24px 0;
`
const FOOTER = `
  <hr style="border:none;border-top:1px solid #eee;margin:32px 0">
  <p style="font-size:12px;color:#999;text-align:center">
    RODAID · Certificación de Bicicletas · Ley 9556 · Mendoza, Argentina<br>
    Si no solicitaste esto, ignorá este email.
  </p>
`

export function buildVerificationEmail(nombre: string, verificationUrl: string): EmailPayload {
  return {
    to:      '', // se setea al llamar
    subject: '✅ Verificá tu cuenta RODAID',
    html: `
<div style="${BASE_STYLE}">
  <div style="${CARD_STYLE}">
    <h1 style="color:#0F1E35;font-size:24px;margin:0 0 8px">¡Bienvenido/a a RODAID, ${nombre}!</h1>
    <p style="color:#555;font-size:16px;line-height:1.6;margin:0 0 8px">
      Certificación de bicicletas en la Blockchain Federal Argentina · Ley 9556 · Mendoza
    </p>
    <p style="color:#555;font-size:15px;line-height:1.6">
      Hacé click en el botón para verificar tu dirección de email y activar tu cuenta:
    </p>
    <div style="text-align:center">
      <a href="${verificationUrl}" style="${BTN_STYLE}">Verificar mi cuenta →</a>
    </div>
    <p style="color:#888;font-size:13px;text-align:center">
      Este enlace expira en <strong>24 horas</strong>.
    </p>
    <div style="background:#f8f9fa;border-radius:8px;padding:16px;margin-top:24px">
      <p style="font-size:12px;color:#666;margin:0;word-break:break-all">
        Si el botón no funciona, copiá este enlace:<br>
        <a href="${verificationUrl}" style="color:#E2541A">${verificationUrl}</a>
      </p>
    </div>
    ${FOOTER}
  </div>
</div>`,
    text: `¡Bienvenido/a a RODAID, ${nombre}!\n\nVerificá tu cuenta en:\n${verificationUrl}\n\nEste enlace expira en 24 horas.\n\nRODAID · Ley 9556 · Mendoza`,
  }
}

export function buildPasswordResetEmail(nombre: string, resetUrl: string): EmailPayload {
  return {
    to:      '',
    subject: '🔐 Restablecer contraseña RODAID',
    html: `
<div style="${BASE_STYLE}">
  <div style="${CARD_STYLE}">
    <h1 style="color:#0F1E35;font-size:24px;margin:0 0 8px">Restablecer contraseña</h1>
    <p style="color:#555;font-size:15px;line-height:1.6">
      Hola <strong>${nombre}</strong>, recibimos una solicitud para restablecer la contraseña de tu cuenta RODAID.
    </p>
    <div style="text-align:center">
      <a href="${resetUrl}" style="${BTN_STYLE}">Restablecer contraseña →</a>
    </div>
    <p style="color:#888;font-size:13px;text-align:center">
      Este enlace expira en <strong>1 hora</strong>.
      Si no solicitaste el cambio, ignorá este email.
    </p>
    <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:12px;margin-top:16px">
      <p style="font-size:13px;color:#856404;margin:0">
        ⚠️ Por seguridad, este enlace solo puede usarse una vez.
      </p>
    </div>
    ${FOOTER}
  </div>
</div>`,
    text: `Hola ${nombre},\n\nRestablecé tu contraseña en:\n${resetUrl}\n\nEste enlace expira en 1 hora y solo puede usarse una vez.\n\nRODAID · Ley 9556 · Mendoza`,
  }
}

export function buildWelcomeEmail(nombre: string): EmailPayload {
  return {
    to:      '',
    subject: '🚲 Tu cuenta RODAID está lista',
    html: `
<div style="${BASE_STYLE}">
  <div style="${CARD_STYLE}">
    <h1 style="color:#0F1E35;font-size:24px;margin:0 0 8px">¡Cuenta verificada, ${nombre}!</h1>
    <p style="color:#555;font-size:15px;line-height:1.6">
      Tu cuenta RODAID está activa. Ya podés:
    </p>
    <ul style="color:#555;font-size:15px;line-height:2">
      <li>📋 <strong>Registrar tus bicicletas</strong> en el Garaje Digital</li>
      <li>🔐 <strong>Certificarlas con CIT</strong> en talleres aliados</li>
      <li>🏪 <strong>Publicarlas en el Marketplace</strong></li>
      <li>🚨 <strong>Denunciar robos</strong> con alerta automática</li>
    </ul>
    <div style="text-align:center">
      <a href="https://rodaid.com.ar/dashboard" style="${BTN_STYLE}">Ir a mi Garaje Digital →</a>
    </div>
    ${FOOTER}
  </div>
</div>`,
    text: `¡Cuenta verificada, ${nombre}!\n\nTu cuenta RODAID está activa.\nVisitá https://rodaid.com.ar/dashboard\n\nRODAID · Ley 9556 · Mendoza`,
  }
}

// ══════════════════════════════════════════════════════════
// EMAIL SENDER
// ══════════════════════════════════════════════════════════

async function send(to: string, payload: EmailPayload): Promise<EmailResult> {
  const email = { ...payload, to }

  // ── Desarrollo / sin API key: loguear en lugar de enviar ─
  if (isDev || !env.RESEND_API_KEY) {
    log.auth.warn({
      stub:    true,
      to,
      subject: email.subject,
      preview: email.text.slice(0, 120),
    }, `📧 EMAIL STUB — no enviado (configurar RESEND_API_KEY para prod)`)
    return { ok: true, stub: true, emailId: `stub-${Date.now()}` }
  }

  // ── Producción: Resend API ────────────────────────────
  try {
    const { Resend } = await import('resend')
    const resend = new Resend(env.RESEND_API_KEY)

    const result = await resend.emails.send({
      from:    env.EMAIL_FROM ?? 'noreply@rodaid.com.ar',
      to:      [to],
      subject: email.subject,
      html:    email.html,
      text:    email.text,
    })

    if (result.error) {
      log.auth.error({ error: result.error, to }, 'Email send failed')
      return { ok: false, error: result.error.message }
    }

    log.auth.info({ emailId: result.data?.id, to, subject: email.subject }, 'Email enviado')
    return { ok: true, emailId: result.data?.id }

  } catch (err) {
    log.auth.error({ err, to }, 'Email service error')
    return { ok: false, error: (err as Error).message }
  }
}

// ══════════════════════════════════════════════════════════
// FUNCIONES PÚBLICAS
// ══════════════════════════════════════════════════════════

export async function sendVerificationEmail(
  to: string, nombre: string, token: string
): Promise<EmailResult> {
  const frontendUrl     = process.env.FRONTEND_URL ?? 'https://rodaid.com.ar'
  const verificationUrl = `${frontendUrl}/auth/verify-email?token=${token}`
  const payload         = buildVerificationEmail(nombre, verificationUrl)
  return send(to, payload)
}

export async function sendPasswordResetEmail(
  to: string, nombre: string, token: string
): Promise<EmailResult> {
  const frontendUrl = process.env.FRONTEND_URL ?? 'https://rodaid.com.ar'
  const resetUrl    = `${frontendUrl}/auth/reset-password?token=${token}`
  const payload     = buildPasswordResetEmail(nombre, resetUrl)
  return send(to, payload)
}

export async function sendWelcomeEmail(
  to: string, nombre: string
): Promise<EmailResult> {
  const payload = buildWelcomeEmail(nombre)
  return send(to, payload)
}

export function buildPasswordChangedEmail(nombre: string, ipAddress?: string): EmailPayload {
  const ipText = ipAddress ? `desde IP ${ipAddress}` : ''
  return {
    to: '',
    subject: '🔐 Tu contraseña fue cambiada — RODAID',
    html: `
<div style="${BASE_STYLE}">
  <div style="${CARD_STYLE}">
    <h1 style="color:#0F1E35;font-size:24px;margin:0 0 8px">Contraseña actualizada</h1>
    <p style="color:#555;font-size:15px;line-height:1.6">
      Hola <strong>${nombre}</strong>, tu contraseña de RODAID fue cambiada exitosamente ${ipText}.
    </p>
    <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:16px;margin:24px 0">
      <p style="font-size:14px;color:#856404;margin:0">
        ⚠️ Si no realizaste este cambio, restablecé tu contraseña inmediatamente y contactá a soporte.
      </p>
    </div>
    <div style="text-align:center">
      <a href="https://rodaid.com.ar/auth/forgot-password" style="${BTN_STYLE}">
        No fui yo → Restablecer ahora
      </a>
    </div>
    ${FOOTER}
  </div>
</div>`,
    text: `Hola ${nombre}, tu contraseña de RODAID fue cambiada ${ipText}.

Si no realizaste este cambio, restablecé tu contraseña en https://rodaid.com.ar/auth/forgot-password

RODAID · Ley 9556 · Mendoza`,
  }
}

export async function sendPasswordChangedEmail(
  to: string, nombre: string, ipAddress?: string
): Promise<EmailResult> {
  const payload = buildPasswordChangedEmail(nombre, ipAddress)
  return send(to, payload)
}

// ══════════════════════════════════════════════════════════
// TEMPLATES DE NEGOCIO RODAID
// ══════════════════════════════════════════════════════════

function emailBase(titulo: string, contenido: string, cta?: { texto: string; url: string }): string {
  return `
<div style="${BASE_STYLE}">
  <div style="${CARD_STYLE}">
    <div style="text-align:center;margin-bottom:32px">
      <span style="font-size:28px;font-weight:900;color:#0F1E35">RODAID</span>
      <span style="font-size:28px;color:#E2541A">·</span>
    </div>
    <h1 style="font-size:22px;color:#0F1E35;margin:0 0 16px">${titulo}</h1>
    ${contenido}
    ${cta ? `<div style="text-align:center"><a href="${cta.url}" style="${BTN_STYLE}">${cta.texto}</a></div>` : ''}
    ${FOOTER}
  </div>
</div>`
}

export async function emailCITEmitido(opts: {
  to: string; nombre: string; numeroCIT: string
  serial: string; marca: string; modelo: string; txHash: string
}): Promise<EmailResult> {
  const html = emailBase(
    `✅ Tu CIT fue emitido: ${opts.numeroCIT}`,
    `<p>Hola <strong>${opts.nombre}</strong>,</p>
     <p>Tu bicicleta <strong>${opts.marca} ${opts.modelo}</strong> (S/N: <code>${opts.serial}</code>)
     fue certificada exitosamente bajo la Ley Provincial N° 9556.</p>
     <table style="width:100%;background:#f9fafb;border-radius:8px;padding:16px;border-spacing:0">
       <tr><td style="color:#666;padding:4px 0">Certificado</td><td><strong>${opts.numeroCIT}</strong></td></tr>
       <tr><td style="color:#666;padding:4px 0">Blockchain</td><td style="font-size:12px;color:#888">${opts.txHash.slice(0, 20)}...</td></tr>
       <tr><td style="color:#666;padding:4px 0">Validez legal</td><td>Ley 9556, Mendoza</td></tr>
     </table>`,
    { texto: 'Ver mi CIT', url: `${process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.com.ar'}/cit/${opts.numeroCIT}` }
  )
  return enviarEmail({
    to: opts.to,
    subject: `✅ CIT emitido: ${opts.numeroCIT} — ${opts.marca} ${opts.modelo}`,
    html,
    text: `Tu bicicleta ${opts.marca} ${opts.modelo} (S/N: ${opts.serial}) fue certificada. CIT: ${opts.numeroCIT}. TxHash BFA: ${opts.txHash}`,
  })
}

export async function emailTasaConfirmada(opts: {
  to: string; nombre: string; montoARS: number; pagoId: string
}): Promise<EmailResult> {
  const html = emailBase(
    `💳 Pago de tasa CIT confirmado`,
    `<p>Hola <strong>${opts.nombre}</strong>,</p>
     <p>Tu pago de <strong>$${opts.montoARS.toLocaleString('es-AR')} ARS</strong>
     fue acreditado exitosamente.</p>
     <p style="color:#888;font-size:13px">Ref.: ${opts.pagoId.slice(0, 8).toUpperCase()}</p>
     <p>Podés continuar con la emisión de tu CIT.</p>`
  )
  return enviarEmail({
    to: opts.to,
    subject: `💳 Pago confirmado — $${opts.montoARS.toLocaleString('es-AR')} ARS`,
    html,
    text: `Pago de tasa CIT confirmado. Monto: $${opts.montoARS} ARS. Ref: ${opts.pagoId.slice(0, 8)}`,
  })
}

export async function emailDenunciaRobo(opts: {
  to: string; nombre: string; serial: string; marca: string
  modelo: string; numeroDenuncia: string
}): Promise<EmailResult> {
  const html = emailBase(
    `🚨 Denuncia registrada — ${opts.serial}`,
    `<p>Hola <strong>${opts.nombre}</strong>,</p>
     <p>Tu denuncia fue registrada en el sistema RODAID y comunicada al
     Ministerio de Seguridad de Mendoza.</p>
     <table style="width:100%;background:#fff8f8;border-radius:8px;padding:16px;border:1px solid #fde;border-spacing:0">
       <tr><td style="color:#666;padding:4px 0">Bicicleta</td><td><strong>${opts.marca} ${opts.modelo}</strong></td></tr>
       <tr><td style="color:#666;padding:4px 0">Nº Serie</td><td><code>${opts.serial}</code></td></tr>
       <tr><td style="color:#666;padding:4px 0">Nº Denuncia</td><td><strong>${opts.numeroDenuncia}</strong></td></tr>
     </table>
     <p style="color:#dc2626;font-size:14px;margin-top:16px">
       ⚠ El CIT queda bloqueado para cualquier transferencia hasta que recuperes la bicicleta.
     </p>`,
    { texto: 'Ver estado de denuncia', url: `${process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.com.ar'}/denuncias/${opts.numeroDenuncia}` }
  )
  return enviarEmail({
    to: opts.to,
    subject: `🚨 Denuncia registrada — ${opts.marca} ${opts.modelo} (${opts.serial})`,
    html,
    text: `Denuncia registrada. ${opts.marca} ${opts.modelo} S/N: ${opts.serial}. N° Denuncia: ${opts.numeroDenuncia}`,
  })
}

export async function emailVentaConfirmada(opts: {
  to: string; nombre: string; montoARS: number; comisionARS: number
  serial: string; marca: string; modelo: string
}): Promise<EmailResult> {
  const neto = opts.montoARS - opts.comisionARS
  const html = emailBase(
    `💰 Venta confirmada — $${neto.toLocaleString('es-AR')} ARS`,
    `<p>Hola <strong>${opts.nombre}</strong>,</p>
     <p>La venta de tu <strong>${opts.marca} ${opts.modelo}</strong> (S/N: ${opts.serial}) fue completada.</p>
     <table style="width:100%;background:#f0fdf4;border-radius:8px;padding:16px;border-spacing:0">
       <tr><td style="color:#666;padding:4px 0">Precio de venta</td><td><strong>$${opts.montoARS.toLocaleString('es-AR')}</strong></td></tr>
       <tr><td style="color:#666;padding:4px 0">Comisión RODAID</td><td style="color:#888">$${opts.comisionARS.toLocaleString('es-AR')}</td></tr>
       <tr><td style="color:#666;padding:4px 0;font-weight:bold">Monto acreditado</td>
           <td style="font-weight:bold;color:#16a34a">$${neto.toLocaleString('es-AR')}</td></tr>
     </table>`
  )
  return enviarEmail({
    to: opts.to,
    subject: `💰 Venta confirmada — $${neto.toLocaleString('es-AR')} ARS acreditados`,
    html,
    text: `Venta confirmada. ${opts.marca} ${opts.modelo}. Monto: $${neto} ARS`,
  })
}

export async function emailCompraCompletada(opts: {
  to: string; nombre: string; montoARS: number
  serial: string; marca: string; modelo: string; numeroCIT: string
}): Promise<EmailResult> {
  const html = emailBase(
    `✅ Compra completada — ${opts.marca} ${opts.modelo}`,
    `<p>Hola <strong>${opts.nombre}</strong>,</p>
     <p>Recibiste tu bicicleta y el pago fue liberado al vendedor.</p>
     <table style="width:100%;background:#f0fdf4;border-radius:8px;padding:16px;border-spacing:0">
       <tr><td style="color:#666;padding:4px 0">Bicicleta</td><td><strong>${opts.marca} ${opts.modelo}</strong></td></tr>
       <tr><td style="color:#666;padding:4px 0">Nº Serie</td><td><code>${opts.serial}</code></td></tr>
       <tr><td style="color:#666;padding:4px 0">CIT</td><td><strong>${opts.numeroCIT}</strong></td></tr>
       <tr><td style="color:#666;padding:4px 0">Monto</td><td>$${opts.montoARS.toLocaleString('es-AR')} ARS</td></tr>
     </table>`,
    { texto: 'Ver mi CIT', url: `${process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.com.ar'}/cit/${opts.numeroCIT}` }
  )
  return enviarEmail({
    to: opts.to,
    subject: `✅ Compra completada — ${opts.marca} ${opts.modelo}`,
    html,
    text: `Compra completada. ${opts.marca} ${opts.modelo} S/N: ${opts.serial}. CIT: ${opts.numeroCIT}`,
  })
}

export async function emailDisputaAbierta(opts: {
  to: string; nombre: string; disputaId: string; motivo: string; rol: 'comprador' | 'vendedor'
}): Promise<EmailResult> {
  const html = emailBase(
    `⚠ Disputa abierta — RODAID PAY`,
    `<p>Hola <strong>${opts.nombre}</strong>,</p>
     <p>${opts.rol === 'comprador' ? 'Abriste una disputa.' : 'La otra parte abrió una disputa sobre tu transacción.'}</p>
     <p><strong>Motivo:</strong> ${opts.motivo}</p>
     <p>El equipo RODAID revisará y resolverá en 72 horas hábiles.
     ${opts.rol === 'vendedor' ? 'Podés aportar evidencia desde tu panel.' : ''}</p>
     <p style="color:#888;font-size:13px">ID Disputa: ${opts.disputaId.slice(0, 8).toUpperCase()}</p>`
  )
  return enviarEmail({
    to: opts.to,
    subject: `⚠ Disputa abierta — ${opts.motivo.slice(0, 50)}`,
    html,
    text: `Disputa abierta. Motivo: ${opts.motivo}. ID: ${opts.disputaId.slice(0, 8)}`,
  })
}

// ── Dispatcher privado ──────────────────────────────────
async function enviarEmail(payload: EmailPayload): Promise<EmailResult> {
  if (isDev || !env.RESEND_API_KEY) {
    log.auth.warn(
      { to: payload.to, subject: payload.subject },
      `📧 EMAIL STUB — no enviado (configurar RESEND_API_KEY para prod)`
    )
    return { ok: true, stub: true, emailId: 'stub_' + Date.now() }
  }
  try {
    const { Resend } = await import('resend')
    const resend = new Resend(env.RESEND_API_KEY)
    const result = await resend.emails.send({
      from:    'RODAID <noreply@rodaid.com.ar>',
      to:      payload.to,
      subject: payload.subject,
      html:    payload.html,
      text:    payload.text,
    })
    return { ok: true, emailId: result.data?.id }
  } catch (err) {
    log.auth.error({ err: (err as Error).message, to: payload.to }, 'Error enviando email')
    return { ok: false, error: (err as Error).message }
  }
}
