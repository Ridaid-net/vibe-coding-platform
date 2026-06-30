import { ApiError, getPool, type DbClient } from '@/lib/marketplace'
import type { UsuarioRol } from '@/lib/auth'
import {
  encolarValidacion,
  procesarJob,
  type ProcesarJobResultado,
} from '@/src/services/validation.service'
import { anclarCITEnSegundoPlano } from '@/src/services/blockchain.service'
import { emitirEvento } from '@/src/services/notification.service'
import {
  firmarActa,
  firmaHashActa,
  verificarFirmaCanonica,
  type ActaFirmada,
  type ActaPayload,
} from '@/src/services/acta-firma.service'

/**
 * RODAID — Hito 11: Portal de Inspectores y Aliados (validacion presencial).
 *
 * Concentra la logica de la INSPECCION FISICA delegada:
 *   - `buscarParaInspeccion`  -> busca la bici por serie/CIT y arma la vista del
 *                                inspector (datos + estado del pipeline + actas).
 *   - `aprobarInspeccionFisica` -> ACTA de aprobacion. Transaccion atomica que
 *                                  registra la inspeccion (auditoria), la firma
 *                                  con la identidad del inspector y ACELERA el
 *                                  pipeline de 72hs a 0hs; luego dispara la
 *                                  decision + anclaje en la BFA de inmediato.
 *   - `reportarDiscrepancia`   -> ACTA de discrepancia: frena la verificacion.
 *
 * Alcance (scope):
 *   - rol 'inspector' / 'admin': pueden inspeccionar cualquier bicicleta.
 *   - rol 'aliado': solo las bicis vinculadas a sus servicios (vendidas o
 *     mantenidas en su taller), via `aliado_servicios`.
 *
 * Identidad digital:
 *   - El inspector DEBE tener `wallet_address` en su perfil. La aprobacion queda
 *     vinculada a esa wallet y, ademas, FIRMADA DIGITALMENTE: el acta canonica se
 *     firma con la Web Crypto API usando la clave de un certificado X.509 cargado
 *     desde un bundle PKCS#12 (ver `acta-firma.service.ts`). La firma + el
 *     certificado se guardan en el acta para verificacion offline (validez legal).
 *
 * Trazabilidad (Hito 11): cada validacion queda asociada a su `inspector_id` y a
 * su `taller_id` (el aliado bajo el que se inspecciono, si aplica).
 */

// ── Contexto del inspector ───────────────────────────────────────────────────

export interface InspectorContexto {
  id: string
  rol: UsuarioRol
  nombre: string
  walletAddress: string | null
  /** Aliado aprobado del usuario, si su rol es 'aliado'. */
  aliado: { id: string; nombre: string } | null
}

// ── Helpers de transaccion / firma ───────────────────────────────────────────

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

/**
 * Arma el payload canonico del acta (lo que se firma y verifica). Centraliza la
 * construccion para que la firma digital y la huella SHA-256 cubran exactamente
 * los mismos datos.
 */
function buildActaPayload(opts: {
  citId: string
  codigoCit: string
  numeroSerie: string
  hashIdentidad: string | null
  resultado: 'APROBADA' | 'DISCREPANCIA'
  inspectorId: string
  walletAddress: string
  tallerId: string | null
  emitidoEn: string
}): ActaPayload {
  return {
    citId: opts.citId,
    codigoCit: opts.codigoCit,
    numeroSerie: opts.numeroSerie,
    hashIdentidad: opts.hashIdentidad,
    resultado: opts.resultado,
    inspectorId: opts.inspectorId,
    walletAddress: opts.walletAddress,
    tallerId: opts.tallerId,
    emitidoEn: opts.emitidoEn,
  }
}

// ── Resolucion del aliado del usuario y del alcance ──────────────────────────

interface AliadoRow {
  id: string
  nombre: string
}

/** Aliado APROBADO cuya cuenta duena es `usuarioId` (o null si no tiene). */
export async function resolverAliadoDeUsuario(
  usuarioId: string
): Promise<{ id: string; nombre: string } | null> {
  const res = await getPool().query<AliadoRow>(
    `
      SELECT id, nombre FROM aliados
      WHERE usuario_id = $1 AND estado = 'aprobado'
      ORDER BY resuelto_en DESC NULLS LAST, created_at DESC
      LIMIT 1
    `,
    [usuarioId]
  )
  return res.rows[0] ?? null
}

