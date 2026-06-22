// ─── RODAID · Rate Limiting GPT por Plan ──────────────────
//
// Tres capas de rate limit combinadas:
//
//   CAPA 1 — MENSUAL (PostgreSQL)
//     · LIBRE:    30 consultas / mes
//     · ESTANDAR: 200 consultas / mes
//     · PREMIUM: 1.000 consultas / mes
//     Fuente de verdad: gpt_uso_mensual (tabla)
//
//   CAPA 2 — POR HORA (Redis, TTL 1h)
//     · LIBRE:    10/hora
//     · ESTANDAR: 20/hora
//     · PREMIUM:  50/hora
//     Keys: gpt:rl:hora:{userId}:{YYYY-MM-DDTHH}
//
//   CAPA 3 — BURST (Redis, TTL 1min)
//     · LIBRE:    3/min
//     · ESTANDAR: 5/min
//     · PREMIUM: 10/min
//     Keys: gpt:rl:burst:{ipHash}:{YYYY-MM-DDTHH:mm}
//
// ══ FLUJO ═════════════════════════════════════════════════
//
//   verificarLimitesPlan(userId, ip?)
//     → obtener plan del usuario (Redis cache 5min o DB)
//     → verificar MENSUAL (DB)
//     → verificar HORA (Redis)
//     → verificar BURST (Redis)
//     → RateLimitResult { ok, bloqueadoPor, limites, uso }
//
//   registrarConsumo(userId, tokensEntrada, tokensSalida)
//     → INCR en Redis (hora + burst)
//     → INSERT/UPDATE en gpt_uso_mensual (PostgreSQL)
//
// ══ RESPUESTA AL CLIENTE ══════════════════════════════════
//
//   rateLimit: {
//     plan,
//     consultasMes: { usadas, limite, restantes },
//     consultasHora: { usadas, limite, restantes },
//     tokensMes: { usados, limite, restantes },
//     resetMes: "2026-07-01T00:00:00.000Z",
//     resetHora: "2026-06-08T22:00:00.000Z",
//   }

import crypto              from 'crypto'
import { query, queryOne } from '../config/database'
import { getRedis }        from '../config/redis'
import { log }             from '../middleware/logger'
import { AppError }        from '../middleware/errorHandler'

// ══════════════════════════════════════════════════════════
// PLANES Y LÍMITES
// ══════════════════════════════════════════════════════════

export interface PlanLimites {
  plan:          string
  label:         string
  consultasMes:  number
  tokensMes:     number
  consultasHora: number
  burstMin:      number
}

// Cache local en memoria (fallback si Redis falla)
const PLANES_DEFAULT: Record<string, PlanLimites> = {
  LIBRE:    { plan:'LIBRE',    label:'Plan Libre',    consultasMes:30,   tokensMes:60_000,    consultasHora:10, burstMin:3 },
  ESTANDAR: { plan:'ESTANDAR', label:'Plan Estándar', consultasMes:200,  tokensMes:400_000,   consultasHora:20, burstMin:5 },
  PREMIUM:  { plan:'PREMIUM',  label:'Plan Premium',  consultasMes:1000, tokensMes:2_000_000, consultasHora:50, burstMin:10 },
}

export interface RateLimitResult {
  ok:           boolean
  bloqueadoPor?: 'MENSUAL' | 'HORA' | 'BURST' | 'TOKENS_MES'
  mensajeBloqueo?: string
  plan:         string
  limites:      PlanLimites
  uso: {
    consultasMes:  number
    tokensMes:     number
    consultasHora: number
  }
  restantes: {
    consultasMes:  number
    tokensMes:     number
    consultasHora: number
  }
  resetMes:  string   // ISO — primer día del mes siguiente
  resetHora: string   // ISO — próxima hora en punto
}

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════

function hash8(t: string): string {
  return crypto.createHash('sha256').update(t).digest('hex').slice(0, 16)
}

function periodoActual(): string {
  return new Date().toISOString().slice(0, 7)   // 'YYYY-MM'
}

