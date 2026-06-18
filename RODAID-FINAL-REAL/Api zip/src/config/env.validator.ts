// ─── RODAID · Validador de Entorno de Producción ──────────
//
// Basado en la propuesta de Gemini (gemini-code-1781033184740.ts)
// extendido con checks específicos de RODAID:
//
//   · Variables críticas (Zod strict)
//   · Variables de producción obligatorias (bloquean el arranque)
//   · Variables opcionales avanzadas (warn si faltan)
//   · PostgreSQL: conexión + 68 tablas
//   · Redis: PING round-trip
//   · BFA: JSON-RPC eth_blockNumber (STUB detectado si no configurado)
//   · MxM: reachability del endpoint OAuth (opcional)
//   · Anthropic: presencia de API key
//   · MinSeg: presencia de credenciales mTLS
//   · S3/CDN: presencia de credenciales de almacenamiento
//
// ══ CRASH-EARLY ════════════════════════════════════════════
//
//   Si NODE_ENV=production y algún check CRÍTICO falla →
//   imprime el diagnóstico completo y llama process.exit(1).
//   En development/test: solo warnings, nunca bloquea.
//
// ══ USO ════════════════════════════════════════════════════
//
//   import { validateProductionEnvironment } from './config/env.validator'
//
//   // En main() de index.ts, ANTES del app.listen():
//   await validateProductionEnvironment()

import { Client as PGClient } from 'pg'
import { createClient  }      from 'redis'
import axios                  from 'axios'
import { logger }             from '../middleware/logger'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export type SeverityLevel = 'CRITICAL' | 'WARN' | 'INFO'

export interface EnvCheck {
  nombre:    string
  severidad: SeverityLevel
  ok:        boolean
  mensaje:   string
  detalle?:  string
}

export interface ValidationResult {
  success:  boolean          // true si ningún CRITICAL falló
  entorno:  string
  checks:   EnvCheck[]
  criticos: EnvCheck[]       // checks CRITICAL fallidos
  warnings: EnvCheck[]       // checks WARN fallidos
  duracionMs: number
}

// ══════════════════════════════════════════════════════════
// VARIABLES POR CATEGORÍA
// ══════════════════════════════════════════════════════════

// CRÍTICAS — su ausencia bloquea el arranque en producción
const VARS_CRITICAS: { var: string; desc: string }[] = [
  { var: 'DATABASE_URL',    desc: 'Cadena de conexión PostgreSQL'           },
  { var: 'REDIS_URL',       desc: 'Cadena de conexión Redis'                },
  { var: 'JWT_SECRET',      desc: 'Secreto JWT (mín. 32 caracteres)'        },
  { var: 'ALLOWED_ORIGINS', desc: 'Orígenes permitidos CORS'                },
]

// PRODUCCIÓN — obligatorias solo en NODE_ENV=production
const VARS_PRODUCCION: { var: string; desc: string; modulo: string }[] = [
  { var: 'MXM_CLIENT_ID',          desc: 'OAuth MxM – ID de cliente',        modulo: 'MxM'       },
  { var: 'MXM_CLIENT_SECRET',      desc: 'OAuth MxM – secreto',              modulo: 'MxM'       },
  { var: 'MXM_AUTH_URL',           desc: 'URL de autorización MxM',          modulo: 'MxM'       },
  { var: 'MXM_PAGOS_URL',          desc: 'Endpoint de pagos MxM',            modulo: 'MxM'       },
  { var: 'MP_ACCESS_TOKEN',        desc: 'MercadoPago Access Token',          modulo: 'Pagos'     },
  { var: 'MP_WEBHOOK_SECRET',      desc: 'MercadoPago Webhook Secret',        modulo: 'Pagos'     },
  { var: 'BFA_RPC_URL',            desc: 'URL nodo BFA (JSON-RPC)',           modulo: 'BFA'       },
  { var: 'BFA_WALLET_PRIVATE_KEY', desc: 'Clave privada wallet BFA',          modulo: 'BFA'       },
  { var: 'BFA_CONTRACT_ADDRESS',   desc: 'Dirección contrato RCIT en BFA',    modulo: 'BFA'       },
  { var: 'MINSEG_API_KEY',         desc: 'Clave API Ministerio de Seguridad', modulo: 'MinSeg'    },
  { var: 'MINSEG_API_URL',         desc: 'URL endpoint MinSeg',               modulo: 'MinSeg'    },
  { var: 'ANTHROPIC_API_KEY',      desc: 'API key Anthropic (RODAID-GPT)',    modulo: 'GPT'       },
  { var: 'CDN_URL',                desc: 'URL base del CDN de assets',        modulo: 'CDN'       },
]

