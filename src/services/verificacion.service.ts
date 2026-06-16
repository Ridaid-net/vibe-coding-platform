import { createHash } from 'node:crypto'
import { getPool } from '@/lib/marketplace'
import { verificarHashEnBFA } from '@/src/services/blockchain.service'

/**
 * RODAID — Hito 7: Verificador Publico.
 *
 * Servicio del verificador abierto: busca una bicicleta por numero de serie o
 * codigo CIT y arma el VEREDICTO PUBLICO de su identidad, sin exponer jamas
 * datos personales del propietario. Tambien concentra el rate limiting estricto
 * por IP (anti fuerza bruta sobre los seriales) y la bitacora ANONIMA de
 * consultas (`logs_verificaciones`) para analitica de uso.
 *
 * Privacidad por diseno:
 *   - La respuesta solo incluye el ESTADO de la bici y datos no sensibles del
 *     bien (marca, modelo, tipo, anio, color, serie). Nunca nombre/email/ID del
 *     dueno.
 *   - La IP del consultante se guarda solo como hash (no reversible).
 */

// ── Tipos del veredicto publico ──────────────────────────────────────────────

/** Veredicto semaforico de la verificacion. */
export type VeredictoEstado =
  | 'SEGURO' // verde: CIT activa y vigente
  | 'ROBADA' // rojo: CIT bloqueada (reportada como robada)
  | 'EN_VALIDACION' // amarillo: CIT pendiente / vencida
  | 'SIN_VERIFICAR' // gris/amarillo: existe la bici pero sin CIT activa
  | 'NO_ENCONTRADA' // gris: no hay coincidencia

export type VeredictoColor = 'verde' | 'rojo' | 'amarillo' | 'gris'

export type TipoBusqueda = 'serial' | 'cit'

export interface VerdictoBfa {
  /** El hash del CIT coincide con el registro anclado en la BFA. */
  coincide: boolean
  /** Estado del anclaje on-chain del CIT. */
  estado: string
  txHash: string | null
  tokenId: string | null
  modo: string
  ancladoEn: string | null
}

export interface VerificacionVeredicto {
  estado: VeredictoEstado
  color: VeredictoColor
  encontrada: boolean
  tipoBusqueda: TipoBusqueda
  /** Mensaje principal para el usuario. */
  titulo: string
  /** Detalle/explicacion del veredicto. */
  mensaje: string
  /** Solo presente cuando hay coincidencia: datos NO sensibles del bien. */
  bicicleta?: {
    marca: string
    modelo: string
    tipo: string
    anio: number | null
    color: string | null
    numeroSerie: string
  }
  codigoCit?: string | null
  /** Coincidencia de la huella SHA-256 con la BFA (blockchain). */
  bfa?: VerdictoBfa
  /** Aviso de robo + sugerencia de contacto (solo cuando ROBADA). */
  alertaRobo?: {
    mensaje: string
    contacto: string
  }
}

// ── Normalizacion / deteccion del termino ────────────────────────────────────

/** Normaliza el termino de busqueda: mayusculas, sin espacios ni separadores. */
export function normalizarTermino(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '')
}

/** Heuristica: un codigo CIT tiene el prefijo `CIT-`. */
export function detectarTipo(termino: string): TipoBusqueda {
  return /^CIT-/i.test(termino) ? 'cit' : 'serial'
}

/**
 * Algunos QR del sticker CIT codifican una URL (p. ej. .../verificar/SERIAL).
 * Extrae el termino util tanto de una URL como de un texto plano.
 */
export function extraerTerminoDeQR(texto: string): string {
  const limpio = texto.trim()
  try {
    const url = new URL(limpio)
    const segmentos = url.pathname.split('/').filter(Boolean)
    const ultimo = segmentos[segmentos.length - 1]
    if (ultimo) return decodeURIComponent(ultimo)
    const q = url.searchParams.get('serial') ?? url.searchParams.get('q')
    if (q) return q
  } catch {
    // No es una URL: se usa el texto tal cual.
  }
  return limpio
}

// ── Rate limiting (fixed-window por IP) ──────────────────────────────────────

