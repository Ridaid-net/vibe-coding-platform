// RODAID — Modulo 4 (CIT): worker programado del pipeline de validacion.
//
// Automatiza "el paso del tiempo" y las validaciones del Certificado de Identidad
// Tecnica. Las transiciones del CIT no dependen de una accion humana puntual:
// ocurren cuando se cumple una ventana temporal o cuando un cruce de datos
// resuelve. Este worker las materializa de forma idempotente en cada corrida.
//
// Maquina de estados que recorre el pipeline (sobre el esquema canonico `cits`):
//
//   PENDIENTE_VALIDACION ──(intake asentado +5 min)──▶ PROCESANDO_CRUCE
//   PROCESANDO_CRUCE ──(denuncia por robo)──────────▶ RECHAZADO
//   PROCESANDO_CRUCE ──(alerta de geocercado GPS)───▶ ANOMALIA_DETECTADA
//   PROCESANDO_CRUCE ──(ventana de 72 hs cumplida)──▶ ACTIVO  (vigencia 2 anios)
//   ACTIVO ──(vigencia de 2 anios expirada)─────────▶ VENCIDO
//
// Cada transicion deja un evento append-only en `cit_eventos` (actor "sistema")
// para que la auditoria del certificado refleje el cambio automatico.
//
// Inmutabilidad: el worker solo evoluciona el `estado` y, al activar, fija la
// vigencia. Nunca toca la huella, la firma ni los datos sellados, de modo que el
// trigger `cit_proteger_payload` no rechaza estos UPDATE. La acunacion en la
// Blockchain Federal Argentina (BFA) se confirma de forma asincrona fuera de este
// worker; aqui solo se reporta cuantos certificados quedan pendientes de anclaje.

import { getDatabase } from '@netlify/database'

// node-postgres-like client expuesto por @netlify/database.
type SqlClient = {
  query: <T = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ) => Promise<{ rows: T[]; rowCount: number | null }>
  release: () => void
}

// Minutos que el intake "reposa" antes de entrar al sistema de cruce de datos.
const MINUTOS_INGRESO_CRUCE = 5
// Vigencia del certificado una vez activado.
const VIGENCIA_ANIOS = 2

interface CruceRow {
  id: string
  ciclista_id: string
  bicicleta_serial: string
  alerta_gps: boolean
  vencio_ventana: boolean
}

/** Datos minimos de un rechazo para el despacho de notificaciones externas. */
interface RechazoNotif {
  citId: string
  ciclistaId: string
  serial: string
  motivo: string
}

/**
 * Mock temporal de la consulta a las fuerzas de seguridad (Ministerio). Mientras
 * no exista la integracion real, un numero de serie terminado en "999" simula una
 * denuncia por robo activa. Es un punto de extension aislado y deterministico.
 */
function tieneDenunciaPorRobo(serial: string): boolean {
  return serial.endsWith('999')
}

/** Inserta un evento de auditoria del ciclo de vida del CIT. */
async function registrarEvento(
  client: SqlClient,
  evento: {
    citId: string
    tipo: string
    estadoAnterior: string
    estadoNuevo: string
    motivo: string
  }
): Promise<void> {
  await client.query(
    `
      INSERT INTO cit_eventos
        (cit_id, tipo, estado_anterior, estado_nuevo, actor_rol, metadata)
      VALUES ($1, $2, $3::cit_estado, $4::cit_estado, 'sistema', jsonb_build_object('motivo', $5::text))
    `,
    [evento.citId, evento.tipo, evento.estadoAnterior, evento.estadoNuevo, evento.motivo]
  )
}

/** Inserta una notificacion IN_APP (canal garantizado) dentro de la transaccion. */
async function registrarNotificacionInApp(
  client: SqlClient,
  notif: {
    usuarioId: string
    tipo: string
    titulo: string
    cuerpo: string
    ctaUrl: string | null
    data: Record<string, unknown>
  }
): Promise<void> {
  await client.query(
    `
      INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, cta_url, data)
      VALUES ($1, $2::notif_tipo, $3, $4, $5, $6::jsonb)
    `,
    [
      notif.usuarioId,
      notif.tipo,
      notif.titulo,
      notif.cuerpo,
      notif.ctaUrl,
      JSON.stringify(notif.data),
    ]
  )
}

/**
 * PASO 1 — Ingreso al cruce: los intakes asentados hace mas de N minutos pasan de
 * PENDIENTE_VALIDACION a PROCESANDO_CRUCE. Set-based en una sola sentencia (CTE)
 * para que el conteo y los eventos sean exactamente consistentes con lo movido.
 */
