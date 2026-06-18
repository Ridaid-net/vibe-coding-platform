// ─── RODAID · Dispatcher de Notificaciones ───────────────
// Conecta los eventos de negocio a los canales de notificación:
//   · FCM push (web + Android)
//   · Email (Resend)
//   · MxM canal gubernamental
//   · In-app (tabla notificaciones)
//
// Todos los dispatchers son fire-and-forget desde los servicios
// de negocio — nunca bloquean el flujo principal.
//
// Eventos cubiertos:
//   notificarCITEmitido       — CIT activo en BFA
//   notificarTasaConfirmada   — pago de tasa procesado
//   notificarDenunciaRobo     — bicicleta denunciada
//   notificarBiciRecuperada   — bicicleta recuperada
//   notificarVenta            — escrow completado (vendedor + comprador)
//   notificarDisputa          — disputa abierta (ambas partes)
//   notificarSistema          — mensaje general

import { log }                   from '../middleware/logger'
import { queryOne }              from '../config/database'
import { enviarPushUsuario }     from './fcm.service'
import { enviarAPNsUsuario }     from './apns.service'
import {
  emailCITEmitido, emailTasaConfirmada, emailDenunciaRobo,
  emailVentaConfirmada, emailCompraCompletada, emailDisputaAbierta,
} from './email.service'
import {
  notifCITEmitido, notifTasaConfirmada, notifDenunciaRobo,
  notifBiciRecuperada, notifVentaConfirmada, notifNFTTransferido,
  notifDisputaAbierta, notifSistema,
} from './mxm.notificaciones.service'

// ══════════════════════════════════════════════════════════
// HELPER: obtener datos del usuario para notificaciones
// ══════════════════════════════════════════════════════════

async function getUsuarioNotif(userId: string): Promise<{
  email: string; nombre: string; apellido: string; nombreCompleto: string
} | null> {
  return queryOne<{ email: string; nombre: string; apellido: string; nombreCompleto: string }>(
    `SELECT email, nombre, apellido,
            COALESCE(nombre || ' ' || apellido, email) AS "nombreCompleto"
     FROM usuarios WHERE id=$1`,
    [userId]
  )
}

// Fire-and-forget wrapper con logging
function despachar(nombre: string, fn: () => Promise<unknown>): void {
  fn().catch(err => log.mensajeria.error({ evento: nombre, err: (err as Error).message }, `Error despachando ${nombre}`))
}

// ══════════════════════════════════════════════════════════
// 1. CIT EMITIDO (BFA on-chain)
// ══════════════════════════════════════════════════════════

export function despacharCITEmitido(opts: {
  usuarioId:  string
  numeroCIT:  string
  serial:     string
  marca:      string
  modelo:     string
  txHash:     string
}): void {
  despachar('CITEmitido', async () => {
    const u = await getUsuarioNotif(opts.usuarioId)
    if (!u) return

    await Promise.allSettled([
      // Push FCM (Android + Web) + APNs (iOS nativo si aplica)
      enviarAPNsUsuario(opts.usuarioId, { titulo: `✅ CIT emitido: ${opts.numeroCIT}`, cuerpo: `${opts.marca} ${opts.modelo} certificada bajo Ley 9556`, badge: 1, mutableContent: true, collapseId: `cit-${opts.numeroCIT}`, datos: { tipo: 'CIT_APROBADO', numeroCIT: opts.numeroCIT } }),
      enviarPushUsuario(opts.usuarioId, {
        titulo:   `✅ CIT emitido: ${opts.numeroCIT}`,
        cuerpo:   `${opts.marca} ${opts.modelo} certificada bajo Ley 9556`,
        clickUrl: `${process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.com.ar'}/cit/${opts.numeroCIT}`,
        datos:    { tipo: 'CIT_APROBADO', numeroCIT: opts.numeroCIT, serial: opts.serial },
      }),
      // Email
      emailCITEmitido({ to: u.email, nombre: u.nombre ?? u.email, ...opts }),
      // MxM (canal gubernamental)
      notifCITEmitido({ usuarioId: opts.usuarioId, numeroCIT: opts.numeroCIT, serial: opts.serial, marca: opts.marca, modelo: opts.modelo, txHash: opts.txHash }),
    ])

    log.mensajeria.info({ numeroCIT: opts.numeroCIT, usuarioId: opts.usuarioId.slice(0, 8) },
      '✓ Notificaciones CIT emitido enviadas (FCM + Email + MxM)')
  })
}

// ══════════════════════════════════════════════════════════
// 2. TASA CIT CONFIRMADA
// ══════════════════════════════════════════════════════════

