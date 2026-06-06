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
  citId: string,
  resultado: ResultadoAcunacion,
  tokenId: string,
  red: string
): Promise<void> {
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
            id,
            resultado,
            preparado.nft.tokenId,
            preparado.nft.red
          )
          acunados += 1
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