const RATE_LIMIT_DEFAULT = 20 // consultas por ventana
const RATE_WINDOW_SEGUNDOS = 60

function rateLimitMax(): number {
  const raw = process.env.RODAID_VERIFICAR_RATE_LIMIT
  if (raw === undefined || raw.trim() === '') return RATE_LIMIT_DEFAULT
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : RATE_LIMIT_DEFAULT
}

function ipSalt(): string {
  return process.env.JWT_SECRET ?? process.env.AUTH_SECRET ?? 'rodaid-verif-salt'
}

/** Hash anonimo de la IP (sal del servidor). No reversible a la IP original. */
export function hashIp(ip: string | null): string {
  return createHash('sha256').update(`${ipSalt()}:${ip ?? 'desconocida'}`).digest('hex')
}

export interface RateLimitResultado {
  permitido: boolean
  limite: number
  restantes: number
  /** Segundos hasta que se libera la ventana (para Retry-After). */
  retryAfter: number
}

/**
 * Rate limiting estricto por IP con ventana fija. Incrementa de forma atomica el
 * contador de la ventana actual (INSERT ... ON CONFLICT) y rechaza si supera el
 * limite. Resistente a concurrencia: el incremento ocurre en una sola sentencia.
 */
export async function chequearRateLimit(ipHash: string): Promise<RateLimitResultado> {
  const limite = rateLimitMax()
  const ventanaMs = RATE_WINDOW_SEGUNDOS * 1000
  const ahora = Date.now()
  const ventanaInicio = new Date(Math.floor(ahora / ventanaMs) * ventanaMs)
  const ventanaFin = ventanaInicio.getTime() + ventanaMs

  const pool = getPool()
  const res = await pool.query<{ contador: number }>(
    `
      INSERT INTO rate_limit_verificaciones (ip_hash, ventana_inicio, contador)
      VALUES ($1, $2, 1)
      ON CONFLICT (ip_hash, ventana_inicio)
      DO UPDATE SET contador = rate_limit_verificaciones.contador + 1
      RETURNING contador
    `,
    [ipHash, ventanaInicio.toISOString()]
  )
  const contador = res.rows[0]?.contador ?? 1

  // Limpieza oportunista de ventanas viejas de esta IP (barato, sin job aparte).
  pool
    .query(
      `DELETE FROM rate_limit_verificaciones WHERE ip_hash = $1 AND ventana_inicio < $2`,
      [ipHash, new Date(ahora - ventanaMs * 5).toISOString()]
    )
    .catch(() => undefined)

  const restantes = Math.max(0, limite - contador)
  const retryAfter = Math.max(1, Math.ceil((ventanaFin - ahora) / 1000))
  return { permitido: contador <= limite, limite, restantes, retryAfter }
}

// ── Busqueda + veredicto ─────────────────────────────────────────────────────

interface FilaVerificacion {
  bici_id: string
  marca: string
  modelo: string
  tipo: string
  anio: number | null
  color: string | null
  numero_serie: string
  cit_id: string | null
  cit_estado: string | null
  codigo_cit: string | null
  hash_sha256: string | null
  fecha_vencimiento: string | null
  bfa_estado: string | null
  bfa_tx_hash: string | null
  bfa_token_id: string | null
  bfa_anclado_en: string | null
}

const CONTACTO_AUTORIDADES =
  'Si la estas viendo en una compra, no concretes la operacion. Comunicate con la policia local (911 en Argentina) y aporta el numero de serie.'

/**
 * Busca la bicicleta por numero de serie o codigo CIT y arma el veredicto
 * publico. Elige el CIT mas relevante para la seguridad: prioriza un CIT
 * BLOQUEADO (una denuncia nunca queda oculta por un CIT mas nuevo), luego el
 * activo y por ultimo el pendiente.
 */
