// ─── RODAID · Verificador Público ─────────────────────────
// GET /api/verificar/:serial → respuesta unificada desde DB + BFA + sello + firma
//
// Fuentes de datos (consultadas en paralelo):
//   1. PostgreSQL — CIT completo (estado, puntos, fechas, propietario, inspector)
//   2. BFA Indexer — estado en blockchain, tokenId, historial de eventos
//   3. Sello Temporal — codigoVerif, selladoEn, modo (RFC3161 / GOB_MENDOZA / STUB)
//   4. Firma Digital — PKCS#7 estado, certSubject, firmadoEn
//
// Privacidad:
//   · Propietario: nombre con último apellido oculto, DNI con últimos 3 dígitos ***
//   · Inspector: nombre completo visible (es información pública del CIT)
//   · Sin wallet addresses en la respuesta pública
//   · Sin coordenadas GPS ni datos internos
//
// Caché Redis:
//   · TTL 5 minutos para respuestas "encontrado"
//   · TTL 30 segundos para "no encontrado" (previene DoS)
//   · Invalidada automáticamente al actualizar el CIT (en otros servicios)
//
// Audit log:
//   · Cada verificación queda en verificaciones_log con IP + origen + ms
//   · Útil para analytics, compliance (Ley 9556) y detección de fraude

import crypto       from 'crypto'
import { env }       from '../config/env'
import { resolverEstado, estadoBadge, resolverLabel, type EstadoInput } from './estado.service'
import { query, queryOne } from '../config/database'
import { getRedis }  from '../config/redis'
import { log }       from '../middleware/logger'

// ══════════════════════════════════════════════════════════
// ANONIMIZACIÓN DE IPs — privacidad by design
// SHA-256(ip + fecha_utc + salt) → primeros 16 hex chars
// El salt diario hace imposible correlacionar días distintos
// ══════════════════════════════════════════════════════════

function hashIP(ip: string): string {
  const salt    = env.ANALYTICS_IP_SALT ?? 'rodaid-analytics-2026'
  const today   = new Date().toISOString().slice(0, 10)  // YYYY-MM-DD
  const payload = `${ip}:${today}:${salt}`
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16)
}

function detectarBot(userAgent?: string): boolean {
  if (!userAgent) return false
  const ua = userAgent.toLowerCase()
  return /bot|crawl|spider|scan|curl|wget|python|go-http|java|axios|fetch|node/i.test(ua)
}

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export interface VerificacionPublica {
  // Meta
  consultadoEn:   string     // ISO 8601 UTC
  fromCache:      boolean
  duracionMs:     number

  // Identidad
  serial:         string
  numeroCIT?:     string
  hashSHA256?:    string    // primeros 16 chars + '...' para identificar

  // Estado principal
  encontrado:     boolean
  estado:         'ACTIVO' | 'EXPIRADO' | 'BLOQUEADO' | 'RECHAZADO' | 'PENDIENTE' | 'NO_ENCONTRADO' | 'EN_VALIDACION' | 'SIN_REGISTRO'
  estadoLabel:    string
  estadoDetalle?: {
    descripcion:       string
    accion?:           string
    color:             string
    icono:             string
    diasParaVencer:    number | null
    diasEnEstado:      number | null
    fuentesPrincipales: string[]
    pipelineVenceEn?:  string
    bloqueoFecha?:     string
    bloqueoMotivo?:    string
  }
  badge?: {
    texto:       string; color: string
    bgColor:     string; borderColor: string; icono: string
  }
  vigente:        boolean | null

  // Datos de la bicicleta (si encontrado)
  bicicleta?: {
    marca:  string; modelo: string; anio: number
    tipo:   string; color:  string
  }

  // Inspección (20 puntos)
  inspeccion?: {
    resultado:  'APROBADO' | 'RECHAZADO'
    puntos:     number
    maximo:     number
    porcentaje: number
    fechaEmision:     string
    fechaVencimiento: string
  }

  // Propietario (parcialmente ocultado por privacidad)
  propietario?: {
    nombre: string    // "Federico A.**" — último apellido oculto
    dni:    string    // "30.123.***" — últimos 3 dígitos ocultos
  }

  // Inspector y taller
  inspector?: {
    nombre:   string
    apellido: string
    taller:   string
    localidad: string
  }

  // Blockchain Federal Argentina (BFA)
  blockchain: {
    red:        string
    indexado:   boolean
    tokenId?:   number
    txHash?:    string    // primeros 18 chars para identificación
    estado:     string
    bloqueado:  boolean
    bloqueoMotivo?: string
    transferencias: number
    // Validación on-chain en tiempo real
    validacionOnChain: {
      consultada:       boolean  // si se pudo consultar el nodo BFA
      hashCoincide:     boolean | null  // hash DB == hash on-chain
      hashDB?:          string          // primeros 16ch del hash en DB
      hashOnChain?:     string          // primeros 16ch del hash en cadena
      bloqueadoOnChain: boolean | null  // estado real en contrato (no solo índice)
      tokenIdOnChain?:  number
      latenciaNodo?:    number          // ms de respuesta del nodo BFA
      nodo:             string          // URL del nodo consultado (si real) o 'STUB'
    }
  }

  // Sello Temporal (RFC 3161 / Gobierno de Mendoza)
  selloTemporal: {
    emitido:       boolean
    codigoVerif?:  string
    selladoEn?:    string
    modo?:         string
    modoLabel?:    string
  }

  // Firma Digital PKCS#7
  firmaDigital: {
    firmado:       boolean
    firmadoEn?:    string
    certSubject?:  string
    validaHasta?:  string
  }

  // URLs de verificación y recursos
  links: {
    verificarURL:  string
    qrPNG?:        string
    descargarPDF?: string  // solo si autenticado
  }

  // Alertas activas (denuncia de robo, etc.)
  alertas: Array<{
    tipo:     string
    mensaje:  string
    desde?:   string
  }>
}

