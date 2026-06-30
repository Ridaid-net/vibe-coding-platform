/**
 * RODAID — Motor de Notificaciones: maquetacion del email institucional.
 *
 * Template HTML responsive con la paleta de RODAID (Navy #0F1E35 y Orange #F97316),
 * boton CTA "Ver en RODAID ->" y pie de pagina legal referenciando la Ley 9556 de
 * Mendoza. Todo el CSS va inline / en un <style> acotado para maximizar la
 * compatibilidad con los clientes de correo (que ignoran hojas externas).
 *
 * Sin dependencias externas: devuelve el HTML y un texto plano de respaldo.
 */

const NAVY = '#0F1E35'
const ORANGE = '#F97316'
const NAVY_SOFT = '#1B2C49'
const TEXT = '#1F2937'
const MUTED = '#6B7280'
const BG = '#F3F4F6'

export interface EmailRodaid {
  asunto: string
  titulo: string
  /** Parrafos del cuerpo (cada string es un <p>). Texto plano, se escapa. */
  parrafos: string[]
  /** Boton de llamada a la accion. Si se omite, no se renderiza. */
  cta?: { label: string; url: string }
  /** Lista opcional de pares clave/valor (p. ej. serie, hash, monto). */
  detalles?: Array<{ etiqueta: string; valor: string }>
  /** Texto del preheader (vista previa del cliente de correo). */
  preheader?: string
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Render del email institucional. Devuelve { html, text }. */
export function renderEmailRODAID(email: EmailRodaid): {
  html: string
  text: string
} {
  const preheader = email.preheader ?? email.parrafos[0] ?? ''

  const parrafosHtml = email.parrafos
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${TEXT};">${escapar(
          p
        )}</p>`
    )
    .join('')

  const detallesHtml = email.detalles?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:8px 0 20px;border-collapse:collapse;background:${BG};border-radius:10px;">
        ${email.detalles
          .map(
            (d) => `<tr>
              <td style="padding:10px 16px;font-size:13px;color:${MUTED};border-bottom:1px solid #E5E7EB;">${escapar(
                d.etiqueta
              )}</td>
              <td style="padding:10px 16px;font-size:13px;color:${TEXT};font-weight:600;text-align:right;border-bottom:1px solid #E5E7EB;word-break:break-all;">${escapar(
                d.valor
              )}</td>
            </tr>`
          )
          .join('')}
      </table>`
    : ''

  const ctaHtml = email.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 8px;">
        <tr><td style="border-radius:10px;background:${ORANGE};">
          <a href="${escapar(email.cta.url)}"
             style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:10px;">
             ${escapar(email.cta.label)} &rarr;
          </a>
        </td></tr>
      </table>`
    : ''

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<title>${escapar(email.asunto)}</title>
</head>
<body style="margin:0;padding:0;background:${BG};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapar(
    preheader
  )}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(15,30,53,0.08);">
      <!-- Encabezado -->
      <tr><td style="background:${NAVY};padding:28px 32px;">
        <span style="font-size:20px;font-weight:800;letter-spacing:0.5px;color:#FFFFFF;">RODA<span style="color:${ORANGE};">ID</span></span>
        <div style="margin-top:4px;font-size:12px;color:#9FB0C9;letter-spacing:0.3px;">Identidad y trazabilidad de tu rodado</div>
      </td></tr>
      <!-- Cuerpo -->
      <tr><td style="padding:32px;">
        <h1 style="margin:0 0 18px;font-size:20px;line-height:1.3;color:${NAVY};">${escapar(
          email.titulo
        )}</h1>
        ${parrafosHtml}
        ${detallesHtml}
        ${ctaHtml}
      </td></tr>
      <!-- Pie legal -->
      <tr><td style="background:${NAVY_SOFT};padding:22px 32px;">
        <p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:#9FB0C9;">
          Recibis este correo porque tenes una cuenta en RODAID. Podes ajustar tus
          preferencias de notificacion desde tu perfil.
        </p>
        <p style="margin:0;font-size:11px;line-height:1.5;color:#7C8DA8;">
          RODAID opera el Registro de Certificacion de Identidad Tecnica en el marco
          de la Ley 9556 de la Provincia de Mendoza. &copy; ${'2026'} RODAID.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`

  const textParts = [
    email.titulo,
    '',
    ...email.parrafos,
    ...(email.detalles?.length
      ? ['', ...email.detalles.map((d) => `${d.etiqueta}: ${d.valor}`)]
      : []),
    ...(email.cta ? ['', `${email.cta.label}: ${email.cta.url}`] : []),
    '',
    '— RODAID · Ley 9556 de la Provincia de Mendoza.',
  ]

  return { html, text: textParts.join('\n') }
}