export function despacharTasaConfirmada(opts: {
  usuarioId: string; montoARS: number; pagoId: string; numeroCIT?: string
}): void {
  despachar('TasaConfirmada', async () => {
    const u = await getUsuarioNotif(opts.usuarioId)
    if (!u) return
    await Promise.allSettled([
      enviarPushUsuario(opts.usuarioId, {
        titulo: `💳 Tasa confirmada — $${opts.montoARS.toLocaleString('es-AR')} ARS`,
        cuerpo: 'Tu pago fue acreditado. Podés continuar con la emisión del CIT.',
        datos:  { tipo: 'TASA_CONFIRMADA', pagoId: opts.pagoId },
      }),
      emailTasaConfirmada({ to: u.email, nombre: u.nombre ?? u.email, ...opts }),
      notifTasaConfirmada({ usuarioId: opts.usuarioId, montoARS: opts.montoARS, pagoId: opts.pagoId, numeroCIT: opts.numeroCIT }),
    ])
  })
}

// ══════════════════════════════════════════════════════════
// 3. DENUNCIA DE ROBO
// ══════════════════════════════════════════════════════════

export function despacharDenunciaRobo(opts: {
  usuarioId:      string
  serial:         string
  marca:          string
  modelo:         string
  numeroDenuncia: string
}): void {
  despachar('DenunciaRobo', async () => {
    const u = await getUsuarioNotif(opts.usuarioId)
    if (!u) return
    await Promise.allSettled([
      enviarPushUsuario(opts.usuarioId, {
        titulo: `🚨 Denuncia registrada — ${opts.serial}`,
        cuerpo: `CIT bloqueado. Denuncia N° ${opts.numeroDenuncia}`,
        datos:  { tipo: 'DENUNCIA_REGISTRADA', serial: opts.serial, numeroDenuncia: opts.numeroDenuncia },
      }),
      emailDenunciaRobo({ to: u.email, nombre: u.nombre ?? u.email, ...opts }),
      notifDenunciaRobo({ usuarioId: opts.usuarioId, serial: opts.serial, marca: opts.marca, modelo: opts.modelo, numeroDenuncia: opts.numeroDenuncia }),
    ])
  })
}

// ══════════════════════════════════════════════════════════
// 4. BICICLETA RECUPERADA
// ══════════════════════════════════════════════════════════

export function despacharBiciRecuperada(opts: {
  usuarioId: string; serial: string; marca: string; modelo: string
}): void {
  despachar('BiciRecuperada', async () => {
    const u = await getUsuarioNotif(opts.usuarioId)
    if (!u) return
    await Promise.allSettled([
      enviarPushUsuario(opts.usuarioId, {
        titulo: `🎉 Bicicleta recuperada`,
        cuerpo: `${opts.marca} ${opts.modelo} marcada como recuperada. CIT activo nuevamente.`,
        datos:  { tipo: 'BICI_RECUPERADA', serial: opts.serial },
      }),
      notifBiciRecuperada({ usuarioId: opts.usuarioId, serial: opts.serial, marca: opts.marca, modelo: opts.modelo }),
    ])
  })
}

// ══════════════════════════════════════════════════════════
// 5. VENTA COMPLETADA (escrow → COMPLETADA)
// ══════════════════════════════════════════════════════════

export function despacharVentaCompletada(opts: {
  vendedorId:  string
  compradorId: string
  montoARS:    number
  comisionARS: number
  serial:      string
  marca:       string
  modelo:      string
  numeroCIT:   string
}): void {
  despachar('VentaCompletada', async () => {
    const [vendedor, comprador] = await Promise.all([
      getUsuarioNotif(opts.vendedorId),
      getUsuarioNotif(opts.compradorId),
    ])
    const neto = opts.montoARS - opts.comisionARS

    await Promise.allSettled([
      // Vendedor: FCM + Email + MxM
      vendedor && enviarPushUsuario(opts.vendedorId, {
        titulo: `💰 Venta confirmada — $${neto.toLocaleString('es-AR')} ARS`,
        cuerpo: `${opts.marca} ${opts.modelo} vendida. Fondos acreditados.`,
        datos:  { tipo: 'VENTA_CONFIRMADA', montoNeto: String(neto) },
      }),
      vendedor && emailVentaConfirmada({
        to: vendedor.email, nombre: vendedor.nombre ?? vendedor.email, ...opts,
      }),
      // Comprador: FCM + Email + MxM
      comprador && enviarPushUsuario(opts.compradorId, {
        titulo: `✅ Compra completada — ${opts.marca} ${opts.modelo}`,
        cuerpo: `Tu confirmación liberó $${neto.toLocaleString('es-AR')} ARS al vendedor.`,
        datos:  { tipo: 'COMPRA_COMPLETADA', serial: opts.serial },
      }),
      comprador && emailCompraCompletada({
        to: comprador.email, nombre: comprador.nombre ?? comprador.email, ...opts,
      }),
      // MxM (ambos)
      notifVentaConfirmada({ vendedorId: opts.vendedorId, compradorId: opts.compradorId, montoARS: opts.montoARS, comisionARS: opts.comisionARS, serial: opts.serial, marca: opts.marca, modelo: opts.modelo }),
    ])

    log.mensajeria.info({
      vendedorId: opts.vendedorId.slice(0, 8), compradorId: opts.compradorId.slice(0, 8),
      neto, serial: opts.serial,
    }, '✓ Notificaciones venta completada enviadas')
  })
}