async function ingresarAlCruce(client: SqlClient): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(
    `
      WITH movidos AS (
        UPDATE cits
        SET estado = 'PROCESANDO_CRUCE'
        WHERE estado = 'PENDIENTE_VALIDACION'
          AND sellado_en <= NOW() - ($1 || ' minutes')::interval
        RETURNING id
      ),
      auditoria AS (
        INSERT INTO cit_eventos
          (cit_id, tipo, estado_anterior, estado_nuevo, actor_rol, metadata)
        SELECT
          id, 'CIT_INGRESO_CRUCE',
          'PENDIENTE_VALIDACION'::cit_estado, 'PROCESANDO_CRUCE'::cit_estado,
          'sistema',
          jsonb_build_object('motivo', 'Ingreso automatico al sistema de cruce de datos.')
        FROM movidos
        RETURNING cit_id AS id
      )
      SELECT id FROM auditoria
    `,
    [String(MINUTOS_INGRESO_CRUCE)]
  )
  return rows.map((row) => row.id)
}

/**
 * PASO 2 — Resolucion del cruce. Cada certificado en PROCESANDO_CRUCE se evalua y
 * resuelve dentro de su propia transaccion (bloqueo FOR UPDATE), de modo que una
 * fila problematica no aborte el barrido completo. Resultado por fila:
 *   - denuncia por robo            -> RECHAZADO
 *   - alerta de geocercado GPS     -> ANOMALIA_DETECTADA
 *   - ventana de 72 hs cumplida    -> ACTIVO (fija fecha_emision + vencimiento)
 *   - en otro caso, sigue esperando en PROCESANDO_CRUCE.
 */
