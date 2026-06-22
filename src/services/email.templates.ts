// ─── RODAID · Email Templates ─────────────────────────────
// Sistema de templates HTML para emails transaccionales.
// Todos los templates usan el mismo diseño base RODAID con
// branding consistente (navy #0F1E35, naranja #E8621A).
//
// Uso:
//   const html = T.citEmitido({ nombre, numeroCIT, ... })
//   await email.send({ to, subject, html })
//
// Preview en dev:
//   GET /admin/email/preview?template=citEmitido&datos={...}

// ══════════════════════════════════════════════════════════
// COLORES Y ESTILOS BASE
// ══════════════════════════════════════════════════════════

const C = {
  navy:       '#0F1E35',
  navyLight:  '#1A2B4A',
  orange:     '#E8621A',
  teal:       '#0D9488',
  grayBg:     '#F8F9FA',
  grayLine:   '#E5E7EB',
  textMain:   '#1F2937',
  textMuted:  '#6B7280',
  red:        '#DC2626',
  green:      '#16A34A',
  yellow:     '#D97706',
  white:      '#FFFFFF',
}

// ── Componentes reutilizables ──────────────────────────────

function layout(content: string, preheader = ''): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>RODAID</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background:${C.grayBg};font-family:'Segoe UI',Arial,sans-serif">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;color:${C.grayBg}">${preheader}&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌</div>` : ''}
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.grayBg}">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%">
        ${header()}
        <tr><td style="background:${C.white};border-radius:0 0 12px 12px;padding:32px 40px 40px;border:1px solid ${C.grayLine};border-top:none">
          ${content}
        </td></tr>
        ${footer()}
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function header(): string {
  return `
  <tr>
    <td style="background:${C.navy};border-radius:12px 12px 0 0;padding:24px 40px;text-align:left">
      <span style="font-size:24px;font-weight:900;color:${C.white};letter-spacing:-0.5px">RODAID</span>
      <span style="font-size:24px;color:${C.orange};font-weight:900">·</span>
    </td>
  </tr>`
}

function footer(): string {
  return `
  <tr><td style="padding:24px 0 0;text-align:center">
    <p style="margin:0;font-size:12px;color:${C.textMuted};line-height:1.6">
      <a href="https://rodaid.com.ar" style="color:${C.orange};text-decoration:none;font-weight:600">rodaid.com.ar</a>
      &nbsp;·&nbsp; Ley Provincial N° 9556, Mendoza
      &nbsp;·&nbsp; San Martín, Mendoza, Argentina
    </p>
    <p style="margin:8px 0 0;font-size:11px;color:${C.grayLine.replace('E5','B0')}">
      Si no esperabas este email, podés ignorarlo sin inconvenientes.
    </p>
  </td></tr>`
}

function h1(text: string, color = C.navy): string {
  return `<h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:${color};line-height:1.3">${text}</h1>`
}

function p(text: string, muted = false): string {
  return `<p style="margin:0 0 16px;font-size:15px;color:${muted ? C.textMuted : C.textMain};line-height:1.6">${text}</p>`
}

function btn(text: string, href: string, color = C.orange): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0">
    <tr><td style="background:${color};border-radius:8px">
      <a href="${href}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:${C.white};text-decoration:none">${text} →</a>
    </td></tr>
  </table>`
}

function infoBox(rows: [string, string][], bg = C.grayBg, borderColor = C.teal): string {
  const cells = rows.map(([label, value]) => `
    <tr>
      <td style="padding:8px 0;font-size:13px;color:${C.textMuted};white-space:nowrap;padding-right:24px;border-bottom:1px solid ${C.grayLine}">${label}</td>
      <td style="padding:8px 0;font-size:13px;color:${C.textMain};font-weight:600;border-bottom:1px solid ${C.grayLine}">${value}</td>
    </tr>`).join('')
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
    style="background:${bg};border-radius:8px;border-left:4px solid ${borderColor};padding:4px 16px;margin:16px 0">
    <tr><td><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      ${cells}
    </table></td></tr>
  </table>`
}