// ══════════════════════════════════════════════════════════
// HELPERS DE PRIVACIDAD
// ══════════════════════════════════════════════════════════

function ocultarApellido(nombre: string): string {
  const partes = nombre.trim().split(/\s+/)
  if (partes.length <= 1) return partes[0] ?? ''
  // "Federico Alejandro De Gea" → "Federico A.**"
  const primerNombre = partes[0]
  const segundoNombre = partes[1]?.charAt(0) + '.'
  return `${primerNombre} ${segundoNombre}**`
}

function ocultarDNI(dni: string): string {
  const solo = dni.replace(/\D/g, '')
  if (solo.length < 6) return '***'
  const visible = solo.slice(0, -3)
  return visible.replace(/(\d{2})(\d*)/, (_, a, b) => {
    const grupos = (a + b).match(/.{1,3}/g) ?? [a + b]
    return grupos.join('.') + '.***'
  })
}

function estadoLabel(estado: VerificacionPublica['estado']): string {
  const labels: Record<string, string> = {
    ACTIVO:         '✓ Certificado activo y vigente',
    EXPIRADO:       '⚠ Certificado vencido — requiere re-inspección',
    BLOQUEADO:      '✗ Certificado bloqueado — denuncia activa',
    RECHAZADO:      '✗ Inspección rechazada',
    PENDIENTE:      '⏳ Certificado en proceso de validación',
    NO_ENCONTRADO:  '— Serial no registrado en RODAID',
  }
  return labels[estado] ?? estado
}

function modoSelloLabel(modo: string): string {
  const labels: Record<string, string> = {
    GOB_MENDOZA: 'Gobierno de Mendoza — TSA oficial',
    RFC3161:     'RFC 3161 — TSA pública reconocida',
    STUB:        'RODAID — sello local (en desarrollo)',
  }
  return labels[modo] ?? modo
}

// ══════════════════════════════════════════════════════════
// CONSULTA PRINCIPAL EN DB
// ══════════════════════════════════════════════════════════