async function resolverCruces(
  client: SqlClient
): Promise<{
  rechazados: string[]
  anomalias: string[]
  activados: string[]
  rechazosNotif: RechazoNotif[]
}> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM cits WHERE estado = 'PROCESANDO_CRUCE' ORDER BY sellado_en ASC`
  )

  const rechazados: string[] = []
  const anomalias: string[] = []
  const activados: string[] = []
  const rechazosNotif: RechazoNotif[] = []

  for (const { id } of rows) {
    try {
      await client.query('BEGIN')

      // Re-lee bajo bloqueo: la fila pudo cambiar entre el listado y el proceso.
      const bloqueada = await client.query<CruceRow>(
        `
          SELECT id, ciclista_id, bicicleta_serial, alerta_gps,
                 (expira_en <= NOW()) AS vencio_ventana
          FROM cits
          WHERE id = $1 AND estado = 'PROCESANDO_CRUCE'
          FOR UPDATE
        `,
        [id]
      )
      const cit = bloqueada.rows[0]
      if (!cit) {
        await client.query('ROLLBACK')
        continue
      }

      if (tieneDenunciaPorRobo(cit.bicicleta_serial)) {
        const motivo =
          'Cruce fallido: el numero de serie tiene un reporte de robo activo.'
        await client.query(`UPDATE cits SET estado = 'RECHAZADO' WHERE id = $1`, [cit.id])
        await registrarEvento(client, {
          citId: cit.id,
          tipo: 'CIT_CRUCE_RECHAZADO',
          estadoAnterior: 'PROCESANDO_CRUCE',
          estadoNuevo: 'RECHAZADO',
          motivo,
        })
        // CIT_RECHAZADO: la notificacion IN_APP se persiste en la MISMA transaccion
        // que el rechazo (consistencia transaccional). El email forzado va despues.
        await registrarNotificacionInApp(client, {
          usuarioId: cit.ciclista_id,
          tipo: 'CIT_RECHAZADO',
          titulo: 'Tu certificado fue rechazado en el cruce de seguridad',
          cuerpo: `El CIT de tu rodado ${cit.bicicleta_serial} fue rechazado: ${motivo}`,
          ctaUrl: appUrl(`/cit/${cit.id}`),
          data: { citId: cit.id, motivo },
        })
        await client.query('COMMIT')
        rechazados.push(cit.id)
        rechazosNotif.push({
          citId: cit.id,
          ciclistaId: cit.ciclista_id,
          serial: cit.bicicleta_serial,
          motivo,
        })
        continue
      }

      if (cit.alerta_gps) {
        await client.query(`UPDATE cits SET estado = 'ANOMALIA_DETECTADA' WHERE id = $1`, [
          cit.id,
        ])
        await registrarEvento(client, {
          citId: cit.id,
          tipo: 'CIT_ANOMALIA_DETECTADA',
          estadoAnterior: 'PROCESANDO_CRUCE',
          estadoNuevo: 'ANOMALIA_DETECTADA',
          motivo: 'Coordenadas del intake fuera del rango del taller aliado emisor.',
        })
        await client.query('COMMIT')
        anomalias.push(cit.id)
        continue
      }

      if (cit.vencio_ventana) {
        // Al activarse se fija la vigencia. El CHECK `cits_activo_vigente` exige
        // que un CIT ACTIVO tenga fecha_emision Y fecha_vencimiento.
        await client.query(
          `
            UPDATE cits
            SET estado = 'ACTIVO',
                validado_en = NOW(),
                fecha_emision = NOW(),
                fecha_vencimiento = NOW() + ($2 || ' years')::interval
            WHERE id = $1
          `,
          [cit.id, String(VIGENCIA_ANIOS)]
        )
        await registrarEvento(client, {
          citId: cit.id,
          tipo: 'CIT_PIPELINE_ACTIVADO',
          estadoAnterior: 'PROCESANDO_CRUCE',
          estadoNuevo: 'ACTIVO',
          motivo: 'Cruce superado y ventana de 72 hs cumplida. Certificado vigente por 2 anios.',
        })
        await client.query('COMMIT')
        activados.push(cit.id)
        continue
      }

      // Sigue dentro de la ventana, sin novedades: permanece en cruce.
      await client.query('ROLLBACK')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      console.error('[cron-pipeline-cit] fallo al resolver el cruce del CIT', id, error)
    }
  }

  return { rechazados, anomalias, activados, rechazosNotif }
}

/**
 * PASO 3 — Vencimiento por vigencia: los certificados ACTIVO cuya vigencia de 2
 * anios expiro pasan a VENCIDO. Set-based (CTE) con su auditoria.
 */
async function vencerVigencias(client: SqlClient): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(
    `
      WITH vencidos AS (
        UPDATE cits
        SET estado = 'VENCIDO'
        WHERE estado = 'ACTIVO'
          AND fecha_vencimiento IS NOT NULL
          AND fecha_vencimiento <= NOW()
        RETURNING id
      ),
      auditoria AS (
        INSERT INTO cit_eventos
          (cit_id, tipo, estado_anterior, estado_nuevo, actor_rol, metadata)
        SELECT
          id, 'CIT_VIGENCIA_VENCIDA',
          'ACTIVO'::cit_estado, 'VENCIDO'::cit_estado,
          'sistema',
          jsonb_build_object('motivo', 'La vigencia de 2 anios del certificado expiro.')
        FROM vencidos
        RETURNING cit_id AS id
      )
      SELECT id FROM auditoria
    `
  )
  return rows.map((row) => row.id)
}

// ── Despacho de canales externos para los rechazos (best-effort) ─────────────
//
// CIT_RECHAZADO es una alerta del Ministerio de Seguridad: ademas del IN_APP ya
// persistido transaccionalmente, fuerza el email. El despacho corre FUERA de las
// transacciones del barrido y nunca lo hace fallar. Si un canal no esta configurado,
// no se finge el envio. Replica, de forma compacta y autocontenida, la paleta del
// template institucional (Navy #0F1E35 / Orange #F97316, CTA, pie Ley 9556 Mendoza).

function envNotif(clave: string): string | null {
  const valor = Netlify.env.get(clave)
  if (typeof valor !== 'string') return null
  const limpio = valor.trim()
  return limpio.length > 0 ? limpio : null
}

function appUrl(path: string): string {
  const base = (envNotif('RODAID_APP_URL') ?? envNotif('APP_URL') ?? 'https://rodaid.app')
    .replace(/\/+$/, '')
  return `${base}${path}`
}

function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderEmailRechazo(serial: string, motivo: string, ctaUrl: string): string {
  return `<!DOCTYPE html><html lang="es"><body style="margin:0;background:#F3F4F6;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;">
<tr><td style="background:#0F1E35;padding:28px 32px;"><span style="font-size:20px;font-weight:800;color:#fff;">RODA<span style="color:#F97316;">ID</span></span></td></tr>
<tr><td style="padding:32px;">
<h1 style="margin:0 0 16px;font-size:20px;color:#0F1E35;">Tu certificado fue rechazado en el cruce de seguridad</h1>
<p style="font-size:15px;line-height:1.6;color:#1F2937;">El Certificado de Identidad Tecnica de tu rodado ${escaparHtml(
    serial
  )} fue rechazado durante el cruce con el Ministerio de Seguridad.</p>
<p style="font-size:15px;line-height:1.6;color:#1F2937;">Motivo: ${escaparHtml(motivo)}</p>
<table cellpadding="0" cellspacing="0" style="margin:8px 0;"><tr><td style="border-radius:10px;background:#F97316;">
<a href="${escaparHtml(
    ctaUrl
  )}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;color:#fff;text-decoration:none;">Ver en RODAID &rarr;</a>
