import { randomUUID } from 'node:crypto'
import { getStore } from '@netlify/blobs'
import { ApiError, getPool, type DbClient } from '@/lib/marketplace'
import type { UsuarioRol } from '@/lib/auth'
import {
  encolarValidacion,
  procesarJob,
  type ProcesarJobResultado,
} from '@/src/services/validation.service'
import { anclarCITEnSegundoPlano } from '@/src/services/blockchain.service'
import { emitirEvento } from '@/src/services/notification.service'
import { registrarLiquidacionAliadoFeeVerificacion } from '@/src/services/compensaciones.service'
import { enviarEmail } from '@/lib/email'
import { cifrarBytesInspeccion } from '@/src/services/cifrado.service'
import {
  PUNTOS_CON_COMPONENTE,
  PUNTOS_INSPECCION,
  PUNTOS_PREMIUM_CON_COMPONENTE,
  PUNTOS_INSPECCION_PREMIUM,
  type ChecklistInspeccion,
} from '@/lib/puntos-inspeccion'
import {
  firmarActa,
  firmaHashActa,
  verificarFirmaCanonica,
  type ActaFirmada,
  type ActaPayload,
} from '@/src/services/acta-firma.service'

// Bucket CIFRADO de fotos de componentes tokenizados (Checklist 20 puntos).
const STORE_INSPECCIONES = 'rodaid-inspecciones-componentes'

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
  aliado: { id: string; nombre: string; tipo: string } | null
  modoVista: ModoVistaAliado
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
 * Sube una foto de componente tokenizado (cifrada en reposo) al bucket
 * dedicado. Mismo patron que `subirPdfCifrado` en denuncia-mpf.service.ts,
 * pero con su propia clave/bucket -- ver cifrado.service.ts.
 */
async function subirFotoComponenteCifrada(key: string, bytes: Uint8Array): Promise<void> {
  const cifrado = cifrarBytesInspeccion(bytes)
  const ab = cifrado.buffer.slice(
    cifrado.byteOffset,
    cifrado.byteOffset + cifrado.byteLength
  ) as ArrayBuffer
  await getStore(STORE_INSPECCIONES).set(key, ab)
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
  tipo: string
}

/** Aliado APROBADO cuya cuenta duena es `usuarioId` (o null si no tiene). */
export async function resolverAliadoDeUsuario(
  usuarioId: string
): Promise<{ id: string; nombre: string; tipo: string } | null> {
  const res = await getPool().query<AliadoRow>(
    `
      SELECT id, nombre, tipo FROM aliados
      WHERE usuario_id = $1 AND estado = 'aprobado'
      ORDER BY resuelto_en DESC NULLS LAST, created_at DESC
      LIMIT 1
    `,
    [usuarioId]
  )
  return res.rows[0] ?? null
}

export type ModoVistaAliado = 'propio' | 'ver_como' | 'vista_previa'

export interface ResolucionAliadoLectura {
  aliado: { id: string; nombre: string; tipo: string } | null
  modo: ModoVistaAliado
}

/**
 * Resuelve el aliado para una LECTURA (contexto, busqueda, estado de
 * publicacion) -- NUNCA para una escritura, que sigue exigiendo
 * resolverAliadoDeUsuario()/resolverAliadoIdDelUsuario() (dueno real via
 * usuario_id). Es la unica pieza que interpreta `aliadoIdSolicitado` -- el
 * parametro "ver como" que un admin puede pasar para inspeccionar
 * visualmente el panel de un aliado real, de solo lectura.
 *
 *   - rol 'aliado'  -> ignora aliadoIdSolicitado, resuelve su propio perfil
 *                      (modo 'propio', igual que siempre).
 *   - rol 'admin' + aliadoIdSolicitado -> ese aliado real (debe existir y
 *                      estar aprobado), modo 'ver_como'. Gana siempre que se
 *                      mande, incluso si el admin tiene tambien un aliado
 *                      propio vinculado.
 *   - rol 'admin' sin aliadoIdSolicitado -> primero chequea si ese admin
 *                      tiene un aliado propio real y aprobado vinculado a su
 *                      propia cuenta (mismo chequeo que la rama 'aliado', via
 *                      resolverAliadoDeUsuario()) -> si lo tiene, modo
 *                      'propio' con ese aliado. Si no, aliado null, modo
 *                      'vista_previa' (el caller arma datos de ejemplo, sin
 *                      tocar `aliados`).
 *   - cualquier otro rol (p. ej. 'inspector') -> aliado null, modo 'propio'
 *                      (mismo comportamiento que hoy: no tiene taller propio).
 */
