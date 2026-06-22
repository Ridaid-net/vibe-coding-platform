// ─── RODAID · Caché de Sugerencias GPT ────────────────────
//
// Reduce el costo de tokens almacenando respuestas en Redis.
//
// ══ ESTRATEGIA DE CACHÉ ═══════════════════════════════════
//
//   NIVEL 0 — Sugerencias predefinidas (static)
//     Respuestas hardcodeadas para las preguntas más frecuentes
//     de RODAID. Sin costo de API. TTL: infinito (en memoria).
//     Ejemplos: "¿Cómo pago la tasa?", "¿Qué es la Ley 9556?"
//
//   NIVEL 1 — Caché exacto por prompt normalizado
//     Clave: SHA-256(normalize(prompt)) × SHA-256(contextoHash)
//     TTL: según tipo de consulta
//       · legal / general: 24h (no cambia el contexto regulatorio)
//       · cit_consulta:     4h (estado del CIT puede cambiar)
//       · marketplace:      2h (precios y publicaciones cambian)
//       · aliado:           6h (retribuciones pueden cambiar)
//     Alcance: POR USUARIO (contextoHash incluye fingerprint del
//              estado del usuario, sin PII)
//
//   NIVEL 2 — Caché semántico por palabras clave
//     Detecta preguntas similares por tokenización simple
//     (sin embeddings). TTL: mismo que nivel 1.
//     Ejemplos: "tasa CIT", "pagar tasa", "pago del CIT" → misma respuesta
//
// ══ CLAVE DE CACHÉ ════════════════════════════════════════
//
//   gpt:cache:{contextHash}:{promptHash}
//
//   contextHash = SHA-256(plan + bikeCount + citStates)[:16]
//     → NO incluye nombre ni DNI del usuario (privacidad)
//     → SÍ incluye estado funcional (cuántas bicis, CIT vigente)
//
//   promptHash  = SHA-256(normalize(prompt))
//     normalize() = lowercase + collapse whitespace + quitar acentos
//
// ══ AHORRO ESTIMADO ═══════════════════════════════════════
//
//   Hit rate objetivo: 30-40% de consultas frecuentes
//   Tokens promedio: 450 entrada + 280 salida = 730/consulta
//   Ahorro nivel-0 (estático): 100% de tokens
//   Ahorro nivel-1 (cache):    tokens_entrada (450 promedio)
//
// ══ INVALIDACIÓN ══════════════════════════════════════════
//
//   Al cambiar estado del usuario (nuevo CIT, pago MxM, etc.)
//   → invalidarCacheUsuario(userId) borra todas sus claves

import crypto              from 'crypto'
import { query, queryOne } from '../config/database'
import { getRedis }        from '../config/redis'
import { log }             from '../middleware/logger'

// ══════════════════════════════════════════════════════════
// TTL POR TIPO DE CONSULTA
// ══════════════════════════════════════════════════════════

const TTL_SEGUNDOS: Record<string, number> = {
  legal:        86_400,   // 24h — legislación no cambia
  general:      86_400,   // 24h — info general de RODAID
  aliado:       21_600,   // 6h  — planes de retribución
  cit_consulta: 14_400,   // 4h  — estado del CIT puede cambiar
  marketplace:   7_200,   // 2h  — precios y publicaciones
}

const TTL_DEFAULT = 14_400   // 4h fallback

// ══════════════════════════════════════════════════════════
// SUGERENCIAS PREDEFINIDAS (NIVEL 0 — costo $0)
// ══════════════════════════════════════════════════════════

interface SugerenciaPredefinida {
  palabrasClave: string[]
  respuesta:     string
  tipo:          string
  tokensAhorrados: number   // estimado
}

