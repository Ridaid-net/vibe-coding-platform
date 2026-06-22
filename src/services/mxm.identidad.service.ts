// ─── RODAID · MxM Identidad Service ──────────────────────
// Consulta y cachea la identidad verificada del usuario desde MxM.
//
// Datos que devuelve:
//   · sub (opaque ID de MxM)
//   · cuil / dni
//   · nombre, apellido, email
//   · nivel de verificación (1 = email, 2 = RENAPER)
//   · scopes aprobados
//   · estado del token MxM (vigente, expirado, ausente)
//   · capacidades RODAID derivadas del nivel
//
// Estrategia de frescura:
//   1. Si hay caché < 5 min → devolver sin consultar MxM
//   2. Si token MxM vigente → refrescar desde /oauth/userinfo
//   3. Si token expirado → intentar refresh_token
//   4. Si todo falla → devolver datos almacenados en DB (stale)
//
// Sin conexión MxM (STUB mode): devuelve datos de la DB + estado sintético.

import { query, queryOne } from '../config/database'
import { getRedis }         from '../config/redis'
import { mxmService, getMxMAccessToken } from './mxm.service'
import { log }              from '../middleware/logger'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export type NivelMxM = 0 | 1 | 2

export interface IdentidadMxM {
  // Identidad verificada por MxM
  conectado:      boolean
  sub?:           string          // opaque ID en MxM
  cuil?:          string          // "20-30123456-7"
  cuilNormalizado?: string        // "20303456708" sin guiones
  dni?:           string          // "30123456"
  nombre?:        string
  apellido?:      string
  nombreCompleto?:string
  email?:         string
  nivel:          NivelMxM       // 0 = no conectado, 1 = email, 2 = RENAPER
  nivelDescripcion: string
  scopes:         string[]

  // Estado del token MxM
  token: {
    vigente:      boolean
    expiraEn?:    Date
    minutosRestantes?: number
    origen:       'cache' | 'userinfo' | 'db' | 'ninguno'
  }

  // Capacidades RODAID derivadas del nivel
  capacidades: {
    puedeEmitirCIT:        boolean   // nivel >= 2
    puedeTransferirCIT:    boolean   // nivel >= 2
    puedeVenderMarketplace: boolean  // nivel >= 1
    puedeComprarMarketplace: boolean // nivel >= 1
    puedeRecibirNFT:       boolean   // nivel >= 1
    descripcion:           string[]  // frases para mostrar en UI
  }

  // Metadata
  cacheadoEn?:    Date
  verificadoEn?:  Date
  esFresco:       boolean
}

// ══════════════════════════════════════════════════════════
// CONSTANTES
// ══════════════════════════════════════════════════════════

const CACHE_TTL_SEC = 300          // 5 min en Redis
const STALE_THRESHOLD_MIN = 5      // refrescar si el caché tiene > 5 min

const NIVEL_DESC: Record<NivelMxM, string> = {
  0: 'Sin verificación MxM',
  1: 'Email / teléfono verificado (Nivel 1)',
  2: 'Identidad completa RENAPER (Nivel 2) ✓',
}

// ══════════════════════════════════════════════════════════
// CACHE REDIS
// ══════════════════════════════════════════════════════════

function cacheKey(userId: string): string {
  return `mxm:identidad:${userId}`
}

