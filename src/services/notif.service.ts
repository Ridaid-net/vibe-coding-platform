import { getPool, type DbClient } from '@/lib/marketplace'
import { renderEmailRODAID } from '@/lib/notif-email'
import {
  emailConfigurado,
  enviarEmail,
  enviarPush,
  pushConfigurado,
  type ResultadoCanal,
} from '@/lib/notif-channels'

/**
 * RODAID — Motor de Notificaciones (3 canales).
 *
 *   IN_APP : siempre se guarda (fila en `notificaciones`). Es el canal de verdad y
 *            el unico garantizado; los externos son best-effort.
 *   EMAIL  : via Resend, si el usuario tiene email y el canal esta habilitado.
 *   PUSH   : via Firebase FCM, si el usuario registro tokens y el canal esta habilitado.
 *
 * Consistencia: la notificacion in-app se persiste primero y de forma atomica; recien
 * despues se despachan los canales externos, cuyo resultado se asienta en la misma
 * fila (`canales`) sin condicionar su existencia. Asi nunca se notifica por email/push
 * algo que no quedo registrado, ni se pierde el registro si un proveedor externo falla.
 *
 * Punto de extension transaccional: `emitirNotificacionEnTx(client, ...)` inserta la
 * fila IN_APP dentro de la transaccion del evento de negocio (p. ej. el rechazo del
 * CIT en el pipeline) y devuelve un "despacho" para correr los canales externos una
 * vez confirmada la transaccion.
 */

export type NotifTipo =
  | 'CIT_APROBADO'
  | 'CIT_RECHAZADO'
  | 'CIT_POR_VENCER'
  | 'DENUNCIA_REGISTRADA'
  | 'BICI_RECUPERADA'
  | 'VENTA_CONFIRMADA'
  | 'COMPRA_COMPLETADA'
  | 'REMITO_GENERADO'
  | 'REMITO_DESPACHADO'

interface NotificacionRow {
  id: string
  usuario_id: string
  tipo: NotifTipo
  titulo: string
  cuerpo: string
  cta_url: string | null
  data: Record<string, unknown>
  canales: Record<string, unknown>
  leida: boolean
  leida_en: string | null
  created_at: string
}

interface PreferenciasRow {
  usuario_id: string
  in_app_habilitado: boolean
  email_habilitado: boolean
  push_habilitado: boolean
  email: string | null
  fcm_tokens: string[]
  tipos_silenciados: NotifTipo[]
  created_at: string
  updated_at: string
}

export function mapNotificacion(row: NotificacionRow) {
  return {
    id: row.id,
    usuarioId: row.usuario_id,
    tipo: row.tipo,
    titulo: row.titulo,
    cuerpo: row.cuerpo,
    ctaUrl: row.cta_url,
    data: row.data ?? {},
    canales: row.canales ?? {},
    leida: row.leida,
    leidaEn: row.leida_en,
    createdAt: row.created_at,
  }
}