async function consultarDB(serial: string): Promise<{
  citId: string; numeroCIT: string; hashSHA256: string
  estado: string; puntos: number; puntoDetalle: Record<string, boolean>
  fechaEmision: Date | null; fechaVencimiento: Date | null
  marca: string; modelo: string; anio: number; tipo: string; color: string
  propietarioNombre: string; propietarioApellido: string; propietarioDNI: string
  inspectorNombre: string; inspectorApellido: string
  tallerNombre: string; tallerLocalidad: string
  nftTokenId: number | null; bfaTxHash: string | null
  pipelineEstado: string | null; pipelineInicio: Date | null
  codigoVerif: string | null; selloSelladoEn: Date | null; selloModo: string | null
  firmaFirmadoEn: Date | null; firmaCertSubject: string | null; firmaValidaHasta: Date | null
} | null> {
  return queryOne(
    `SELECT
       c.id                 AS "citId",
       c.numero_cit         AS "numeroCIT",
       c.hash_sha256        AS "hashSHA256",
       c.estado::text       AS "estado",
       c.puntos,
       c.punto_detalle      AS "puntoDetalle",
       c.fecha_emision      AS "fechaEmision",
       c.fecha_vencimiento  AS "fechaVencimiento",
       c.nft_token_id       AS "nftTokenId",
       c.bfa_tx_hash        AS "bfaTxHash",
       c.pipeline_estado    AS "pipelineEstado",
       c.pipeline_inicio    AS "pipelineInicio",
       c.codigo_verif       AS "codigoVerif",
       c.sello_sellado_en   AS "selloSelladoEn",
       -- Bicicleta
       COALESCE(b.marca,'')    AS "marca",
       COALESCE(b.modelo,'')   AS "modelo",
       COALESCE(b.anio,0)      AS "anio",
       COALESCE(b.tipo::text,'') AS "tipo",
       COALESCE(b.color,'')    AS "color",
       -- Propietario (privacidad: solo nombre+dni)
       COALESCE(u.nombre,'')   AS "propietarioNombre",
       COALESCE(u.apellido,'') AS "propietarioApellido",
       COALESCE(u.dni,'')      AS "propietarioDNI",
       -- Inspector
       COALESCE(ui.nombre,'')  AS "inspectorNombre",
       COALESCE(ui.apellido,'') AS "inspectorApellido",
       COALESCE(ta.nombre,'')  AS "tallerNombre",
       COALESCE(ta.localidad,'') AS "tallerLocalidad",
       -- Sello temporal
       st.modo              AS "selloModo",
       -- Firma digital
       fp.firmado_en        AS "firmaFirmadoEn",
       fp.cert_subject      AS "firmaCertSubject",
       fp.valida_hasta      AS "firmaValidaHasta"
     FROM cits c
     JOIN bicicletas b ON b.id = c.bicicleta_id
     LEFT JOIN usuarios u ON u.id = c.propietario_id
     LEFT JOIN inspectores i ON i.id = c.inspector_id
     LEFT JOIN usuarios ui ON ui.id = i.usuario_id
     LEFT JOIN talleres_aliados ta ON ta.id = c.taller_aliado_id
     LEFT JOIN sellos_temporales st ON st.cit_id = c.id
     LEFT JOIN firmas_pdf fp ON fp.cit_id = c.id AND fp.revocada = FALSE
     WHERE b.numero_serie = $1
       AND c.estado IN ('ACTIVO','PENDIENTE','RECHAZADO','BLOQUEADO')
     ORDER BY c.creado_en DESC
     LIMIT 1`,
    [serial]
  )
}

// ══════════════════════════════════════════════════════════
// CONSULTA PARALELA BFA ON-CHAIN
// ══════════════════════════════════════════════════════════

/**
 * Consulta el contrato RodaidCIT en BFA en tiempo real para validar
 * que el hash almacenado en DB coincide con el hash on-chain.
 *
 * Ejecuta en paralelo dos llamadas al contrato:
 *   1. verificarIntegridad(hash)   → valido, bloqueado, tokenId
 *   2. datosCIT(tokenId)           → hash, serial, propietario, bloqueado
 *
 * Comparación triple:
 *   · DB.hash_sha256 == BFA_INDEX.hash_sha256 (ya verificado por el indexer)
 *   · DB.hash_sha256 == ON_CHAIN.hashSHA256   (verificación on-chain real)
 *
 * Si los tres coinciden → verificación completa ✓
 * Si alguno difiere  → ALERTA de manipulación
 */
interface BFAOnChainResult {
  consultada:       boolean
  hashCoincide:     boolean | null
  hashDB?:          string
  hashOnChain?:     string
  bloqueadoOnChain: boolean | null
  tokenIdOnChain?:  number
  latenciaNodo?:    number
  nodo:             string
  error?:           string
}