function resetMes(): string {
  const ahora = new Date()
  return new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1).toISOString()
}

function resetHora(): string {
  const ahora = new Date()
  ahora.setMinutes(0, 0, 0)
  ahora.setHours(ahora.getHours() + 1)
  return ahora.toISOString()
}

// ══════════════════════════════════════════════════════════
// OBTENER PLAN DEL USUARIO
// ══════════════════════════════════════════════════════════

async function getPlanUsuario(usuarioId: string): Promise<PlanLimites> {
  const redis    = getRedis()
  const cacheKey = `user:plan:${usuarioId}`

  // 1. Redis cache (5 min)
  try {
    const cached = await redis.get(cacheKey)
    if (cached) {
      const planNombre = JSON.parse(cached) as string
      return PLANES_DEFAULT[planNombre] ?? PLANES_DEFAULT.LIBRE
    }
  } catch { /* Redis caído */ }

  // 2. PostgreSQL: join usuarios + planes_gpt
  const row = await queryOne<{ plan_suscripcion: string; consultas_mes: number; tokens_mes: number; consultas_hora: number; burst_min: number; label: string }>(
    `SELECT u.plan_suscripcion,
            pg.consultas_mes, pg.tokens_mes, pg.consultas_hora, pg.burst_min, pg.label
     FROM usuarios u
     LEFT JOIN planes_gpt pg ON pg.plan = u.plan_suscripcion
     WHERE u.id = $1::uuid`,
    [usuarioId]
  )

  const planNombre = row?.plan_suscripcion ?? 'LIBRE'
  const limites: PlanLimites = row?.consultas_mes
    ? {
        plan:          planNombre,
        label:         row.label,
        consultasMes:  row.consultas_mes,
        tokensMes:     row.tokens_mes,
        consultasHora: row.consultas_hora,
        burstMin:      row.burst_min,
      }
    : PLANES_DEFAULT[planNombre] ?? PLANES_DEFAULT.LIBRE

  // Guardar en Redis 5 min
  try { await redis.set(cacheKey, JSON.stringify(planNombre), 'EX', '300') } catch { /* ok */ }

  return limites
}

// ══════════════════════════════════════════════════════════
// VERIFICAR LÍMITES (sin incrementar aún)
// ══════════════════════════════════════════════════════════