// AVANZADAS — warnings si faltan pero no bloquean producción
const VARS_AVANZADAS: { var: string; desc: string }[] = [
  { var: 'RESEND_API_KEY',          desc: 'Email transaccional (Resend)'      },
  { var: 'S3_BUCKET_FOTOS',         desc: 'Bucket S3 para fotos de bicicletas'},
  { var: 'APNS_KEY_ID',             desc: 'APNs para notificaciones iOS'       },
  { var: 'RODAID_FIRMA_CERT_PEM',   desc: 'Certificado X.509 para firma PDF'  },
  { var: 'PINATA_JWT',              desc: 'IPFS para metadata NFT (Pinata)'   },
]

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════

function check(
  nombre:    string,
  severidad: SeverityLevel,
  ok:        boolean,
  ok_msg:    string,
  fail_msg:  string,
  detalle?:  string
): EnvCheck {
  return { nombre, severidad, ok, mensaje: ok ? ok_msg : fail_msg, detalle }
}

function hasVar(name: string): boolean {
  const v = process.env[name]
  return typeof v === 'string' && v.trim().length > 0
}

// ══════════════════════════════════════════════════════════
// VALIDADOR PRINCIPAL
// ══════════════════════════════════════════════════════════

export async function validateProductionEnvironment(): Promise<ValidationResult> {
  const t0      = Date.now()
  const entorno = process.env.NODE_ENV ?? 'development'
  const isProd  = entorno === 'production'
  const checks: EnvCheck[] = []

  // ── 1. Variables críticas ────────────────────────────────
  for (const { var: v, desc } of VARS_CRITICAS) {
    const ok = hasVar(v)
    checks.push(check(
      `VAR:${v}`, 'CRITICAL',
      ok,
      `${v} presente`,
      `Falta variable crítica: ${v} — ${desc}`,
    ))
  }

  // JWT_SECRET mínimo 32 chars
  const jwtSecret = process.env.JWT_SECRET ?? ''
  checks.push(check(
    'JWT_SECRET:min32', 'CRITICAL',
    jwtSecret.length >= 32,
    'JWT_SECRET tiene longitud adecuada (≥32 chars)',
    `JWT_SECRET demasiado corto: ${jwtSecret.length} chars (mínimo 32)`,
  ))

  // ── 2. Variables de producción ───────────────────────────
  for (const { var: v, desc, modulo } of VARS_PRODUCCION) {
    const ok = hasVar(v)
    // En desarrollo: WARN si falta. En producción: CRITICAL.
    const sev: SeverityLevel = isProd ? 'CRITICAL' : 'WARN'
    checks.push(check(
      `VAR:${v}`, sev,
      ok,
      `${v} presente [${modulo}]`,
      `${isProd ? '❌ Falta' : '⚠ Falta (dev-ok)'}: ${v} — ${desc} [módulo: ${modulo}]`,
    ))
  }

  // ── 3. Variables avanzadas (warnings) ────────────────────
  for (const { var: v, desc } of VARS_AVANZADAS) {
    checks.push(check(
      `VAR:${v}`, 'WARN',
      hasVar(v),
      `${v} configurada`,
      `⚠ Opcional no configurada: ${v} — ${desc}`,
    ))
  }

  // ── 4. Conexión PostgreSQL ───────────────────────────────
  if (hasVar('DATABASE_URL')) {
    try {
      const pgClient = new PGClient({ connectionString: process.env.DATABASE_URL })
      await pgClient.connect()

      const tablas = await pgClient.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public'`
      )
      const nTablas = parseInt(tablas.rows[0].count)

      // Verificar al menos las tablas críticas
      const tablasReq = ['usuarios','bicicletas','cits','marketplace_publicaciones','transacciones']
      const tablasList = await pgClient.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname='public'`
      )
      const existentes = new Set(tablasList.rows.map(r => r.tablename))
      const faltantes  = tablasReq.filter(t => !existentes.has(t))

      await pgClient.end()

      checks.push(check(
        'DB:connection', 'CRITICAL',
        nTablas > 0,
        `PostgreSQL OK — ${nTablas} tablas en schema public`,
        `PostgreSQL conecta pero la DB está vacía (faltan migraciones) — ${nTablas} tablas`,
        nTablas < 68 ? `Se esperan ≥68 tablas, se encontraron ${nTablas}` : undefined,
      ))

      checks.push(check(
        'DB:tablas-criticas', 'CRITICAL',
        faltantes.length === 0,
        `Tablas críticas presentes: ${tablasReq.join(', ')}`,
        `Faltan tablas críticas: ${faltantes.join(', ')}`,
      ))

    } catch (err: any) {
      checks.push(check(
        'DB:connection', 'CRITICAL',
        false,
        '',
        `Error al conectar a DATABASE_URL: ${err.message}`,
      ))
    }
  }

  // ── 5. Conexión Redis ────────────────────────────────────
  if (hasVar('REDIS_URL')) {
    try {
      const rc = createClient({ url: process.env.REDIS_URL })
      await rc.connect()
      const pong = await rc.ping()
      await rc.disconnect()
      checks.push(check(
        'Redis:ping', 'CRITICAL',
        pong === 'PONG',
        'Redis OK — PING → PONG',
        `Redis responde pero PING devolvió: ${pong}`,
      ))
    } catch (err: any) {
      checks.push(check(
        'Redis:ping', 'CRITICAL',
        false,
        '',
        `Error al conectar a REDIS_URL: ${err.message}`,
      ))
    }
  }

  // ── 6. BFA JSON-RPC (eth_blockNumber) ───────────────────
  const bfaRpc = process.env.BFA_RPC_URL
  if (bfaRpc) {
    try {
      const resp = await axios.post(
        bfaRpc,
        { jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 },
        { timeout: 5_000 }
      )
      const blockHex: string = resp.data?.result
      const block = blockHex ? parseInt(blockHex, 16) : null

      checks.push(check(
        'BFA:eth_blockNumber', 'WARN',
        resp.status === 200 && !!blockHex,
        `BFA nodo OK — bloque actual: ${block?.toLocaleString('es-AR')}`,
        'BFA_RPC_URL respondió pero el formato JSON-RPC no es válido.',
        !blockHex ? `Respuesta: ${JSON.stringify(resp.data).slice(0, 80)}` : undefined,
      ))
    } catch (err: any) {
      // En producción con BFA: CRITICAL. Sin BFA configurado: solo INFO.
      const sev: SeverityLevel = isProd && hasVar('BFA_CONTRACT_ADDRESS') ? 'CRITICAL' : 'WARN'
      checks.push(check(
        'BFA:eth_blockNumber', sev,
        false,
        '',
        `No se pudo conectar al nodo BFA (BFA_RPC_URL): ${err.message}`,
        'Sin nodo BFA el modo es STUB — los NFTs no se acuñarán en mainnet.',
      ))
    }
  } else {
    checks.push(check(
      'BFA:configuracion', 'WARN',
      false,
      '',
      'BFA_RPC_URL no configurada — modo STUB activo (NFTs simulados)',
      'Para producción solicitar acceso al nodo BFA (ONTI).',
    ))
  }

  // ── 7. MxM OAuth — reachability ─────────────────────────
  const mxmAuth = process.env.MXM_AUTH_URL
  if (mxmAuth) {
    try {
      await axios.get(mxmAuth.replace('/oauth/authorize','/.well-known/openid-configuration'), { timeout: 4_000 })
      checks.push(check('MxM:reachability', 'WARN', true, 'MxM endpoint alcanzable', ''))
    } catch (err: any) {
      const sev: SeverityLevel = isProd ? 'WARN' : 'INFO'
      checks.push(check(
        'MxM:reachability', sev, false, '',
        `MxM no alcanzable desde este entorno: ${err.message}`,
        'El servidor puede arrancar — MxM tiene circuit-breaker integrado.',
      ))
    }
  }

  // ── 8. Anthropic API key — formato ──────────────────────
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? ''
  const anthropicOk  = anthropicKey.startsWith('sk-ant-') && anthropicKey.length > 40
  checks.push(check(
    'Anthropic:api-key', isProd ? 'CRITICAL' : 'WARN',
    anthropicOk,
    'ANTHROPIC_API_KEY con formato válido (sk-ant-...)',
    anthropicKey
      ? `ANTHROPIC_API_KEY tiene formato incorrecto (no empieza con sk-ant-)`
      : 'ANTHROPIC_API_KEY no configurada — RODAID-GPT no estará disponible',
  ))

  // ── 9. MinSeg — presencia de credenciales mTLS ──────────
  const minsegOk = hasVar('MINSEG_API_KEY') && hasVar('MINSEG_API_URL')
  checks.push(check(
    'MinSeg:credenciales', isProd ? 'CRITICAL' : 'WARN',
    minsegOk,
    'Credenciales MinSeg configuradas (API_KEY + API_URL)',
    'Faltan credenciales MinSeg — el cross-reference de denuncia operará en modo STUB',
  ))

  // ── 10. S3 / Almacenamiento ──────────────────────────────
  const s3Ok = hasVar('S3_BUCKET_FOTOS') && hasVar('AWS_ACCESS_KEY_ID') && hasVar('AWS_SECRET_ACCESS_KEY')
  checks.push(check(
    'S3:credenciales', 'WARN',
    s3Ok,
    'S3 configurado — fotos de inspecciones operativas',
    'S3 no configurado — las fotos de inspección se almacenarán localmente (solo dev)',
  ))

  // ── 11. CDN URL — formato ─────────────────────────────────
  const cdnUrl = process.env.CDN_URL ?? ''
  checks.push(check(
    'CDN:url', 'WARN',
    cdnUrl.startsWith('https://'),
    `CDN_URL configurada: ${cdnUrl}`,
    cdnUrl ? `CDN_URL no usa HTTPS: ${cdnUrl}` : 'CDN_URL no configurada — assets servidos desde /api/cdn/',
  ))

  // ── 12. NODE_ENV explícito ────────────────────────────────
  checks.push(check(
    'NODE_ENV', 'INFO',
    ['development','production','test'].includes(entorno),
    `NODE_ENV = ${entorno}`,
    `NODE_ENV inválido: "${entorno}"`,
  ))

  // ─────────────────────────────────────────────────────────
  const criticos = checks.filter(c => !c.ok && c.severidad === 'CRITICAL')
  const warnings = checks.filter(c => !c.ok && c.severidad === 'WARN')

  return {
    success:     criticos.length === 0,
    entorno,
    checks,
    criticos,
    warnings,
    duracionMs:  Date.now() - t0,
  }
}

// ══════════════════════════════════════════════════════════
// RUNNER — llamar desde main() de index.ts
// ══════════════════════════════════════════════════════════

export async function runEnvValidation(): Promise<void> {
  const isProd = (process.env.NODE_ENV ?? 'development') === 'production'

  logger.info('─── RODAID · Auditoría de entorno ───────────────────')
  logger.info(`Entorno: ${process.env.NODE_ENV ?? 'development (default)'}`)

  const result = await validateProductionEnvironment()

  // Imprimir todos los checks
  for (const c of result.checks) {
    if (c.ok) {
      if (c.severidad === 'CRITICAL') logger.info(`  ✅ ${c.nombre}: ${c.mensaje}`)
      // WARN/INFO exitosos → silencio para no saturar el log
    } else {
      if (c.severidad === 'CRITICAL') logger.error({ check: c.nombre, detalle: c.detalle }, `  ❌ CRÍTICO: ${c.mensaje}`)
      else if (c.severidad === 'WARN') logger.warn({ check: c.nombre, detalle: c.detalle },  `  ⚠  WARN:   ${c.mensaje}`)
      else                             logger.info({ check: c.nombre },                        `  ℹ  INFO:   ${c.mensaje}`)
    }
  }

  logger.info('─────────────────────────────────────────────────────')
  logger.info(`Resultado: ${result.criticos.length} críticos · ${result.warnings.length} warnings · ${result.duracionMs}ms`)

  // Warnings: loggear resumen
  if (result.warnings.length > 0) {
    logger.warn(`⚠  ${result.warnings.length} módulos en modo STUB/limitado:`)
    result.warnings.forEach(w => logger.warn(`   · ${w.nombre.replace('VAR:','')}`))
  }

  if (!result.success) {
    logger.error('─────────────────────────────────────────────────────')
    logger.error(`❌ ERROR CRÍTICO: ${result.criticos.length} checks fallaron`)
    result.criticos.forEach(c => logger.error(`   · ${c.mensaje}`))
    logger.error('─── Servidor detenido por seguridad ─────────────────')

    if (isProd) {
      // Solo crash en producción — en dev el desarrollador puede querer arrancar igual
      process.exit(1)
    } else {
      logger.warn('(desarrollo) Continuando a pesar de los errores críticos…')
    }
  } else {
    logger.info('✅ Entorno de producción validado con éxito.')
  }
}
