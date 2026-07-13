import { ApiError, getPool, type DbClient } from '@/lib/marketplace'
import {
  verificarSello,
  type CitBfaEstado,
  type CitEstado,
} from '@/lib/cit'
import { notificarCITAprobado } from '@/src/services/notif.service'

/**
 * RODAID — Modulo 4: maquina de estados del Certificado de Identidad Tecnica.
 *
 *   (creacion, en minuscula)  -> 'pendiente'  (ver validation.service.ts)
 *   (aprobacion, en minuscula) -> 'activo'    (ver inspeccion.service.ts / validation.service.ts)
 *   revocarCIT()               -> REVOCADO
 *
 * El anclaje en la Blockchain Federal Argentina (BFA) NO vive en este archivo --
 * ver blockchain.service.ts (unico mecanismo real, conectado al pipeline de
 * aprobacion). Este archivo tuvo una generacion anterior de ese anclaje
 * (prepararAcunacionBFA/registrarAcunacionBFA/acunarCITEnBFA, via lib/bfa.ts)
 * retirada 2026-07-12 por quedar redundante y sin ningun llamador real (ni de
 * frontend ni de otro backend) una vez que blockchain.service.ts paso a ser el
 * camino conectado al pipeline automatico.
 *
 * Este archivo tuvo ademas una generacion anterior del PROPIO pipeline de
 * emision/validacion del CIT (iniciarCIT()/validarCIT(), en MAYUSCULA:
 * PENDIENTE_VALIDACION -> PROCESANDO_CRUCE -> ACTIVO/VENCIDO/RECHAZADO/
 * ANOMALIA_DETECTADA, mas el worker netlify/functions/cron-pipeline-cit.mts que
 * la recorria cada hora), retirada 2026-07-13. Se confirmo que ninguna de las
 * dos funciones tenia llamador real: sus unicas rutas (POST /api/v1/cit/iniciar,
 * POST /api/v1/cit/:id/validar) no eran invocadas desde ningun componente ni
 * otro backend. El flujo real de emision es
 * app/api/v1/bicicletas/[id]/verificar/route.ts, que inserta el CIT directo en
 * minuscula ('pendiente'::cit_estado) y lo encola con
 * validation.service.ts::encolarValidacion() -- una convencion de casing
 * distinta y ya consistente con el resto del sistema (ver la auditoria de
 * casing de cits.estado/cits.bfa_estado, 2026-07-11/12). El cron llevaba
 * corriendo cada hora sin encontrar jamas una fila real que mover, mismo patron
 * que la Generacion 1 de BFA de arriba.
 *
 * La inmutabilidad es el corazon del modulo: la huella y la firma se calculan en
 * el intake y el trigger `cit_proteger_payload` impide alterar los datos
 * certificados; la huella permite detectar cualquier manipulacion posterior.
 */

export interface CitRow {
  id: string
  bicicleta_id: string
  ciclista_id: string
  aliado_id: string
  aliado_nombre: string | null
  estado: CitEstado
  version: number
  bicicleta_serial: string
  inspeccion: unknown[]
  coordenadas_gps: Record<string, unknown> | null
  fotos_hashes: Record<string, unknown> | null
  alerta_gps: boolean
  huella_sha256: string
  firma_hmac: string
  algoritmo: string
  snapshot_canonico: string
  sellado_en: string
  expira_en: string
  validado_por: string | null
  validado_en: string | null
  fecha_emision: string | null
  fecha_vencimiento: string | null
  bfa_estado: CitBfaEstado
  bfa_tx_hash: string | null
  bfa_stamp_id: string | null
  bfa_objeto_id: string | null
  bfa_red: string | null
  bfa_token_id: string | null
  bfa_metadata_hash: string | null
  bfa_metadata: Record<string, unknown> | null
  bfa_intentos: number
  bfa_ultimo_error: string | null
  bfa_propietario_wallet: string | null
  bfa_modo_custodia: string | null
  acunado_en: string | null
  revocacion_motivo: string | null
  revocado_por: string | null
  revocado_en: string | null
  created_at: string
  updated_at: string
}