</td></tr></table>
</td></tr>
<tr><td style="background:#1B2C49;padding:22px 32px;"><p style="margin:0;font-size:11px;line-height:1.5;color:#7C8DA8;">RODAID opera el Registro de Certificacion de Identidad Tecnica en el marco de la Ley 9556 de la Provincia de Mendoza.</p></td></tr>
</table></td></tr></table></body></html>`
}

interface PrefsNotif {
  email: string | null
  email_habilitado: boolean
  push_habilitado: boolean
  fcm_tokens: string[]
}

async function despacharRechazos(
  client: SqlClient,
  rechazos: RechazoNotif[]
): Promise<void> {
  if (rechazos.length === 0) return
  const resendKey = envNotif('RESEND_API_KEY')
  const resendFrom = envNotif('RESEND_FROM')
  const fcmKey = envNotif('FCM_SERVER_KEY')

  for (const r of rechazos) {
    try {
      const { rows } = await client.query<PrefsNotif>(
        `
          SELECT email, email_habilitado, push_habilitado,
                 ARRAY(SELECT jsonb_array_elements_text(fcm_tokens)) AS fcm_tokens
          FROM notif_preferencias WHERE usuario_id = $1
        `,
        [r.ciclistaId]
      )
      const prefs = rows[0]
      const ctaUrl = appUrl(`/cit/${r.citId}`)

      // EMAIL forzado (alerta de Min. de Seguridad), si hay direccion y Resend.
      if (resendKey && resendFrom && prefs?.email) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${resendKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            from: resendFrom,
            to: [prefs.email],
            subject: 'Tu certificado fue rechazado en el cruce de seguridad',
            html: renderEmailRechazo(r.serial, r.motivo, ctaUrl),
          }),
        }).catch(() => undefined)
      }

      // PUSH, si el usuario lo tiene habilitado, hay tokens y FCM esta configurado.
      if (fcmKey && prefs?.push_habilitado && prefs.fcm_tokens?.length) {
        await fetch('https://fcm.googleapis.com/fcm/send', {
          method: 'POST',
          headers: { authorization: `key=${fcmKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            registration_ids: prefs.fcm_tokens,
            notification: {
              title: 'Tu certificado fue rechazado',
              body: `El CIT de tu rodado ${r.serial} fue rechazado en el cruce de seguridad.`,
            },
            data: { tipo: 'CIT_RECHAZADO', citId: r.citId, url: ctaUrl },
          }),
        }).catch(() => undefined)
      }
    } catch (error) {
      console.error('[cron-pipeline-cit] fallo el despacho de notificacion de rechazo', r.citId, error)
    }
  }
}

export default async (req: Request) => {
  // El cuerpo de una funcion programada trae { next_run: <ISO-8601> }.
  const proximaCorrida = await req
    .json()
    .then((cuerpo) => (cuerpo as { next_run?: string }).next_run)
    .catch(() => undefined)

  const client = (await getDatabase().pool.connect()) as unknown as SqlClient

  try {
    await client.query('BEGIN')
    const ingresados = await ingresarAlCruce(client)
    await client.query('COMMIT')

    const cruces = await resolverCruces(client)

    // Despacho best-effort de los canales externos para los rechazos (fuera de tx).
    await despacharRechazos(client, cruces.rechazosNotif)

    await client.query('BEGIN')
    const vencidos = await vencerVigencias(client)
    await client.query('COMMIT')

    const { rows: pendientesBfa } = await client.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM cits WHERE bfa_estado = 'PENDIENTE'`
    )

    const resumen = {
      ejecutadoEn: new Date().toISOString(),
      proximaCorrida: proximaCorrida ?? null,
      ingresadosACruce: ingresados.length,
      rechazadosPorRobo: cruces.rechazados.length,
      anomaliasGps: cruces.anomalias.length,
      activados: cruces.activados.length,
      vencidosPorVigencia: vencidos.length,
      bfaPendientesDeAnclaje: Number(pendientesBfa[0]?.total ?? 0),
    }

    console.log('[cron-pipeline-cit] barrido completado', JSON.stringify(resumen))
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error('[cron-pipeline-cit] el barrido del pipeline fallo', error)
    throw error
  } finally {
    client.release()
  }
}

// Barrido horario (UTC). Granularidad mas que suficiente para una ventana de
// 72 hs; el minuto 17 evita el congestionamiento del tope de hora.
export const config = {
  schedule: '17 * * * *',
}
