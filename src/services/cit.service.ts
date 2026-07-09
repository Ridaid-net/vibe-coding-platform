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
import {
  extraerCoordenada,
  verificarGeofencing,
  RADIO_GEOCERCA_DEFECTO_METROS,
} from '@/lib/geo'
import {
  BfaError,
  bfaConfigurada,
  construirAcunacionNFT,
  enviarAcunacionBFA,
  esErrorReintentable,
  leerConfigBFA,
  resolverWalletDestino,
  subirMetadataIPFSBackground,
} from '@/lib/bfa'
import { notificarCITAprobado } from '@/src/services/notif.service'

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

function esViolacionUnicidad(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505'
  )
}

/**
 * Control de anomalias (fase temprana): geocercado real del intake.
 *
 * Cruza las coordenadas levantadas por el mecanico contra la ubicacion
 * registrada del taller aliado emisor (tabla `talleres`) usando la formula de
 * Haversine. Si el intake quedo fuera del radio permitido, levanta la bandera
 * `alerta_gps`, que el worker del pipeline traduce luego a ANOMALIA_DETECTADA.
 *
 * Si el aliado no tiene una geocerca registrada o el intake no trae coordenadas,
 * no se puede evaluar: no se levanta la alerta (no se penaliza al ciclista por
 * una omision de configuracion del taller) y el motivo queda asentado para la
 * auditoria.
 */
export interface ResultadoGeocercaTaller {
  alertaGps: boolean
  evaluado: boolean
  motivo:
    | 'DENTRO_DEL_RADIO'
    | 'FUERA_DEL_RADIO'
    | 'SIN_REFERENCIA_TALLER'
    | 'SIN_COORDENADAS_INTAKE'
    | 'COORDENADAS_INTAKE_INVALIDAS'
  distanciaMetros: number | null
  radioMetros: number | null
}

interface TallerGeocercaRow {
  lat: number
  lng: number
  radio_metros: number
}