async function consultarBFAOnChain(
  hashSHA256: string,
  tokenId:    number | null,
  citId:      string
): Promise<BFAOnChainResult> {
  const t0 = Date.now()

  try {
    const { bfaService } = await import('./bfa.service')
    const { env }        = await import('../config/env')

    // Llamada 1: verificarIntegridad(hash) — siempre disponible (view function)
    const integridad = await bfaService.verificarIntegridad(hashSHA256)

    // Llamada 2: datosCIT(tokenId) — solo si tenemos tokenId
    let datosCIT: { hashSHA256: string; bloqueado: boolean } | null = null
    if (integridad.valido && integridad.tokenId) {
      datosCIT = await bfaService.datosCIT(integridad.tokenId)
    } else if (tokenId) {
      datosCIT = await bfaService.datosCIT(tokenId)
    }

    const latenciaNodo = Date.now() - t0

    // Comparar hash DB vs hash on-chain
    const hashOnChain   = datosCIT?.hashSHA256 ?? null
    const hashCoincide  = hashOnChain
      ? hashOnChain.toLowerCase() === hashSHA256.toLowerCase()
      : integridad.valido   // si integridad.valido=true el hash está registrado

    const tokenIdFinal  = integridad.tokenId || tokenId || undefined
    const bloqueado     = datosCIT?.bloqueado ?? integridad.bloqueado

    const nodo = env.BFA_RPC_URL
      ? new URL(env.BFA_RPC_URL).hostname
      : 'STUB'

    log.verificador.debug({
      citId, hashCoincide, tokenId: tokenIdFinal,
      bloqueadoOnChain: bloqueado, latenciaNodo, nodo,
    }, `BFA on-chain: ${hashCoincide ? '✓ hash coincide' : '⚠ hash NO coincide'}`)

    return {
      consultada:       true,
      hashCoincide,
      hashDB:           hashSHA256.slice(0, 16) + '...',
      hashOnChain:      hashOnChain ? hashOnChain.slice(0, 16) + '...' : undefined,
      bloqueadoOnChain: bloqueado,
      tokenIdOnChain:   tokenIdFinal,
      latenciaNodo,
      nodo,
    }

  } catch (err) {
    const ms = Date.now() - t0
    log.verificador.warn({ citId, err: (err as Error).message, ms },
      'BFA on-chain consulta falló — usando solo índice local')

    return {
      consultada:       false,
      hashCoincide:     null,
      bloqueadoOnChain: null,
      latenciaNodo:     ms,
      nodo:             'ERROR',
      error:            (err as Error).message.slice(0, 100),
    }
  }
}

async function consultarDenuncias(serial: string): Promise<Array<{ estado: string; creado_en: Date }>> {
  return query(
    `SELECT estado, creado_en FROM denuncias_robo
     WHERE numero_serie=$1 AND estado='ACTIVA'
     ORDER BY creado_en DESC LIMIT 5`,
    [serial]
  )
}

// ══════════════════════════════════════════════════════════
// CACHÉ REDIS
// ══════════════════════════════════════════════════════════

const CACHE_TTL_ENCONTRADO    = 300   // 5 min
const CACHE_TTL_NO_ENCONTRADO = 30    // 30 s

function cacheKey(tipo: 'serial' | 'hash' | 'numero', valor: string) {
  return `verificar:${tipo}:${valor.toUpperCase()}`
}