export async function resolverAliadoParaLectura(
  user: { id: string; rol: string },
  aliadoIdSolicitado: string | null
): Promise<ResolucionAliadoLectura> {
  if (user.rol === 'aliado') {
    return { aliado: await resolverAliadoDeUsuario(user.id), modo: 'propio' }
  }
  if (user.rol === 'admin' && aliadoIdSolicitado) {
    const res = await getPool().query<AliadoRow>(
      `SELECT id, nombre, tipo FROM aliados WHERE id = $1 AND estado = 'aprobado' LIMIT 1`,
      [aliadoIdSolicitado]
    )
    return { aliado: res.rows[0] ?? null, modo: 'ver_como' }
  }
  if (user.rol === 'admin') {
    const propio = await resolverAliadoDeUsuario(user.id)
    if (propio) {
      return { aliado: propio, modo: 'propio' }
    }
    return { aliado: null, modo: 'vista_previa' }
  }
  return { aliado: null, modo: 'propio' }
}

interface InspectorPerfilRow {
  id: string
  rol: UsuarioRol
  wallet_address: string | null
  datos_perfil: Record<string, unknown> | null
}

/**
 * Carga el contexto de inspeccion de un usuario: su rol, su wallet (identidad
 * digital) y su aliado (propio, "ver como", o vista previa). Lanza si el
 * usuario no existe.
 */
