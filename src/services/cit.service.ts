import { ApiError, getPool, type DbClient } from '@/lib/marketplace'
import {
  CIT_ALGORITMO,
  canonicalizar,
  construirSnapshot,
  firmarHuella,
  huellaDeCanonico,
  nuevoId,
  verificarSello,
  type CitBfaEstado,
  type CitEstado,
} from '@/lib/cit'

/**
 * RODAID — Modulo 4: maquina de estados del Certificado de Identidad Tecnica.
 *
 *   iniciarCIT()            -> PENDIENTE_VALIDACION  (intake sellado, ventana 72 hs)
 *   validarCIT()            -> ACTIVO                (RODAID valida; fija vigencia)
 *   (vencimiento ventana)   -> VENCIDO
 *   revocarCIT()            -> REVOCADO
 *
 *   Anclaje en Blockchain Federal Argentina (BFA), independiente de la validez:
 *   prepararAcunacionBFA()  -> bfa_estado PENDIENTE  (entrega la huella a anclar)
 *   registrarAcunacionBFA() -> bfa_estado ACUNADO    (txHash on-chain)
 *
 * La inmutabilidad es el corazon del modulo: la huella y la firma se calculan en
 * el intake y el trigger `cit_proteger_payload` impide alterar los datos
 * certificados; la huella permite detectar cualquier manipulacion posterior.
 */

const VENTANA_VALIDACION_HORAS = 72
const VIGENCIA_ANIOS = 2

export interface BicicletaRow {
  id: string
  propietario_id: string
  marca: string | null
  modelo: string | null
  anio: number | null
  tipo: string | null
  numero_serie: string
  numero_cuadro: string | null
  color: string | null
  rodado: string | null
  created_at: string
  updated_at: string
}

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

function esViolacionUnicidad(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505'
  )
}

/**
 * Control de anomalias (fase temprana): verifica que el intake se haya levantado
 * dentro del radio geografico del taller aliado.
 *
 * TODO: conectar el radio real del taller (geofencing). Por ahora es un stub que
 * devuelve `true` y deja registrada la coordenada en el sello para auditoria.
 */
export function verificarGeofencing(
  _aliadoId: string,
  _coordenadasGps: Record<string, unknown> | null
): boolean {
  return true
}

// ── Tipos de entrada ─────────────────────────────────────────────────────────

export interface IniciarCitInput {
  aliadoId: string
  ciclistaId: string
  bicicletaSerial: string
  aliadoNombre: string | null
  inspeccion: unknown[]
  coordenadasGps: Record<string, unknown> | null
  fotosHashes: Record<string, unknown> | null
}

// ── 1. iniciarCIT (intake + sello de inmutabilidad) ──────────────────────────