export async function verificarLimitesPlan(
  usuarioId:   string,
  ip?:         string,
  tokensEstimados = 0
): Promise<RateLimitResult> {

  const limites = await getPlanUsuario(usuarioId)
  const redis   = getRedis()
  const periodo = periodoActual()

  const ahora   = new Date()
  const horaKey = ahora.toISOString().slice(0, 13)    // YYYY-MM-DDTHH
  const minKey  = ahora.toISOString().slice(0, 16)    // YYYY-MM-DDTHH:mm

  const keyHora  = `gpt:rl:hora:${usuarioId}:${horaKey}`
  const keyBurst = ip ? `gpt:rl:burst:${hash8(ip)}:${minKey}` : null

  // Leer contadores en paralelo
  const [usadoMensual, cHora, cBurst] = await Promise.all([
    // Mensual desde PostgreSQL
    queryOne<{ consultas: number; tokens_entrada: number; tokens_salida: number }>(
      `SELECT consultas, tokens_entrada, tokens_salida
       FROM gpt_uso_mensual
       WHERE usuario_id=$1::uuid AND periodo=$2`,
      [usuarioId, periodo]
    ).then(r => r ?? { consultas: 0, tokens_entrada: 0, tokens_salida: 0 }),

    // Por hora desde Redis
    redis.get(keyHora).then(v => parseInt(v ?? '0')).catch(() => 0),

    // Burst desde Redis
    keyBurst
      ? redis.get(keyBurst).then(v => parseInt(v ?? '0')).catch(() => 0)
      : Promise.resolve(0),
  ])

  const tokensMesUsados = usadoMensual.tokens_entrada + usadoMensual.tokens_salida

  const resultado: RateLimitResult = {
    ok:          true,
    plan:        limites.plan,
    limites,
    uso: {
      consultasMes:  usadoMensual.consultas,
      tokensMes:     tokensMesUsados,
      consultasHora: cHora,
    },
    restantes: {
      consultasMes:  Math.max(0, limites.consultasMes  - usadoMensual.consultas),
      tokensMes:     Math.max(0, limites.tokensMes     - tokensMesUsados),
      consultasHora: Math.max(0, limites.consultasHora - cHora),
    },
    resetMes:  resetMes(),
    resetHora: resetHora(),
  }

  // ── Verificar límite mensual de consultas ──────────────
  if (usadoMensual.consultas >= limites.consultasMes) {
    return {
      ...resultado, ok: false, bloqueadoPor: 'MENSUAL',
      mensajeBloqueo: `Alcanzaste el límite de ${limites.consultasMes} consultas/mes del ${limites.label}. ` +
        `Resetea el ${new Date(resetMes()).toLocaleDateString('es-AR')} o upgrade al plan superior.`,
    }
  }

  // ── Verificar límite mensual de tokens ─────────────────
  if (tokensEstimados > 0 && tokensMesUsados + tokensEstimados > limites.tokensMes) {
    return {
      ...resultado, ok: false, bloqueadoPor: 'TOKENS_MES',
      mensajeBloqueo: `Límite de ${(limites.tokensMes / 1000).toFixed(0)}K tokens/mes alcanzado (${limites.label}).`,
    }
  }

  // ── Verificar límite por hora ──────────────────────────
  if (cHora >= limites.consultasHora) {
    return {
      ...resultado, ok: false, bloqueadoPor: 'HORA',
      mensajeBloqueo: `Límite de ${limites.consultasHora} consultas/hora alcanzado (${limites.label}). ` +
        `Próximo reset: ${new Date(resetHora()).toLocaleTimeString('es-AR')}.`,
    }
  }

  // ── Verificar burst ────────────────────────────────────
  if (keyBurst && cBurst >= limites.burstMin) {
    return {
      ...resultado, ok: false, bloqueadoPor: 'BURST',
      mensajeBloqueo: `Demasiadas consultas en poco tiempo (${limites.burstMin}/min). Esperá un momento.`,
    }
  }

  return resultado
}

// ══════════════════════════════════════════════════════════
// REGISTRAR CONSUMO (llamar DESPUÉS de la respuesta de Anthropic)
// ══════════════════════════════════════════════════════════

export async function registrarConsumo(
  usuarioId:     string,
  tokensEntrada: number,
  tokensSalida:  number,
  ip?:           string
): Promise<void> {
  const redis   = getRedis()
  const periodo = periodoActual()
  const ahora   = new Date()
  const horaKey = ahora.toISOString().slice(0, 13)
  const minKey  = ahora.toISOString().slice(0, 16)

  const keyHora  = `gpt:rl:hora:${usuarioId}:${horaKey}`
  const keyBurst = ip ? `gpt:rl:burst:${hash8(ip)}:${minKey}` : null

  await Promise.all([
    // Redis: INCR con TTL (solo en el primer incremento)
    redis.incr(keyHora).then(n => { if (n === 1) redis.expire(keyHora, 3600) }),
    keyBurst
      ? redis.incr(keyBurst).then(n => { if (n === 1) redis.expire(keyBurst, 60) })
      : Promise.resolve(),

    // PostgreSQL: UPSERT en gpt_uso_mensual
    query(
      `INSERT INTO gpt_uso_mensual (usuario_id, periodo, consultas, tokens_entrada, tokens_salida, plan_al_inicio)
       VALUES ($1::uuid, $2, 1, $3, $4,
         (SELECT COALESCE(plan_suscripcion,'LIBRE') FROM usuarios WHERE id=$1::uuid))
       ON CONFLICT (usuario_id, periodo) DO UPDATE
       SET consultas       = gpt_uso_mensual.consultas + 1,
           tokens_entrada  = gpt_uso_mensual.tokens_entrada + $3,
           tokens_salida   = gpt_uso_mensual.tokens_salida  + $4,
           actualizado_en  = NOW()`,
      [usuarioId, periodo, tokensEntrada, tokensSalida]
    ),
  ])

  log.mxm.debug({ usuarioId: usuarioId.slice(0,8), tokensEntrada, tokensSalida, periodo },
    '📊 Consumo GPT registrado')
}