const SUGERENCIAS_PREDEFINIDAS: SugerenciaPredefinida[] = [
  {
    palabrasClave: ['ley 9556', 'ley provincial', 'normativa', 'marco legal', 'que es la ley'],
    tipo: 'legal',
    tokensAhorrados: 680,
    respuesta: `La **Ley Provincial N° 9556** de Mendoza establece el marco legal para la certificación técnica de bicicletas en la Zona Este (San Martín, Junín, Rivadavia).

**Artículos clave:**

**Art. 11 — Registro obligatorio de talleres**
Los talleres de bicicletas que operen en la zona deben registrarse en el municipio correspondiente bajo pena de sanciones.

**Art. 12 — Sanciones**
El incumplimiento del registro o la emisión de certificados irregulares implica multas y clausura del establecimiento.

**Art. 17 — Código único de verificación**
Cada bicicleta certificada recibe un código único de identidad técnica (CIT) que debe ser verificable públicamente.

**Art. 18 — Aranceles**
Los aranceles por emisión del CIT son fijados por el Poder Ejecutivo y se abonan a través del canal oficial MxM del Gobierno de Mendoza. Actualmente: **$3.000 ARS**.

**Blockchain Federal Argentina (BFA):**
El hash SHA-256 del CIT se ancla en la BFA (ONTI) como token ERC-721, garantizando inmutabilidad e imposibilidad de falsificación.`,
  },
  {
    palabrasClave: ['como pago', 'pagar la tasa', 'tasa cit', 'tasa del cit', 'pago mxm', 'canal mxm', 'cuanto cuesta'],
    tipo: 'cit_consulta',
    tokensAhorrados: 590,
    respuesta: `Para pagar la **Tasa CIT** ($3.000 ARS) por el canal oficial MxM del Gobierno de Mendoza:

**Paso 1 — Iniciar el pago**
\`\`\`
POST /api/v1/cit/pago
{ "citId": "tu-cit-uuid" }
\`\`\`
El sistema genera una preferencia de pago en MxM con un link de redirección.

**Paso 2 — Pagar en el portal oficial**
Te redirigimos a \`portal.mendoza.gov.ar/pagos\` donde completás el pago con cualquier medio habilitado (tarjeta, transferencia, efectivo en Rapipago/Pago Fácil).

**Paso 3 — Confirmación automática**
Al aprobar el pago, el Gobierno de Mendoza envía un webhook a RODAID. En segundos:
- El CIT pasa a estado **ACTIVO**
- Recibís una notificación push "🎉 ¡CIT Activo!"
- Se genera el Expediente Provincial (EXP-MXM-AAAA-NNNNN)

**Paso 4 — Mint del NFT**
Una vez pagada la tasa, el sistema mintea automáticamente el token ERC-721 en la Blockchain Federal Argentina con el hash SHA-256 como metadata inmutable.

💡 El pago vence a las **2 horas** de iniciado. Si no pagás, el CIT vuelve a estado BORRADOR.`,
  },
  {
    palabrasClave: ['escrow', 'como vender', 'vender bicicleta', 'marketplace', 'publicar', 'como funciona la venta'],
    tipo: 'marketplace',
    tokensAhorrados: 620,
    respuesta: `El **Marketplace RODAID** utiliza un sistema de escrow para proteger compradores y vendedores.

**Flujo completo de venta:**

1. **Publicás** tu bicicleta con CIT vigente como respaldo
2. **Comprador paga** → fondos quedan retenidos en escrow (no llegan al vendedor aún)
3. **Entrega** → el comprador confirma la recepción
4. **Liberación automática** → 97.5% al vendedor, 2.5% comisión RODAID

**Split del precio:**
- Vendedor recibe: **97.5%**
- Comisión RODAID: **2.5%**

**Auto-release:** Si el comprador no confirma ni disputa en **5 días**, los fondos se liberan automáticamente al vendedor.

**Disputas:** Si hay un problema, abrís una disputa y RODAID tiene **72 horas** para resolver. El CIT es clave: si el serial físico no coincide con el CIT registrado, RODAID falla a favor del comprador.

**Para publicar:**
\`\`\`
POST /api/v1/marketplace/publicaciones
{ "bicicletaId": "...", "precioARS": 85000, "tipoEntrega": "EN_MANO" }
\`\`\``,
  },
  {
    palabrasClave: ['nft', 'blockchain', 'bfa', 'token erc', 'mint', 'que es el nft', 'blockchain federal'],
    tipo: 'cit_consulta',
    tokensAhorrados: 550,
    respuesta: `El **NFT del CIT** es un token ERC-721 acuñado en la **Blockchain Federal Argentina (BFA)**, la red blockchain oficial del Estado Nacional Argentino operada por la ONTI.

**¿Qué contiene el NFT?**
- Hash SHA-256 del Certificado de Identidad Técnica (inmutable)
- Número de serie de la bicicleta
- Número de CIT (RCIT-AAAA-NNNNN)
- Timestamp de emisión
- Dirección del propietario (wallet)

**¿Para qué sirve?**
✅ Prueba irrefutable de que el CIT existió en esa fecha y con ese contenido
✅ Imposible de falsificar (la BFA es una blockchain pública y auditable)
✅ Transferible: cuando vendés la bicicleta en el marketplace, el NFT puede transferirse al nuevo propietario

**Para mintear tu NFT:**
El mint ocurre automáticamente cuando pagás la Tasa MxM. Si ya pagaste pero no se minteó:
\`\`\`
POST /api/v1/bfa/mint/{citId}
\`\`\`

**Contrato:** "Rodaid Certificado" (RCIT) en la red BFA Testnet (actualmente) → Mainnet en producción.`,
  },
  {
    palabrasClave: ['aliado', 'taller aliado', 'plan aliado', 'pionero', 'constructor', 'escalador', 'retribucion', 'como cobro', 'cuanto cobro'],
    tipo: 'aliado',
    tokensAhorrados: 570,
    respuesta: `El **Programa Aliados RODAID** permite a talleres y mecánicos certificados ganar una retribución por cada CIT emitido.

**Planes y porcentajes** (sobre la Tasa CIT de $3.000 ARS):

| Plan | CITs/mes | % Retribución | $ por CIT |
|------|----------|---------------|-----------|
| PIONERO | ≤50 | 35% | $1.050 ARS |
| CONSTRUCTOR | 51–200 | 40% | $1.200 ARS |
| ESCALADOR | >200 | 45% | $1.350 ARS |

**¿Cómo cobro?**
La retribución se acredita automáticamente vía **MercadoPago** en tu cuenta aliada dentro de las 24h de que el propietario paga la Tasa MxM. No necesitás hacer nada: el sistema lo maneja.

**Liquidación mensual:**
Además del pago por CIT, se genera una liquidación consolidada el primer día de cada mes.

**Para ver tu retribución:**
\`\`\`
GET /api/v1/aliado/retribucion
\`\`\`

**Para conectar tu cuenta MP:**
\`\`\`
POST /api/v1/mp/connect
\`\`\``,
  },
  {
    palabrasClave: ['que es el cit', 'que es rodaid', 'para que sirve', 'como funciona rodaid', 'certificado de identidad'],
    tipo: 'general',
    tokensAhorrados: 500,
    respuesta: `**RODAID** es la primera plataforma argentina de certificación técnica de bicicletas, operando bajo la **Ley Provincial N° 9556** de Mendoza.

**¿Qué es el CIT?**
El **Certificado de Identidad Técnica** (CIT) es el documento oficial que certifica:
- La identidad del rodado (marca, modelo, número de serie)
- El estado técnico evaluado por un inspector certificado
- La propiedad registrada

**Proceso de certificación:**
1. 🔍 **Inspección** por inspector certificado → puntaje mínimo 16/20 puntos
2. 💳 **Pago de Tasa** → $3.000 ARS por canal MxM (Gobierno de Mendoza)
3. 🔗 **Anclaje en BFA** → Hash SHA-256 + NFT ERC-721 (Blockchain Federal Argentina)
4. ✅ **CIT vigente** por 12 meses

**¿Para qué sirve?**
- 🛡 Prevención de robo (denuncia ante MinSeg con geolocalización)
- 🏪 Compraventa segura en el Marketplace RODAID con garantía de identidad
- 📋 Respaldo legal ante accidentes o reclamos

**Zona de operación:** San Martín, Junín y Rivadavia — Mendoza, Argentina.`,
  },
]