export async function iniciarCIT(input: IniciarCitInput) {
  const alertaGps = verificarGeofencing(input.aliadoId, input.coordenadasGps)

  return withTx(async (client) => {
    // Upsert del rodado por numero de serie (identidad fisica unica).
    const existente = await client.query<BicicletaRow>(
      `SELECT * FROM bicicletas WHERE numero_serie = $1 FOR UPDATE`,
      [input.bicicletaSerial]
    )

    let bicicleta = existente.rows[0]
    if (bicicleta) {
      if (bicicleta.propietario_id !== input.ciclistaId) {
        throw new ApiError(
          409,
          'PROPIETARIO_CONFLICTO',
          'El numero de serie ya esta registrado a nombre de otro ciclista.'
        )
      }
    } else {
      const creada = await client.query<BicicletaRow>(
        `
          INSERT INTO bicicletas (propietario_id, numero_serie)
          VALUES ($1, $2)
          RETURNING *
        `,
        [input.ciclistaId, input.bicicletaSerial]
      )
      bicicleta = creada.rows[0]
    }

    const citId = nuevoId()
    // La marca de tiempo del intake es autoritativa: se incrusta en el snapshot
    // hasheado y se persiste con el mismo valor, de modo que la verificacion
    // posterior recalcule exactamente la misma huella.
    const capturadoEn = new Date().toISOString()
    const expiraEn = new Date(
      Date.parse(capturadoEn) + VENTANA_VALIDACION_HORAS * 60 * 60 * 1000
    ).toISOString()

    const snapshot = construirSnapshot({
      citId,
      version: 1,
      aliadoId: input.aliadoId,
      ciclistaId: input.ciclistaId,
      bicicletaSerial: input.bicicletaSerial,
      inspeccion: input.inspeccion,
      coordenadasGps: input.coordenadasGps,
      fotosHashes: input.fotosHashes,
      capturadoEn,
    })

    // Se hashea la cadena canonica EXACTA y se persiste tal cual, para que la
    // verificacion posterior recalcule la misma huella byte a byte.
    const canonico = canonicalizar(snapshot)
    const huella = huellaDeCanonico(canonico)
    const firma = firmarHuella(huella)

    let citRow: CitRow
    try {
      const insertado = await client.query<CitRow>(
        `
          INSERT INTO cits (
            id, bicicleta_id, ciclista_id, aliado_id, aliado_nombre,
            bicicleta_serial, inspeccion, coordenadas_gps, fotos_hashes, alerta_gps,
            huella_sha256, firma_hmac, algoritmo, snapshot_canonico, sellado_en, expira_en
          )
          VALUES (
            $1, $2, $3, $4, $5,
            $6, $7::jsonb, $8::jsonb, $9::jsonb, $10,
            $11, $12, $13, $14, $15, $16
          )
          RETURNING *
        `,
        [
          citId,
          bicicleta.id,
          input.ciclistaId,
          input.aliadoId,
          input.aliadoNombre,
          input.bicicletaSerial,
          JSON.stringify(input.inspeccion ?? []),
          input.coordenadasGps === null ? null : JSON.stringify(input.coordenadasGps),
          input.fotosHashes === null ? null : JSON.stringify(input.fotosHashes),
          alertaGps,
          huella,
          firma,
          CIT_ALGORITMO,
          canonico,
          capturadoEn,
          expiraEn,
        ]
      )
      citRow = insertado.rows[0]
    } catch (error) {
      if (esViolacionUnicidad(error)) {
        throw new ApiError(
          409,
          'CIT_DUPLICADO',
          'Ya existe un certificado en validacion o vigente para este rodado.'
        )
      }
      throw error
    }

    await logEvento(client, {
      citId,
      tipo: 'CIT_INTAKE_RECIBIDO',
      estadoNuevo: 'PENDIENTE_VALIDACION',
      actorId: input.aliadoId,
      actorRol: 'aliado',
      metadata: { huella, alertaGps, expiraEn },
    })

    return { cit: mapCit(citRow), huella, alertaGps, expiraEn }
  })
}

// ── 2. validarCIT (PENDIENTE_VALIDACION -> ACTIVO) ───────────────────────────