// ══════════════════════════════════════════════════════════
// 6. NFT TRANSFERIDO
// ══════════════════════════════════════════════════════════

export function despacharNFTTransferido(opts: {
  compradorId: string; serial: string; txHash: string; numeroCIT: string
}): void {
  despachar('NFTTransferido', async () => {
    const u = await getUsuarioNotif(opts.compradorId)
    if (!u) return
    await Promise.allSettled([
      enviarPushUsuario(opts.compradorId, {
        titulo: `⛓ CIT transferido on-chain`,
        cuerpo: `${opts.numeroCIT} ahora está en tu nombre en la BFA.`,
        datos:  { tipo: 'NFT_TRANSFERIDO', txHash: opts.txHash.slice(0, 20), numeroCIT: opts.numeroCIT },
      }),
      notifNFTTransferido({ compradorId: opts.compradorId, serial: opts.serial, txHash: opts.txHash, numeroCIT: opts.numeroCIT }),
    ])
  })
}

// ══════════════════════════════════════════════════════════
// 7. DISPUTA ABIERTA
// ══════════════════════════════════════════════════════════

export function despacharDisputaAbierta(opts: {
  iniciadorId:    string
  otroId:         string
  disputaId:      string
  motivo:         string
  transaccionId:  string
}): void {
  despachar('DisputaAbierta', async () => {
    const [iniciador, otro] = await Promise.all([
      getUsuarioNotif(opts.iniciadorId),
      getUsuarioNotif(opts.otroId),
    ])
    await Promise.allSettled([
      iniciador && enviarPushUsuario(opts.iniciadorId, {
        titulo: '⚠ Disputa abierta — RODAID PAY',
        cuerpo: `Motivo: ${opts.motivo}. Resolución en 72hs.`,
        datos:  { tipo: 'DISPUTA_ABIERTA', disputaId: opts.disputaId },
      }),
      otro && enviarPushUsuario(opts.otroId, {
        titulo: '⚠ Se abrió una disputa sobre tu transacción',
        cuerpo: `Motivo: ${opts.motivo}. Aportá evidencia en tu panel.`,
        datos:  { tipo: 'DISPUTA_ABIERTA', disputaId: opts.disputaId },
      }),
      iniciador && emailDisputaAbierta({
        to: iniciador.email, nombre: iniciador.nombre ?? iniciador.email,
        disputaId: opts.disputaId, motivo: opts.motivo, rol: 'comprador',
      }),
      otro && emailDisputaAbierta({
        to: otro.email, nombre: otro.nombre ?? otro.email,
        disputaId: opts.disputaId, motivo: opts.motivo, rol: 'vendedor',
      }),
      notifDisputaAbierta({ iniciadorId: opts.iniciadorId, otroId: opts.otroId, disputaId: opts.disputaId, motivo: opts.motivo, transaccionId: opts.transaccionId }),
    ])
  })
}

// ══════════════════════════════════════════════════════════
// 8. MENSAJE DEL SISTEMA
// ══════════════════════════════════════════════════════════

export function despacharSistema(opts: {
  usuarioId: string; titulo: string; cuerpo: string; urgente?: boolean
}): void {
  despachar('Sistema', async () => {
    await Promise.allSettled([
      enviarPushUsuario(opts.usuarioId, {
        titulo: opts.titulo,
        cuerpo: opts.cuerpo,
        datos:  { tipo: 'SISTEMA_GENERAL' },
      }),
      notifSistema({ usuarioId: opts.usuarioId, titulo: opts.titulo, cuerpo: opts.cuerpo, urgente: opts.urgente }),
    ])
  })
}