// ══════════════════════════════════════════════════════════
// UTILIDADES DE HASH Y NORMALIZACIÓN
// ══════════════════════════════════════════════════════════

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // quitar acentos
    .replace(/[¿?¡!.,;:]/g, ' ')       // quitar puntuación
    .replace(/\s+/g, ' ')
    .trim()
}

function hashPrompt(texto: string): string {
  return crypto.createHash('sha256').update(normalizar(texto), 'utf8').digest('hex')
}

function hashContexto(ctx: ContextoCacheKey): string {
  // NO incluye nombre ni datos PII — solo estado funcional
  const huella = `${ctx.plan}:${ctx.bikeCount}:${ctx.citStates.sort().join('|')}`
  return crypto.createHash('sha256').update(huella).digest('hex').slice(0, 16)
}

export interface ContextoCacheKey {
  plan:      string          // LIBRE / ESTANDAR / PREMIUM
  bikeCount: number          // cantidad de bicicletas
  citStates: string[]        // ['ACTIVO','BORRADOR'] (sin IDs ni nombres)
}

export interface CacheResult {
  hit:         boolean
  respuesta?:  string
  nivel?:      0 | 1 | 2    // 0=static, 1=exact, 2=semantic
  tokensAhorrados?: number
  cacheKey?:   string
  ttlRestante?: number       // segundos
}