export async function cargarInspectorContexto(
  usuarioId: string,
  aliadoIdSolicitado: string | null = null
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

  // 'inspector' nunca tiene taller propio -- mismo comportamiento de siempre.
  // aliadoIdSolicitado solo se interpreta para 'aliado'/'admin' (ver
  // resolverAliadoParaLectura). CRITICO: el POST de aprobar/discrepancia
  // (mas abajo, via autorizarCitParaInspeccion) llama a esta funcion SIN
  // pasar aliadoIdSolicitado nunca -- asi que un admin en modo "ver como"
  // (impersonando a otro aliado via el selector) jamas puede firmar un acta
  // atribuida a ese aliado. Si el admin tiene su PROPIO aliado real vinculado
  // a su cuenta (resolverAliadoDeUsuario(user.id) lo encuentra), en cambio,
  // queda en modo 'propio' con ese aliado -- y sus aprobaciones SI quedan
  // atribuidas a el, igual que si hubiera iniciado sesion con rol 'aliado'
  // (fix 2026-07-13: antes, cualquier admin firmaba siempre con aliado_id
  // NULL, incluso si tenia un taller real propio vinculado).
  if (row.rol !== 'aliado' && row.rol !== 'admin') {
    return {
      id: row.id,
      rol: row.rol,
      nombre,
      walletAddress: row.wallet_address,
      aliado: null,
      modoVista: 'propio',
    }
  }

  const { aliado, modo } = await resolverAliadoParaLectura(
    { id: row.id, rol: row.rol },
    aliadoIdSolicitado
  )
  return {
    id: row.id,
    rol: row.rol,
    nombre,
    walletAddress: row.wallet_address,
    aliado,
    modoVista: modo,
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
 * a registrar en el acta. Lanza 404 si el CIT no existe, 403 TIPO_ALIADO_NO_
 * HABILITADO si el aliado no es de tipo 'taller' (decision de producto
 * confirmada con Federico 2026-07-21: solo un taller tiene capacidad mecanica
 * real para certificar una inspeccion fisica de 20 puntos -- una 'tienda'
 * puede seguir siendo aliado, aparecer en el directorio y vender servicios,
 * pero no puede sellar), y 403 FUERA_DE_ALCANCE si esta fuera de alcance (un
 * aliado taller sobre una bici que no es suya).
 *
 * Deliberadamente NO se mete el chequeo de tipo dentro de puedeInspeccionar():
 * esa funcion tambien la usan la busqueda del panel (aviso suave, no bloqueo
 * duro) y verificarActaPorId() (ver un acta YA firmada, una accion de lectura
 * distinta a sellar una nueva) -- el gate de tipo aplica solo a las dos
 * acciones que realmente firman/sellan (aprobarInspeccionFisica() /
 * reportarDiscrepancia()), ambas via este mismo punto de entrada.
 */
export async function autorizarCitParaInspeccion(
  ctx: InspectorContexto,
  citId: string
): Promise<{ aliadoId: string | null }> {
  if (ctx.rol === 'aliado' && ctx.aliado && ctx.aliado.tipo !== 'taller') {
    throw new ApiError(
      403,
      'TIPO_ALIADO_NO_HABILITADO',
      'Tu perfil de aliado no tiene capacidad mecánica registrada (tipo taller) -- no podés certificar inspecciones físicas.'
    )
  }
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
  suspension_trasera: boolean | null
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
    /** NULL = no declarado todavía. Distinto de FALSE (confirmado rígida). */
    suspensionTrasera: boolean | null
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
        b.color, b.rodado, b.talle_cuadro, b.suspension_trasera, b.propietario_id,
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
          c.acunado_en DESC
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
      suspensionTrasera: fila.suspension_trasera,
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
  /** Fase 4: transicion de marketplace_publicaciones sellada por esta aprobacion, si habia una publicacion esperando. */
  marketplaceTransicion: {
    publicacionId: string
    estadoAnterior: string
    estadoNuevo: string
  } | null
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
  /** Checklist de 20 puntos (Hito "CIT Completo Plus"). Opcional: un caller
   * que no lo envia sigue el camino legacy (solo veredicto + notas libres). */
  checklist?: ChecklistInspeccion | null
  /** Checklist Premium (PR01-PR08, suspensión/e-bike) -- opcional, solo
   * disponible cuando `checklist` tambien esta presente (nunca standalone).
   * Nunca gatea aprobada/DISCREPANCIA -- ver puntos-inspeccion.ts. */
  checklistPremium?: ChecklistInspeccion | null
  /** Fotos de componentes tokenizados, keyeadas por puntoId (P06/P08/P09/
   * P11/P12/PR01..PR08). Solo se suben las que efectivamente vengan. */
  fotosPorPunto?: Record<string, Blob> | null
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
  // "Plus" = se uso el checklist de 20 puntos (habilita la captura de
  // componentes), independientemente de si algun punto termino con datos --
  // un inspector puede activar el modulo y no encontrar un serial legible
  // ese dia. Esta es la unica senal confiable: la presencia de filas en
  // componentes_tokenizados NO alcanza (ver auditoria previa a esta migracion).
  const moduloComponentes = Boolean(opts.checklist)
  // Mismo criterio que moduloComponentes, pero para el módulo premium
  // (PR01-PR08) -- solo tiene sentido si el checklist base también está
  // presente (nunca se ofrece el módulo premium fuera del flujo Plus).
  const moduloPremium = Boolean(opts.checklist) && Boolean(opts.checklistPremium)

  // Subida de fotos de componentes ANTES de la transaccion (mismo orden que
  // denuncia-mpf.service.ts::subirPdfCifrado): I/O externo primero, para no
  // sostener la transaccion abierta mientras se sube un blob. Si algo falla
  // acá, no se toca la base todavia.
  const fotoBlobKeys: Record<string, string> = {}
  if (opts.fotosPorPunto) {
    for (const [puntoId, blob] of Object.entries(opts.fotosPorPunto)) {
      const esComponenteValido =
        PUNTOS_CON_COMPONENTE.includes(puntoId as (typeof PUNTOS_CON_COMPONENTE)[number]) ||
        PUNTOS_PREMIUM_CON_COMPONENTE.includes(puntoId as (typeof PUNTOS_PREMIUM_CON_COMPONENTE)[number])
      if (!esComponenteValido) continue
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const key = `inspecciones/${opts.citId}/${puntoId}-${randomUUID()}.jpg.enc`
        await subirFotoComponenteCifrada(key, bytes)
        fotoBlobKeys[puntoId] = key
      } catch (error) {
        console.error('[inspeccion] no se pudo guardar la foto del componente', error)
        throw new ApiError(
          502,
          'STORAGE_ERROR',
          'No pudimos guardar una de las fotos del componente. Probá de nuevo.'
        )
      }
    }
  }

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
           notas, acelero_pipeline, metadata, checklist_detalle, modulo_componentes,
           modulo_premium)
        VALUES ($1, $2, $3, $4, $5, 'APROBADA', $6, $7, $8, $9, $10, $11, $12, $13,
                $14, TRUE, $15::jsonb, $16::jsonb, $17, $18)
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
        // checklist_detalle mezcla el checklist base (P01-P20) y el premium
        // (PR01-PR08) en el mismo objeto plano -- misma columna JSONB,
        // ambos comparten shape {resultado, nota?, componente?} y ninguno
        // necesita distinguirse a nivel de storage (calcularResultadoChecklist()
        // solo lee las claves P01-P20 de todas formas, ver puntos-inspeccion.ts).
        opts.checklist
          ? JSON.stringify({ ...opts.checklist, ...(opts.checklistPremium ?? {}) })
          : null,
        moduloComponentes,
        moduloPremium,
      ]
    )
    const inspeccionId = inserted.rows[0].id

    // 1b. Componentes tokenizados ("CIT Completo Plus"): solo para los 5
    // puntos de alto valor, y solo si el inspector efectivamente cargo algo
    // (marca, modelo, numero de serie o foto) -- no se inserta una fila
    // vacia por cada punto en cada inspeccion.
    if (opts.checklist) {
      for (const puntoId of PUNTOS_CON_COMPONENTE) {
        const punto = PUNTOS_INSPECCION.find((p) => p.id === puntoId)
        const comp = opts.checklist[puntoId]?.componente
        const fotoBlobKey = fotoBlobKeys[puntoId] ?? null
        const marca = comp?.marca?.trim() || null
        const modelo = comp?.modelo?.trim() || null
        const numeroSerie = comp?.numeroSerie?.trim() || null
        if (!punto || (!marca && !modelo && !numeroSerie && !fotoBlobKey)) continue

        if (numeroSerie) {
          const dup = await client.query<{ id: string }>(
            `SELECT id FROM componentes_tokenizados WHERE numero_serie = $1 LIMIT 1`,
            [numeroSerie]
          )
          if (dup.rowCount) {
            throw new ApiError(
              409,
              'NUMERO_SERIE_DUPLICADO_COMPONENTE',
              `Ya existe un componente tokenizado con el número de serie "${numeroSerie}" en otra bicicleta.`
            )
          }
        }

        await client.query(
          `
            INSERT INTO componentes_tokenizados
              (inspeccion_id, bicicleta_id, punto_id, categoria, marca, modelo,
               numero_serie, foto_blob_key)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [inspeccionId, cit.bicicleta_id, puntoId, punto.categoria, marca, modelo, numeroSerie, fotoBlobKey]
        )
      }
    }

    // 1c. Componentes tokenizados PREMIUM (PR01-PR08, suspensión/e-bike):
    // mismo mecanismo que 1b -- los 8 SIEMPRE son candidatos a componente
    // (a diferencia de los 5-de-20 base), y solo se insertan si el
    // inspector efectivamente cargo algo. `especificaciones` solo lo
    // completan PR07 (motor) y PR08 (batería).
    if (opts.checklist && opts.checklistPremium) {
      for (const puntoId of PUNTOS_PREMIUM_CON_COMPONENTE) {
        const punto = PUNTOS_INSPECCION_PREMIUM.find((p) => p.id === puntoId)
        const comp = opts.checklistPremium[puntoId]?.componente
        const fotoBlobKey = fotoBlobKeys[puntoId] ?? null
        const marca = comp?.marca?.trim() || null
        const modelo = comp?.modelo?.trim() || null
        const numeroSerie = comp?.numeroSerie?.trim() || null
        const especificaciones = comp?.especificaciones ?? null
        if (!punto || (!marca && !modelo && !numeroSerie && !fotoBlobKey && !especificaciones)) continue

        if (numeroSerie) {
          const dup = await client.query<{ id: string }>(
            `SELECT id FROM componentes_tokenizados WHERE numero_serie = $1 LIMIT 1`,
            [numeroSerie]
          )
          if (dup.rowCount) {
            throw new ApiError(
              409,
              'NUMERO_SERIE_DUPLICADO_COMPONENTE',
              `Ya existe un componente tokenizado con el número de serie "${numeroSerie}" en otra bicicleta.`
            )
          }
        }

        await client.query(
          `
            INSERT INTO componentes_tokenizados
              (inspeccion_id, bicicleta_id, punto_id, categoria, marca, modelo,
               numero_serie, foto_blob_key, especificaciones)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
          `,
          [
            inspeccionId,
            cit.bicicleta_id,
            puntoId,
            punto.categoria,
            marca,
            modelo,
            numeroSerie,
            fotoBlobKey,
            especificaciones ? JSON.stringify(especificaciones) : null,
          ]
        )
      }
    }

    // 2. Sella la aprobacion fisica en el CIT (para el certificado + auditoria).
    await client.query(
      `
        UPDATE cits
        SET metadata_json = metadata_json || $2::jsonb,
            updated_at = NOW()
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

    // 4. Fase 4 (CIT Completo): si esta bici tiene una publicacion de
    //    Marketplace esperando esta certificacion, sellarla.
    //    PUBLICADO_PENDIENTE_CERTIFICACION -> PUBLICADO_CERTIFICADO (nadie
    //    esperando comprar todavia); RESERVADO -> EJECUTANDO_LOGISTICA (ya hay
    //    un comprador con la sena puesta financiando esta verificacion).
    //    Cualquier otro estado (incluida una publicacion inexistente) es un
    //    no-op: una re-inspeccion de una bici ya certificada/vendida no hace
    //    nada. FOR UPDATE evita una carrera con un reserve/cancel simultaneo.
    const publicacionRes = await client.query<{ id: string; estado: string }>(
      `
        SELECT id, estado FROM marketplace_publicaciones
        WHERE cit_id = $1
          AND estado IN ('PUBLICADO_PENDIENTE_CERTIFICACION', 'RESERVADO')
        FOR UPDATE
      `,
      [cit.cit_id]
    )
    const publicacion = publicacionRes.rows[0]
    let marketplaceTransicion:
      | { publicacionId: string; estadoAnterior: string; estadoNuevo: string }
      | null = null

    if (publicacion) {
      const estadoNuevo =
        publicacion.estado === 'RESERVADO' ? 'EJECUTANDO_LOGISTICA' : 'PUBLICADO_CERTIFICADO'

      await client.query(
        `
          UPDATE marketplace_publicaciones
          SET estado = $2, inspeccion_sellado_id = $3
          WHERE id = $1
        `,
        [publicacion.id, estadoNuevo, inserted.rows[0].id]
      )

      marketplaceTransicion = {
        publicacionId: publicacion.id,
        estadoAnterior: publicacion.estado,
        estadoNuevo,
      }

      // Fase 6: si esta reserva tiene una sena confirmada financiando la
      // verificacion, el sellado es el momento (y el UNICO momento, ver
      // registrarLiquidacionAliadoFeeVerificacion) en que se le debe el Fee
      // de Verificacion al Taller Aliado -- sin importar si la venta despues
      // se concreta o la reserva vence. Best-effort respecto al flujo
      // principal: si por algun motivo no hay una escrow_transaccion
      // RESERVADA (no deberia pasar si el orden del flujo se respeto), no se
      // bloquea la aprobacion de la inspeccion por esto.
      if (publicacion.estado === 'RESERVADO') {
        const escrowRes = await client.query<{
          id: string
          aliado_id: string | null
          fee_verificacion_ars: string
        }>(
          `
            SELECT id, aliado_id, fee_verificacion_ars
            FROM escrow_transacciones
            WHERE publicacion_id = $1 AND estado = 'RESERVADA'
            FOR UPDATE
          `,
          [publicacion.id]
        )
        const escrow = escrowRes.rows[0]
        if (escrow?.aliado_id && Number(escrow.fee_verificacion_ars) > 0) {
          await registrarLiquidacionAliadoFeeVerificacion(client, {
            escrowTransaccionId: escrow.id,
            aliadoId: escrow.aliado_id,
            monto: Number(escrow.fee_verificacion_ars),
          })
        }
      }
    }

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
      marketplaceTransicion,
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


  // Email felicitaciones CIT al propietario
  if (!bloqueada && atomico.propietarioId) {
    try {
      const { getPool } = await import('@/lib/marketplace')
      const pool = getPool()
      const userRes = await pool.query('SELECT email, datos_perfil FROM usuarios WHERE id = $1', [atomico.propietarioId])
      const row = userRes.rows[0]
      if (row?.email) {
        const nombre = row.datos_perfil?.nombre ?? 'Ciclista'
        const logoB64 = require('fs').readFileSync(process.cwd() + '/public/logo-rodaid.jpeg').toString('base64')
        await enviarEmail({
          to: row.email,
          subject: '🎉 Felicitaciones! Obtuviste tu CIT RODAID',
          html: '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#f7f6f3;"><div style="background:#0F1E35;padding:32px;text-align:center;"><img src="data:image/jpeg;base64,' + logoB64 + '" alt="RODAID" style="height:70px;border-radius:12px;margin-bottom:12px;" /><h1 style="color:white;margin:0;font-size:32px;font-weight:900;">RODAID</h1><p style="color:#2BBCB8;margin:6px 0 0;">Certificado de Identidad Técnica</p></div><div style="padding:32px;"><div style="background:white;padding:28px;border-radius:16px;text-align:center;"><div style="font-size:64px;margin-bottom:16px;">🎉</div><h2 style="color:#0F1E35;margin:0 0 8px;">Felicitaciones ' + nombre + '!</h2><p style="color:#555;line-height:1.7;margin-bottom:20px;">Tu bicicleta obtuvo su <strong>Certificado de Identidad Técnica (CIT)</strong> oficial de RODAID. Tu rodado ahora tiene identidad digital verificada en la <strong>Blockchain Federal Argentina</strong>.</p><div style="background:#f0fafa;padding:20px;border-radius:12px;margin:20px 0;border:2px solid #2BBCB8;"><p style="margin:0;color:#0F1E35;font-weight:700;font-size:18px;">Codigo CIT</p><p style="margin:8px 0 0;font-family:monospace;font-size:20px;color:#2BBCB8;font-weight:700;">' + atomico.codigoCit + '</p></div><div style="margin-top:24px;"><a href="https://rodaid.net/garaje" style="background:#F47B20;color:white;padding:14px 32px;border-radius:999px;text-decoration:none;font-weight:700;font-size:15px;">Ver mi CIT en el Garaje</a></div></div></div><div style="background:#0F1E35;padding:20px;text-align:center;"><p style="color:#888;font-size:12px;margin:0;">RODAID · rodaid.net</p></div></div>'
        })
      }
    } catch (emailErr) {
      console.error('Error email CIT:', emailErr)
    }
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
    marketplaceTransicion: atomico.marketplaceTransicion,
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
  /** Checklist de 20 puntos que originó la discrepancia (URGENTE, fix
   * 2026-07-18): antes de esto, un inspector que rechazaba desde el
   * checklist completo perdia los 20 puntos de trabajo -- se persisten
   * igual que en aprobarInspeccionFisica(), pero deliberadamente SIN
   * insertar en componentes_tokenizados ni subir fotos (ver comentario mas
   * abajo, junto al INSERT). */
  checklist?: ChecklistInspeccion | null
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

    // Persiste el checklist igual que aprobarInspeccionFisica(), pero
    // deliberadamente NO inserta en componentes_tokenizados ni sube fotos:
    // tokenizar (con UNIQUE global) el serial de un componente de una
    // inspeccion RECHAZADA seria un vector para "ocupar" un serial legitimo
    // via una inspeccion rechazada armada a proposito. El checklist completo
    // igual queda preservado y auditable en checklist_detalle.
    const moduloComponentes = Boolean(opts.checklist)
    const inserted = await client.query<{ id: string }>(
      `
        INSERT INTO inspecciones_fisicas
          (cit_id, bicicleta_id, inspector_id, aliado_id, taller_id, resultado,
           inspector_wallet, firma_hash, firma_algoritmo, firma_valor,
           firma_certificado, firma_cert_serie, firma_cert_fingerprint, firma_modo,
           discrepancia_motivo, metadata, checklist_detalle, modulo_componentes)
        VALUES ($1, $2, $3, $4, $5, 'DISCREPANCIA', $6, $7, $8, $9, $10, $11, $12,
                $13, $14, $15::jsonb, $16::jsonb, $17)
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
        opts.checklist ? JSON.stringify(opts.checklist) : null,
        moduloComponentes,
      ]
    )

    // El CIT se rechaza: la discrepancia frena la verificacion.
    await client.query(
      `
        UPDATE cits
        SET estado = 'rechazado',
            metadata_json = metadata_json || $2::jsonb,
            updated_at = NOW()
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
