// RODAID — Modulo 4 (CIT): Configuracion Final · barrido de acunacion del NFT en BFA.
//
// Cierra el ciclo de la Certificacion de Identidad Tecnica: una vez que un
// certificado queda ACTIVO (validado por RODAID o activado por el pipeline), su
// huella debe quedar anclada como NFT en la Blockchain Federal Argentina (BFA).
// Este worker programado toma los certificados ACTIVOS que todavia no tienen un NFT
// confirmado on-chain y los acuna de forma automatica e idempotente.
//
// Por cada certificado, en transacciones separadas y con la llamada de red FUERA del
// bloqueo de fila:
//
//   Tx1  -> construye el NFT deterministico desde la huella sellada y deja el
//           anclaje en PENDIENTE con el token y la metadata persistidos.
//   Red  -> envia el anclaje al gateway de BFA configurado.
//   Tx2  -> registra la confirmacion on-chain (ACUNADO) o el error (ERROR).
//
// Honestidad del estado on-chain: si no hay gateway de BFA configurado, el worker
// NO inventa transacciones; reporta cuantos certificados quedan a la espera de
// configuracion y termina sin tocar la base.
//
// Inmutabilidad: el worker nunca altera la huella, la firma ni los datos sellados;
// solo evoluciona el anclaje BFA (columnas no protegidas por `cit_proteger_payload`).
//
// La construccion del NFT replica `lib/bfa.ts` (token id derivado de la huella,
// metadata ERC-721 canonica, hash de metadata). Las funciones de Netlify son
// autocontenidas y libres de framework, igual que `api-cit-verificar` replica el
// nucleo de sellado de `lib/cit.ts`.

import { createHash } from 'node:crypto'
import { getDatabase } from '@netlify/database'

type SqlClient = {
  query: <T = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ) => Promise<{ rows: T[]; rowCount: number | null }>
  release: () => void
}

const BFA_ESQUEMA_NFT = 'RODAID-CIT-NFT-v1'
// Cota de certificados por corrida: evita barridos largos ante acumulacion.
const LIMITE_POR_CORRIDA = 25

interface BfaConfig {
  redNombre: string
  chainId: string
  contrato: string | null
  gatewayUrl: string | null
  apiKey: string | null
  explorerUrl: string | null
  timeoutMs: number
}