export async function validarCIT(input: { citId: string; validadorId: string | null }) {
  return withTx(async (client) => {
    const cit = await lockCit(client, input.citId)
    if (cit.estado !== 'PENDIENTE_VALIDACION') {
      throw new ApiError(
        409,
        'CIT_NO_VALIDABLE',
        'El certificado no esta pendiente de validacion.'
      )
    }

    if (Date.parse(cit.expira_en) <= Date.now()) {
      const vencido = await client.query<CitRow>(
        `UPDATE cits SET estado = 'VENCIDO' WHERE id = $1 RETURNING *`,
        [cit.id]
      )
      await logEvento(client, {
        citId: cit.id,
        tipo: 'CIT_PIPELINE_VENCIDO',
        estadoAnterior: 'PENDIENTE_VALIDACION',
        estadoNuevo: 'VENCIDO',
        actorId: input.validadorId,
        actorRol: 'sistema',
      })
      // Devuelve el estado actualizado dentro del error para trazabilidad.
      void vencido
      throw new ApiError(
        422,
        'CIT_PIPELINE_VENCIDO',
        'La ventana de validacion de 72 hs expiro.'
      )
    }

    const emision = new Date().toISOString()
    const vencimiento = new Date(emision)
    vencimiento.setFullYear(vencimiento.getFullYear() + VIGENCIA_ANIOS)

    const actualizado = await client.query<CitRow>(
      `
        UPDATE cits
        SET estado = 'ACTIVO',
            validado_por = $2,
            validado_en = $3,
            fecha_emision = $3,
            fecha_vencimiento = $4
        WHERE id = $1
        RETURNING *
      `,
      [cit.id, input.validadorId, emision, vencimiento.toISOString()]
    )

    await logEvento(client, {
      citId: cit.id,
      tipo: 'CIT_VALIDADO',
      estadoAnterior: 'PENDIENTE_VALIDACION',
      estadoNuevo: 'ACTIVO',
      actorId: input.validadorId,
      actorRol: 'sistema',
    })

    return mapCit(actualizado.rows[0])
  })
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

// ── 4. prepararAcunacionBFA ──────────────────────────────────────────────────

/**
 * Prepara el payload de anclaje en la Blockchain Federal Argentina: la huella es
 * lo que se estampa on-chain. No realiza la llamada de red (la red puede estar
 * inestable; la acunacion se confirma de forma asincrona via registrarAcunacionBFA).
 */
export async function prepararAcunacionBFA(input: {
  citId: string
  actorId: string | null
  actorRol: string
}) {
  return withTx(async (client) => {
    const cit = await lockCit(client, input.citId)
    if (cit.estado !== 'ACTIVO') {
      throw new ApiError(
        409,
        'CIT_NO_ACTIVO',
        'Solo se puede acunar un certificado validado (ACTIVO).'
      )
    }
    if (cit.bfa_estado === 'ACUNADO') {
      throw new ApiError(409, 'BFA_YA_ACUNADO', 'El certificado ya fue acunado en BFA.')
    }

    const actualizado = await client.query<CitRow>(
      `UPDATE cits SET bfa_estado = 'PENDIENTE' WHERE id = $1 RETURNING *`,
      [cit.id]
    )

    await logEvento(client, {
      citId: cit.id,
      tipo: 'BFA_ACUNACION_PREPARADA',
      actorId: input.actorId,
      actorRol: input.actorRol,
      metadata: { huella: cit.huella_sha256 },
    })

    return {
      cit: mapCit(actualizado.rows[0]),
      payloadBFA: {
        citId: cit.id,
        huellaSHA256: cit.huella_sha256,
        firmaHMAC: cit.firma_hmac,
        algoritmo: cit.algoritmo,
        selladoEn: cit.sellado_en,
      },
    }
  })
}

// ── 5. registrarAcunacionBFA ─────────────────────────────────────────────────

export async function registrarAcunacionBFA(input: {
  citId: string
  txHash: string
  stampId: string | null
  objetoId: string | null
  actorId: string | null
  actorRol: string
}) {
  return withTx(async (client) => {
    const cit = await lockCit(client, input.citId)
    if (cit.estado !== 'ACTIVO') {
      throw new ApiError(
        409,
        'CIT_NO_ACTIVO',
        'Solo se puede acunar un certificado validado (ACTIVO).'
      )
    }
    if (cit.bfa_estado === 'ACUNADO') {
      throw new ApiError(409, 'BFA_YA_ACUNADO', 'El certificado ya fue acunado en BFA.')
    }

    const actualizado = await client.query<CitRow>(
      `
        UPDATE cits
        SET bfa_estado = 'ACUNADO',
            bfa_tx_hash = $2,
            bfa_stamp_id = $3,
            bfa_objeto_id = $4,
            acunado_en = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [cit.id, input.txHash, input.stampId, input.objetoId]
    )

    await logEvento(client, {
      citId: cit.id,
      tipo: 'BFA_ACUNADO',
      actorId: input.actorId,
      actorRol: input.actorRol,
      metadata: { txHash: input.txHash, stampId: input.stampId },
    })

    return mapCit(actualizado.rows[0])
  })
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

export async function listarEventos(citId: string) {
  const res = await getPool().query<EventoRow>(
    `SELECT * FROM cit_eventos WHERE cit_id = $1 ORDER BY created_at ASC`,
    [citId]
  )
  return res.rows.map(mapEvento)
}