async function getCache(key: string): Promise<VerificacionPublica | null> {
  try {
    const redis = getRedis()
    const raw   = await redis.get(key)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

async function setCache(key: string, data: VerificacionPublica): Promise<void> {
  try {
    const redis = getRedis()
    const ttl   = data.encontrado ? CACHE_TTL_ENCONTRADO : CACHE_TTL_NO_ENCONTRADO
    await redis.set(key, JSON.stringify(data), 'EX', ttl)
  } catch { /* best-effort */ }
}

export async function invalidarCacheVerificador(serial?: string, numeroCIT?: string): Promise<void> {
  try {
    const redis = getRedis()
    const keys  = await redis.keys('verificar:*')
    const toDelete = keys.filter(k =>
      (!serial    || k.includes(serial.toUpperCase())) ||
      (!numeroCIT || k.includes(numeroCIT.toUpperCase()))
    )
    if (toDelete.length > 0) await redis.del(...toDelete)
  } catch { /* best-effort */ }
}

// ══════════════════════════════════════════════════════════
// AUDIT LOG
// ══════════════════════════════════════════════════════════

async function registrarLog(opts: {
  serial?:    string; hash?: string; numeroCIT?: string; codigoVerif?: string
  encontrado: boolean; estadoCIT?: string
  ip?: string; userAgent?: string; origen?: string
  ms: number; fromCache: boolean
}): Promise<void> {
  const ipHash = opts.ip ? hashIP(opts.ip) : null
  const esBot  = detectarBot(opts.userAgent)

  await query(
    `INSERT INTO verificaciones_log
       (serial, hash_sha256, numero_cit, codigo_verif, encontrado, estado_cit,
        ip_origen, ip_hash, user_agent, origen, ms, from_cache, es_bot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      opts.serial ?? null, opts.hash ?? null, opts.numeroCIT ?? null,
      opts.codigoVerif ?? null, opts.encontrado, opts.estadoCIT ?? null,
      null,                    // ip_origen: NO almacenar IP cruda (privacidad)
      ipHash,
      opts.userAgent?.slice(0, 255) ?? null,
      opts.origen ?? 'API', opts.ms, opts.fromCache, esBot,
    ]
  ).catch(() => {})
}

// ══════════════════════════════════════════════════════════
// ENSAMBLADO DE RESPUESTA
// ══════════════════════════════════════════════════════════

async function armarRespuesta(
  serial:     string,
  t0:         number,
  fromCache:  boolean,
  ip?:        string,
  userAgent?: string,
  origen?:    string
): Promise<VerificacionPublica> {
  const baseURL = process.env.RODAID_BASE_URL ?? 'https://rodaid.com.ar'

  // ── Consultas en paralelo ─────────────────────────────────
  // DB (CIT + bicicleta + inspector + sello + firma) y denuncias
  const [dbRow, denuncias] = await Promise.all([
    consultarDB(serial),
    consultarDenuncias(serial),
  ])

  // ── BFA Index (local, sin nodo) ────────────────────────────
  let bfaData: { indexado: boolean; tokenId?: number; txHash?: string
    estado: string; bloqueado: boolean; bloqueoMotivo?: string; transferencias: number
  } = { indexado: false, estado: 'NO_ENCONTRADO', bloqueado: false, transferencias: 0 }

  try {
    const { verificarPorSerial } = await import('./bfa.indexer')
    const bfa = await verificarPorSerial(serial)
    bfaData = {
      indexado:       bfa.encontrado,
      tokenId:        bfa.bfa.tokenId,
      txHash:         bfa.bfa.mintTxHash?.slice(0, 18),
      estado:         bfa.estado,
      bloqueado:      bfa.bfa.bloqueado,
      bloqueoMotivo:  bfa.bfa.bloqueoMotivo,
      transferencias: bfa.bfa.transferencias,
    }
  } catch { /* BFA index opcional */ }

  // ── BFA On-Chain: verificarIntegridad + datosCIT en paralelo ──
  // Se lanza en paralelo con el resto — no bloquea si el nodo BFA no responde
  const hashParaVerif = dbRow?.hashSHA256 ?? null
  const tokenIdParaVerif = dbRow?.nftTokenId ?? bfaData.tokenId ?? null

  let bfaOnChain: BFAOnChainResult = {
    consultada:       false,
    hashCoincide:     null,
    bloqueadoOnChain: null,
    nodo:             'NO_CONSULTADO',
  }

  if (hashParaVerif) {
    bfaOnChain = await consultarBFAOnChain(
      hashParaVerif,
      tokenIdParaVerif,
      dbRow?.citId ?? ''
    )
  }

  // Respuesta "no encontrado"
  if (!dbRow) {
    const resp: VerificacionPublica = {
      consultadoEn:  new Date().toISOString(),
      fromCache,
      duracionMs:    Date.now() - t0,
      serial,
      encontrado:    false,
      estado:        'NO_ENCONTRADO',
      estadoLabel:   estadoLabel('NO_ENCONTRADO'),
      vigente:       false,
      blockchain:    { ...bfaData, red: 'Blockchain Federal Argentina (BFA)',
        validacionOnChain: { consultada: false, hashCoincide: null, bloqueadoOnChain: null, nodo: 'NO_CONSULTADO' } },
      selloTemporal: { emitido: false },
      firmaDigital:  { firmado: false },
      links:         { verificarURL: `${baseURL}/verificar/${encodeURIComponent(serial)}` },
      alertas:       [],
    }
    await registrarLog({ serial, encontrado: false, ip, userAgent, origen, ms: resp.duracionMs, fromCache })
    return resp
  }

  // ── Motor de estados (resolución con todas las fuentes) ──
  const estadoInput: EstadoInput = {
    dbEstado:            dbRow.estado,
    pipelineEstado:      dbRow.pipelineEstado,
    pipelineInicio:      dbRow.pipelineInicio,
    fechaVencimiento:    dbRow.fechaVencimiento,
    fechaEmision:        dbRow.fechaEmision,
    bfaBloqueado:        bfaData.bloqueado,
    bfaBloqueadoOnChain: bfaOnChain.bloqueadoOnChain,
    bfaIndexado:         bfaData.indexado,
    denunciasActivas:    denuncias.length,
    ultimaDenuncia:      denuncias[0]?.creado_en,
    citId:               dbRow.citId,
    serial,
  }
  const estadoResuelto = resolverEstado(estadoInput)
  const estadoFinal    = estadoResuelto.estado
  const vigente        = estadoResuelto.vigente

  // Puntos de inspección
  const puntoDetalle = typeof dbRow.puntoDetalle === 'string'
    ? JSON.parse(dbRow.puntoDetalle) : (dbRow.puntoDetalle ?? {})
  const puntosAprobados = Object.values(puntoDetalle as Record<string, boolean>)
    .filter(Boolean).length
  const totalPuntos = dbRow.puntos ?? puntosAprobados

  const ahora = new Date()
  // Alertas
  const alertas: VerificacionPublica['alertas'] = []
  if (denuncias.length > 0) {
    alertas.push({
      tipo:    'DENUNCIA_ROBO',
      mensaje: 'Esta bicicleta tiene una denuncia de robo activa en RODAID',
      desde:   denuncias[0].creado_en.toISOString(),
    })
  }
  if (estadoFinal === 'EXPIRADO') {
    alertas.push({ tipo: 'CIT_EXPIRADO',
      mensaje: `El certificado venció el ${dbRow.fechaVencimiento?.toLocaleDateString('es-AR')}` })
  }
  if (bfaData.bloqueado || bfaOnChain.bloqueadoOnChain) {
    alertas.push({ tipo: 'BLOQUEADO_BFA',
      mensaje: `Bloqueado en BFA: ${bfaData.bloqueoMotivo ?? 'motivo no especificado'}` })
  }

  // ⚠ CRÍTICO: hash en DB no coincide con hash on-chain → posible manipulación
  if (bfaOnChain.consultada && bfaOnChain.hashCoincide === false) {
    alertas.push({
      tipo:    'HASH_MISMATCH_ONCHAIN',
      mensaje: `ALERTA: El hash del certificado en la base de datos (${bfaOnChain.hashDB}) ` +
               `NO COINCIDE con el hash registrado en la Blockchain Federal Argentina ` +
               `(${bfaOnChain.hashOnChain}). El documento puede haber sido manipulado.`,
    })
    log.verificador.error({
      serial, citId: dbRow?.citId,
      hashDB:       bfaOnChain.hashDB,
      hashOnChain:  bfaOnChain.hashOnChain,
    }, '🚨 HASH MISMATCH ONCHAIN — posible manipulación del CIT')
  }

  const hashPrefix = dbRow.hashSHA256 ? dbRow.hashSHA256.slice(0, 16) + '...' : undefined

  const resp: VerificacionPublica = {
    consultadoEn:  ahora.toISOString(),
    fromCache,
    duracionMs:    Date.now() - t0,

    serial,
    numeroCIT:     dbRow.numeroCIT,
    hashSHA256:    hashPrefix,

    encontrado:    true,
    estado:        estadoFinal,
    estadoLabel:   estadoResuelto.estadoLabel,
    vigente,
    estadoDetalle: {
      descripcion:       estadoResuelto.descripcion,
      accion:            estadoResuelto.accion,
      color:             estadoResuelto.color,
      icono:             estadoResuelto.icono,
      diasParaVencer:    estadoResuelto.diasParaVencer,
      diasEnEstado:      estadoResuelto.diasEnEstado,
      fuentesPrincipales: estadoResuelto.fuentesPrincipales,
      pipelineVenceEn:   estadoResuelto.pipelineVenceEn?.toISOString(),
      bloqueoFecha:      estadoResuelto.bloqueoFecha?.toISOString(),
      bloqueoMotivo:     estadoResuelto.bloqueoMotivo,
    },
    badge:         estadoBadge(estadoResuelto),

    bicicleta: {
      marca:  dbRow.marca,
      modelo: dbRow.modelo,
      anio:   dbRow.anio,
      tipo:   dbRow.tipo,
      color:  dbRow.color,
    },

    inspeccion: {
      resultado:        totalPuntos >= 15 ? 'APROBADO' : 'RECHAZADO',
      puntos:           totalPuntos,
      maximo:           20,
      porcentaje:       Math.round(totalPuntos / 20 * 100),
      fechaEmision:     dbRow.fechaEmision?.toISOString() ?? '',
      fechaVencimiento: dbRow.fechaVencimiento?.toISOString() ?? '',
    },

    propietario: {
      nombre: ocultarApellido(
        `${dbRow.propietarioNombre} ${dbRow.propietarioApellido}`.trim()
      ),
      dni: ocultarDNI(dbRow.propietarioDNI),
    },

    inspector: {
      nombre:    dbRow.inspectorNombre,
      apellido:  dbRow.inspectorApellido,
      taller:    dbRow.tallerNombre,
      localidad: dbRow.tallerLocalidad,
    },

    blockchain: {
      red:            'Blockchain Federal Argentina (BFA)',
      indexado:       bfaData.indexado,
      tokenId:        bfaData.tokenId ?? dbRow.nftTokenId ?? undefined,
      txHash:         bfaData.txHash ?? dbRow.bfaTxHash?.slice(0, 18) ?? undefined,
      estado:         bfaData.estado,
      bloqueado:      bfaData.bloqueado || (bfaOnChain.bloqueadoOnChain ?? false),
      bloqueoMotivo:  bfaData.bloqueoMotivo,
      transferencias: bfaData.transferencias,
      validacionOnChain: bfaOnChain,
    },

    selloTemporal: {
      emitido:      !!dbRow.codigoVerif,
      codigoVerif:  dbRow.codigoVerif ?? undefined,
      selladoEn:    dbRow.selloSelladoEn?.toISOString() ?? undefined,
      modo:         dbRow.selloModo ?? undefined,
      modoLabel:    dbRow.selloModo ? modoSelloLabel(dbRow.selloModo) : undefined,
    },

    firmaDigital: {
      firmado:      !!dbRow.firmaFirmadoEn,
      firmadoEn:    dbRow.firmaFirmadoEn?.toISOString() ?? undefined,
      certSubject:  dbRow.firmaCertSubject ?? undefined,
      validaHasta:  dbRow.firmaValidaHasta?.toISOString() ?? undefined,
    },

    links: {
      verificarURL: `${baseURL}/verificar/${encodeURIComponent(serial)}`,
      qrPNG:        `/api/v1/qr/${encodeURIComponent(serial)}`,
    },

    alertas,
  }

  await registrarLog({
    serial, numeroCIT: dbRow.numeroCIT, encontrado: true, estadoCIT: estadoFinal,
    ip, userAgent, origen, ms: resp.duracionMs, fromCache,
  })

  return resp
}

// ══════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL — por serial
// ══════════════════════════════════════════════════════════

export async function verificarSerial(
  serial:     string,
  ip?:        string,
  userAgent?: string,
  origen?:    string
): Promise<VerificacionPublica> {
  const t0 = Date.now()
  const serialNorm = serial.trim().toUpperCase()
  const key  = cacheKey('serial', serialNorm)

  // Caché hit
  const cached = await getCache(key)
  if (cached) {
    log.verificador.debug({ serial: serialNorm, fromCache: true }, 'Verificación desde caché')
    const resp = { ...cached, consultadoEn: new Date().toISOString(),
      duracionMs: Date.now() - t0, fromCache: true }
    await registrarLog({ serial: serialNorm, encontrado: cached.encontrado,
      ip, userAgent, origen, ms: resp.duracionMs, fromCache: true })
    return resp
  }

  const resp = await armarRespuesta(serialNorm, t0, false, ip, userAgent, origen)
  await setCache(key, resp)

  log.verificador.info({
    serial: serialNorm, encontrado: resp.encontrado,
    estado: resp.estado, ms: resp.duracionMs,
  }, `✓ Verificación ${resp.encontrado ? resp.estado : 'NOT_FOUND'}`)

  return resp
}

// ══════════════════════════════════════════════════════════
// FUNCIÓN — por número de CIT
// ══════════════════════════════════════════════════════════

export async function verificarNumeroCIT(
  numeroCIT:  string,
  ip?:        string,
  userAgent?: string,
  origen?:    string
): Promise<VerificacionPublica> {
  const t0 = Date.now()
  // Resolver el serial desde el número de CIT
  const row = await queryOne<{ numero_serie: string }>(
    `SELECT b.numero_serie FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id
     WHERE c.numero_cit=$1 LIMIT 1`,
    [numeroCIT.toUpperCase()]
  )
  if (!row) {
    return {
      consultadoEn: new Date().toISOString(), fromCache: false,
      duracionMs: Date.now() - t0, serial: '', numeroCIT,
      encontrado: false, estado: 'NO_ENCONTRADO',
      estadoLabel: estadoLabel('NO_ENCONTRADO'), vigente: false,
      blockchain: { red: 'BFA', indexado: false, estado: 'NO_ENCONTRADO', bloqueado: false, transferencias: 0,
        validacionOnChain: { consultada: false, hashCoincide: null, bloqueadoOnChain: null, nodo: 'NO_CONSULTADO' } },
      selloTemporal: { emitido: false }, firmaDigital: { firmado: false },
      links: { verificarURL: `${process.env.RODAID_BASE_URL ?? 'https://rodaid.com.ar'}/verificar/${numeroCIT}` },
      alertas: [],
    }
  }
  return verificarSerial(row.numero_serie, ip, userAgent, origen)
}

// ══════════════════════════════════════════════════════════
// FUNCIÓN — por código de verificación RODAID
// ══════════════════════════════════════════════════════════

export async function verificarCodigo(
  codigo:     string,
  ip?:        string,
  userAgent?: string,
  origen?:    string
): Promise<VerificacionPublica> {
  const row = await queryOne<{ cit_id: string }>(
    `SELECT cit_id FROM sellos_temporales WHERE codigo_verif=$1`, [codigo]
  )
  if (!row) {
    const t0 = Date.now()
    return {
      consultadoEn: new Date().toISOString(), fromCache: false,
      duracionMs: Date.now() - t0, serial: '',
      encontrado: false, estado: 'NO_ENCONTRADO',
      estadoLabel: estadoLabel('NO_ENCONTRADO'), vigente: false,
      blockchain: { red: 'BFA', indexado: false, estado: 'NO_ENCONTRADO', bloqueado: false, transferencias: 0,
        validacionOnChain: { consultada: false, hashCoincide: null, bloqueadoOnChain: null, nodo: 'NO_CONSULTADO' } },
      selloTemporal: { emitido: false, codigoVerif: codigo }, firmaDigital: { firmado: false },
      links: { verificarURL: '' }, alertas: [],
    }
  }
  // Resolver serial desde citId
  const citRow = await queryOne<{ numero_serie: string }>(
    `SELECT b.numero_serie FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id WHERE c.id=$1`, [row.cit_id]
  )
  if (!citRow) return verificarSerial('', ip, userAgent, origen)
  return verificarSerial(citRow.numero_serie, ip, userAgent, origen)
}

// ══════════════════════════════════════════════════════════
// ADMIN — estadísticas de verificaciones
// ══════════════════════════════════════════════════════════

export async function getVerificacionesStats(dias = 7) {
  const [totales, porOrigen, topSeriales, porHora] = await Promise.all([
    queryOne<{ total: string; encontradas: string; no_encontradas: string; desde_cache: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE encontrado)::text AS encontradas,
              COUNT(*) FILTER (WHERE NOT encontrado)::text AS no_encontradas,
              COUNT(*) FILTER (WHERE from_cache)::text AS desde_cache
       FROM verificaciones_log
       WHERE creado_en > NOW() - INTERVAL '${dias} days'`, []
    ),
    query<{ origen: string; count: string }>(
      `SELECT origen, COUNT(*)::text AS count FROM verificaciones_log
       WHERE creado_en > NOW() - INTERVAL '${dias} days'
       GROUP BY origen ORDER BY count DESC`, []
    ),
    query<{ serial: string; consultas: string }>(
      `SELECT serial, COUNT(*)::text AS consultas FROM verificaciones_log
       WHERE creado_en > NOW() - INTERVAL '${dias} days' AND serial IS NOT NULL
       GROUP BY serial ORDER BY consultas DESC LIMIT 10`, []
    ),
    query<{ hora: string; consultas: string }>(
      `SELECT DATE_TRUNC('hour', creado_en)::text AS hora, COUNT(*)::text AS consultas
       FROM verificaciones_log
       WHERE creado_en > NOW() - INTERVAL '24 hours'
       GROUP BY hora ORDER BY hora DESC`, []
    ),
  ])
  return {
    periodo: `${dias} días`,
    total:          parseInt(totales?.total ?? '0'),
    encontradas:    parseInt(totales?.encontradas ?? '0'),
    noEncontradas:  parseInt(totales?.no_encontradas ?? '0'),
    desdeCache:     parseInt(totales?.desde_cache ?? '0'),
    porOrigen:      Object.fromEntries(porOrigen.map(r => [r.origen, parseInt(r.count)])),
    topSeriales:    topSeriales.map(r => ({ serial: r.serial, consultas: parseInt(r.consultas) })),
    porHora,
  }
}