export interface EventoRow {
  id: string
  cit_id: string
  tipo: string
  estado_anterior: CitEstado | null
  estado_nuevo: CitEstado | null
  actor_id: string | null
  actor_rol: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export function mapCit(row: CitRow) {
  return {
    id: row.id,
    bicicletaId: row.bicicleta_id,
    ciclistaId: row.ciclista_id,
    aliadoId: row.aliado_id,
    aliadoNombre: row.aliado_nombre,
    estado: row.estado,
    version: row.version,
    bicicletaSerial: row.bicicleta_serial,
    inspeccion: row.inspeccion ?? [],
    coordenadasGps: row.coordenadas_gps,
    fotosHashes: row.fotos_hashes,
    alertaGps: row.alerta_gps,
    sello: {
      huellaSHA256: row.huella_sha256,
      firmaHMAC: row.firma_hmac,
      algoritmo: row.algoritmo,
      selladoEn: row.sellado_en,
      snapshot: JSON.parse(row.snapshot_canonico) as Record<string, unknown>,
    },
    expiraEn: row.expira_en,
    validadoPor: row.validado_por,
    validadoEn: row.validado_en,
    fechaEmision: row.fecha_emision,
    fechaVencimiento: row.fecha_vencimiento,
    bfa: {
      estado: row.bfa_estado,
      txHash: row.bfa_tx_hash,
      stampId: row.bfa_stamp_id,
      objetoId: row.bfa_objeto_id,
      red: row.bfa_red,
      tokenId: row.bfa_token_id,
      metadataHash: row.bfa_metadata_hash,
      metadata: row.bfa_metadata,
      intentos: row.bfa_intentos ?? 0,
      ultimoError: row.bfa_ultimo_error,
      propietarioWallet: row.bfa_propietario_wallet,
      modoCustodia: row.bfa_modo_custodia,
      acunadoEn: row.acunado_en,
    },
    revocacion: row.revocado_en
      ? { motivo: row.revocacion_motivo, por: row.revocado_por, en: row.revocado_en }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapEvento(row: EventoRow) {
  return {
    id: row.id,
    citId: row.cit_id,
    tipo: row.tipo,
    estadoAnterior: row.estado_anterior,
    estadoNuevo: row.estado_nuevo,
    actorId: row.actor_id,
    actorRol: row.actor_rol,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  }
}

// ── Helpers internos ─────────────────────────────────────────────────────────

async function withTx<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

async function lockCit(client: DbClient, citId: string): Promise<CitRow> {
  const res = await client.query<CitRow>(
    `SELECT * FROM cits WHERE id = $1 FOR UPDATE`,
    [citId]
  )
  const cit = res.rows[0]
  if (!cit) {
    throw new ApiError(404, 'CIT_NOT_FOUND', 'El certificado no existe.')
  }
  return cit
}

async function logEvento(
  client: DbClient,
  evento: {
    citId: string
    tipo: string
    estadoAnterior?: CitEstado | null
    estadoNuevo?: CitEstado | null
    actorId?: string | null
    actorRol?: string | null
    metadata?: Record<string, unknown>
  }
) {
  await client.query(
    `
      INSERT INTO cit_eventos
        (cit_id, tipo, estado_anterior, estado_nuevo, actor_id, actor_rol, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `,
    [
      evento.citId,
      evento.tipo,
      evento.estadoAnterior ?? null,
      evento.estadoNuevo ?? null,
      evento.actorId ?? null,
      evento.actorRol ?? null,
      JSON.stringify(evento.metadata ?? {}),
    ]
  )
}

// ── 3. verificarIntegridad ───────────────────────────────────────────────────

export async function verificarIntegridad(citId: string) {
  const res = await getPool().query<CitRow>(`SELECT * FROM cits WHERE id = $1`, [citId])
  const cit = res.rows[0]
  if (!cit) {
    throw new ApiError(404, 'CIT_NOT_FOUND', 'El certificado no existe.')
  }

  const verificacion = verificarSello(
    cit.snapshot_canonico,
    cit.huella_sha256,
    cit.firma_hmac
  )

  return {
    citId: cit.id,
    estado: cit.estado,
    integro: verificacion.integro,
    huellaCoincide: verificacion.huellaCoincide,
    firmaValida: verificacion.firmaValida,
    huellaSHA256: cit.huella_sha256,
    huellaRecalculada: verificacion.huellaRecalculada,
    algoritmo: cit.algoritmo,
    selladoEn: cit.sellado_en,
    bfa: {
      estado: cit.bfa_estado,
      txHash: cit.bfa_tx_hash,
      acunadoEn: cit.acunado_en,
    },
  }
}

// ── 6. revocarCIT ────────────────────────────────────────────────────────────

export async function revocarCIT(input: {
  citId: string
  motivo: string
  actorId: string | null
  actorRol: string
}) {
  return withTx(async (client) => {
    const cit = await lockCit(client, input.citId)
    if (cit.estado === 'REVOCADO') {
      throw new ApiError(409, 'CIT_YA_REVOCADO', 'El certificado ya esta revocado.')
    }

    const actualizado = await client.query<CitRow>(
      `
        UPDATE cits
        SET estado = 'REVOCADO',
            revocacion_motivo = $2,
            revocado_por = $3,
            revocado_en = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [cit.id, input.motivo, input.actorId]
    )

    await logEvento(client, {
      citId: cit.id,
      tipo: 'CIT_REVOCADO',
      estadoAnterior: cit.estado,
      estadoNuevo: 'REVOCADO',
      actorId: input.actorId,
      actorRol: input.actorRol,
      metadata: { motivo: input.motivo },
    })

    return mapCit(actualizado.rows[0])
  })
}

// ── Lecturas ─────────────────────────────────────────────────────────────────

export async function obtenerCIT(citId: string) {
  const res = await getPool().query<CitRow>(`SELECT * FROM cits WHERE id = $1`, [citId])
  const cit = res.rows[0]
  if (!cit) {
    throw new ApiError(404, 'CIT_NOT_FOUND', 'El certificado no existe.')
  }
  return mapCit(cit)
}

export async function listarCITs(filtros: {
  ciclistaId?: string | null
  aliadoId?: string | null
  estado?: CitEstado | null
}) {
  const condiciones: string[] = []
  const valores: unknown[] = []

  if (filtros.ciclistaId) {
    valores.push(filtros.ciclistaId)
    condiciones.push(`ciclista_id = $${valores.length}`)
  }
  if (filtros.aliadoId) {
    valores.push(filtros.aliadoId)
    condiciones.push(`aliado_id = $${valores.length}`)
  }
  if (filtros.estado) {
    valores.push(filtros.estado)
    condiciones.push(`estado = $${valores.length}`)
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''
  const res = await getPool().query<CitRow>(
    `SELECT * FROM cits ${where} ORDER BY created_at DESC LIMIT 100`,
    valores
  )
  return res.rows.map(mapCit)
}

/**
 * RODAID — Sistema de tarifas de denuncia de robo (Fase 7): ¿este usuario
 * tiene al menos un CIT activo y vigente? Determina si su denuncia de robo es
 * gratuita (ya contribuyo al sistema) o paga (cuenta gratis, nunca certifico).
 */
export async function tieneCitActivo(usuarioId: string): Promise<boolean> {
  const res = await getPool().query<{ existe: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1 FROM cits
        WHERE ciclista_id = $1
          AND estado = 'activo'
          AND fecha_vencimiento > NOW()
      ) AS existe
    `,
    [usuarioId]
  )
  return res.rows[0]?.existe ?? false
}

export async function listarEventos(citId: string) {
  const res = await getPool().query<EventoRow>(
    `SELECT * FROM cit_eventos WHERE cit_id = $1 ORDER BY created_at ASC`,
    [citId]
  )
  return res.rows.map(mapEvento)
}

// ── Estado de mint (acunacion del NFT en BFA) ────────────────────────────────

/** Correspondencia bfa_estado (canonico) -> vocabulario de mint del servicio. */
const MINT_ESTADO: Record<string, string> = {
  NO_INICIADA: 'NO_INICIADO',
  PENDIENTE: 'EN_PROCESO',
  ACUNADO: 'COMPLETADO',
  ERROR: 'REINTENTANDO',
  FALLIDO: 'FALLIDO',
}

/**
 * Estado de la acunacion del NFT de un certificado (GET /admin/cit/:id/mint/status).
 * Expone el estado de mint, los intentos, el ultimo error y los datos del token/tx.
 */
export async function obtenerEstadoMint(citId: string) {
  const res = await getPool().query<CitRow>(`SELECT * FROM cits WHERE id = $1`, [citId])
  const cit = res.rows[0]
  if (!cit) {
    throw new ApiError(404, 'CIT_NOT_FOUND', 'El certificado no existe.')
  }
  return {
    citId: cit.id,
    bicicletaSerial: cit.bicicleta_serial,
    estadoCit: cit.estado,
    mintEstado: MINT_ESTADO[cit.bfa_estado] ?? cit.bfa_estado,
    bfaEstado: cit.bfa_estado,
    intentos: cit.bfa_intentos ?? 0,
    ultimoError: cit.bfa_ultimo_error,
    modoCustodia: cit.bfa_modo_custodia,
    wallet: cit.bfa_propietario_wallet,
    tokenId: cit.bfa_token_id,
    metadataHash: cit.bfa_metadata_hash,
    red: cit.bfa_red,
    txHash: cit.bfa_tx_hash,
    objetoId: cit.bfa_objeto_id,
    acunadoEn: cit.acunado_en,
  }
}

// ── Geocerca del taller aliado ───────────────────────────────────────────────

export interface TallerRow {
  id: string
  nombre: string | null
  lat: number
  lng: number
  radio_metros: number
  created_at: string
  updated_at: string
}

function mapTaller(row: TallerRow) {
  return {
    aliadoId: row.id,
    nombre: row.nombre,
    lat: row.lat,
    lng: row.lng,
    radioMetros: row.radio_metros,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Registra (o actualiza) la geocerca del taller aliado: su coordenada y el radio
 * permitido alrededor de ella. Es la referencia que el intake del CIT cruza con
 * Haversine para decidir `alerta_gps`. La fila se identifica por el UUID del
 * aliado autenticado.
 */
export async function registrarGeocercaTaller(input: {
  aliadoId: string
  nombre: string | null
  lat: number
  lng: number
  radioMetros: number
}) {
  const res = await getPool().query<TallerRow>(
    `
      INSERT INTO talleres (id, nombre, lat, lng, radio_metros)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE
        SET nombre = EXCLUDED.nombre,
            lat = EXCLUDED.lat,
            lng = EXCLUDED.lng,
            radio_metros = EXCLUDED.radio_metros,
            updated_at = NOW()
      RETURNING *
    `,
    [input.aliadoId, input.nombre, input.lat, input.lng, input.radioMetros]
  )
  return mapTaller(res.rows[0])
}

/** Devuelve la geocerca registrada del aliado, o `null` si no la configuro. */
export async function obtenerGeocercaTaller(aliadoId: string) {
  const res = await getPool().query<TallerRow>(
    `SELECT * FROM talleres WHERE id = $1`,
    [aliadoId]
  )
  const row = res.rows[0]
  return row ? mapTaller(row) : null
}