export async function evaluarGeocercaTaller(
  client: DbClient,
  aliadoId: string,
  coordenadasGps: Record<string, unknown> | null
): Promise<ResultadoGeocercaTaller> {
  const intake = extraerCoordenada(coordenadasGps)
  if (coordenadasGps === null) {
    return {
      alertaGps: false,
      evaluado: false,
      motivo: 'SIN_COORDENADAS_INTAKE',
      distanciaMetros: null,
      radioMetros: null,
    }
  }
  if (intake === null) {
    return {
      alertaGps: false,
      evaluado: false,
      motivo: 'COORDENADAS_INTAKE_INVALIDAS',
      distanciaMetros: null,
      radioMetros: null,
    }
  }

  const taller = await client.query<TallerGeocercaRow>(
    `SELECT lat, lng, radio_metros FROM talleres WHERE id = $1`,
    [aliadoId]
  )
  const referencia = taller.rows[0]
  if (!referencia) {
    return {
      alertaGps: false,
      evaluado: false,
      motivo: 'SIN_REFERENCIA_TALLER',
      distanciaMetros: null,
      radioMetros: null,
    }
  }

  const radioMetros = referencia.radio_metros ?? RADIO_GEOCERCA_DEFECTO_METROS
  const { esValido, distanciaMetros } = verificarGeofencing(
    referencia.lat,
    referencia.lng,
    intake.lat,
    intake.lng,
    radioMetros
  )

  return {
    alertaGps: !esValido,
    evaluado: true,
    motivo: esValido ? 'DENTRO_DEL_RADIO' : 'FUERA_DEL_RADIO',
    distanciaMetros,
    radioMetros,
  }
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
  return withTx(async (client) => {
    // Geocercado real (Haversine) contra la ubicacion registrada del taller.
    const geocerca = await evaluarGeocercaTaller(
      client,
      input.aliadoId,
      input.coordenadasGps
    )
    const alertaGps = geocerca.alertaGps

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
      metadata: {
        huella,
        alertaGps,
        expiraEn,
        geocerca: {
          evaluado: geocerca.evaluado,
          motivo: geocerca.motivo,
          distanciaMetros: geocerca.distanciaMetros,
          radioMetros: geocerca.radioMetros,
        },
      },
    })

    // Si el intake quedo fuera del radio del taller, se asienta un evento de
    // auditoria dedicado con la distancia excedida (el worker del pipeline lo
    // resolvera luego como ANOMALIA_DETECTADA).
    if (geocerca.alertaGps) {
      await logEvento(client, {
        citId,
        tipo: 'CIT_ALERTA_GEOCERCA',
        estadoNuevo: 'PENDIENTE_VALIDACION',
        actorId: input.aliadoId,
        actorRol: 'aliado',
        metadata: {
          motivo: 'Coordenadas del intake fuera del radio permitido del taller aliado.',
          distanciaMetros: geocerca.distanciaMetros,
          radioMetros: geocerca.radioMetros,
        },
      })
    }

    return { cit: mapCit(citRow), huella, alertaGps, expiraEn, geocerca }
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

// ── 5b. acunarCITEnBFA (acunacion del NFT en BFA, 8 pasos atomicos) ──────────

/**
 * Servicio de Acunacion BFA: acuna el NFT del certificado en la Blockchain Federal
 * Argentina de punta a punta, en 8 pasos atomicos, automatizando el puente que antes
 * era manual (preparar -> registrar txHash externo).
 *
 * Wallet de destino:
 *   - `propietarioWallet` presente -> transferencia DIRECTA a esa wallet.
 *   - ausente                      -> Modelo Custodial RODAID (la plataforma custodia
 *                                     el NFT hasta que el propietario reclame su wallet).
 *
 * Clasificacion de errores (`esErrorReintentable`):
 *   - Red / timeout / conflicto de nonce -> estado REINTENTANDO (bfa_estado ERROR):
 *     el worker programado lo reintenta automaticamente.
 *   - Hash duplicado / propietario invalido -> estado FALLIDO: bloqueo definitivo
 *     para auditoria, no se reintenta solo.
 *
 * La llamada de red va FUERA del bloqueo de fila para no retener el lock durante la
 * submission on-chain. La subida de metadata a IPFS se despega en background, fuera
 * de la transaccion principal. Honestidad de estado: si no hay gateway de BFA
 * configurado, NO se inventa una transaccion; el NFT queda preparado a la espera.
 */
export async function acunarCITEnBFA(input: {
  citId: string
  propietarioWallet?: string | null
  actorId: string | null
  actorRol: string
}) {
  const config = leerConfigBFA()

  // Marca el anclaje como fallido/transitorio segun la clasificacion del error.
  const registrarFallo = async (error: unknown) => {
    const codigo = error instanceof BfaError ? error.code : 'BFA_ACUNACION_FALLIDA'
    const mensaje = error instanceof Error ? error.message : 'Fallo la acunacion en BFA.'
    const reintentable = esErrorReintentable(error)
    const estadoBfa = reintentable ? 'ERROR' : 'FALLIDO' // REINTENTANDO vs FALLIDO
    await withTx(async (client) => {
      await lockCit(client, input.citId)
      await client.query(
        `UPDATE cits SET bfa_estado = $2::cit_bfa_estado, bfa_ultimo_error = $3 WHERE id = $1`,
        [input.citId, estadoBfa, mensaje]
      )
      await logEvento(client, {
        citId: input.citId,
        tipo: 'BFA_ACUNACION_ERROR',
        actorId: input.actorId,
        actorRol: input.actorRol,
        metadata: { codigo, mensaje, reintentable, estadoBfa },
      })
    })
    throw new ApiError(error instanceof BfaError ? error.status : 502, codigo, mensaje)
  }

  // ── Pasos 1-4 · Tx1: validar, resolver wallet, construir NFT, dejar EN_PROCESO ─
  let preparado
  try {
    preparado = await withTx(async (client) => {
      // Paso 1 — Validar el certificado bajo bloqueo de fila.
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

      // Paso 2 — Resolver la wallet de destino (directo vs. custodial). Una wallet
      // malformada lanza BfaError fatal (no reintentable).
      const destino = resolverWalletDestino(
        input.propietarioWallet,
        cit.ciclista_id,
        config
      )

      // Paso 3 — Construir el NFT de forma deterministica desde la huella sellada.
      const nft = construirAcunacionNFT(
        {
          citId: cit.id,
          huella: cit.huella_sha256,
          firma: cit.firma_hmac,
          algoritmo: cit.algoritmo,
          bicicletaSerial: cit.bicicleta_serial,
          ciclistaId: cit.ciclista_id,
          aliadoId: cit.aliado_id,
          aliadoNombre: cit.aliado_nombre,
          estado: cit.estado,
          selladoEn: cit.sellado_en,
          fechaEmision: cit.fecha_emision,
          fechaVencimiento: cit.fecha_vencimiento,
        },
        config
      )

      // Paso 4 — Persistir el estado EN_PROCESO (bfa_estado PENDIENTE) con el token,
      // la metadata, la wallet y el modo de custodia; incrementar intentos.
      const actualizado = await client.query<CitRow>(
        `
          UPDATE cits
          SET bfa_estado = 'PENDIENTE',
              bfa_red = $2,
              bfa_token_id = $3,
              bfa_metadata_hash = $4,
              bfa_metadata = $5::jsonb,
              bfa_propietario_wallet = $6,
              bfa_modo_custodia = $7,
              bfa_intentos = bfa_intentos + 1,
              bfa_ultimo_error = NULL
          WHERE id = $1
          RETURNING *
        `,
        [
          cit.id,
          nft.red,
          nft.tokenId,
          nft.metadataHash,
          JSON.stringify(nft.metadata),
          destino.wallet,
          destino.modo,
        ]
      )

      await logEvento(client, {
        citId: cit.id,
        tipo: 'BFA_ACUNACION_PREPARADA',
        actorId: input.actorId,
        actorRol: input.actorRol,
        metadata: {
          huella: cit.huella_sha256,
          tokenId: nft.tokenId,
          metadataHash: nft.metadataHash,
          red: nft.red,
          modoCustodia: destino.modo,
          configurada: bfaConfigurada(config),
        },
      })

      return { cit, nft, destino, row: actualizado.rows[0] }
    })
  } catch (error) {
    // Errores de negocio (no acunable / ya acunado) se propagan tal cual; un error
    // fatal de wallet se asienta como FALLIDO para auditoria.
    if (error instanceof ApiError) throw error
    if (error instanceof BfaError) return registrarFallo(error)
    throw error
  }

  // ── Paso 5 · Submission on-chain (fuera del lock) ──────────────────────────
  let resultado
  try {
    resultado = await enviarAcunacionBFA(
      preparado.nft,
      { citId: preparado.cit.id, huella: preparado.cit.huella_sha256 },
      config,
      preparado.destino
    )
  } catch (error) {
    if (error instanceof BfaError && error.code === 'BFA_NO_CONFIGURADA') {
      // Sin gateway: el NFT queda preparado y EN_PROCESO, sin inventar una tx.
      return {
        acunado: false,
        motivo: 'BFA_NO_CONFIGURADA' as const,
        cit: mapCit(preparado.row),
        modoCustodia: preparado.destino.modo,
        wallet: preparado.destino.wallet,
        payloadBFA: {
          citId: preparado.cit.id,
          huellaSHA256: preparado.cit.huella_sha256,
          firmaHMAC: preparado.cit.firma_hmac,
          algoritmo: preparado.cit.algoritmo,
          tokenId: preparado.nft.tokenId,
          metadataHash: preparado.nft.metadataHash,
          metadata: preparado.nft.metadata,
        },
      }
    }
    // Paso 6 — Clasificar el error y asentar REINTENTANDO (ERROR) o FALLIDO.
    return registrarFallo(error)
  }

  // ── Paso 7 · Tx2: registrar la confirmacion on-chain (COMPLETADO/ACUNADO) ───
  const final = await withTx(async (client) => {
    const cit = await lockCit(client, input.citId)
    if (cit.bfa_estado === 'ACUNADO') {
      return mapCit(cit) // idempotente: otra corrida ya lo confirmo.
    }

    const actualizado = await client.query<CitRow>(
      `
        UPDATE cits
        SET bfa_estado = 'ACUNADO',
            bfa_tx_hash = $2,
            bfa_stamp_id = $3,
            bfa_objeto_id = $4,
            bfa_ultimo_error = NULL,
            acunado_en = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [cit.id, resultado.txHash, resultado.stampId, resultado.objetoId]
    )

    await logEvento(client, {
      citId: cit.id,
      tipo: 'BFA_ACUNADO',
      actorId: input.actorId,
      actorRol: input.actorRol,
      metadata: {
        txHash: resultado.txHash,
        stampId: resultado.stampId,
        objetoId: resultado.objetoId,
        tokenId: preparado.nft.tokenId,
        red: resultado.red,
        modoCustodia: preparado.destino.modo,
        explorerUrl: resultado.explorerUrl,
      },
    })

    return mapCit(actualizado.rows[0])
  })

  // ── Paso 8 · Efectos fuera de la transaccion: notificar + IPFS en background ─
  // Notificacion CIT_APROBADO al ciclista (best-effort; no bloquea la acunacion).
  await notificarCITAprobado(preparado.cit.ciclista_id, {
    citId: preparado.cit.id,
    bicicletaSerial: preparado.cit.bicicleta_serial,
    txHash: resultado.txHash,
    explorerUrl: resultado.explorerUrl,
    red: resultado.red,
  }).catch((error) => {
    console.error('[cit] fallo la notificacion CIT_APROBADO', preparado.cit.id, error)
  })

  // _subirIPFSBackground: pin de la metadata a IPFS, despegado de la transaccion
  // principal (fire-and-forget). No es critico para la consistencia on-chain.
  void subirMetadataIPFSBackground(preparado.nft).catch((error) => {
    console.error('[cit] fallo la subida de metadata a IPFS', preparado.cit.id, error)
  })

  return {
    acunado: true,
    motivo: 'ACUNADO' as const,
    cit: final,
    resultado,
    tokenId: preparado.nft.tokenId,
    metadataHash: preparado.nft.metadataHash,
    modoCustodia: preparado.destino.modo,
    wallet: preparado.destino.wallet,
    explorerUrl: resultado.explorerUrl,
  }
}

/**
 * Alias historico de `acunarCITEnBFA`. Se conserva para los llamadores existentes
 * (route handler de acunacion) sin cambiar su contrato.
 */
export const acunarCIT = acunarCITEnBFA

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

/**
 * Lista los certificados ACTIVOS cuya acunacion del NFT en BFA no quedo confirmada:
 * FALLIDO (error fatal, requiere re-acunacion manual) y, opcionalmente, ERROR
 * (transitorio, lo reintenta el barrido). Alimenta el panel de administracion para
 * diagnosticar y re-disparar la acunacion via POST /api/v1/cit/:id/acunar.
 */
export async function listarAcunacionesFallidas(opciones?: {
  incluirTransitorios?: boolean
}) {
  const estados = opciones?.incluirTransitorios
    ? ['FALLIDO', 'ERROR']
    : ['FALLIDO']
  const res = await getPool().query<CitRow>(
    `
      SELECT * FROM cits
      WHERE estado = 'ACTIVO' AND bfa_estado = ANY($1::cit_bfa_estado[])
      ORDER BY updated_at DESC
      LIMIT 200
    `,
    [estados]
  )
  return res.rows.map((row: CitRow) => {
    const cit = mapCit(row)
    return {
      citId: cit.id,
      bicicletaSerial: cit.bicicletaSerial,
      huellaSHA256: cit.sello.huellaSHA256,
      bfa: cit.bfa,
    }
  })
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