async function getCached(userId: string): Promise<IdentidadMxM | null> {
  try {
    const raw = await getRedis().get(cacheKey(userId))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

async function setCache(userId: string, data: IdentidadMxM): Promise<void> {
  try {
    await getRedis().set(cacheKey(userId), JSON.stringify(data), 'EX', CACHE_TTL_SEC)
  } catch { /* best-effort */ }
}

export async function invalidarCache(userId: string): Promise<void> {
  try {
    await getRedis().del(cacheKey(userId))
  } catch { /* best-effort */ }
}

// ══════════════════════════════════════════════════════════
// DERIVAR CAPACIDADES
// ══════════════════════════════════════════════════════════

function derivarCapacidades(nivel: NivelMxM): IdentidadMxM['capacidades'] {
  const n2 = nivel >= 2
  const n1 = nivel >= 1

  const descripcion: string[] = []
  if (n2) {
    descripcion.push('✓ Puede emitir Certificados de Identidad Técnica (CIT)')
    descripcion.push('✓ Puede transferir CIT al vender una bicicleta')
  } else if (n1) {
    descripcion.push('✓ Puede acceder al marketplace RODAID')
    descripcion.push('⚠ Requiere Nivel 2 para emitir CITs — verificá tu identidad con RENAPER en MxM')
  } else {
    descripcion.push('✗ Conectate con Mendoza por Mí para acceder a todas las funciones')
  }

  return {
    puedeEmitirCIT:          n2,
    puedeTransferirCIT:      n2,
    puedeVenderMarketplace:  n1,
    puedeComprarMarketplace: n1,
    puedeRecibirNFT:         n1,
    descripcion,
  }
}

// ══════════════════════════════════════════════════════════
// OBTENER IDENTIDAD — función principal
// ══════════════════════════════════════════════════════════

export async function getIdentidadMxM(
  userId:      string,
  opciones?: { forzarRefresh?: boolean; incluirRaw?: boolean }
): Promise<IdentidadMxM> {

  // ── 1. Cache hit ─────────────────────────────────────────
  if (!opciones?.forzarRefresh) {
    const cached = await getCached(userId)
    if (cached) {
      log.mxm.debug({ userId: userId.slice(0, 8), origen: 'cache' }, 'identidad desde Redis')
      return { ...cached, esFresco: true, token: { ...cached.token, origen: 'cache' } }
    }
  }

  // ── 2. Leer de DB ─────────────────────────────────────────
  const [usuario, tokenRow, cacheRow] = await Promise.all([
    queryOne<{
      mxm_verificado: boolean; mxm_nivel: number; mxm_sub: string | null
      mxm_email: string | null; mxm_ultimo_login: Date | null
      nombre: string; apellido: string; dni: string | null; cuil: string | null
    }>(
      `SELECT mxm_verificado, mxm_nivel, mxm_sub, mxm_email, mxm_ultimo_login,
              nombre, apellido, dni, cuil
       FROM usuarios WHERE id=$1`,
      [userId]
    ),
    queryOne<{
      access_token: string; expires_at: Date; cuil: string | null; nivel: number
      nombre: string | null; apellido: string | null; dni: string | null; email: string | null
    }>(
      `SELECT access_token, expires_at, cuil, nivel, nombre, apellido, dni, email
       FROM mxm_tokens WHERE usuario_id=$1`,
      [userId]
    ),
    queryOne<{
      sub: string | null; cuil: string | null; dni: string | null
      nombre: string | null; apellido: string | null; email: string | null
      nivel: number; scopes: string[] | null; cacheado_en: Date; verificado_en: Date | null
    }>(
      `SELECT sub, cuil, dni, nombre, apellido, email, nivel, scopes, cacheado_en, verificado_en
       FROM mxm_identidad_cache WHERE usuario_id=$1`,
      [userId]
    ),
  ])

  // No conectado a MxM
  if (!usuario?.mxm_verificado && !tokenRow) {
    const identidad: IdentidadMxM = {
      conectado: false,
      nivel: 0,
      nivelDescripcion: NIVEL_DESC[0],
      scopes: [],
      token:  { vigente: false, origen: 'ninguno' },
      capacidades: derivarCapacidades(0),
      esFresco: true,
    }
    await setCache(userId, identidad)
    return identidad
  }

  // ── 3. Verificar frescura del token ───────────────────────
  const ahora         = new Date()
  const tokenExpiraEn = tokenRow?.expires_at ? new Date(tokenRow.expires_at) : null
  const tokenVigente  = tokenExpiraEn ? tokenExpiraEn > new Date(ahora.getTime() + 60_000) : false
  const cacheadoHace  = cacheRow?.cacheado_en
    ? (ahora.getTime() - new Date(cacheRow.cacheado_en).getTime()) / 60_000
    : Infinity

  // ── 4. Refrescar desde /userinfo si el token está vigente ─
  let identidadFresca: Partial<IdentidadMxM> = {}
  let origenToken: IdentidadMxM['token']['origen'] = 'db'

  if (tokenVigente && cacheadoHace > STALE_THRESHOLD_MIN) {
    try {
      const accessToken = await getMxMAccessToken(userId)
      if (accessToken) {
        const raw = await mxmService.getIdentidad(accessToken)
        identidadFresca = {
          cuil:           raw.cuil,
          dni:            raw.dni,
          nombre:         raw.nombre,
          apellido:       raw.apellido,
          email:          raw.email,
        }
        origenToken = 'userinfo'

        // Persistir en caché DB
        await upsertIdentidadCache(userId, { ...raw, sub: raw.sub ?? '' }, tokenExpiraEn)
        log.mxm.info({ userId: userId.slice(0, 8), nivel: raw.nivel }, 'identidad refrescada desde /userinfo')
      }
    } catch (err) {
      log.mxm.warn({ err: (err as Error).message }, 'No se pudo refrescar desde /userinfo — usando DB')
    }
  }

  // ── 5. Construir respuesta combinando fuentes ─────────────
  const cuil    = identidadFresca.cuil    ?? cacheRow?.cuil    ?? tokenRow?.cuil    ?? usuario?.cuil    ?? undefined
  const dni     = identidadFresca.dni     ?? cacheRow?.dni     ?? tokenRow?.dni     ?? usuario?.dni     ?? undefined
  const nombre  = identidadFresca.nombre  ?? cacheRow?.nombre  ?? tokenRow?.nombre  ?? usuario?.nombre  ?? undefined
  const apellido= identidadFresca.apellido?? cacheRow?.apellido?? tokenRow?.apellido?? usuario?.apellido ?? undefined
  const email   = identidadFresca.email   ?? cacheRow?.email   ?? usuario?.mxm_email ?? undefined
  const nivel   = Math.max(
    (identidadFresca as any)?.nivel ?? 0,
    cacheRow?.nivel ?? 0,
    tokenRow?.nivel ?? 0,
    usuario?.mxm_nivel ?? 0
  ) as NivelMxM

  const minutosRestantes = tokenExpiraEn
    ? Math.max(0, Math.floor((tokenExpiraEn.getTime() - ahora.getTime()) / 60_000))
    : undefined

  const cuilNormalizado = cuil?.replace(/-/g, '')

  const identidad: IdentidadMxM = {
    conectado:       true,
    sub:             cacheRow?.sub ?? usuario?.mxm_sub ?? undefined,
    cuil,
    cuilNormalizado,
    dni,
    nombre,
    apellido,
    nombreCompleto:  nombre && apellido ? `${nombre} ${apellido}` : nombre,
    email,
    nivel,
    nivelDescripcion: NIVEL_DESC[nivel] ?? NIVEL_DESC[0],
    scopes:          cacheRow?.scopes ?? [],

    token: {
      vigente:         tokenVigente,
      expiraEn:        tokenExpiraEn ?? undefined,
      minutosRestantes,
      origen:          origenToken,
    },

    capacidades: derivarCapacidades(nivel),
    cacheadoEn:  cacheRow?.cacheado_en ?? undefined,
    verificadoEn: cacheRow?.verificado_en ?? undefined,
    esFresco:    origenToken === 'userinfo',
  }

  await setCache(userId, identidad)
  return identidad
}

// ══════════════════════════════════════════════════════════
// UPSERT CACHE DB
// ══════════════════════════════════════════════════════════

async function upsertIdentidadCache(
  userId:      string,
  raw:         { sub: string; cuil: string; dni: string; nombre: string; apellido: string; email?: string; nivel: number },
  tokenExpiraEn: Date | null
): Promise<void> {
  await query(
    `INSERT INTO mxm_identidad_cache
       (usuario_id, sub, cuil, dni, nombre, apellido, email, nivel, token_expira_en, cacheado_en, verificado_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
     ON CONFLICT (usuario_id) DO UPDATE SET
       sub             = EXCLUDED.sub,
       cuil            = EXCLUDED.cuil,
       dni             = EXCLUDED.dni,
       nombre          = EXCLUDED.nombre,
       apellido        = EXCLUDED.apellido,
       email           = EXCLUDED.email,
       nivel           = EXCLUDED.nivel,
       token_expira_en = EXCLUDED.token_expira_en,
       cacheado_en     = NOW(),
       verificado_en   = NOW()`,
    [userId, raw.sub, raw.cuil, raw.dni, raw.nombre, raw.apellido,
     raw.email ?? null, raw.nivel, tokenExpiraEn]
  )
}

// ══════════════════════════════════════════════════════════
// CONSULTA PÚBLICA POR SERIAL (para verificador — sin datos PII)
// ══════════════════════════════════════════════════════════

/**
 * Retorna solo el nivel de verificación del propietario actual de un CIT.
 * Sin PII — solo el nivel para que el comprador pueda evaluar la confianza.
 */
export async function getNivelPorSerial(serial: string): Promise<{
  nivelPropietario: NivelMxM
  nivelDescripcion: string
  verificadoPorMxM: boolean
}> {
  const row = await queryOne<{ nivel: number | null; verificado: boolean }>(
    `SELECT u.mxm_nivel AS nivel, u.mxm_verificado AS verificado
     FROM cits c
     JOIN bicicletas b ON b.id=c.bicicleta_id
     JOIN usuarios u ON u.id=c.propietario_id
     WHERE b.numero_serie=$1 AND c.estado='ACTIVO'
     ORDER BY c.creado_en DESC LIMIT 1`,
    [serial]
  )

  const nivel = (row?.nivel ?? 0) as NivelMxM
  return {
    nivelPropietario: nivel,
    nivelDescripcion: NIVEL_DESC[nivel] ?? NIVEL_DESC[0],
    verificadoPorMxM: row?.verificado === true,
  }
}

// ══════════════════════════════════════════════════════════
// ADMIN — resumen de niveles MxM en RODAID
// ══════════════════════════════════════════════════════════

export async function getResumenNivelesMxM(): Promise<{
  total:      number
  nivel0:     number  // sin MxM
  nivel1:     number  // email verificado
  nivel2:     number  // RENAPER
  pctVerificados: number
}> {
  const row = await queryOne<{
    total: string; n0: string; n1: string; n2: string
  }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE NOT mxm_verificado OR mxm_nivel=0)::text AS n0,
       COUNT(*) FILTER (WHERE mxm_verificado AND mxm_nivel=1)::text AS n1,
       COUNT(*) FILTER (WHERE mxm_verificado AND mxm_nivel=2)::text AS n2
     FROM usuarios`,
    []
  )

  const total = parseInt(row?.total ?? '0')
  const n2    = parseInt(row?.n2 ?? '0')

  return {
    total,
    nivel0:         parseInt(row?.n0 ?? '0'),
    nivel1:         parseInt(row?.n1 ?? '0'),
    nivel2:         n2,
    pctVerificados: total > 0 ? Math.round(n2 / total * 100) : 0,
  }
}
