import { ApiError, getPool } from '@/lib/marketplace'
import { esCitCompleto } from '@/src/services/garaje.service'
import {
  calcularScoresConfianza,
  PUNTOS_CIT_COMPLETO,
  PUNTOS_CIT_EXPRESS,
  type InsumoScoreCit,
} from '@/src/services/score-confianza.service'
import {
  buscarYVerificar,
  type VerificacionVeredicto,
} from '@/src/services/verificacion.service'

/**
 * RODAID — Historial Clinico publico del Garaje Digital.
 *
 * Un dueño puede activar un link (y QR) publico y compartible por bici, para
 * pegar en Facebook Marketplace u otros canales externos. El link combina
 * datos que YA son seguros de publicar (CIT + fecha_emision,
 * bicisalud_resumen_publico, scoreConfianza total+badge, resumen de
 * inspecciones_fisicas) detras de un token de acceso propio (no el
 * codigo_cit ni el bicicleta_id interno -- ver CLAUDE.md, seccion
 * "Historial Clinico publico" para el porque).
 *
 * Opt-in explicito: `activarCompartir()` es la UNICA forma de que exista un
 * token -- no hay ningun flag de consentimiento separado. Revocar nunca
 * borra la fila (preserva vistas/historial); reactivar crea un token NUEVO,
 * asi que un link viejo filtrado en algun lado queda muerto para siempre.
 *
 * SEGURIDAD: si `buscarYVerificar()` devuelve el veredicto ROBADA, este
 * servicio corta ahi -- nunca agrega BiciSalud/score/inspecciones a una bici
 * denunciada. Mostrar un "historial lindo" de una bici robada ayudaria a
 * venderla mejor a un tercero de mala fe.
 */

export interface EstadoCompartir {
  activo: boolean
  token: string | null
  url: string | null
  activadoEn: string | null
  vistas: number
}

interface CompartidaRow {
  token: string
  activado_en: string
  vistas: number
}

interface BiciRow {
  id: string
  propietario_id: string
  numero_serie: string
}

async function obtenerBiciDelDueno(
  bicicletaId: string,
  usuarioId: string
): Promise<BiciRow> {
  const res = await getPool().query<BiciRow>(
    `SELECT id, propietario_id, numero_serie FROM bicicletas WHERE id = $1`,
    [bicicletaId]
  )
  const bici = res.rows[0]
  if (!bici) {
    throw new ApiError(404, 'BICICLETA_NOT_FOUND', 'La bicicleta indicada no existe.')
  }
  if (bici.propietario_id !== usuarioId) {
    throw new ApiError(403, 'NOT_OWNER', 'No sos el propietario de esta bicicleta.')
  }
  return bici
}