export async function buscarYVerificar(
  termino: string
): Promise<VerificacionVeredicto> {
  const tipoBusqueda = detectarTipo(termino)

  const res = await getPool().query<FilaVerificacion>(
    `
      SELECT
        b.id AS bici_id, b.marca, b.modelo, b.tipo, b.anio, b.color, b.numero_serie,
        c.id AS cit_id, c.estado AS cit_estado, c.codigo_cit, c.hash_sha256,
        c.fecha_vencimiento, c.bfa_estado, c.bfa_tx_hash, c.bfa_token_id,
        c.bfa_anclado_en
      FROM bicicletas b
      LEFT JOIN LATERAL (
        SELECT *
        FROM cits c
        WHERE c.bicicleta_id = b.id
        ORDER BY
          CASE c.estado
            WHEN 'bloqueado' THEN 0
            WHEN 'activo' THEN 1
            WHEN 'pendiente' THEN 2
            ELSE 3
          END,
          c.creado_en DESC
        LIMIT 1
      ) c ON TRUE
      WHERE UPPER(b.numero_serie) = $1
         OR EXISTS (
              SELECT 1 FROM cits cc
              WHERE cc.bicicleta_id = b.id AND UPPER(cc.codigo_cit) = $1
            )
      ORDER BY
        CASE WHEN UPPER(b.numero_serie) = $1 THEN 0 ELSE 1 END
      LIMIT 1
    `,
    [termino]
  )

  const fila = res.rows[0]
  if (!fila) {
    return {
      estado: 'NO_ENCONTRADA',
      color: 'gris',
      encontrada: false,
      tipoBusqueda,
      titulo: 'No encontramos esta bicicleta',
      mensaje:
        'No hay ninguna bicicleta registrada con ese numero de serie o codigo CIT en RODAID. Verifica que lo hayas escrito correctamente.',
    }
  }

  const bicicleta = {
    marca: fila.marca,
    modelo: fila.modelo,
    tipo: fila.tipo,
    anio: fila.anio,
    color: fila.color,
    numeroSerie: fila.numero_serie,
  }

  // Sin CIT: la bici existe pero no tiene identidad verificada.
  if (!fila.cit_id || !fila.cit_estado) {
    return {
      estado: 'SIN_VERIFICAR',
      color: 'amarillo',
      encontrada: true,
      tipoBusqueda,
      titulo: 'Bicicleta sin identidad verificada',
      mensaje:
        'Esta bicicleta esta registrada pero todavia no tiene una Cedula de Identidad (CIT) activa. No podemos confirmar su estado.',
      bicicleta,
      codigoCit: null,
    }
  }

  const vencida =
    fila.fecha_vencimiento !== null &&
    new Date(fila.fecha_vencimiento).getTime() <= Date.now()

  // BLOQUEADA: reportada como robada (rojo). Prioridad maxima.
  if (fila.cit_estado === 'bloqueado') {
    const bfa = await construirBfa(fila)
    return {
      estado: 'ROBADA',
      color: 'rojo',
      encontrada: true,
      tipoBusqueda,
      titulo: 'Reportada como robada',
      mensaje:
        'Esta bicicleta figura BLOQUEADA en RODAID por una denuncia. No la compres ni concretes ninguna operacion.',
      bicicleta,
      codigoCit: fila.codigo_cit,
      bfa,
      alertaRobo: {
        mensaje: 'Reportada como robada',
        contacto: CONTACTO_AUTORIDADES,
      },
    }
  }

  // ACTIVA y vigente: SEGURO (verde).
  if (fila.cit_estado === 'activo' && !vencida) {
    const bfa = await construirBfa(fila)
    return {
      estado: 'SEGURO',
      color: 'verde',
      encontrada: true,
      tipoBusqueda,
      titulo: 'Identidad verificada',
      mensaje: bfa.coincide
        ? 'Esta bicicleta tiene una identidad (CIT) activa y su huella coincide con el registro anclado en la BFA. Sin denuncias.'
        : 'Esta bicicleta tiene una identidad (CIT) activa y sin denuncias.',
      bicicleta,
      codigoCit: fila.codigo_cit,
      bfa,
    }
  }

  // PENDIENTE o ACTIVA vencida: EN_VALIDACION (amarillo).
  const bfa = await construirBfa(fila)
  return {
    estado: 'EN_VALIDACION',
    color: 'amarillo',
    encontrada: true,
    tipoBusqueda,
    titulo: vencida ? 'Identidad vencida' : 'En proceso de validacion',
    mensaje: vencida
      ? 'La Cedula de Identidad (CIT) de esta bicicleta vencio y debe renovarse. Por ahora no podemos confirmar su estado actual.'
      : 'La identidad de esta bicicleta esta en proceso de validacion (control de 72 hs). Todavia no hay un veredicto definitivo.',
    bicicleta,
    codigoCit: fila.codigo_cit,
    bfa,
  }
}

