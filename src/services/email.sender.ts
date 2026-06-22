// ─── RODAID · Email Sender (Resend) ───────────────────────
// Servicio de envío de emails transaccionales.
// Soporta Resend (default) y SendGrid como fallback.
//
// Configuración:
//   RESEND_API_KEY   → usar Resend (recomendado)
//   SENDGRID_API_KEY → usar SendGrid como alternativa
//   Sin keys → modo STUB (log, no envía)
//
// Rate limiting:
//   · Cola interna con concurrencia 5 (evitar 429)
//   · Retry automático: 1 vez con backoff 5s
//
// Tracking:
//   · Registra cada envío en tabla email_envios
//   · emailId devuelto por Resend/SendGrid para tracking

import { query }        from '../config/database'
import { getRedis }     from '../config/redis'
import { log }          from '../middleware/logger'
import { env }          from '../config/env'
import { T, getSubject, SUBJECTS } from './email.templates'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export type TemplateName = keyof typeof T

export interface SendEmailOpts {
  to:         string | string[]
  template:   TemplateName
  datos:      Parameters<typeof T[TemplateName]>[0]
  subject?:   string           // override del subject automático
  replyTo?:   string
  tags?:      Record<string, string>  // para Resend analytics
}

export interface SendResult {
  ok:       boolean
  emailId?: string
  provider: 'resend' | 'sendgrid' | 'stub'
  error?:   string
}

// ══════════════════════════════════════════════════════════
// MODO DE OPERACIÓN
// ══════════════════════════════════════════════════════════

const PROVIDER: 'resend' | 'sendgrid' | 'stub' =
  env.RESEND_API_KEY    ? 'resend'
  : (env as any).SENDGRID_API_KEY ? 'sendgrid'
  : 'stub'

const FROM_EMAIL = 'RODAID <noreply@rodaid.com.ar>'
const RATE_LIMIT_KEY = 'email:rate:concurrent'
const MAX_CONCURRENT = 5

// ══════════════════════════════════════════════════════════
// ENVIAR EMAIL
// ══════════════════════════════════════════════════════════

export async function sendEmail(opts: SendEmailOpts): Promise<SendResult> {
  // 1. Renderizar template
  const templateFn = T[opts.template] as (datos: any) => string
  const html    = templateFn(opts.datos)
  const subject = opts.subject ?? getSubject(opts.template, opts.datos)
  const to      = Array.isArray(opts.to) ? opts.to : [opts.to]

  if (PROVIDER === 'stub') {
    log.auth.warn({
      to: to[0], template: opts.template, subject,
    }, '📧 EMAIL STUB — configurar RESEND_API_KEY o SENDGRID_API_KEY')

    await registrarEnvio({
      to: to[0], template: opts.template, subject,
      provider: 'stub', estado: 'STUB',
    })
    return { ok: true, provider: 'stub', emailId: 'stub_' + Date.now() }
  }

  // 2. Enviar con el proveedor configurado
  return await enviarConRetry(to, subject, html, opts)
}

async function enviarConRetry(
  to: string[], subject: string, html: string, opts: SendEmailOpts,
  intento = 0
): Promise<SendResult> {
  try {
    const result = PROVIDER === 'resend'
      ? await enviarResend(to, subject, html, opts)
      : await enviarSendGrid(to, subject, html, opts)

    await registrarEnvio({
      to: to[0], template: opts.template, subject,
      provider: PROVIDER, estado: 'ENVIADO', emailId: result.emailId,
    })

    log.auth.info({
      to: to[0], template: opts.template, emailId: result.emailId?.slice(0, 12),
    }, `✉ Email enviado [${PROVIDER}]: ${opts.template}`)

    return { ok: true, provider: PROVIDER, emailId: result.emailId }

  } catch (err) {
    const msg = (err as Error).message
    const isRateLimit = msg.includes('429') || msg.includes('rate')

    if (intento === 0 && isRateLimit) {
      // Reintentar una vez con backoff
      log.auth.warn({ to: to[0], template: opts.template }, 'Rate limit email — reintentando en 5s')
      await new Promise(r => setTimeout(r, 5000))
      return enviarConRetry(to, subject, html, opts, 1)
    }

    await registrarEnvio({
      to: to[0], template: opts.template, subject,
      provider: PROVIDER, estado: 'FALLIDO', error: msg,
    })

    log.auth.error({ to: to[0], template: opts.template, err: msg }, 'Error enviando email')
    return { ok: false, provider: PROVIDER, error: msg }
  }
}

// ── Resend ──────────────────────────────────────────────
async function enviarResend(
  to: string[], subject: string, html: string, opts: SendEmailOpts
): Promise<{ emailId?: string }> {
  const { Resend } = await import('resend')
  const resend = new Resend(env.RESEND_API_KEY!)

  const res = await resend.emails.send({
    from:     FROM_EMAIL,
    to,
    subject,
    html,
    replyTo: opts.replyTo,
    tags:     opts.tags
      ? Object.entries(opts.tags).map(([name, value]) => ({ name, value }))
      : undefined,
  })

  if (res.error) throw new Error(res.error.message)
  return { emailId: res.data?.id }
}