interface InspectorPerfilRow {
  id: string
  rol: UsuarioRol
  wallet_address: string | null
  datos_perfil: Record<string, unknown> | null
}

/**
 * Carga el contexto de inspeccion de un usuario: su rol, su wallet (identidad
 * digital) y, si es aliado, su aliado aprobado. Lanza si el usuario no existe.
 */
export async function cargarInspectorContexto(
  usuarioId: string
): Promise<InspectorContexto> {
  const res = await getPool().query<InspectorPerfilRow>(
    `SELECT id, rol, wallet_address, datos_perfil FROM usuarios WHERE id = $1 LIMIT 1`,
    [usuarioId]
  )
  const row = res.rows[0]
  if (!row) {
    throw new ApiError(404, 'USUARIO_NOT_FOUND', 'El usuario no existe.')
  }
  const perfil = row.datos_perfil ?? {}
  const nombre =
    (typeof perfil.nombre === 'string' && perfil.nombre.trim()) || 'Inspector'
  const aliado = row.rol === 'aliado' ? await resolverAliadoDeUsuario(row.id) : null
  return {
    id: row.id,
    rol: row.rol,
    nombre,
    walletAddress: row.wallet_address,
    aliado,
  }
}

/** ¿El aliado tiene un vinculo de servicio con esta bicicleta? */
async function aliadoTieneServicio(
  aliadoId: string,
  bicicletaId: string
): Promise<boolean> {
  const res = await getPool().query<{ uno: number }>(
    `SELECT 1 AS uno FROM aliado_servicios WHERE aliado_id = $1 AND bicicleta_id = $2 LIMIT 1`,
    [aliadoId, bicicletaId]
  )
  return res.rows.length > 0
}

/**
 * ¿Este inspector puede inspeccionar esta bicicleta? inspector/admin: siempre.
 * aliado: solo si tiene un vinculo de servicio con la bici.
 */
export async function puedeInspeccionar(
  ctx: InspectorContexto,
  bicicletaId: string
): Promise<{ autorizado: boolean; aliadoId: string | null }> {
  if (ctx.rol === 'inspector' || ctx.rol === 'admin') {
    return { autorizado: true, aliadoId: ctx.aliado?.id ?? null }
  }
  if (ctx.rol === 'aliado' && ctx.aliado) {
    const tiene = await aliadoTieneServicio(ctx.aliado.id, bicicletaId)
    return { autorizado: tiene, aliadoId: ctx.aliado.id }
  }
  return { autorizado: false, aliadoId: null }
}

/**
 * Resuelve el alcance de inspeccion para una accion sobre un CIT: carga la bici
 * del CIT, valida que el inspector pueda inspeccionarla y devuelve el aliado_id
 * a registrar en el acta. Lanza 404 si el CIT no existe y 403 si esta fuera de
 * alcance (un aliado sobre una bici que no es suya).
 */
export async function autorizarCitParaInspeccion(
  ctx: InspectorContexto,
  citId: string
): Promise<{ aliadoId: string | null }> {
  const res = await getPool().query<{ bicicleta_id: string }>(
    `SELECT bicicleta_id FROM cits WHERE id = $1 LIMIT 1`,
    [citId]
  )
  const bici = res.rows[0]
  if (!bici) {
    throw new ApiError(404, 'CIT_NOT_FOUND', 'No encontramos la cedula (CIT) a inspeccionar.')
  }
  const { autorizado, aliadoId } = await puedeInspeccionar(ctx, bici.bicicleta_id)
  if (!autorizado) {
    throw new ApiError(
      403,
      'FUERA_DE_ALCANCE',
      'No podes inspeccionar esta bicicleta: no esta vinculada a tu taller.'
    )
  }
  return { aliadoId }
}

// ── Busqueda para el panel de inspecciones ───────────────────────────────────

interface FilaInspeccionBusqueda {
  bici_id: string
  marca: string
  modelo: string
  tipo: string
  numero_serie: string
  anio: number | null
  color: string | null
  rodado: string | null
  talle_cuadro: string | null
  propietario_id: string
  titular_perfil: Record<string, unknown> | null
  cit_id: string | null
  cit_estado: string | null
  codigo_cit: string | null
  hash_sha256: string | null
  fecha_vencimiento: string | null
  bfa_estado: string | null
  cit_metadata: Record<string, unknown> | null
}