// ══════════════════════════════════════════════════════════
// BUSCAR EN CACHÉ
// ══════════════════════════════════════════════════════════

export async function buscarEnCache(
  prompt:       string,
  contexto:     ContextoCacheKey,
  tipoConsulta: string
): Promise<CacheResult> {

  const textoNorm   = normalizar(prompt)
  const promptHash  = hashPrompt(prompt)
  const ctxHash     = hashContexto(contexto)

  // ── NIVEL 0: Sugerencias predefinidas ─────────────────
  for (const sug of SUGERENCIAS_PREDEFINIDAS) {
    const match = sug.palabrasClave.some(kw => textoNorm.includes(kw))
    if (match) {
      // Registrar hit en stats (async, no bloquea)
      registrarHitStats(promptHash, ctxHash, 0, sug.tipo, sug.respuesta.length, sug.tokensAhorrados).catch(() => {})

      log.mxm.info({ nivel: 0, tipo: sug.tipo, tokens: sug.tokensAhorrados }, '✅ Cache NIVEL-0 (predefinida)')
      return {
        hit:             true,
        respuesta:       sug.respuesta,
        nivel:           0,
        tokensAhorrados: sug.tokensAhorrados,
        ttlRestante:     Infinity,
      }
    }
  }

  // ── NIVEL 1: Caché exacto en Redis ────────────────────
  const redis   = getRedis()
  const cacheKey = `gpt:cache:${ctxHash}:${promptHash}`

  try {
    const cached = await redis.get(cacheKey)
    if (cached) {
      const data = JSON.parse(cached) as { respuesta: string; tokens: number }
      const ttl  = await redis.ttl(cacheKey)

      // Registrar hit
      registrarHitStats(promptHash, ctxHash, 1, tipoConsulta, data.respuesta.length, data.tokens).catch(() => {})

      log.mxm.info({ nivel: 1, cacheKey: cacheKey.slice(-12), ttl, tokens: data.tokens }, '✅ Cache NIVEL-1 (Redis)')
      return {
        hit:             true,
        respuesta:       data.respuesta,
        nivel:           1,
        tokensAhorrados: data.tokens,
        cacheKey,
        ttlRestante:     ttl,
      }
    }
  } catch { /* Redis caído — continuar sin caché */ }

  // ── NIVEL 2: Caché semántico por tokens (keywords) ────
  const tokens  = textoNorm.split(' ').filter(t => t.length > 3)
  const keyBase = tokens.slice(0, 4).join('-')
  const semKey  = `gpt:cache:sem:${ctxHash}:${hashPrompt(keyBase)}`

  try {
    const cached = await redis.get(semKey)
    if (cached) {
      const data = JSON.parse(cached) as { respuesta: string; tokens: number }
      const ttl  = await redis.ttl(semKey)

      registrarHitStats(promptHash, ctxHash, 2, tipoConsulta, data.respuesta.length, Math.round(data.tokens * 0.6)).catch(() => {})

      log.mxm.info({ nivel: 2, semKey: semKey.slice(-12) }, '✅ Cache NIVEL-2 (semántico)')
      return {
        hit:             true,
        respuesta:       data.respuesta,
        nivel:           2,
        tokensAhorrados: Math.round(data.tokens * 0.6),
        cacheKey:        semKey,
        ttlRestante:     ttl,
      }
    }
  } catch { /* ok */ }

  return { hit: false }
}