function urlPublica(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/historial/${token}`
}

async function filaActiva(bicicletaId: string): Promise<CompartidaRow | null> {
  const res = await getPool().query<CompartidaRow>(
    `
      SELECT token, activado_en, vistas
      FROM bicicletas_compartidas
      WHERE bicicleta_id = $1 AND revocado_en IS NULL
      LIMIT 1
    `,
    [bicicletaId]
  )
  return res.rows[0] ?? null
}

/** Estado actual del compartir de una bici (para que el Garaje sepa que boton mostrar). */
export async function obtenerEstadoCompartir(
  bicicletaId: string,
  usuarioId: string,
  baseUrl: string
): Promise<EstadoCompartir> {
  await obtenerBiciDelDueno(bicicletaId, usuarioId)
  const fila = await filaActiva(bicicletaId)
  if (!fila) return { activo: false, token: null, url: null, activadoEn: null, vistas: 0 }
  return {
    activo: true,
    token: fila.token,
    url: urlPublica(baseUrl, fila.token),
    activadoEn: fila.activado_en,
    vistas: fila.vistas,
  }
}

/**
 * Activa el compartir (opt-in explicito). Idempotente: si ya hay una fila
 * activa la devuelve tal cual, nunca duplica (el indice unico parcial de la
 * migracion tampoco lo permitiria).
 */
export async function activarCompartir(
  bicicletaId: string,
  usuarioId: string,
  baseUrl: string
): Promise<EstadoCompartir> {
  await obtenerBiciDelDueno(bicicletaId, usuarioId)

  const existente = await filaActiva(bicicletaId)
  if (existente) {
    return {
      activo: true,
      token: existente.token,
      url: urlPublica(baseUrl, existente.token),
      activadoEn: existente.activado_en,
      vistas: existente.vistas,
    }
  }

  const res = await getPool().query<CompartidaRow>(
    `
      INSERT INTO bicicletas_compartidas (bicicleta_id, activado_por)
      VALUES ($1, $2)
      RETURNING token, activado_en, vistas
    `,
    [bicicletaId, usuarioId]
  )
  const fila = res.rows[0]!
  return {
    activo: true,
    token: fila.token,
    url: urlPublica(baseUrl, fila.token),
    activadoEn: fila.activado_en,
    vistas: fila.vistas,
  }
}

/** Revoca el compartir. No borra la fila (preserva el historial de vistas). */
export async function revocarCompartir(
  bicicletaId: string,
  usuarioId: string
): Promise<void> {
  await obtenerBiciDelDueno(bicicletaId, usuarioId)
  await getPool().query(
    `
      UPDATE bicicletas_compartidas
      SET revocado_en = NOW()
      WHERE bicicleta_id = $1 AND revocado_en IS NULL
    `,
    [bicicletaId]
  )
}

// ── Historial publico (sin auth) ─────────────────────────────────────────────

export interface InspeccionesResumenPublico {
  total: number
  fechas: string[]
  tallerNombre: string | null
}

export interface BiciSaludItemPublico {
  tipo: string
  severidad: string
  titulo: string
  mensaje: string
  creadoEn: string
}

export interface HistorialPublico {
  encontrada: boolean
  veredicto: VerificacionVeredicto
  cit?: { fechaEmision: string | null }
  scoreConfianza?: { total: number; badge: 'oro' | 'bronce' | null }
  biciSalud?: BiciSaludItemPublico[]
  inspecciones?: InspeccionesResumenPublico
}

interface TokenLookupRow {
  bicicleta_id: string
  numero_serie: string
}

interface CitEmisionRow {
  fecha_emision: string | null
  metadata_json: Record<string, unknown> | null
  estado: string | null
  created_at: string
}

interface InspeccionAgregadaRow {
  total: string
  fechas: string[]
  taller_nombre: string | null
}

/**
 * Resuelve un token publico al Historial Clinico completo. `null` si el
 * token no existe o fue revocado -- el caller (la ruta) lo traduce a 404.
 */
export async function obtenerHistorialPublico(
  token: string
): Promise<HistorialPublico | null> {
  const pool = getPool()

  const lookup = await pool.query<TokenLookupRow>(
    `
      SELECT b.id AS bicicleta_id, b.numero_serie
      FROM bicicletas_compartidas bc
      JOIN bicicletas b ON b.id = bc.bicicleta_id
      WHERE bc.token = $1 AND bc.revocado_en IS NULL
      LIMIT 1
    `,
    [token]
  )
  const fila = lookup.rows[0]
  if (!fila) return null

  // Registro de vista best-effort (no bloquea la respuesta al visitante).
  pool
    .query(
      `
        UPDATE bicicletas_compartidas
        SET vistas = vistas + 1, ultima_vista_en = NOW()
        WHERE bicicleta_id = $1 AND revocado_en IS NULL
      `,
      [fila.bicicleta_id]
    )
    .catch((err: unknown) => console.error('[garaje-publico] no se pudo registrar la vista', err))

  // Reusa el veredicto YA probado del Verificador Publico -- unica fuente de
  // verdad de "esta bici esta denunciada". Si da ROBADA, no se agrega nada mas.
  const veredicto = await buscarYVerificar(fila.numero_serie)
  if (veredicto.estado === 'ROBADA') {
    return { encontrada: true, veredicto }
  }
  if (!veredicto.encontrada) {
    return { encontrada: false, veredicto }
  }

  const [citRes, inspeccionesRes] = await Promise.all([
    pool.query<CitEmisionRow>(
      `
        SELECT fecha_emision, metadata_json, estado, created_at
        FROM cits
        WHERE bicicleta_id = $1
        ORDER BY
          CASE estado
            WHEN 'bloqueado' THEN 0
            WHEN 'activo' THEN 1
            WHEN 'pendiente' THEN 2
            ELSE 3
          END,
          acunado_en DESC
        LIMIT 1
      `,
      [fila.bicicleta_id]
    ),
    pool.query<InspeccionAgregadaRow>(
      `
        SELECT
          COUNT(*) AS total,
          ARRAY_AGG(i.created_at ORDER BY i.created_at DESC) AS fechas,
          (ARRAY_AGG(a.nombre ORDER BY i.created_at DESC))[1] AS taller_nombre
        FROM inspecciones_fisicas i
        LEFT JOIN aliados a ON a.id = i.taller_id
        WHERE i.bicicleta_id = $1 AND i.resultado = 'APROBADA'
      `,
      [fila.bicicleta_id]
    ),
  ])

  const citFila = citRes.rows[0]

  // scoreConfianza: mismo motor que el Garaje privado, un solo insumo.
  const insumos = new Map<string, InsumoScoreCit>([
    [
      fila.bicicleta_id,
      {
        factorCit: !citFila || citFila.estado !== 'activo'
          ? 0
          : esCitCompleto(citFila.metadata_json)
            ? PUNTOS_CIT_COMPLETO
            : PUNTOS_CIT_EXPRESS,
        bicicletaCreadoEn: citFila?.created_at ?? null,
      },
    ],
  ])
  const scores = await calcularScoresConfianza(insumos)
  const score = scores.get(fila.bicicleta_id)

  const insp = inspeccionesRes.rows[0]

  return {
    encontrada: true,
    veredicto,
    cit: { fechaEmision: citFila?.fecha_emision ?? null },
    scoreConfianza: score ? { total: score.total, badge: score.badge } : undefined,
    biciSalud: await obtenerBiciSaludPublico(fila.bicicleta_id),
    inspecciones: {
      total: insp ? Number(insp.total) : 0,
      fechas: insp?.fechas ?? [],
      tallerNombre: insp?.taller_nombre ?? null,
    },
  }
}

interface BiciSaludRow {
  tipo: string
  severidad: string
  titulo: string
  mensaje: string
  created_at: string
}

async function obtenerBiciSaludPublico(
  bicicletaId: string
): Promise<BiciSaludItemPublico[]> {
  const res = await getPool().query<BiciSaludRow>(
    `SELECT tipo, severidad, titulo, mensaje, created_at FROM bicisalud_resumen_publico WHERE bicicleta_id = $1`,
    [bicicletaId]
  )
  return res.rows.map((r: BiciSaludRow) => ({
    tipo: r.tipo,
    severidad: r.severidad,
    titulo: r.titulo,
    mensaje: r.mensaje,
    creadoEn: r.created_at,
  }))
}