export interface ActaInspeccion {
  id: string
  resultado: 'APROBADA' | 'DISCREPANCIA'
  inspectorId: string
  aliadoId: string | null
  tallerId: string | null
  inspectorWallet: string
  firmaHash: string
  /** Firma digital (Web Crypto / PKCS#12), si el acta fue firmada. */
  firma: {
    algoritmo: string
    valor: string
    certSerie: string | null
    certFingerprint: string | null
    modo: string | null
  } | null
  notas: string | null
  discrepanciaMotivo: string | null
  aceleroPipeline: boolean
  createdAt: string
}

export interface BusquedaInspeccionResultado {
  encontrada: boolean
  autorizado: boolean
  /** Mensaje cuando no esta autorizado (aliado fuera de alcance) o no hay CIT. */
  aviso: string | null
  bicicleta?: {
    id: string
    marca: string
    modelo: string
    tipo: string
    numeroSerie: string
    anio: number | null
    color: string | null
    rodado: number | null
    talleCuadro: string | null
    /** Solo para inspector/admin (no se expone a un aliado). */
    titular: string | null
  }
  cit?: {
    id: string
    estado: string
    codigoCit: string
    hashSha256: string | null
    fechaVencimiento: string | null
    bfaEstado: string | null
    yaInspeccionada: boolean
  }
  pipeline?: {
    estado: string | null
    ejecutarEn: string | null
  } | null
  actas: ActaInspeccion[]
}

function nombreTitular(perfil: Record<string, unknown> | null): string | null {
  const p = perfil ?? {}
  const nombre = typeof p.nombre === 'string' ? p.nombre.trim() : ''
  return nombre || null
}

/**
 * Busca la bicicleta por numero de serie o codigo CIT y arma la vista del panel
 * de inspecciones, respetando el alcance del inspector (un aliado solo ve las
 * bicis vinculadas a sus servicios).
 */