/** Arma el bloque BFA del veredicto, verificando la coincidencia del hash. */
async function construirBfa(fila: FilaVerificacion): Promise<VerdictoBfa> {
  const verif = await verificarHashEnBFA(fila.numero_serie, fila.hash_sha256, {
    ancladoEnDb: fila.bfa_estado === 'anclado',
  })
  return {
    coincide: verif.coincide,
    estado: fila.bfa_estado ?? 'pendiente',
    txHash: fila.bfa_tx_hash,
    tokenId: fila.bfa_token_id ?? verif.tokenId,
    modo: verif.modo,
    ancladoEn: fila.bfa_anclado_en,
  }
}

// ── Bitacora anonima ─────────────────────────────────────────────────────────

export interface RegistroConsulta {
  consulta: string
  tipoBusqueda: TipoBusqueda
  veredicto: VeredictoEstado
  encontrada: boolean
  bicicletaId?: string | null
  citId?: string | null
  ipHash: string | null
  userAgent: string | null
}

/**
 * Registra una consulta del verificador en `logs_verificaciones` (anonima).
 * Best-effort: nunca tira abajo la respuesta al usuario por un fallo de log.
 */
export async function registrarConsulta(reg: RegistroConsulta): Promise<void> {
  try {
    await getPool().query(
      `
        INSERT INTO logs_verificaciones
          (consulta, tipo_busqueda, encontrada, veredicto,
           bicicleta_id, cit_id, ip_hash, user_agent)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        reg.consulta.slice(0, 120),
        reg.tipoBusqueda,
        reg.encontrada,
        reg.veredicto,
        reg.bicicletaId ?? null,
        reg.citId ?? null,
        reg.ipHash,
        reg.userAgent ? reg.userAgent.slice(0, 200) : null,
      ]
    )
  } catch (error) {
    console.error('[verificacion] no se pudo registrar la consulta', error)
  }
}

// ── Analitica: deteccion de interes repetido ─────────────────────────────────

export interface ConsultaTendencia {
  consulta: string
  total: number
  ipsDistintas: number
  ultimaConsulta: string
  encontrada: boolean
}

interface TendenciaFila {
  consulta: string
  total: string
  ips_distintas: string
  ultima: string
  encontrada: boolean
}

/**
 * Tendencias de consultas: series consultadas repetidamente en una ventana
 * (posible interes en una compra/venta puntual). Pensado para back-office.
 */
export async function getTendenciasVerificaciones(opciones: {
  horas?: number
  minConsultas?: number
  limite?: number
} = {}): Promise<ConsultaTendencia[]> {
  const horas = opciones.horas ?? 24
  const minConsultas = opciones.minConsultas ?? 3
  const limite = Math.min(opciones.limite ?? 50, 200)

  const res = await getPool().query<TendenciaFila>(
    `
      SELECT
        consulta,
        COUNT(*) AS total,
        COUNT(DISTINCT ip_hash) AS ips_distintas,
        MAX(created_at) AS ultima,
        BOOL_OR(encontrada) AS encontrada
      FROM logs_verificaciones
      WHERE created_at >= NOW() - ($1 || ' hours')::interval
      GROUP BY consulta
      HAVING COUNT(*) >= $2
      ORDER BY total DESC, ultima DESC
      LIMIT $3
    `,
    [String(horas), minConsultas, limite]
  )

  return res.rows.map((r: TendenciaFila) => ({
    consulta: r.consulta,
    total: Number(r.total),
    ipsDistintas: Number(r.ips_distintas),
    ultimaConsulta: r.ultima,
    encontrada: r.encontrada,
  }))
}