function mapPreferencias(row: PreferenciasRow) {
  return {
    usuarioId: row.usuario_id,
    inAppHabilitado: row.in_app_habilitado,
    emailHabilitado: row.email_habilitado,
    pushHabilitado: row.push_habilitado,
    email: row.email,
    fcmTokens: row.fcm_tokens ?? [],
    tiposSilenciados: row.tipos_silenciados ?? [],
    canalesDisponibles: {
      email: emailConfigurado(),
      push: pushConfigurado(),
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ── Preferencias y datos de contacto ─────────────────────────────────────────

/** Devuelve las preferencias del usuario, creando las de defecto si no existen. */
export async function obtenerPreferencias(usuarioId: string) {
  const res = await getPool().query<PreferenciasRow>(
    `
      INSERT INTO notif_preferencias (usuario_id)
      VALUES ($1)
      ON CONFLICT (usuario_id) DO UPDATE SET updated_at = notif_preferencias.updated_at
      RETURNING *
    `,
    [usuarioId]
  )
  return mapPreferencias(res.rows[0])
}

export async function actualizarPreferencias(
  usuarioId: string,
  patch: {
    inAppHabilitado?: boolean
    emailHabilitado?: boolean
    pushHabilitado?: boolean
    email?: string | null
  }
) {
  const res = await getPool().query<PreferenciasRow>(
    `
      INSERT INTO notif_preferencias
        (usuario_id, in_app_habilitado, email_habilitado, push_habilitado, email)
      VALUES ($1, COALESCE($2, TRUE), COALESCE($3, TRUE), COALESCE($4, TRUE), $5)
      ON CONFLICT (usuario_id) DO UPDATE SET
        in_app_habilitado = COALESCE($2, notif_preferencias.in_app_habilitado),
        email_habilitado  = COALESCE($3, notif_preferencias.email_habilitado),
        push_habilitado   = COALESCE($4, notif_preferencias.push_habilitado),
        email             = COALESCE($5, notif_preferencias.email),
        updated_at        = NOW()
      RETURNING *
    `,
    [
      usuarioId,
      patch.inAppHabilitado ?? null,
      patch.emailHabilitado ?? null,
      patch.pushHabilitado ?? null,
      patch.email ?? null,
    ]
  )
  return mapPreferencias(res.rows[0])
}

/** Registra (sin duplicar) un token FCM del dispositivo del usuario. */
export async function registrarFcmToken(usuarioId: string, token: string) {
  const res = await getPool().query<PreferenciasRow>(
    `
      INSERT INTO notif_preferencias (usuario_id, fcm_tokens)
      VALUES ($1, jsonb_build_array($2::text))
      ON CONFLICT (usuario_id) DO UPDATE SET
        fcm_tokens = (
          SELECT COALESCE(jsonb_agg(DISTINCT t), '[]'::jsonb)
          FROM jsonb_array_elements_text(
            notif_preferencias.fcm_tokens || jsonb_build_array($2::text)
          ) AS t
        ),
        updated_at = NOW()
      RETURNING *
    `,
    [usuarioId, token]
  )
  return mapPreferencias(res.rows[0])
}

/** Depura tokens FCM invalidos (NotRegistered / InvalidRegistration) reportados por FCM. */
async function depurarTokens(usuarioId: string, invalidos: string[]) {
  if (invalidos.length === 0) return
  await getPool().query(
    `
      UPDATE notif_preferencias
      SET fcm_tokens = (
            SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
            FROM jsonb_array_elements_text(fcm_tokens) AS t
            WHERE t <> ALL($2::text[])
          ),
          updated_at = NOW()
      WHERE usuario_id = $1
    `,
    [usuarioId, invalidos]
  )
}

// ── Lecturas ──────────────────────────────────────────────────────────────────

export async function listarNotificaciones(
  usuarioId: string,
  opciones: { soloNoLeidas?: boolean; limit?: number; offset?: number } = {}
) {
  const limit = Math.min(Math.max(opciones.limit ?? 20, 1), 100)
  const offset = Math.max(opciones.offset ?? 0, 0)
  const soloNoLeidas = opciones.soloNoLeidas === true

  const where = soloNoLeidas
    ? `WHERE usuario_id = $1 AND leida = FALSE`
    : `WHERE usuario_id = $1`

  const [items, totales] = await Promise.all([
    getPool().query<NotificacionRow>(
      `SELECT * FROM notificaciones ${where} ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [usuarioId, limit, offset]
    ),
    getPool().query<{ total: string; no_leidas: string }>(
      `
        SELECT
          COUNT(*)::text AS total,
          COUNT(*) FILTER (WHERE leida = FALSE)::text AS no_leidas
        FROM notificaciones
        WHERE usuario_id = $1
      `,
      [usuarioId]
    ),
  ])

  return {
    items: items.rows.map(mapNotificacion),
    total: Number(totales.rows[0]?.total ?? 0),
    noLeidas: Number(totales.rows[0]?.no_leidas ?? 0),
    limit,
    offset,
  }
}

export async function marcarLeida(usuarioId: string, id: string) {
  const res = await getPool().query<NotificacionRow>(
    `
      UPDATE notificaciones
      SET leida = TRUE, leida_en = COALESCE(leida_en, NOW())
      WHERE id = $1 AND usuario_id = $2
      RETURNING *
    `,
    [id, usuarioId]
  )
  return res.rows[0] ? mapNotificacion(res.rows[0]) : null
}

export async function marcarTodasLeidas(usuarioId: string) {
  const res = await getPool().query(
    `
      UPDATE notificaciones
      SET leida = TRUE, leida_en = NOW()
      WHERE usuario_id = $1 AND leida = FALSE
    `,
    [usuarioId]
  )
  return { actualizadas: res.rowCount ?? 0 }
}

// ── Emision (nucleo de 3 canales) ────────────────────────────────────────────

export interface EmitirInput {
  usuarioId: string
  tipo: NotifTipo
  titulo: string
  cuerpo: string
  /** Parrafos del email (si se omite, se usa `cuerpo`). */
  parrafosEmail?: string[]
  cta?: { label: string; url: string }
  detalles?: Array<{ etiqueta: string; valor: string }>
  data?: Record<string, unknown>
  /** Fuerza el email aunque el usuario lo tenga deshabilitado o silenciado (alertas criticas). */
  forzarEmail?: boolean
}

/** Inserta la fila IN_APP. Acepta un client para participar en una transaccion externa. */
async function insertarInApp(
  input: EmitirInput,
  client?: DbClient
): Promise<NotificacionRow> {
  const sql = `
    INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, cta_url, data)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    RETURNING *
  `
  const params = [
    input.usuarioId,
    input.tipo,
    input.titulo,
    input.cuerpo,
    input.cta?.url ?? null,
    JSON.stringify(input.data ?? {}),
  ]
  const runner = client ?? getPool()
  const res = await runner.query<NotificacionRow>(sql, params)
  return res.rows[0]
}

/** Corre los canales externos (email/push) segun preferencias y asienta el resultado. */
async function despacharExternos(
  notif: NotificacionRow,
  input: EmitirInput
): Promise<void> {
  const prefs = await obtenerPreferencias(input.usuarioId)
  const silenciado = prefs.tiposSilenciados.includes(input.tipo)
  const canales: Record<string, ResultadoCanal | { enviado: false; motivo: string }> = {
    in_app: { enviado: true },
  }

  // EMAIL: habilitado y no silenciado, o forzado (alerta critica).
  const emailPermitido = input.forzarEmail || (prefs.emailHabilitado && !silenciado)
  if (emailPermitido && prefs.email) {
    const { html, text } = renderEmailRODAID({
      asunto: input.titulo,
      titulo: input.titulo,
      parrafos: input.parrafosEmail ?? [input.cuerpo],
      cta: input.cta,
      detalles: input.detalles,
    })
    canales.email = await enviarEmail({
      para: prefs.email,
      asunto: input.titulo,
      html,
      text,
    })
  } else {
    canales.email = {
      enviado: false,
      motivo: input.forzarEmail
        ? 'EMAIL_SIN_DIRECCION'
        : !prefs.emailHabilitado
          ? 'EMAIL_DESHABILITADO'
          : silenciado
            ? 'TIPO_SILENCIADO'
            : 'EMAIL_SIN_DIRECCION',
    }
  }

  // PUSH: habilitado y no silenciado.
  const pushPermitido = prefs.pushHabilitado && !silenciado
  if (pushPermitido && prefs.fcmTokens.length > 0) {
    const resultado = await enviarPush({
      tokens: prefs.fcmTokens,
      titulo: input.titulo,
      cuerpo: input.cuerpo,
      data: { tipo: input.tipo, notificacionId: notif.id, ...(input.cta ? { url: input.cta.url } : {}) },
    })
    canales.push = resultado
    if (resultado.tokensInvalidos?.length) {
      await depurarTokens(input.usuarioId, resultado.tokensInvalidos).catch(() => undefined)
    }
  } else {
    canales.push = {
      enviado: false,
      motivo: !prefs.pushHabilitado
        ? 'PUSH_DESHABILITADO'
        : silenciado
          ? 'TIPO_SILENCIADO'
          : 'PUSH_SIN_TOKENS',
    }
  }

  await getPool()
    .query(`UPDATE notificaciones SET canales = $2::jsonb WHERE id = $1`, [
      notif.id,
      JSON.stringify(canales),
    ])
    .catch(() => undefined)
}

/**
 * Emite una notificacion por los 3 canales. La fila IN_APP se persiste siempre; los
 * canales externos son best-effort y nunca hacen fallar la emision. Devuelve la
 * notificacion in-app creada.
 */
export async function emitirNotificacion(input: EmitirInput) {
  const notif = await insertarInApp(input)
  // Best-effort: un fallo de email/push no debe propagarse al evento de negocio.
  await despacharExternos(notif, input).catch((error) => {
    console.error('[notif] fallo el despacho de canales externos', notif.id, error)
  })
  return mapNotificacion(notif)
}

/**
 * Variante transaccional: inserta la fila IN_APP DENTRO de la transaccion del
 * llamador (consistencia con el evento de negocio) y devuelve un `despachar()` que
 * el llamador invoca DESPUES del COMMIT para correr los canales externos.
 */
export async function emitirNotificacionEnTx(
  client: DbClient,
  input: EmitirInput
): Promise<{ notificacion: ReturnType<typeof mapNotificacion>; despachar: () => Promise<void> }> {
  const notif = await insertarInApp(input, client)
  return {
    notificacion: mapNotificacion(notif),
    despachar: () =>
      despacharExternos(notif, input).catch((error) => {
        console.error('[notif] fallo el despacho de canales externos', notif.id, error)
      }),
  }
}

// ── URLs de la app para los CTA ──────────────────────────────────────────────

function appUrl(path: string): string {
  const base = (process.env.RODAID_APP_URL ?? process.env.APP_URL ?? 'https://rodaid.app')
    .trim()
    .replace(/\/+$/, '')
  return `${base}${path}`
}

// ── Las 7 notificaciones de negocio ──────────────────────────────────────────

/** CIT_APROBADO — tras la acunacion exitosa del NFT en BFA. */
export function notificarCITAprobado(
  ciclistaId: string,
  datos: {
    citId: string
    bicicletaSerial: string
    txHash?: string | null
    explorerUrl?: string | null
    red?: string | null
  }
) {
  const detalles: Array<{ etiqueta: string; valor: string }> = [
    { etiqueta: 'Rodado', valor: datos.bicicletaSerial },
  ]
  if (datos.red) detalles.push({ etiqueta: 'Red', valor: datos.red })
  if (datos.txHash) detalles.push({ etiqueta: 'Transaccion', valor: datos.txHash })

  return emitirNotificacion({
    usuarioId: ciclistaId,
    tipo: 'CIT_APROBADO',
    titulo: 'Tu certificado fue acunado en la Blockchain Federal Argentina',
    cuerpo: `El CIT de tu rodado ${datos.bicicletaSerial} quedo anclado on-chain como NFT. Su identidad es ahora verificable de forma publica.`,
    parrafosEmail: [
      `Tu Certificado de Identidad Tecnica (CIT) fue aprobado y acunado como NFT en la Blockchain Federal Argentina.`,
      `El rodado ${datos.bicicletaSerial} queda con su identidad anclada on-chain, verificable por cualquier tercero.`,
    ],
    cta: { label: 'Ver en RODAID', url: datos.explorerUrl ?? appUrl(`/cit/${datos.citId}`) },
    detalles,
    data: {
      citId: datos.citId,
      txHash: datos.txHash ?? null,
      explorerUrl: datos.explorerUrl ?? null,
    },
  })
}

/** CIT_RECHAZADO — alerta del Ministerio de Seguridad. Fuerza email. */
export function notificarCITRechazado(
  ciclistaId: string,
  datos: { citId: string; bicicletaSerial: string; motivo: string }
) {
  return emitirNotificacion({
    usuarioId: ciclistaId,
    tipo: 'CIT_RECHAZADO',
    titulo: 'Tu certificado fue rechazado en el cruce de seguridad',
    cuerpo: `El CIT de tu rodado ${datos.bicicletaSerial} fue rechazado: ${datos.motivo}`,
    parrafosEmail: [
      `El Certificado de Identidad Tecnica de tu rodado ${datos.bicicletaSerial} fue rechazado durante el cruce con el Ministerio de Seguridad.`,
      `Motivo: ${datos.motivo}`,
      `Si considerás que se trata de un error, comunicate con tu taller aliado o con RODAID para iniciar la revisión.`,
    ],
    cta: { label: 'Ver en RODAID', url: appUrl(`/cit/${datos.citId}`) },
    data: { citId: datos.citId, motivo: datos.motivo },
    forzarEmail: true,
  })
}

/** CIT_POR_VENCER — la vigencia del certificado esta proxima a expirar. */
export function notificarCITPorVencer(
  ciclistaId: string,
  datos: { citId: string; bicicletaSerial: string; venceEn: string }
) {
  return emitirNotificacion({
    usuarioId: ciclistaId,
    tipo: 'CIT_POR_VENCER',
    titulo: 'Tu certificado esta proximo a vencer',
    cuerpo: `El CIT de tu rodado ${datos.bicicletaSerial} vence el ${datos.venceEn}. Renovalo para mantener su vigencia.`,
    cta: { label: 'Renovar en RODAID', url: appUrl(`/cit/${datos.citId}`) },
    detalles: [
      { etiqueta: 'Rodado', valor: datos.bicicletaSerial },
      { etiqueta: 'Vence', valor: datos.venceEn },
    ],
    data: { citId: datos.citId, venceEn: datos.venceEn },
  })
}

/** DENUNCIA_REGISTRADA — se registro una denuncia de robo del rodado. */
export function notificarDenunciaRegistrada(
  ciclistaId: string,
  datos: { denunciaId: string; bicicletaSerial: string }
) {
  return emitirNotificacion({
    usuarioId: ciclistaId,
    tipo: 'DENUNCIA_REGISTRADA',
    titulo: 'Registramos la denuncia de tu rodado',
    cuerpo: `Tu rodado ${datos.bicicletaSerial} quedo marcado como denunciado en RODAID. Te avisaremos ante cualquier novedad.`,
    cta: { label: 'Ver la denuncia', url: appUrl(`/denuncias/${datos.denunciaId}`) },
    detalles: [{ etiqueta: 'Rodado', valor: datos.bicicletaSerial }],
    data: { denunciaId: datos.denunciaId },
    forzarEmail: true,
  })
}

/** BICI_RECUPERADA — el rodado denunciado fue localizado/recuperado. */
export function notificarBiciRecuperada(
  ciclistaId: string,
  datos: { bicicletaSerial: string; detalle?: string | null; denunciaId?: string | null }
) {
  return emitirNotificacion({
    usuarioId: ciclistaId,
    tipo: 'BICI_RECUPERADA',
    titulo: 'Buenas noticias: tu rodado fue recuperado',
    cuerpo: `Tu rodado ${datos.bicicletaSerial} fue localizado.${datos.detalle ? ` ${datos.detalle}` : ''}`,
    cta: {
      label: 'Ver en RODAID',
      url: appUrl(datos.denunciaId ? `/denuncias/${datos.denunciaId}` : '/mis-rodados'),
    },
    detalles: [{ etiqueta: 'Rodado', valor: datos.bicicletaSerial }],
    data: { denunciaId: datos.denunciaId ?? null },
    forzarEmail: true,
  })
}

/** VENTA_CONFIRMADA — al vendedor: la venta se cerro y se liberaron los fondos. */
export function notificarVentaConfirmada(
  vendedorId: string,
  datos: { transaccionId: string; montoVendedor: number; titulo?: string | null }
) {
  return emitirNotificacion({
    usuarioId: vendedorId,
    tipo: 'VENTA_CONFIRMADA',
    titulo: 'Tu venta se confirmo y liberamos los fondos',
    cuerpo: `Se confirmo la entrega${datos.titulo ? ` de "${datos.titulo}"` : ''}. Acreditamos $${datos.montoVendedor.toLocaleString('es-AR')} a tu favor.`,
    cta: { label: 'Ver la operacion', url: appUrl(`/transacciones/${datos.transaccionId}`) },
    detalles: [
      { etiqueta: 'Monto acreditado', valor: `$${datos.montoVendedor.toLocaleString('es-AR')}` },
    ],
    data: { transaccionId: datos.transaccionId, montoVendedor: datos.montoVendedor },
  })
}

/** COMPRA_COMPLETADA — al comprador: la operacion se completo y el CIT se transfiere. */
export function notificarCompraCompletada(
  compradorId: string,
  datos: { transaccionId: string; titulo?: string | null }
) {
  return emitirNotificacion({
    usuarioId: compradorId,
    tipo: 'COMPRA_COMPLETADA',
    titulo: 'Tu compra se completo',
    cuerpo: `Confirmamos tu compra${datos.titulo ? ` de "${datos.titulo}"` : ''}. El CIT mantiene su identidad y su historial — el cambio de titularidad quedó anclado en la Blockchain Federal Argentina.`,
    cta: { label: 'Ver la operacion', url: appUrl(`/transacciones/${datos.transaccionId}`) },
    data: { transaccionId: datos.transaccionId },
  })
}

/**
 * REMITO_GENERADO — el vendedor generó el Remito de Embalaje y Despacho
 * (Fase 6b, CIT Completo). Variante para cuando el Taller Aliado SÍ tiene una
 * cuenta de usuario vinculada (aliados.usuario_id): in-app + email por el
 * motor normal, con preferencias.
 */
export function notificarRemitoGenerado(
  tallerUsuarioId: string,
  datos: { remitoId: string; numero: string; bicicletaSerial: string; vendedorNombre: string }
) {
  return emitirNotificacion({
    usuarioId: tallerUsuarioId,
    tipo: 'REMITO_GENERADO',
    titulo: 'Nuevo Remito de Embalaje y Despacho',
    cuerpo: `${datos.vendedorNombre} confirmó la venta de la bici ${datos.bicicletaSerial}. Generá el embalaje y confirmá el despacho desde tu panel.`,
    parrafosEmail: [
      `${datos.vendedorNombre} confirmó el pago de una venta de CIT Completo — la bici ${datos.bicicletaSerial} está lista para embalar.`,
      `Descargá el remito (N° ${datos.numero}), embalá la bici siguiendo las instrucciones impresas, y confirmá el despacho desde tu Panel de Taller Aliado.`,
    ],
    cta: { label: 'Ver en mi Panel de Taller', url: appUrl('/taller') },
    detalles: [
      { etiqueta: 'Remito', valor: datos.numero },
      { etiqueta: 'Bici', valor: datos.bicicletaSerial },
    ],
    data: { remitoId: datos.remitoId, numero: datos.numero },
    forzarEmail: true, // orden de trabajo real -- tiene que llegar si o si
  })
}

/**
 * REMITO_GENERADO — variante para cuando el Taller Aliado NO tiene cuenta de
 * usuario vinculada. El motor de notificaciones normal es enteramente
 * usuario_id-centrico (preferencias, fila in-app) y no aplica sin una cuenta
 * -- se manda un email directo a aliados.email, sin preferencias de por medio.
 */
export async function notificarRemitoGeneradoSinCuenta(
  email: string,
  datos: { numero: string; bicicletaSerial: string; vendedorNombre: string }
): Promise<void> {
  if (!emailConfigurado()) return
  const { html, text } = renderEmailRODAID({
    asunto: 'Nuevo Remito de Embalaje y Despacho',
    titulo: 'Nuevo Remito de Embalaje y Despacho',
    parrafos: [
      `${datos.vendedorNombre} confirmó el pago de una venta de CIT Completo — la bici ${datos.bicicletaSerial} está lista para embalar.`,
      `Descargá el remito (N° ${datos.numero}) desde tu Panel de Taller Aliado en RODAID y confirmá el despacho una vez embalada.`,
    ],
    cta: { label: 'Ingresar a RODAID', url: appUrl('/taller') },
  })
  await enviarEmail({ para: email, asunto: 'Nuevo Remito de Embalaje y Despacho', html, text }).catch(
    (error) => console.error('[notif] fallo el email directo de REMITO_GENERADO', error)
  )
}

/**
 * REMITO_DESPACHADO — el Taller confirmó el embalaje y despacho. El
 * comprador siempre tiene cuenta (es requisito para haber comprado), asi que
 * usa el motor normal directamente.
 */
export function notificarRemitoDespachado(
  compradorId: string,
  datos: { remitoId: string; numero: string; bicicletaSerial: string }
) {
  return emitirNotificacion({
    usuarioId: compradorId,
    tipo: 'REMITO_DESPACHADO',
    titulo: 'Tu bici ya fue despachada',
    cuerpo: `El Taller Aliado confirmó el embalaje y despacho de la bici ${datos.bicicletaSerial}. Está en camino.`,
    cta: { label: 'Ver mis compras', url: appUrl('/garaje') },
    detalles: [{ etiqueta: 'Remito', valor: datos.numero }],
    data: { remitoId: datos.remitoId, numero: datos.numero },
  })
}