function leerConfigBFA(): BfaConfig {
  const limpio = (clave: string): string | null => {
    const valor = Netlify.env.get(clave)
    if (typeof valor !== 'string') return null
    const trimmed = valor.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  const timeoutCrudo = Number(limpio('BFA_TIMEOUT_MS'))
  return {
    redNombre: limpio('BFA_RED_NOMBRE') ?? 'Blockchain Federal Argentina',
    chainId: limpio('BFA_CHAIN_ID') ?? 'bfa',
    contrato: limpio('BFA_CONTRATO'),
    gatewayUrl: limpio('BFA_GATEWAY_URL'),
    apiKey: limpio('BFA_GATEWAY_API_KEY'),
    explorerUrl: limpio('BFA_EXPLORER_URL'),
    timeoutMs:
      Number.isFinite(timeoutCrudo) && timeoutCrudo > 0 ? timeoutCrudo : 8000,
  }
}

/** Falla de submission con clasificacion: transitoria (reintentable) o fatal. */
class AcunacionError extends Error {
  constructor(
    message: string,
    public reintentable: boolean
  ) {
    super(message)
    this.name = 'AcunacionError'
  }
}

// ── Helpers de notificacion (best-effort, autocontenidos) ────────────────────

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

/** Datos minimos de una acunacion exitosa para el despacho de canales externos. */
interface AprobadoNotif {
  citId: string
  ciclistaId: string
  serial: string
  txHash: string
  explorerUrl: string | null
}

interface PrefsNotif {
  email: string | null
  email_habilitado: boolean
  push_habilitado: boolean
  fcm_tokens: string[]
}

function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderEmailAprobado(serial: string, ctaUrl: string): string {
  return `<!DOCTYPE html><html lang="es"><body style="margin:0;background:#F3F4F6;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;">
<tr><td style="background:#0F1E35;padding:28px 32px;"><span style="font-size:20px;font-weight:800;color:#fff;">RODA<span style="color:#F97316;">ID</span></span></td></tr>
<tr><td style="padding:32px;">
<h1 style="margin:0 0 16px;font-size:20px;color:#0F1E35;">Tu certificado fue acunado en la Blockchain Federal Argentina</h1>
<p style="font-size:15px;line-height:1.6;color:#1F2937;">El Certificado de Identidad Tecnica de tu rodado ${escaparHtml(
    serial
  )} quedo anclado on-chain como NFT. Su identidad es ahora verificable de forma publica.</p>
<table cellpadding="0" cellspacing="0" style="margin:8px 0;"><tr><td style="border-radius:10px;background:#F97316;">
<a href="${escaparHtml(
    ctaUrl
  )}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;color:#fff;text-decoration:none;">Ver en RODAID &rarr;</a>
</td></tr></table>
</td></tr>
<tr><td style="background:#1B2C49;padding:22px 32px;"><p style="margin:0;font-size:11px;line-height:1.5;color:#7C8DA8;">RODAID opera el Registro de Certificacion de Identidad Tecnica en el marco de la Ley 9556 de la Provincia de Mendoza.</p></td></tr>
</table></td></tr></table></body></html>`
}

/**
 * Despacha los canales externos (email/push) de las acunaciones exitosas, FUERA de
 * las transacciones del barrido. La notificacion IN_APP ya quedo persistida. Si un
 * canal no esta configurado, no se finge el envio.
 */
async function despacharAprobados(
  client: SqlClient,
  aprobados: AprobadoNotif[]
): Promise<void> {
  if (aprobados.length === 0) return
  const resendKey = envNotif('RESEND_API_KEY')
  const resendFrom = envNotif('RESEND_FROM')
  const fcmKey = envNotif('FCM_SERVER_KEY')

  for (const a of aprobados) {
    try {
      const { rows } = await client.query<PrefsNotif>(
        `
          SELECT email, email_habilitado, push_habilitado,
                 ARRAY(SELECT jsonb_array_elements_text(fcm_tokens)) AS fcm_tokens
          FROM notif_preferencias WHERE usuario_id = $1
        `,
        [a.ciclistaId]
      )
      const prefs = rows[0]
      const ctaUrl = a.explorerUrl ?? appUrl(`/cit/${a.citId}`)

      if (resendKey && resendFrom && prefs?.email && prefs.email_habilitado) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${resendKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            from: resendFrom,
            to: [prefs.email],
            subject: 'Tu certificado fue acunado en la Blockchain Federal Argentina',
            html: renderEmailAprobado(a.serial, ctaUrl),
          }),
        }).catch(() => undefined)
      }

      if (fcmKey && prefs?.push_habilitado && prefs.fcm_tokens?.length) {
        await fetch('https://fcm.googleapis.com/fcm/send', {
          method: 'POST',
          headers: { authorization: `key=${fcmKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            registration_ids: prefs.fcm_tokens,
            notification: {
              title: 'Tu certificado fue acunado en BFA',
              body: `El CIT de tu rodado ${a.serial} quedo anclado on-chain como NFT.`,
            },
            data: { tipo: 'CIT_APROBADO', citId: a.citId, url: ctaUrl },
          }),
        }).catch(() => undefined)
      }
    } catch (error) {
      console.error('[cron-acunacion-bfa] fallo el despacho de notificacion de aprobado', a.citId, error)
    }
  }
}

// ── Construccion deterministica del NFT (espejo de lib/bfa.ts) ────────────────

function ordenar(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value ?? null
  }
  if (Array.isArray(value)) {
    return value.map((item) => ordenar(item))
  }
  const entrada = value as Record<string, unknown>
  const salida: Record<string, unknown> = {}
  for (const clave of Object.keys(entrada).sort()) {
    if (entrada[clave] !== undefined) {
      salida[clave] = ordenar(entrada[clave])
    }
  }
  return salida
}

function sha256Hex(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex')
}

interface CitRow {
  id: string
  huella_sha256: string
  firma_hmac: string
  algoritmo: string
  bicicleta_serial: string
  ciclista_id: string
  aliado_id: string
  aliado_nombre: string | null
  estado: string
  sellado_en: string
  fecha_emision: string | null
  fecha_vencimiento: string | null
}

interface NFT {
  tokenId: string
  objetoId: string
  metadata: Record<string, unknown>
  metadataHash: string
  stampId: string
  red: string
}

function construirNFT(cit: CitRow, config: BfaConfig): NFT {
  const tokenId = `0x${cit.huella_sha256.toLowerCase()}`
  const metadata = {
    schema: BFA_ESQUEMA_NFT,
    name: `RODAID CIT · ${cit.bicicleta_serial}`,
    description:
      'Certificado de Identidad Tecnica (CIT) de RODAID anclado en la Blockchain Federal Argentina (BFA). La huella SHA-256 es el sello inmutable del certificado.',
    emisor: 'RODAID',
    red: config.redNombre,
    contentHash: cit.huella_sha256,
    firmaHMAC: cit.firma_hmac,
    algoritmo: cit.algoritmo,
    attributes: [
      { trait_type: 'Numero de serie', value: cit.bicicleta_serial },
      { trait_type: 'Huella SHA-256', value: cit.huella_sha256 },
      { trait_type: 'Algoritmo', value: cit.algoritmo },
      { trait_type: 'Estado', value: cit.estado },
      { trait_type: 'Aliado emisor', value: cit.aliado_nombre ?? cit.aliado_id },
      { trait_type: 'Sellado', value: cit.sellado_en },
      { trait_type: 'Emitido', value: cit.fecha_emision ?? null },
      { trait_type: 'Vence', value: cit.fecha_vencimiento ?? null },
    ],
  }
  const metadataHash = sha256Hex(JSON.stringify(ordenar(metadata)))
  const stampId = sha256Hex(
    `${config.chainId}|${config.contrato ?? ''}|${cit.huella_sha256}`
  )
  const objetoId = `bfa:${config.chainId}:${config.contrato ?? 'cit'}:${tokenId}`
  return { tokenId, objetoId, metadata, metadataHash, stampId, red: config.redNombre }
}

// ── Submission on-chain ──────────────────────────────────────────────────────

interface ResultadoAcunacion {
  txHash: string
  stampId: string
  objetoId: string
  explorerUrl: string | null
}

function textoNoVacio(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function enviarAcunacionBFA(
  cit: CitRow,
  nft: NFT,
  config: BfaConfig
): Promise<ResultadoAcunacion> {
  // El gateway esta garantizado por el llamador (no se ejecuta sin configuracion).
  const controlador = new AbortController()
  const timer = setTimeout(() => controlador.abort(), config.timeoutMs)
  try {
    const respuesta = await fetch(config.gatewayUrl as string, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        citId: cit.id,
        huella: cit.huella_sha256,
        tokenId: nft.tokenId,
        contrato: config.contrato,
        chainId: config.chainId,
        metadataHash: nft.metadataHash,
        metadata: nft.metadata,
      }),
      signal: controlador.signal,
    })
    if (!respuesta.ok) {
      // 5xx / 429 -> transitorio (reintentable). 4xx de contrato -> fatal.
      const reintentable = respuesta.status >= 500 || respuesta.status === 429
      throw new AcunacionError(
        `El gateway de BFA respondio con estado ${respuesta.status}.`,
        reintentable
      )
    }
    const datos = (await respuesta.json().catch(() => ({}))) as Record<string, unknown>
    const txHash = textoNoVacio(datos.txHash ?? datos.tx_hash)
    if (!txHash) {
      throw new AcunacionError('El gateway de BFA no devolvio un txHash.', true)
    }
    const explorerUrl = config.explorerUrl
      ? `${config.explorerUrl.replace(/\/+$/, '')}/tx/${txHash}`
      : null
    return {
      txHash,
      stampId: textoNoVacio(datos.stampId ?? datos.stamp_id) ?? nft.stampId,
      objetoId: textoNoVacio(datos.objetoId ?? datos.objeto_id) ?? nft.objetoId,
      explorerUrl,
    }
  } catch (error) {
    if (error instanceof AcunacionError) {
      throw error
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AcunacionError(
        `El gateway de BFA no respondio dentro de ${config.timeoutMs} ms.`,
        true
      )
    }
    throw new AcunacionError('No se pudo contactar al gateway de BFA.', true)
  } finally {
    clearTimeout(timer)
  }
}

// ── Persistencia (Tx1 preparar / Tx2 confirmar o marcar error) ───────────────

async function prepararNFT(
  client: SqlClient,
  citId: string
): Promise<{ cit: CitRow; nft: NFT } | null> {
  await client.query('BEGIN')
  try {
    const { rows } = await client.query<CitRow>(
      `
        SELECT id, huella_sha256, firma_hmac, algoritmo, bicicleta_serial,
               ciclista_id, aliado_id, aliado_nombre, estado, sellado_en,
               fecha_emision, fecha_vencimiento
        FROM cits
        WHERE id = $1 AND estado = 'ACTIVO' AND bfa_estado <> 'ACUNADO'
        FOR UPDATE
      `,
      [citId]
    )
    const cit = rows[0]
    if (!cit) {
      await client.query('ROLLBACK')
      return null
    }
    const config = leerConfigBFA()
    const nft = construirNFT(cit, config)
    await client.query(
      `
        UPDATE cits
        SET bfa_estado = 'PENDIENTE',
            bfa_red = $2,
            bfa_token_id = $3,
            bfa_metadata_hash = $4,
            bfa_metadata = $5::jsonb,
            bfa_intentos = bfa_intentos + 1,
            bfa_ultimo_error = NULL
        WHERE id = $1
      `,
      [cit.id, nft.red, nft.tokenId, nft.metadataHash, JSON.stringify(nft.metadata)]
    )
    await client.query(
      `
        INSERT INTO cit_eventos (cit_id, tipo, actor_rol, metadata)
        VALUES ($1, 'BFA_ACUNACION_PREPARADA', 'sistema', $2::jsonb)
      `,
      [
        cit.id,
        JSON.stringify({
          huella: cit.huella_sha256,
          tokenId: nft.tokenId,
          metadataHash: nft.metadataHash,
          red: nft.red,
        }),
      ]
    )
    await client.query('COMMIT')
    return { cit, nft }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

async function registrarAcunado(
  client: SqlClient,
  cit: CitRow,
  resultado: ResultadoAcunacion,
  tokenId: string,
  red: string
): Promise<void> {
  const citId = cit.id
  await client.query('BEGIN')
  try {
    await client.query(
      `
        UPDATE cits
        SET bfa_estado = 'ACUNADO',
            bfa_tx_hash = $2,
            bfa_stamp_id = $3,
            bfa_objeto_id = $4,
            bfa_ultimo_error = NULL,
            acunado_en = NOW()
        WHERE id = $1 AND bfa_estado <> 'ACUNADO'
      `,
      [citId, resultado.txHash, resultado.stampId, resultado.objetoId]
    )
    await client.query(
      `
        INSERT INTO cit_eventos (cit_id, tipo, actor_rol, metadata)
        VALUES ($1, 'BFA_ACUNADO', 'sistema', $2::jsonb)
      `,
      [
        citId,
        JSON.stringify({
          txHash: resultado.txHash,
          stampId: resultado.stampId,
          objetoId: resultado.objetoId,
          tokenId,
          red,
          explorerUrl: resultado.explorerUrl,
        }),
      ]
    )
    // CIT_APROBADO: la notificacion IN_APP se persiste en la MISMA transaccion que
    // la confirmacion de la acunacion (consistencia transaccional).
    await client.query(
      `
        INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, cta_url, data)
        VALUES ($1, 'CIT_APROBADO', $2, $3, $4, $5::jsonb)
      `,
      [
        cit.ciclista_id,
        'Tu certificado fue acunado en la Blockchain Federal Argentina',
        `El CIT de tu rodado ${cit.bicicleta_serial} quedo anclado on-chain como NFT.`,
        resultado.explorerUrl ?? appUrl(`/cit/${citId}`),
        JSON.stringify({ citId, txHash: resultado.txHash, explorerUrl: resultado.explorerUrl }),
      ]
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

async function registrarError(
  client: SqlClient,
  citId: string,
  mensaje: string,
  reintentable: boolean
): Promise<void> {
  // Transitorio -> ERROR (el barrido lo reintenta). Fatal -> FALLIDO (re-acunacion
  // manual del admin via POST /api/v1/cit/:id/acunar).
  const estadoBfa = reintentable ? 'ERROR' : 'FALLIDO'
  await client.query('BEGIN')
  try {
    await client.query(
      `UPDATE cits SET bfa_estado = $2::cit_bfa_estado, bfa_ultimo_error = $3 WHERE id = $1`,
      [citId, estadoBfa, mensaje]
    )
    await client.query(
      `
        INSERT INTO cit_eventos (cit_id, tipo, actor_rol, metadata)
        VALUES ($1, 'BFA_ACUNACION_ERROR', 'sistema', $2::jsonb)
      `,
      [citId, JSON.stringify({ mensaje, reintentable, estadoBfa })]
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

export default async (req: Request) => {
  const proximaCorrida = await req
    .json()
    .then((cuerpo) => (cuerpo as { next_run?: string }).next_run)
    .catch(() => undefined)

  const config = leerConfigBFA()
  const client = (await getDatabase().pool.connect()) as unknown as SqlClient

  try {
    // Conteo de certificados a la espera de un NFT confirmado on-chain.
    const { rows: candidatos } = await client.query<{ id: string }>(
      `
        SELECT id FROM cits
        WHERE estado = 'ACTIVO'
          AND bfa_estado IN ('NO_INICIADA', 'PENDIENTE', 'ERROR')
        ORDER BY sellado_en ASC
        LIMIT $1
      `,
      [LIMITE_POR_CORRIDA]
    )

    // Sin gateway configurado no se acuna: se reporta y se termina sin tocar la base.
    if (!config.gatewayUrl) {
      console.log(
        '[cron-acunacion-bfa] BFA sin gateway configurado; certificados a la espera:',
        JSON.stringify({
          ejecutadoEn: new Date().toISOString(),
          proximaCorrida: proximaCorrida ?? null,
          pendientesDeConfiguracion: candidatos.length,
        })
      )
      return
    }

    let acunados = 0
    let errores = 0
    let fallidos = 0
    const aprobados: AprobadoNotif[] = []

    for (const { id } of candidatos) {
      try {
        const preparado = await prepararNFT(client, id)
        if (!preparado) {
          continue // dejo de ser elegible entre el listado y el lock.
        }
        try {
          const resultado = await enviarAcunacionBFA(
            preparado.cit,
            preparado.nft,
            config
          )
          await registrarAcunado(
            client,
            preparado.cit,
            resultado,
            preparado.nft.tokenId,
            preparado.nft.red
          )
          acunados += 1
          aprobados.push({
            citId: preparado.cit.id,
            ciclistaId: preparado.cit.ciclista_id,
            serial: preparado.cit.bicicleta_serial,
            txHash: resultado.txHash,
            explorerUrl: resultado.explorerUrl,
          })
        } catch (errorRed) {
          const mensaje =
            errorRed instanceof Error ? errorRed.message : 'Fallo la acunacion en BFA.'
          const reintentable =
            errorRed instanceof AcunacionError ? errorRed.reintentable : true
          await registrarError(client, id, mensaje, reintentable)
          if (reintentable) {
            errores += 1
          } else {
            fallidos += 1
          }
        }
      } catch (error) {
        console.error('[cron-acunacion-bfa] fallo al acunar el CIT', id, error)
        errores += 1
      }
    }

    // Despacho best-effort de los canales externos (CIT_APROBADO), fuera de las tx.
    await despacharAprobados(client, aprobados)

    console.log(
      '[cron-acunacion-bfa] barrido completado',
      JSON.stringify({
        ejecutadoEn: new Date().toISOString(),
        proximaCorrida: proximaCorrida ?? null,
        red: config.redNombre,
        candidatos: candidatos.length,
        acunados,
        errores,
        fallidos,
      })
    )
  } catch (error) {
    console.error('[cron-acunacion-bfa] el barrido de acunacion fallo', error)
    throw error
  } finally {
    client.release()
  }
}

// Barrido horario (UTC). El minuto 37 evita el congestionamiento del tope de hora
// y se separa del pipeline de validacion (minuto 17).
export const config = {
  schedule: '37 * * * *',
}