// ══════════════════════════════════════════════════════════
// CONSULTAR USO MENSUAL (endpoint /gpt/uso-plan)
// ══════════════════════════════════════════════════════════

export async function getUsoPlan(usuarioId: string): Promise<{
  plan:          PlanLimites
  periodoActual: string
  uso: {
    consultasMes:  number
    tokensMes:     number
    consultasHora: number
  }
  restantes: {
    consultasMes:  number
    tokensMes:     number
  }
  porcentajeUso: {
    consultas: number
    tokens:    number
  }
  resetMes:   string
  historial:  Array<{ periodo: string; consultas: number; tokensMes: number; plan: string }>
}> {
  const limites = await getPlanUsuario(usuarioId)
  const redis   = getRedis()
  const periodo = periodoActual()
  const horaKey = `gpt:rl:hora:${usuarioId}:${new Date().toISOString().slice(0, 13)}`

  const [usadoMes, cHora, historial] = await Promise.all([
    queryOne<any>(
      `SELECT consultas, tokens_entrada, tokens_salida
       FROM gpt_uso_mensual WHERE usuario_id=$1::uuid AND periodo=$2`,
      [usuarioId, periodo]
    ),
    redis.get(horaKey).then(v => parseInt(v ?? '0')).catch(() => 0),
    query<any>(
      `SELECT periodo, consultas, tokens_entrada+tokens_salida AS tokens_mes, plan_al_inicio AS plan
       FROM gpt_uso_mensual WHERE usuario_id=$1::uuid
       ORDER BY periodo DESC LIMIT 6`,
      [usuarioId]
    ),
  ])

  const consultasMes = usadoMes?.consultas ?? 0
  const tokensMes    = (usadoMes?.tokens_entrada ?? 0) + (usadoMes?.tokens_salida ?? 0)

  return {
    plan: limites,
    periodoActual: periodo,
    uso: {
      consultasMes,
      tokensMes,
      consultasHora: cHora,
    },
    restantes: {
      consultasMes:  Math.max(0, limites.consultasMes - consultasMes),
      tokensMes:     Math.max(0, limites.tokensMes    - tokensMes),
    },
    porcentajeUso: {
      consultas: Math.min(100, Math.round(consultasMes / limites.consultasMes * 100)),
      tokens:    Math.min(100, Math.round(tokensMes    / limites.tokensMes    * 100)),
    },
    resetMes: resetMes(),
    historial: historial.map((h: any) => ({
      periodo:    h.periodo,
      consultas:  h.consultas,
      tokensMes:  parseInt(h.tokens_mes),
      plan:       h.plan,
    })),
  }
}

// ══════════════════════════════════════════════════════════
// UPGRADE DE PLAN (admin / pago)
// ══════════════════════════════════════════════════════════

export async function upgradePlan(
  usuarioId: string,
  nuevoPlan: 'LIBRE' | 'ESTANDAR' | 'PREMIUM'
): Promise<void> {
  if (!PLANES_DEFAULT[nuevoPlan]) throw new AppError('Plan inválido', 400)

  await query(
    `UPDATE usuarios SET plan_suscripcion=$2 WHERE id=$1::uuid`,
    [usuarioId, nuevoPlan]
  )

  // Invalidar cache de plan en Redis
  const redis = getRedis()
  await redis.del(`user:plan:${usuarioId}`).catch(() => {})

  log.mxm.info({ usuarioId: usuarioId.slice(0,8), nuevoPlan }, '📋 Plan actualizado')
}

export { PLANES_DEFAULT, periodoActual }