export async function buscarParaInspeccion(
  terminoRaw: string,
  ctx: InspectorContexto
): Promise<BusquedaInspeccionResultado> {
  const termino = terminoRaw.trim().toUpperCase().replace(/\s+/g, '')
  if (!termino) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Ingresa un numero de serie o codigo CIT.')
  }

  const res = await getPool().query<FilaInspeccionBusqueda>(
    `
      SELECT
        b.id AS bici_id, b.marca, b.modelo, b.tipo, b.numero_serie, b.anio,
        b.color, b.rodado, b.talle_cuadro, b.propietario_id,
        u.datos_perfil AS titular_perfil,
        c.id AS cit_id, c.estado AS cit_estado, c.codigo_cit, c.hash_sha256,
        c.fecha_vencimiento, c.bfa_estado, c.metadata_json AS cit_metadata
      FROM bicicletas b
      LEFT JOIN usuarios u ON u.id = b.propietario_id
      LEFT JOIN LATERAL (
        SELECT *
        FROM cits c
        WHERE c.bicicleta_id = b.id
        ORDER BY
          CASE c.estado
            WHEN 'pendiente' THEN 0
            WHEN 'activo' THEN 1
            WHEN 'rechazado' THEN 2
            WHEN 'bloqueado' THEN 3
            ELSE 4
          END,
          c.creado_en DESC
        LIMIT 1
      ) c ON TRUE
      WHERE UPPER(b.numero_serie) = $1
         OR EXISTS (
              SELECT 1 FROM cits cc
              WHERE cc.bicicleta_id = b.id AND UPPER(cc.codigo_cit) = $1
            )
      ORDER BY CASE WHEN UPPER(b.numero_serie) = $1 THEN 0 ELSE 1 END
      LIMIT 1
    `,
    [termino]
  )

  const fila = res.rows[0]
  if (!fila) {
    return {
      encontrada: false,
      autorizado: false,
      aviso:
        'No hay ninguna bicicleta registrada con ese numero de serie o codigo CIT.',
      actas: [],
    }
  }

  const { autorizado } = await puedeInspeccionar(ctx, fila.bici_id)

  // Un aliado fuera de alcance no ve los datos de la bici: solo el aviso.
  if (!autorizado) {
    return {
      encontrada: true,
      autorizado: false,
      aviso:
        'Esta bicicleta no esta vinculada a tu taller. Solo podes inspeccionar las bicis que vendiste o mantuviste.',
      actas: [],
    }
  }

  const verTitular = ctx.rol === 'inspector' || ctx.rol === 'admin'

  // Historial de actas de inspeccion de la bici.
  const actasRes = await getPool().query<ActaRow>(
    `
      SELECT id, resultado, inspector_id, aliado_id, taller_id, inspector_wallet,
             firma_hash, firma_algoritmo, firma_valor, firma_cert_serie,
             firma_cert_fingerprint, firma_modo, notas, discrepancia_motivo,
             acelero_pipeline, created_at
      FROM inspecciones_fisicas
      WHERE bicicleta_id = $1
      ORDER BY created_at DESC
      LIMIT 20
    `,
    [fila.bici_id]
  )

  // Estado del pipeline de validacion del CIT (si hay uno).
  let pipeline: BusquedaInspeccionResultado['pipeline'] = null
  if (fila.cit_id) {
    const jobRes = await getPool().query<{ estado: string; ejecutar_en: string }>(
      `SELECT estado, ejecutar_en FROM cola_validaciones WHERE cit_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [fila.cit_id]
    )
    pipeline = jobRes.rows[0]
      ? { estado: jobRes.rows[0].estado, ejecutarEn: jobRes.rows[0].ejecutar_en }
      : null
  }

  const meta = fila.cit_metadata ?? {}
  const yaInspeccionada =
    typeof meta === 'object' && meta !== null && 'inspeccionFisica' in meta

  return {
    encontrada: true,
    autorizado: true,
    aviso: fila.cit_id
      ? null
      : 'Esta bicicleta todavia no tiene una solicitud de verificacion (CIT). El propietario debe solicitarla antes de la inspeccion fisica.',
    bicicleta: {
      id: fila.bici_id,
      marca: fila.marca,
      modelo: fila.modelo,
      tipo: fila.tipo,
      numeroSerie: fila.numero_serie,
      anio: fila.anio,
      color: fila.color,
      rodado: fila.rodado === null ? null : Number(fila.rodado),
      talleCuadro: fila.talle_cuadro,
      titular: verTitular ? nombreTitular(fila.titular_perfil) : null,
    },
    cit: fila.cit_id
      ? {
          id: fila.cit_id,
          estado: fila.cit_estado ?? 'pendiente',
          codigoCit: fila.codigo_cit ?? '',
          hashSha256: fila.hash_sha256,
          fechaVencimiento: fila.fecha_vencimiento,
          bfaEstado: fila.bfa_estado,
          yaInspeccionada,
        }
      : undefined,
    pipeline,
    actas: actasRes.rows.map(mapActa),
  }
}

interface ActaRow {
  id: string
  resultado: 'APROBADA' | 'DISCREPANCIA'
  inspector_id: string
  aliado_id: string | null
  taller_id: string | null
  inspector_wallet: string
  firma_hash: string
  firma_algoritmo: string | null
  firma_valor: string | null
  firma_cert_serie: string | null
  firma_cert_fingerprint: string | null
  firma_modo: string | null
  notas: string | null
  discrepancia_motivo: string | null
  acelero_pipeline: boolean
  created_at: string
}

function mapActa(r: ActaRow): ActaInspeccion {
  return {
    id: r.id,
    resultado: r.resultado,
    inspectorId: r.inspector_id,
    aliadoId: r.aliado_id,
    tallerId: r.taller_id,
    inspectorWallet: r.inspector_wallet,
    firmaHash: r.firma_hash,
    firma:
      r.firma_algoritmo && r.firma_valor
        ? {
            algoritmo: r.firma_algoritmo,
            valor: r.firma_valor,
            certSerie: r.firma_cert_serie,
            certFingerprint: r.firma_cert_fingerprint,
            modo: r.firma_modo,
          }
        : null,
    notas: r.notas,
    discrepanciaMotivo: r.discrepancia_motivo,
    aceleroPipeline: r.acelero_pipeline,
    createdAt: r.created_at,
  }
}

// ── Datos del CIT a inspeccionar (lock) ──────────────────────────────────────

interface CitInspeccionRow {
  cit_id: string
  cit_estado: string
  codigo_cit: string
  hash_sha256: string | null
  bicicleta_id: string
  numero_serie: string
  propietario_id: string
}

async function cargarCitParaInspeccion(
  client: DbClient,
  citId: string
): Promise<CitInspeccionRow> {
  const res = await client.query<CitInspeccionRow>(
    `
      SELECT c.id AS cit_id, c.estado AS cit_estado, c.codigo_cit, c.hash_sha256,
             b.id AS bicicleta_id, b.numero_serie, b.propietario_id
      FROM cits c
      JOIN bicicletas b ON b.id = c.bicicleta_id
      WHERE c.id = $1
      FOR UPDATE OF c
    `,
    [citId]
  )
  const row = res.rows[0]
  if (!row) {
    throw new ApiError(404, 'CIT_NOT_FOUND', 'No encontramos la cedula (CIT) a inspeccionar.')
  }
  return row
}

// ── Aprobar inspeccion fisica (acta + firma + acelerador del pipeline) ────────

export interface AprobacionResultado {
  inspeccionId: string
  resultado: 'APROBADA'
  firmaHash: string
  /** Firma digital del acta (Web Crypto / PKCS#12). */
  firma: {
    algoritmo: string
    valor: string
    modo: string
    certSerie: string
    certFingerprint: string
    commonName: string
  }
  tallerId: string | null
  inspectorId: string
  aceleroPipeline: boolean
  /** Estado final del CIT tras correr el pipeline acelerado. */
  citEstado: string
  /** true si el cross-reference de seguridad bloqueo la bici pese a la aprobacion. */
  bloqueadaPorSeguridad: boolean
  hashSha256: string | null
}

/**
 * Aprueba la inspeccion fisica de un CIT. La parte critica es ATOMICA (una sola
 * transaccion): registra el acta de auditoria (inspector_id + timestamp), la
 * firma con la wallet del inspector y ACELERA el pipeline de 72hs a 0hs.
 *
 * Tras confirmar la transaccion, dispara la decision del pipeline de inmediato
 * (cross-reference -> aprobacion -> hash -> anclaje en la BFA). El control de
 * seguridad (cross-reference) SIEMPRE corre: si la bici figura denunciada, queda
 * BLOQUEADA pese a la aprobacion fisica (la seguridad nunca se saltea).
 */
export async function aprobarInspeccionFisica(opts: {
  citId: string
  inspector: InspectorContexto
  aliadoId: string | null
  notas?: string | null
}): Promise<AprobacionResultado> {
  const { inspector } = opts
  const wallet = inspector.walletAddress
  if (!wallet) {
    throw new ApiError(
      409,
      'WALLET_REQUERIDA',
      'Configura tu wallet_address antes de aprobar inspecciones.'
    )
  }

  const emitidoEn = new Date().toISOString()
  const tallerId = opts.aliadoId

  const atomico = await withTx(async (client) => {
    const cit = await cargarCitParaInspeccion(client, opts.citId)

    // No se puede aprobar una bici reportada como robada.
    if (cit.cit_estado === 'bloqueado') {
      throw new ApiError(
        409,
        'CIT_BLOQUEADO',
        'Esta bicicleta figura bloqueada (reportada como robada). No se puede aprobar.'
      )
    }

    const payload = buildActaPayload({
      citId: cit.cit_id,
      codigoCit: cit.codigo_cit,
      numeroSerie: cit.numero_serie,
      hashIdentidad: cit.hash_sha256,
      resultado: 'APROBADA',
      inspectorId: inspector.id,
      walletAddress: wallet,
      tallerId,
      emitidoEn,
    })
    const firmaHash = firmaHashActa(payload)
    // Firma digital del acta con la Web Crypto API (clave del bundle PKCS#12).
    const firma: ActaFirmada = await firmarActa(payload)

    // 1. Acta de inspeccion (auditoria + firma digital).
    const inserted = await client.query<{ id: string }>(
      `
        INSERT INTO inspecciones_fisicas
          (cit_id, bicicleta_id, inspector_id, aliado_id, taller_id, resultado,
           inspector_wallet, firma_hash, firma_algoritmo, firma_valor,
           firma_certificado, firma_cert_serie, firma_cert_fingerprint, firma_modo,
           notas, acelero_pipeline, metadata)
        VALUES ($1, $2, $3, $4, $5, 'APROBADA', $6, $7, $8, $9, $10, $11, $12, $13,
                $14, TRUE, $15::jsonb)
        RETURNING id
      `,
      [
        cit.cit_id,
        cit.bicicleta_id,
        inspector.id,
        opts.aliadoId,
        tallerId,
        wallet,
        firmaHash,
        firma.algoritmo,
        firma.valor,
        firma.certificadoPem,
        firma.certSerie,
        firma.certFingerprint,
        firma.modo,
        opts.notas ?? null,
        JSON.stringify({
          emitidoEn,
          inspectorNombre: inspector.nombre,
          canonico: firma.canonico,
        }),
      ]
    )

    // 2. Sella la aprobacion fisica en el CIT (para el certificado + auditoria).
    await client.query(
      `
        UPDATE cits
        SET metadata_json = metadata_json || $2::jsonb,
            actualizado_en = NOW()
        WHERE id = $1
      `,
      [
        cit.cit_id,
        JSON.stringify({
          inspeccionFisica: {
            resultado: 'APROBADA',
            inspectorId: inspector.id,
            inspectorNombre: inspector.nombre,
            walletAddress: wallet,
            aliadoId: opts.aliadoId,
            tallerId,
            aliadoNombre: inspector.aliado?.nombre ?? null,
            firmaHash,
            firmaAlgoritmo: firma.algoritmo,
            firmaModo: firma.modo,
            certSerie: firma.certSerie,
            certFingerprint: firma.certFingerprint,
            aprobadaEn: emitidoEn,
          },
        }),
      ]
    )

    // 3. Acelerador: la ventana de 72hs se reduce a 0 (ejecutar ahora).
    const jobRes = await client.query<{ id: string }>(
      `
        UPDATE cola_validaciones
        SET ejecutar_en = NOW(), proximo_intento_en = NULL, updated_at = NOW()
        WHERE cit_id = $1 AND estado = 'PENDIENTE'
        RETURNING id
      `,
      [opts.citId]
    )

    return {
      inspeccionId: inserted.rows[0].id,
      firmaHash,
      firma,
      jobId: jobRes.rows[0]?.id ?? null,
      citEstadoPrevio: cit.cit_estado,
      hashSha256: cit.hash_sha256,
      numeroSerie: cit.numero_serie,
      propietarioId: cit.propietario_id,
      codigoCit: cit.codigo_cit,
    }
  })

  // Fuera de la transaccion: dispara la decision del pipeline de inmediato.
  let citEstado = atomico.citEstadoPrevio
  let bloqueada = false
  let hashSha256 = atomico.hashSha256

  let jobId = atomico.jobId
  // Si no habia un job vivo y el CIT sigue pendiente, lo encolamos para correrlo.
  if (!jobId && atomico.citEstadoPrevio === 'pendiente') {
    try {
      const job = await encolarValidacion(opts.citId, { ventanaHoras: 0 })
      jobId = job.id
    } catch (error) {
      console.error('[inspeccion] no se pudo encolar el CIT para acelerar', error)
    }
  }

  if (jobId) {
    const resultado: ProcesarJobResultado = await procesarJob(jobId, {
      ignorarVentana: true,
    })
    if (resultado.estado === 'APROBADO') {
      citEstado = 'activo'
      hashSha256 = resultado.hash ?? hashSha256
    } else if (resultado.estado === 'BLOQUEADO') {
      citEstado = 'bloqueado'
      bloqueada = true
    }
  } else if (atomico.citEstadoPrevio === 'activo') {
    // CIT ya verificado: aseguramos el anclaje en la BFA (best-effort) para que
    // el acta quede tambien anclada on-chain.
    citEstado = 'activo'
    if (hashSha256) {
      anclarCITEnSegundoPlano(opts.citId, hashSha256, atomico.numeroSerie)
    }
  }

  // Hito 10: avisar al propietario que un inspector firmo el acta fisica de su
  // bici (best-effort). No se notifica si la unidad quedo bloqueada por robo.
  if (!bloqueada) {
    await emitirEvento({
      tipo: 'inspeccion.acta_firmada',
      usuarioId: atomico.propietarioId,
      data: {
        citId: opts.citId,
        codigoCit: atomico.codigoCit,
        aliadoNombre: inspector.aliado?.nombre ?? null,
        inspectorNombre: inspector.nombre,
      },
    })
  }

  return {
    inspeccionId: atomico.inspeccionId,
    resultado: 'APROBADA',
    firmaHash: atomico.firmaHash,
    firma: {
      algoritmo: atomico.firma.algoritmo,
      valor: atomico.firma.valor,
      modo: atomico.firma.modo,
      certSerie: atomico.firma.certSerie,
      certFingerprint: atomico.firma.certFingerprint,
      commonName: atomico.firma.commonName,
    },
    tallerId,
    inspectorId: inspector.id,
    aceleroPipeline: true,
    citEstado,
    bloqueadaPorSeguridad: bloqueada,
    hashSha256,
  }
}

// ── Reportar discrepancia ────────────────────────────────────────────────────

export interface DiscrepanciaResultado {
  inspeccionId: string
  resultado: 'DISCREPANCIA'
  firmaHash: string
  firma: {
    algoritmo: string
    valor: string
    modo: string
    certSerie: string
    certFingerprint: string
    commonName: string
  }
  tallerId: string | null
  inspectorId: string
  citEstado: string
}

/**
 * Reporta una discrepancia en la inspeccion fisica: registra el acta y FRENA la
 * verificacion. El CIT pasa a 'rechazado' y el job del pipeline se manda a ERROR
 * (no se auto-aprobara). El propietario debera resolver y volver a solicitar.
 */
export async function reportarDiscrepancia(opts: {
  citId: string
  inspector: InspectorContexto
  aliadoId: string | null
  motivo: string
}): Promise<DiscrepanciaResultado> {
  const { inspector } = opts
  const wallet = inspector.walletAddress
  if (!wallet) {
    throw new ApiError(
      409,
      'WALLET_REQUERIDA',
      'Configura tu wallet_address antes de reportar inspecciones.'
    )
  }
  const motivo = opts.motivo.trim()
  if (!motivo) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Indica el motivo de la discrepancia.')
  }

  const emitidoEn = new Date().toISOString()
  const tallerId = opts.aliadoId

  return withTx(async (client) => {
    const cit = await cargarCitParaInspeccion(client, opts.citId)

    const payload = buildActaPayload({
      citId: cit.cit_id,
      codigoCit: cit.codigo_cit,
      numeroSerie: cit.numero_serie,
      hashIdentidad: cit.hash_sha256,
      resultado: 'DISCREPANCIA',
      inspectorId: inspector.id,
      walletAddress: wallet,
      tallerId,
      emitidoEn,
    })
    const firmaHash = firmaHashActa(payload)
    const firma: ActaFirmada = await firmarActa(payload)

    const inserted = await client.query<{ id: string }>(
      `
        INSERT INTO inspecciones_fisicas
          (cit_id, bicicleta_id, inspector_id, aliado_id, taller_id, resultado,
           inspector_wallet, firma_hash, firma_algoritmo, firma_valor,
           firma_certificado, firma_cert_serie, firma_cert_fingerprint, firma_modo,
           discrepancia_motivo, metadata)
        VALUES ($1, $2, $3, $4, $5, 'DISCREPANCIA', $6, $7, $8, $9, $10, $11, $12,
                $13, $14, $15::jsonb)
        RETURNING id
      `,
      [
        cit.cit_id,
        cit.bicicleta_id,
        inspector.id,
        opts.aliadoId,
        tallerId,
        wallet,
        firmaHash,
        firma.algoritmo,
        firma.valor,
        firma.certificadoPem,
        firma.certSerie,
        firma.certFingerprint,
        firma.modo,
        motivo,
        JSON.stringify({
          emitidoEn,
          inspectorNombre: inspector.nombre,
          canonico: firma.canonico,
        }),
      ]
    )

    // El CIT se rechaza: la discrepancia frena la verificacion.
    await client.query(
      `
        UPDATE cits
        SET estado = 'rechazado',
            metadata_json = metadata_json || $2::jsonb,
            actualizado_en = NOW()
        WHERE id = $1
      `,
      [
        cit.cit_id,
        JSON.stringify({
          inspeccionFisica: {
            resultado: 'DISCREPANCIA',
            inspectorId: inspector.id,
            inspectorNombre: inspector.nombre,
            walletAddress: wallet,
            aliadoId: opts.aliadoId,
            tallerId,
            aliadoNombre: inspector.aliado?.nombre ?? null,
            firmaHash,
            firmaAlgoritmo: firma.algoritmo,
            firmaModo: firma.modo,
            certSerie: firma.certSerie,
            certFingerprint: firma.certFingerprint,
            motivo,
            reportadaEn: emitidoEn,
          },
        }),
      ]
    )

    // Frena el pipeline: el job no debe auto-aprobar tras una discrepancia.
    await client.query(
      `
        UPDATE cola_validaciones
        SET estado = 'ERROR',
            ultimo_error = $2,
            proximo_intento_en = NULL,
            updated_at = NOW()
        WHERE cit_id = $1 AND estado IN ('PENDIENTE', 'EN_PROCESO')
      `,
      [opts.citId, `Discrepancia en inspeccion fisica: ${motivo}`.slice(0, 480)]
    )

    return {
      inspeccionId: inserted.rows[0].id,
      resultado: 'DISCREPANCIA' as const,
      firmaHash,
      firma: {
        algoritmo: firma.algoritmo,
        valor: firma.valor,
        modo: firma.modo,
        certSerie: firma.certSerie,
        certFingerprint: firma.certFingerprint,
        commonName: firma.commonName,
      },
      tallerId,
      inspectorId: inspector.id,
      citEstado: 'rechazado',
    }
  })
}

// ── Verificacion de la firma de un acta ──────────────────────────────────────

export interface VerificacionActa {
  actaId: string
  resultado: 'APROBADA' | 'DISCREPANCIA'
  valido: boolean
  algoritmo: string | null
  modo: string | null
  certSerie: string | null
  certFingerprint: string | null
  commonName: string | null
  inspectorId: string
  tallerId: string | null
  emitidoEn: string | null
}

interface ActaVerificacionRow {
  id: string
  resultado: 'APROBADA' | 'DISCREPANCIA'
  inspector_id: string
  taller_id: string | null
  firma_algoritmo: string | null
  firma_valor: string | null
  firma_certificado: string | null
  firma_cert_serie: string | null
  firma_cert_fingerprint: string | null
  firma_modo: string | null
  metadata: { canonico?: string; emitidoEn?: string } | null
  created_at: string
}

/**
 * Verifica la firma digital de un acta de inspeccion (validez legal). Recompone
 * el texto canonico firmado (guardado en el acta) y valida la firma con la Web
 * Crypto API contra el certificado embebido — verificacion offline autocontenida.
 * Respeta el alcance del inspector: un aliado solo verifica sus actas.
 */
export async function verificarActaPorId(
  actaId: string,
  ctx: InspectorContexto
): Promise<VerificacionActa> {
  const res = await getPool().query<ActaVerificacionRow & { bicicleta_id: string }>(
    `
      SELECT id, resultado, inspector_id, taller_id, bicicleta_id,
             firma_algoritmo, firma_valor, firma_certificado, firma_cert_serie,
             firma_cert_fingerprint, firma_modo, metadata, created_at
      FROM inspecciones_fisicas
      WHERE id = $1
      LIMIT 1
    `,
    [actaId]
  )
  const row = res.rows[0]
  if (!row) {
    throw new ApiError(404, 'ACTA_NOT_FOUND', 'No encontramos el acta a verificar.')
  }

  const { autorizado } = await puedeInspeccionar(ctx, row.bicicleta_id)
  if (!autorizado) {
    throw new ApiError(
      403,
      'FUERA_DE_ALCANCE',
      'No podes verificar el acta de una bicicleta fuera de tu alcance.'
    )
  }

  const canonico = row.metadata?.canonico ?? null
  const base: VerificacionActa = {
    actaId: row.id,
    resultado: row.resultado,
    valido: false,
    algoritmo: row.firma_algoritmo,
    modo: row.firma_modo,
    certSerie: row.firma_cert_serie,
    certFingerprint: row.firma_cert_fingerprint,
    commonName: null,
    inspectorId: row.inspector_id,
    tallerId: row.taller_id,
    emitidoEn: row.metadata?.emitidoEn ?? row.created_at,
  }

  if (!canonico || !row.firma_valor || !row.firma_certificado) {
    // Acta historica sin firma digital (solo huella SHA-256): no verificable aqui.
    return base
  }

  const verif = await verificarFirmaCanonica({
    canonico,
    firmaBase64: row.firma_valor,
    certificadoPem: row.firma_certificado,
  })

  return { ...base, valido: verif.valido, commonName: verif.commonName }
}
