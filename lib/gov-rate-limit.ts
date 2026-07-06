/**
 * RODAID · Rate Limiting para API Gubernamental
 * 1000 requests/hora por token · In-memory con TTL
 */
const store = new Map<string, { count: number; reset: number }>()
const LIMIT = 1000
const WINDOW = 60 * 60 * 1000 // 1 hora

export function checkRateLimit(token: string): { ok: boolean; remaining: number; reset: number } {
  const now = Date.now()
  const key = token.slice(-8) // Solo últimos 8 chars del token como key
  const entry = store.get(key)

  if (!entry || now > entry.reset) {
    store.set(key, { count: 1, reset: now + WINDOW })
    return { ok: true, remaining: LIMIT - 1, reset: now + WINDOW }
  }

  entry.count++
  if (entry.count > LIMIT) {
    return { ok: false, remaining: 0, reset: entry.reset }
  }

  return { ok: true, remaining: LIMIT - entry.count, reset: entry.reset }
}

export function rateLimitHeaders(result: ReturnType<typeof checkRateLimit>) {
  return {
    'X-RateLimit-Limit': String(LIMIT),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.floor(result.reset / 1000)),
  }
}