// ══════════════════════════════════════════════════════════
// GUARDAR EN CACHÉ
// ══════════════════════════════════════════════════════════

export async function guardarEnCache(
  prompt:        string,
  respuesta:     string,
  contexto:      ContextoCacheKey,
  tipoConsulta:  string,
  tokensEntrada: number,
  tokensSalida:  number
): Promise<void> {

  const redis      = getRedis()
  const promptHash = hashPrompt(prompt)
  const ctxHash    = hashContexto(contexto)
  const ttl        = TTL_SEGUNDOS[tipoConsulta] ?? TTL_DEFAULT
  const tokens     = tokensEntrada + tokensSalida

  const payload    = JSON.stringify({ respuesta, tokens, tipo: tipoConsulta, ts: Date.now() })
  const cacheKey   = `gpt:cache:${ctxHash}:${promptHash}`

  // Caché exacto (nivel 1)
  await redis.set(cacheKey, payload, 'EX', String(ttl)).catch(() => {})

  // Caché semántico (nivel 2) — tokens principales como clave
  const textoNorm = normalizar(prompt)
  const tokens2   = textoNorm.split(' ').filter(t => t.length > 3)
  const keyBase   = tokens2.slice(0, 4).join('-')
  if (keyBase.length > 4) {
    const semKey  = `gpt:cache:sem:${ctxHash}:${hashPrompt(keyBase)}`
    await redis.set(semKey, payload, 'EX', String(ttl)).catch(() => {})
  }

  // Guardar stat en DB
  await query(
    `INSERT INTO gpt_cache_stats
       (prompt_hash, context_hash, tipo_consulta, cache_key, respuesta_len, tokens_ahorrados, ttl_segundos)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (prompt_hash, context_hash) DO UPDATE
     SET ultimo_hit=NOW()`,
    [promptHash, ctxHash, tipoConsulta, cacheKey, respuesta.length, tokens, ttl]
  ).catch(() => {})

  log.mxm.debug({ cacheKey: cacheKey.slice(-12), ttl, tokens }, '💾 Respuesta guardada en caché')
}

// ══════════════════════════════════════════════════════════
// INVALIDAR CACHÉ DEL USUARIO
// ══════════════════════════════════════════════════════════

export async function invalidarCacheUsuario(
  contexto: ContextoCacheKey
): Promise<number> {
  const redis   = getRedis()
  const ctxHash = hashContexto(contexto)

  // Borrar todas las claves del contexto
  const pattern = `gpt:cache:${ctxHash}:*`
  let   borradas = 0

  try {
    const keys = await redis.keys(pattern)
    if (keys.length > 0) {
      await redis.del(...keys)
      borradas = keys.length
      log.mxm.info({ ctxHash, borradas }, '🗑 Caché de usuario invalidada')
    }

    // También el caché semántico
    const semKeys = await redis.keys(`gpt:cache:sem:${ctxHash}:*`)
    if (semKeys.length > 0) {
      await redis.del(...semKeys)
      borradas += semKeys.length
    }
  } catch { /* Redis no disponible */ }

  return borradas
}