function badge(text: string, color: string, bg: string): string {
  return `<span style="display:inline-block;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:700;color:${color};background:${bg}">${text}</span>`
}

function divider(): string {
  return `<hr style="border:none;border-top:1px solid ${C.grayLine};margin:24px 0">`
}

function alertBox(text: string, level: 'info' | 'warning' | 'error' = 'info'): string {
  const colors = {
    info:    { bg: '#EFF6FF', border: '#3B82F6', text: '#1D4ED8' },
    warning: { bg: '#FFFBEB', border: C.yellow, text: '#92400E' },
    error:   { bg: '#FEF2F2', border: C.red,    text: '#991B1B' },
  }
  const c = colors[level]
  return `<div style="background:${c.bg};border-left:4px solid ${c.border};border-radius:4px;padding:12px 16px;margin:16px 0;font-size:14px;color:${c.text};line-height:1.5">${text}</div>`
}

// ══════════════════════════════════════════════════════════
// TEMPLATES EXPORTADOS
// ══════════════════════════════════════════════════════════

export const T = {

  // ── CUENTA ────────────────────────────────────────────

  bienvenida: (opts: { nombre: string }) => layout(`
    ${h1('¡Bienvenido/a a RODAID! 🎉')}
    ${p(`Hola <strong>${opts.nombre}</strong>,`)}
    ${p('Tu cuenta fue creada exitosamente. RODAID es la plataforma oficial de certificación de bicicletas bajo la Ley Provincial N° 9556 de Mendoza.')}
    ${infoBox([
      ['Plataforma', 'RODAID — Garaje Digital'],
      ['Cobertura',  'Zona Este de Mendoza (San Martín, Junín, Rivadavia)'],
      ['Marco legal','Ley Provincial N° 9556'],
    ])}
    ${p('Podés empezar certificando tu bicicleta o navegando el marketplace:')}
    ${btn('Ir a mi Garaje Digital', 'https://rodaid.com.ar/dashboard')}
  `, 'Bienvenido/a a RODAID, tu plataforma de certificación de bicicletas'),

  verificacionEmail: (opts: { nombre: string; url: string; expiraHoras?: number }) => layout(`
    ${h1('Verificá tu email')}
    ${p(`Hola <strong>${opts.nombre}</strong>,`)}
    ${p('Para activar tu cuenta en RODAID, verificá tu dirección de email haciendo clic en el botón:')}
    ${btn('Verificar mi cuenta', opts.url)}
    ${p(`Este link expira en <strong>${opts.expiraHoras ?? 24} horas</strong>.`, true)}
    ${alertBox('Si no creaste una cuenta en RODAID, ignorá este email.', 'info')}
  `, 'Verificá tu email para activar tu cuenta RODAID'),

  resetPassword: (opts: { nombre: string; url: string; expiraMinutos?: number }) => layout(`
    ${h1('Restablecer contraseña')}
    ${p(`Hola <strong>${opts.nombre}</strong>,`)}
    ${p('Recibimos una solicitud para restablecer la contraseña de tu cuenta RODAID.')}
    ${btn('Restablecer contraseña', opts.url)}
    ${p(`Este link expira en <strong>${opts.expiraMinutos ?? 60} minutos</strong>.`, true)}
    ${alertBox('Si no solicitaste restablecer tu contraseña, tu cuenta está segura. Podés ignorar este email.', 'warning')}
  `, 'Restablecé tu contraseña RODAID'),

  passwordCambiado: (opts: { nombre: string; fecha: string; ip?: string }) => layout(`
    ${h1('Contraseña cambiada')}
    ${p(`Hola <strong>${opts.nombre}</strong>,`)}
    ${p('Tu contraseña fue cambiada exitosamente.')}
    ${infoBox([
      ['Fecha', opts.fecha],
      ...(opts.ip ? [['IP', opts.ip] as [string, string]] : []),
    ])}
    ${alertBox('Si no realizaste este cambio, <a href="https://rodaid.com.ar/soporte" style="color:#991B1B">contactá soporte</a> de inmediato.', 'error')}
  `, 'Tu contraseña RODAID fue cambiada'),

  // ── CIT ───────────────────────────────────────────────

  citEmitido: (opts: {
    nombre: string; numeroCIT: string; serial: string
    marca: string; modelo: string; txHash: string; fechaVencimiento?: string
  }) => layout(`
    ${h1(`✅ CIT emitido: ${opts.numeroCIT}`)}
    ${p(`Hola <strong>${opts.nombre}</strong>,`)}
    ${p(`Tu bicicleta <strong>${opts.marca} ${opts.modelo}</strong> fue certificada exitosamente bajo la Ley Provincial N° 9556.`)}
    ${infoBox([
      ['Certificado',       opts.numeroCIT],
      ['Número de serie',   opts.serial],
      ['Bicicleta',         `${opts.marca} ${opts.modelo}`],
      ['BFA Transaction',   opts.txHash.slice(0, 20) + '...'],
      ...(opts.fechaVencimiento ? [['Vence el', opts.fechaVencimiento] as [string, string]] : []),
    ], '#F0FDF4', C.green)}
    ${p('Este certificado tiene <strong>validez legal</strong> ante cualquier autoridad de la Provincia de Mendoza y puede verificarse públicamente en:')}
    ${btn('Ver mi CIT en blockchain', `https://rodaid.com.ar/verificar?cit=${opts.numeroCIT}`, C.green)}
  `, `CIT emitido: ${opts.numeroCIT} — ${opts.marca} ${opts.modelo}`),

  citRechazado: (opts: {
    nombre: string; numeroCIT: string; serial: string
    marca: string; modelo: string; motivo: string; alertaMinSeg?: boolean
  }) => layout(`
    ${h1('❌ CIT rechazado', C.red)}
    ${p(`Hola <strong>${opts.nombre}</strong>,`)}
    ${p(`Lamentablemente el CIT <strong>${opts.numeroCIT}</strong> para tu <strong>${opts.marca} ${opts.modelo}</strong> (S/N: ${opts.serial}) fue rechazado.`)}
    ${opts.alertaMinSeg ? alertBox(`
      <strong>⚠ Alerta del Ministerio de Seguridad de Mendoza</strong><br>
      El rodado <strong>${opts.serial}</strong> figura en la base de denuncias provincial.
      Los datos fueron remitidos automáticamente a las autoridades competentes.
    `, 'error') : ''}
    ${infoBox([
      ['CIT',      opts.numeroCIT],
      ['Motivo',   opts.motivo],
      ['Estado',   '❌ Rechazado'],
    ], '#FEF2F2', C.red)}
    ${p('Si creés que hay un error, podés contactar a soporte:')}
    ${btn('Ir a soporte', 'https://rodaid.com.ar/soporte', C.navy)}
  `, `CIT rechazado — ${opts.marca} ${opts.modelo}`),

  citPorVencer: (opts: {
    nombre: string; numeroCIT: string; serial: string
    marca: string; modelo: string; diasRestantes: number; fechaVencimiento: string
  }) => {
    const critico  = opts.diasRestantes <= 1
    const urgente  = opts.diasRestantes <= 7
    const emoji    = critico ? '🔴' : urgente ? '⚠' : '📅'
    const color    = critico ? C.red : urgente ? C.yellow : C.navy
    const alerta   = critico
      ? alertBox(`<strong>Tu CIT vence hoy.</strong> Renovalo inmediatamente para seguir operando legalmente.`, 'error')
      : urgente
      ? alertBox(`Tu CIT vence en <strong>${opts.diasRestantes} día${opts.diasRestantes > 1 ? 's' : ''}</strong>. Renovalo pronto para evitar inconvenientes.`, 'warning')
      : ''
    return layout(`
      ${h1(`${emoji} CIT vence en ${opts.diasRestantes} día${opts.diasRestantes > 1 ? 's' : ''}`, color)}
      ${p(`Hola <strong>${opts.nombre}</strong>,`)}
      ${p(`El CIT de tu <strong>${opts.marca} ${opts.modelo}</strong> (S/N: ${opts.serial}) está próximo a vencer.`)}
      ${alerta}
      ${infoBox([
        ['CIT',              opts.numeroCIT],
        ['Vence el',         opts.fechaVencimiento],
        ['Días restantes',   `${opts.diasRestantes} día${opts.diasRestantes > 1 ? 's' : ''}`],
      ], urgente ? '#FFFBEB' : C.grayBg, color)}
      ${btn('Renovar mi CIT', `https://rodaid.com.ar/cit/${opts.numeroCIT}/renovar`, color)}
    `, `CIT vence en ${opts.diasRestantes} días — renovalo ahora`)
  },

  citVencido: (opts: { nombre: string; numeroCIT: string; serial: string; marca: string; modelo: string }) => layout(`
    ${h1('🔴 CIT vencido', C.red)}
    ${p(`Hola <strong>${opts.nombre}</strong>,`)}
    ${p(`El CIT <strong>${opts.numeroCIT}</strong> de tu <strong>${opts.marca} ${opts.modelo}</strong> venció.`)}
    ${alertBox('Operar sin CIT vigente puede acarrear sanciones bajo la Ley N° 9556. Renovalo para volver a estar en regla.', 'error')}
    ${btn('Renovar mi CIT ahora', `https://rodaid.com.ar/cit/${opts.numeroCIT}/renovar`, C.red)}
  `, `Tu CIT venció — renovalo para seguir operando`),

  // ── PAGOS / TASA ──────────────────────────────────────

  tasaConfirmada: (opts: { nombre: string; montoARS: number; pagoId: string; numeroCIT?: string }) => layout(`
    ${h1('💳 Pago confirmado')}
    ${p(`Hola <strong>${opts.nombre}</strong>,`)}
    ${p('Tu pago de tasa CIT fue acreditado exitosamente.')}
    ${infoBox([
      ['Monto',      `$${opts.montoARS.toLocaleString('es-AR')} ARS`],
      ['Ref. pago',  opts.pagoId.slice(0, 8).toUpperCase()],
      ...(opts.numeroCIT ? [['CIT', opts.numeroCIT] as [string, string]] : []),
      ['Estado',     '✅ Confirmado'],
    ], '#F0FDF4', C.green)}
    ${p('Ya podés continuar con el proceso de certificación de tu bicicleta.')}
    ${btn('Continuar con mi CIT', 'https://rodaid.com.ar/dashboard')}
  `, `Pago confirmado — $${opts.montoARS.toLocaleString('es-AR')} ARS`),

  pagoRechazado: (opts: { nombre: string; montoARS: number; motivo?: string }) => layout(`
    ${h1('❌ Pago rechazado', C.red)}
    ${p(`Hola <strong>${opts.nombre}</strong>,`)}
    ${p(`El pago de <strong>$${opts.montoARS.toLocaleString('es-AR')} ARS</strong> no pudo procesarse.`)}
    ${opts.motivo ? alertBox(`Motivo: ${opts.motivo}`, 'error') : ''}
    ${p('Podés intentar con otro método de pago o contactar a soporte:')}
    ${btn('Intentar de nuevo', 'https://rodaid.com.ar/dashboard', C.red)}
  `, 'Pago rechazado — verificá tus datos'),

  // ── DENUNCIAS ─────────────────────────────────────────

  denunciaRegistrada: (opts: {
    nombre: string; serial: string; marca: string
    modelo: string; numeroDenuncia: string; fecha: string
  }) => layout(`
    ${h1('🚨 Denuncia registrada', C.red)}
    ${p(`Hola <strong>${opts.nombre}</strong>,`)}
    ${p('Tu denuncia fue registrada y comunicada al Ministerio de Seguridad de Mendoza.')}
    ${infoBox([
      ['Bicicleta',   `${opts.marca} ${opts.modelo}`],
      ['Nº serie',    opts.serial],
      ['Nº denuncia', opts.numeroDenuncia],
      ['Fecha',       opts.fecha],
      ['Estado CIT',  '🔒 Bloqueado para transferencias'],
    ], '#FEF2F2', C.red)}
    ${alertBox('El CIT queda bloqueado para transferencias hasta que recuperes la bicicleta y solicites la rehabilitación.', 'error')}
    ${btn('Ver estado de denuncia', `https://rodaid.com.ar/denuncias/${opts.numeroDenuncia}`, C.red)}
  `, `Denuncia registrada: ${opts.marca} ${opts.modelo} (${opts.serial})`),

  biciRecuperada: (opts: { nombre: string; serial: string; marca: string; modelo: string }) => layout(`
    ${h1('🎉 ¡Bicicleta recuperada!', C.green)}
    ${p(`Hola <strong>${opts.nombre}</strong>,`)}
    ${p(`Tu <strong>${opts.marca} ${opts.modelo}</strong> (S/N: ${opts.serial}) fue marcada como recuperada en el sistema RODAID.`)}
    ${infoBox([
      ['Bicicleta', `${opts.marca} ${opts.modelo}`],
      ['Nº serie',  opts.serial],
      ['Estado CIT','✅ Activo — transferencias habilitadas'],
    ], '#F0FDF4', C.green)}
    ${p('El CIT vuelve a estar activo para todas las operaciones normales.')}
    ${btn('Ver mi CIT', `https://rodaid.com.ar/dashboard`, C.green)}
  `, `Bicicleta recuperada — ${opts.marca} ${opts.modelo}`),

  // ── MARKETPLACE / ESCROW ──────────────────────────────

  ventaConfirmada: (opts: {
    nombre: string; marca: string; modelo: string; serial: string
    montoARS: number; comisionARS: number
  }) => {
    const neto = opts.montoARS - opts.comisionARS
    return layout(`
      ${h1('💰 ¡Venta confirmada!')}
      ${p(`Hola <strong>${opts.nombre}</strong>,`)}
      ${p(`La venta de tu <strong>${opts.marca} ${opts.modelo}</strong> fue completada exitosamente.`)}
      ${infoBox([
        ['Bicicleta',        `${opts.marca} ${opts.modelo} (S/N: ${opts.serial})`],
        ['Precio de venta',  `$${opts.montoARS.toLocaleString('es-AR')} ARS`],
        ['Comisión RODAID',  `$${opts.comisionARS.toLocaleString('es-AR')} ARS`],
        ['Monto acreditado', `$${neto.toLocaleString('es-AR')} ARS ✅`],
      ], '#F0FDF4', C.green)}
      ${btn('Ver mis transacciones', 'https://rodaid.com.ar/transacciones', C.green)}
    `, `Venta confirmada — $${neto.toLocaleString('es-AR')} ARS acreditados`)
  },

  compraCompletada: (opts: {
    nombre: string; marca: string; modelo: string; serial: string
    montoARS: number; numeroCIT: string
  }) => layout(`
    ${h1('✅ ¡Compra completada!')}
    ${p(`Hola <strong>${opts.nombre}</strong>,`)}
    ${p(`Tu compra fue completada y los fondos fueron liberados al vendedor.`)}
    ${infoBox([
      ['Bicicleta',  `${opts.marca} ${opts.modelo}`],
      ['Nº serie',   opts.serial],
      ['CIT',        opts.numeroCIT],
      ['Monto',      `$${opts.montoARS.toLocaleString('es-AR')} ARS`],
    ], '#F0FDF4', C.green)}
    ${p('El CIT fue transferido a tu nombre en la Blockchain Federal Argentina.')}
    ${btn('Ver mi CIT', `https://rodaid.com.ar/cit/${opts.numeroCIT}`, C.green)}
  `, `Compra completada — ${opts.marca} ${opts.modelo}`),

  nuevaOferta: (opts: {
    nombre: string; marca: string; modelo: string; serial: string
    ofertaARS: number; publicacionId: string
  }) => layout(`
    ${h1('💬 Nueva oferta recibida')}
    ${p(`Hola <strong>${opts.nombre}</strong>,`)}
    ${p(`Recibiste una oferta por tu <strong>${opts.marca} ${opts.modelo}</strong>:`)}
    ${infoBox([
      ['Bicicleta', `${opts.marca} ${opts.modelo} (S/N: ${opts.serial})`],
      ['Oferta',    `$${opts.ofertaARS.toLocaleString('es-AR')} ARS`],
    ])}
    ${p('Revisá la oferta en el marketplace para aceptarla o rechazarla:')}
    ${btn('Ver oferta', `https://rodaid.com.ar/marketplace/${opts.publicacionId}`)}
  `, `Nueva oferta: $${opts.ofertaARS.toLocaleString('es-AR')} ARS por tu ${opts.marca} ${opts.modelo}`),

  disputaAbierta: (opts: {
    nombre: string; disputaId: string; motivo: string; rol: 'comprador' | 'vendedor'
  }) => layout(`
    ${h1('⚠ Disputa abierta — RODAID PAY', C.yellow)}
    ${p(`Hola <strong>${opts.nombre}</strong>,`)}
    ${p(opts.rol === 'comprador'
      ? 'Abriste una disputa sobre tu compra.'
      : 'La contraparte abrió una disputa sobre tu venta.')}
    ${infoBox([
      ['ID de disputa', opts.disputaId.slice(0, 8).toUpperCase()],
      ['Motivo',        opts.motivo],
      ['Resolución',    'Hasta 72 horas hábiles'],
    ], '#FFFBEB', C.yellow)}
    ${opts.rol === 'vendedor' ? p('Podés aportar evidencia desde tu panel para defender tu caso.') : ''}
    ${btn('Ver disputa', `https://rodaid.com.ar/transacciones/${opts.disputaId}`, C.yellow)}
  `, `Disputa abierta — ${opts.motivo.slice(0, 50)}`),

  disputaResuelta: (opts: {
    nombre: string; disputaId: string; resolucion: string; rol: 'comprador' | 'vendedor'
  }) => layout(`
    ${h1('✅ Disputa resuelta')}
    ${p(`Hola <strong>${opts.nombre}</strong>,`)}
    ${p('La disputa fue revisada y resuelta por el equipo RODAID.')}
    ${infoBox([
      ['ID de disputa', opts.disputaId.slice(0, 8).toUpperCase()],
      ['Resolución',    opts.resolucion],
    ], '#F0FDF4', C.green)}
    ${btn('Ver detalle', `https://rodaid.com.ar/transacciones/${opts.disputaId}`, C.green)}
  `, 'Disputa resuelta'),

  // ── NFT / BLOCKCHAIN ──────────────────────────────────

  nftTransferido: (opts: {
    nombre: string; numeroCIT: string; serial: string; txHash: string
  }) => layout(`
    ${h1('⛓ CIT transferido on-chain')}
    ${p(`Hola <strong>${opts.nombre}</strong>,`)}
    ${p('El certificado de tu bicicleta fue transferido a tu nombre en la Blockchain Federal Argentina (BFA).')}
    ${infoBox([
      ['CIT',        opts.numeroCIT],
      ['Nº serie',   opts.serial],
      ['BFA TxHash', opts.txHash.slice(0, 20) + '...'],
      ['Red',        'Blockchain Federal Argentina (BFA)'],
    ], '#F0FDF4', C.teal)}
    ${btn('Verificar en blockchain', `https://rodaid.com.ar/verificar?cit=${opts.numeroCIT}`, C.teal)}
  `, `CIT ${opts.numeroCIT} transferido a tu nombre en la BFA`),

  // ── AUTENTICACIÓN / SEGURIDAD ─────────────────────────

  alertaLoginNuevoDispositivo: (opts: {
    nombre: string; dispositivo: string; ip: string; fecha: string; revocarUrl: string
  }) => layout(`
    ${h1('🔐 Nuevo inicio de sesión detectado')}
    ${p(`Hola <strong>${opts.nombre}</strong>,`)}
    ${p('Detectamos un inicio de sesión desde un dispositivo o ubicación nuevos:')}
    ${infoBox([
      ['Dispositivo', opts.dispositivo],
      ['IP',          opts.ip],
      ['Fecha',       opts.fecha],
    ])}
    ${alertBox(`Si fuiste vos, no hay nada que hacer. Si <strong>no reconocés esta actividad</strong>, revocá el acceso inmediatamente.`, 'warning')}
    ${btn('Revocar acceso', opts.revocarUrl, C.red)}
  `, 'Nuevo inicio de sesión en tu cuenta RODAID'),

  codigoVerificacion2FA: (opts: { nombre: string; codigo: string; expiraMin?: number }) => layout(`
    ${h1('🔑 Tu código de verificación')}
    ${p(`Hola <strong>${opts.nombre}</strong>,`)}
    ${p('Tu código de verificación de dos factores es:')}
    <div style="text-align:center;margin:24px 0">
      <span style="font-size:36px;font-weight:900;color:${C.navy};letter-spacing:12px;font-family:'Courier New',monospace">${opts.codigo}</span>
    </div>
    ${p(`Expira en <strong>${opts.expiraMin ?? 10} minutos</strong>. No lo compartas con nadie.`, true)}
    ${alertBox('RODAID nunca te pedirá este código por teléfono o chat.', 'warning')}
  `, `Código de verificación: ${opts.codigo}`),
}

// ══════════════════════════════════════════════════════════
// SUBJECTS POR DEFECTO
// ══════════════════════════════════════════════════════════

export const SUBJECTS: Record<keyof typeof T, string | ((...args: any[]) => string)> = {
  bienvenida:                  '¡Bienvenido/a a RODAID! Tu cuenta está lista',
  verificacionEmail:           'Verificá tu email para activar tu cuenta RODAID',
  resetPassword:               'Restablecé tu contraseña RODAID',
  passwordCambiado:            '🔐 Tu contraseña RODAID fue cambiada',
  citEmitido:                  (o: any) => `✅ CIT emitido: ${o.numeroCIT} — ${o.marca} ${o.modelo}`,
  citRechazado:                (o: any) => `❌ CIT rechazado: ${o.numeroCIT}`,
  citPorVencer:                (o: any) => `${o.diasRestantes <= 1 ? '🔴 CIT vence HOY' : `⚠ CIT vence en ${o.diasRestantes} días`}: ${o.numeroCIT}`,
  citVencido:                  (o: any) => `🔴 CIT vencido: ${o.numeroCIT} — Renovalo ahora`,
  tasaConfirmada:              (o: any) => `💳 Pago confirmado: $${o.montoARS.toLocaleString('es-AR')} ARS`,
  pagoRechazado:               '❌ Pago rechazado — verificá tus datos de pago',
  denunciaRegistrada:          (o: any) => `🚨 Denuncia N° ${o.numeroDenuncia} — ${o.marca} ${o.modelo}`,
  biciRecuperada:              (o: any) => `🎉 Bicicleta recuperada: ${o.marca} ${o.modelo}`,
  ventaConfirmada:             (o: any) => `💰 Venta confirmada: $${(o.montoARS - o.comisionARS).toLocaleString('es-AR')} ARS acreditados`,
  compraCompletada:            (o: any) => `✅ Compra completada: ${o.marca} ${o.modelo}`,
  nuevaOferta:                 (o: any) => `💬 Nueva oferta: $${o.ofertaARS.toLocaleString('es-AR')} ARS`,
  disputaAbierta:              '⚠ Disputa abierta — RODAID PAY',
  disputaResuelta:             '✅ Disputa resuelta — RODAID PAY',
  nftTransferido:              (o: any) => `⛓ CIT ${o.numeroCIT} transferido on-chain`,
  alertaLoginNuevoDispositivo: '🔐 Nuevo inicio de sesión detectado en tu cuenta',
  codigoVerificacion2FA:       (o: any) => `🔑 Código: ${o.codigo} — RODAID`,
}

export function getSubject(template: keyof typeof T, opts: any): string {
  const s = SUBJECTS[template]
  return typeof s === 'function' ? s(opts) : s
}