// ── SendGrid (fallback) ──────────────────────────────────
async function enviarSendGrid(
  to: string[], subject: string, html: string, opts: SendEmailOpts
): Promise<{ emailId?: string }> {
  // SendGrid via HTTP directo (sin SDK para no agregar dependencia)
  const sgKey = (env as any).SENDGRID_API_KEY
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${sgKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: to.map(email => ({ email })) }],
      from:    { email: 'noreply@rodaid.com.ar', name: 'RODAID' },
      subject,
      content: [{ type: 'text/html', value: html }],
      reply_to: opts.replyTo ? { email: opts.replyTo } : undefined,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`SendGrid ${res.status}: ${await res.text().catch(() => '')}`)
  const msgId = res.headers.get('X-Message-Id') ?? undefined
  return { emailId: msgId }
}

// ══════════════════════════════════════════════════════════
// BATCH: enviar el mismo template a múltiples destinatarios
// ══════════════════════════════════════════════════════════

export async function sendEmailBatch(
  recipients: Array<{ to: string; datos: any }>,
  template:   TemplateName,
  opts?:      { concurrencia?: number }
): Promise<{ enviados: number; fallidos: number }> {
  const concurrencia = opts?.concurrencia ?? 5
  let enviados = 0; let fallidos = 0

  for (let i = 0; i < recipients.length; i += concurrencia) {
    const lote = recipients.slice(i, i + concurrencia)
    const resultados = await Promise.allSettled(
      lote.map(r => sendEmail({ to: r.to, template, datos: r.datos }))
    )
    for (const r of resultados) {
      if (r.status === 'fulfilled' && r.value.ok) enviados++
      else fallidos++
    }
    // Pausa entre lotes para no saturar el proveedor
    if (i + concurrencia < recipients.length) {
      await new Promise(r => setTimeout(r, 500))
    }
  }

  log.auth.info({ template, enviados, fallidos }, `Batch email completado`)
  return { enviados, fallidos }
}

// ══════════════════════════════════════════════════════════
// PREVIEW (solo dev/admin)
// ══════════════════════════════════════════════════════════

export function renderPreview(template: TemplateName, datos: any): string {
  try {
    const fn = T[template] as (d: any) => string
    return fn(datos)
  } catch (err) {
    return `<pre style="color:red">Error renderizando template ${template}: ${(err as Error).message}</pre>`
  }
}

export function listTemplates(): Array<{ name: string; subject: string }> {
  return Object.keys(T).map(name => ({
    name,
    subject: typeof SUBJECTS[name as TemplateName] === 'string'
      ? SUBJECTS[name as TemplateName] as string
      : `(dinámico — depende de datos)`,
  }))
}

// ══════════════════════════════════════════════════════════
// ESTADÍSTICAS
// ══════════════════════════════════════════════════════════

export async function getEmailStats(dias = 30): Promise<{
  total: number; enviados: number; fallidos: number; stub: number
  porTemplate: Record<string, number>
  tasaEntrega: number; proveedor: string
}> {
  const rows = await query<{ estado: string; template: string; count: string }>(
    `SELECT estado, template_nombre AS template, COUNT(*)::text AS count
     FROM email_envios WHERE enviado_en > NOW()-($1||' days')::interval
     GROUP BY estado, template_nombre ORDER BY count DESC`,
    [dias]
  ).catch(() => [] as any[])

  let total = 0; let enviados = 0; let fallidos = 0; let stub = 0
  const porTemplate: Record<string, number> = {}

  for (const r of rows) {
    const c = parseInt(r.count)
    total += c
    if (r.estado === 'ENVIADO')  enviados += c
    if (r.estado === 'FALLIDO')  fallidos += c
    if (r.estado === 'STUB')     stub     += c
    if (r.template) porTemplate[r.template] = (porTemplate[r.template] ?? 0) + c
  }

  return {
    total, enviados, fallidos, stub,
    porTemplate,
    tasaEntrega: (enviados + fallidos) > 0 ? Math.round(enviados / (enviados + fallidos) * 100) : 100,
    proveedor:   PROVIDER,
  }
}

// ── Helper: registrar envío ──────────────────────────────
async function registrarEnvio(opts: {
  to: string; template: string; subject: string
  provider: string; estado: string; emailId?: string; error?: string
}): Promise<void> {
  await query(
    `INSERT INTO email_envios (destinatario, template_nombre, subject, proveedor, estado, email_id, error_msg)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [opts.to, opts.template, opts.subject, opts.provider, opts.estado, opts.emailId ?? null, opts.error ?? null]
  ).catch(() => {})
}