// ══════════════════════════════════════════════════════════
// MÉTRICAS DE CACHÉ
// ══════════════════════════════════════════════════════════

export async function getCacheMetrics(dias = 30): Promise<{
  hitRate:        number
  tokensAhorrados:number
  costoAhorradoUSD:number
  porNivel:       Array<{ nivel: string; hits: number; tokens: number }>
  topConsultas:   Array<{ tipo: string; hits: number; tokens: number }>
  clavesCachadas: number
}> {
  const redis = getRedis()

  const [stats, totalConsultas] = await Promise.all([
    query<any>(`
      SELECT
        SUM(hits)::int AS total_hits,
        SUM(tokens_ahorrados)::int AS tokens_total,
        tipo_consulta,
        COUNT(*)::int AS tipos
      FROM gpt_cache_stats
      WHERE ultimo_hit > NOW() - ($1||' days')::interval
      GROUP BY tipo_consulta ORDER BY total_hits DESC
    `, [dias]),

    queryOne<{ count: string }>(`
      SELECT COUNT(*)::text AS count FROM gpt_consultas
      WHERE creado_en > NOW() - ($1||' days')::interval
    `, [dias]),
  ])

  const totalHits     = stats.reduce((s: number, r: any) => s + (r.total_hits || 0), 0)
  const tokensTotal   = stats.reduce((s: number, r: any) => s + (r.tokens_total || 0), 0)
  const totalQ        = parseInt(totalConsultas?.count ?? '0')
  const hitRate       = totalQ > 0 ? Math.round(totalHits / (totalQ + totalHits) * 100) : 0
  // Precio público Anthropic claude-sonnet (Input $3/MTok, Output $15/MTok)
  const costoUSD      = Math.round(tokensTotal * 0.000009 * 100) / 100

  let clavesCachadas = 0
  try {
    const keys = await redis.keys('gpt:cache:*')
    clavesCachadas = keys.length
  } catch { /* ok */ }

  return {
    hitRate,
    tokensAhorrados:  tokensTotal,
    costoAhorradoUSD: costoUSD,
    porNivel: [
      { nivel: 'Nivel 0 (predefinidas)', hits: 0, tokens: 0 },
      { nivel: 'Nivel 1 (Redis exacto)', hits: totalHits, tokens: tokensTotal },
      { nivel: 'Nivel 2 (semántico)',    hits: 0, tokens: 0 },
    ],
    topConsultas: stats.map((r: any) => ({
      tipo:   r.tipo_consulta,
      hits:   r.total_hits,
      tokens: r.tokens_total,
    })),
    clavesCachadas,
  }
}

// ══════════════════════════════════════════════════════════
// HELPERS PRIVADOS
// ══════════════════════════════════════════════════════════

async function registrarHitStats(
  promptHash:      string,
  ctxHash:         string,
  nivel:           number,
  tipo:            string,
  respuestaLen:    number,
  tokensAhorrados: number
): Promise<void> {
  await query(
    `INSERT INTO gpt_cache_stats
       (prompt_hash, context_hash, tipo_consulta, cache_key,
        respuesta_len, tokens_ahorrados, hits, ttl_segundos)
     VALUES ($1,$2,$3,$4,$5,$6,1,$7)
     ON CONFLICT (prompt_hash, context_hash) DO UPDATE
     SET hits=gpt_cache_stats.hits+1, ultimo_hit=NOW()`,
    [promptHash, ctxHash, tipo,
     `nivel-${nivel}`, respuestaLen, tokensAhorrados,
     TTL_SEGUNDOS[tipo] ?? TTL_DEFAULT]
  )
}

export { normalizar, hashPrompt, hashContexto, SUGERENCIAS_PREDEFINIDAS }
