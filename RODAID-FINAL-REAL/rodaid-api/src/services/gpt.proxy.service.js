"use strict";
// ─── POST /api/gpt/consulta — Proxy Seguro Anthropic ──────
//
// La API key de Anthropic NUNCA sale del servidor.
// El cliente solo ve el endpoint de RODAID.
//
// ══ CAPAS DE SEGURIDAD ════════════════════════════════════
//
//   1. JWT obligatorio (middleware authenticated)
//   2. Rate limit estricto:
//        · 20 req/hora por usuario
//        · 200 req/día  por usuario
//        · 5 req/minuto por IP (burst)
//   3. Validación de input (zod):
//        · mensaje: 1–4000 chars
//        · contexto: enum limitado
//        · historial: máx 10 turnos
//   4. Sanitización de output:
//        · nunca se reenvía la API key
//        · solo se retorna texto + metadatos de tokens
//   5. Auditoría completa sin PII:
//        · prompt_hash (SHA-256, no el texto)
//        · ip_hash (SHA-256, no la IP)
//        · tokens, latencia, estado
//   6. Circuit breaker:
//        · si Anthropic devuelve 429/5xx → error tipado
//        · no se reintenta automáticamente (evita explosión de costos)
//   7. Timeout: 30 segundos (evita cuelgues)
//
// ══ LO QUE EL CLIENTE NO VE NUNCA ════════════════════════
//
//   ✗ ANTHROPIC_API_KEY
//   ✗ Nombre interno del modelo (puede ser diferente en producción)
//   ✗ System prompt completo
//   ✗ IPs de otros usuarios
//   ✗ Historial de otros usuarios
//
// ══ LO QUE EL CLIENTE SÍ RECIBE ═════════════════════════
//
//   ✓ respuesta (texto del asistente)
//   ✓ tokens { entrada, salida, total }
//   ✓ latenciaMs
//   ✓ consulta_id (para auditoría del usuario)
//   ✓ rate_limit { restantes, resetEn }
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RL_DIA_MAX = exports.RL_HORA_MAX = void 0;
exports.consultaGPT = consultaGPT;
exports.consultaGPTStream = consultaGPTStream;
exports.getUsoGPT = getUsoGPT;
const crypto_1 = __importDefault(require("crypto"));
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const rodaid_context_service_1 = require("./rodaid.context.service");
const gpt_cache_service_1 = require("./gpt.cache.service");
const gpt_ratelimit_service_1 = require("./gpt.ratelimit.service");
const database_1 = require("../config/database");
const redis_1 = require("../config/redis");
const logger_1 = require("../middleware/logger");
const errorHandler_1 = require("../middleware/errorHandler");
// ══════════════════════════════════════════════════════════
// CONSTANTES DE SEGURIDAD (nunca en el cliente)
// ══════════════════════════════════════════════════════════
const MODELO_INTERNO = 'claude-sonnet-4-20250514'; // ← nunca sale
const MAX_TOKENS = 2048;
const TIMEOUT_MS = 30_000;
// Rate limits locales para función legacy (plan ESTANDAR default)
const RL_HORA_MAX = 20;
exports.RL_HORA_MAX = RL_HORA_MAX;
const RL_DIA_MAX = 200;
exports.RL_DIA_MAX = RL_DIA_MAX;
// System prompt base — también privado
const SYSTEM_RODAID = `Sos RODAID-GPT, el asistente oficial de RODAID.

RODAID es la plataforma de certificación técnica de bicicletas de Argentina bajo la Ley Provincial N° 9556 de Mendoza (Zona Este: San Martín, Junín, Rivadavia).

CONTEXTO:
{CONTEXTO_USUARIO}

ÁREAS DE CONOCIMIENTO:
• CIT (Certificado de Identidad Técnica): inspección → 16/20 pts → tasa MxM $3.000 ARS → NFT BFA
• Ley 9556: Arts. 11/12 obligatoriedad, Art. 17 código único, Art. 18 aranceles
• Marketplace RODAID: escrow, split 97.5%/2.5%, auto-release 5 días
• Pagos: MercadoPago OAuth, MxM canal oficial Gobierno de Mendoza
• BFA: Blockchain Federal Argentina (ERC-721, contrato "Rodaid Certificado" RCIT)
• Aliados: PIONERO 35% / CONSTRUCTOR 40% / ESCALADOR 45% por CIT emitido

ESTILO: Español rioplatense, preciso, técnico cuando aplica. Siempre mencionás el paso o endpoint concreto. Formato Markdown.`;
// ══════════════════════════════════════════════════════════
// RATE LIMITING
// ══════════════════════════════════════════════════════════
// DEPRECADO: reemplazado por verificarLimitesPlan en gpt.ratelimit.service.ts
// Mantenido para compatibilidad — delega a la nueva función
async function verificarRateLimit_LEGACY(usuarioId, ip) {
    const redis = (0, redis_1.getRedis)();
    const ahora = new Date();
    const hora = ahora.toISOString().slice(0, 13); // YYYY-MM-DDTHH
    const dia = ahora.toISOString().slice(0, 10); // YYYY-MM-DD
    const minuto = ahora.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
    const keyHora = `gpt:rl:hora:${usuarioId}:${hora}`;
    const keyDia = `gpt:rl:dia:${usuarioId}:${dia}`;
    const keyBurst = ip ? `gpt:rl:burst:${hash8(ip)}:${minuto}` : null;
    const [cHora, cDia, cBurst] = await Promise.all([
        redis.incr(keyHora),
        redis.incr(keyDia),
        keyBurst ? redis.incr(keyBurst) : Promise.resolve(0),
    ]);
    // TTL solo en el primer incremento
    if (cHora === 1)
        await redis.expire(keyHora, 3600);
    if (cDia === 1)
        await redis.expire(keyDia, 86400);
    if (keyBurst && cBurst === 1)
        await redis.expire(keyBurst, 60);
    const restantesHora = Math.max(0, RL_HORA_MAX - cHora);
    const restantesDia = Math.max(0, RL_DIA_MAX - cDia);
    const resetEn = new Date(Date.now() + (3600 - (ahora.getSeconds() + ahora.getMinutes() * 60)) * 1000).toISOString();
    if (cBurst > 5)
        return { ok: false, restantesHora, restantesDia, resetEn, bloqueadoPor: 'BURST' };
    if (cHora > RL_HORA_MAX)
        return { ok: false, restantesHora: 0, restantesDia, resetEn, bloqueadoPor: 'HORA' };
    if (cDia > RL_DIA_MAX)
        return { ok: false, restantesHora, restantesDia: 0, resetEn, bloqueadoPor: 'DIA' };
    return { ok: true, restantesHora, restantesDia, resetEn };
}
// ══════════════════════════════════════════════════════════
// CONTEXTO DEL USUARIO (privado, va al system prompt)
// ══════════════════════════════════════════════════════════
// buildContexto delegada a rodaid.context.service.ts
// (ver buildContextoRico con km, historial, zona y aliado)
// ══════════════════════════════════════════════════════════
// PROXY PRINCIPAL
// ══════════════════════════════════════════════════════════
async function consultaGPT(input) {
    const t0 = Date.now();
    // 1. Verificar API key (nunca sale del servidor)
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        await auditarConsulta(input, 0, 0, 0, 'ERROR', 'API_KEY_AUSENTE');
        throw new errorHandler_1.AppError('El servicio de IA no está disponible. Contactar a soporte.', 503, 'AI_NO_DISPONIBLE');
    }
    // 2. Rate limiting por plan (LIBRE/ESTANDAR/PREMIUM)
    const rl = await (0, gpt_ratelimit_service_1.verificarLimitesPlan)(input.usuarioId, input.ip);
    if (!rl.ok) {
        await auditarConsulta(input, 0, 0, 0, 'RATE_LIMITED', rl.bloqueadoPor);
        throw new errorHandler_1.AppError(rl.mensajeBloqueo ?? `Límite alcanzado (${rl.bloqueadoPor}).`, 429, 'RATE_LIMITED');
    }
    // 3. Verificar caché ANTES de llamar a Anthropic (ahorra tokens)
    const contextoKey = {
        plan: rl.plan,
        bikeCount: 0, // se actualiza abajo
        citStates: [],
    };
    // Construir fingerprint de contexto (sin PII)
    const bikeInfo = await (0, database_1.query)(`SELECT c.estado FROM bicicletas b
     LEFT JOIN LATERAL (SELECT estado FROM cits WHERE bicicleta_id=b.id ORDER BY creado_en DESC LIMIT 1) c ON TRUE
     WHERE b.propietario_id=$1::uuid LIMIT 10`, [input.usuarioId]).catch(() => []);
    contextoKey.bikeCount = bikeInfo.length;
    contextoKey.citStates = bikeInfo.map((b) => b.estado ?? 'SIN_CIT').filter(Boolean);
    const cacheResult = await (0, gpt_cache_service_1.buscarEnCache)(input.mensaje, contextoKey, input.contexto ?? 'general');
    if (cacheResult.hit && cacheResult.respuesta) {
        // ✅ Cache HIT — respuesta instantánea, costo $0
        const latencia = Date.now() - t0;
        const consultaId = await auditarConsulta(input, 0, 0, latencia, 'CACHE_HIT', `nivel-${cacheResult.nivel}`);
        return {
            consultaId,
            respuesta: cacheResult.respuesta,
            tokens: { entrada: 0, salida: 0, total: 0 },
            latenciaMs: latencia,
            rateLimit: {
                plan: rl.plan,
                restantesHora: rl.restantes.consultasHora,
                restantesDia: rl.restantes.consultasMes,
                resetMes: rl.resetMes,
                resetEn: rl.resetHora,
                consultasMes: rl.uso.consultasMes,
                limiteMes: rl.limites.consultasMes,
            },
            fromCache: true,
            cacheNivel: cacheResult.nivel,
            tokensAhorrados: cacheResult.tokensAhorrados,
        };
    }
    // CACHE MISS — construir system prompt y llamar a Anthropic
    const contextoUsuario = await (0, rodaid_context_service_1.buildContextoRico)(input.usuarioId, input.contexto);
    const systemPrompt = SYSTEM_RODAID.replace('{CONTEXTO_USUARIO}', contextoUsuario);
    // 4. Construir mensajes (historial máx 10 turnos = 20 mensajes)
    const historial = (input.historial ?? []).slice(-20);
    const mensajesAPI = [
        ...historial.map(h => ({
            role: h.rol === 'user' ? 'user' : 'assistant',
            content: h.contenido,
        })),
        { role: 'user', content: input.mensaje },
    ];
    // 5. Llamar a Anthropic (la key nunca sale del proceso Node.js)
    const client = new sdk_1.default({ apiKey });
    let respuesta = '';
    let tokensEntrada = 0;
    let tokensSalida = 0;
    try {
        const response = await Promise.race([
            client.messages.create({
                model: MODELO_INTERNO,
                max_tokens: MAX_TOKENS,
                system: systemPrompt,
                messages: mensajesAPI,
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), TIMEOUT_MS)),
        ]);
        respuesta = response.content[0].type === 'text' ? response.content[0].text : '';
        tokensEntrada = response.usage.input_tokens;
        tokensSalida = response.usage.output_tokens;
    }
    catch (err) {
        const latencia = Date.now() - t0;
        const tipo = err.message === 'TIMEOUT' ? 'TIMEOUT' : 'ANTHROPIC_ERROR';
        await auditarConsulta(input, tokensEntrada, tokensSalida, latencia, 'ERROR', tipo);
        if (tipo === 'TIMEOUT') {
            throw new errorHandler_1.AppError('El servicio tardó demasiado. Intentá con una pregunta más corta.', 504, 'AI_TIMEOUT');
        }
        // No reenviar el error de Anthropic al cliente (puede contener info interna)
        logger_1.log.mxm.error({ err: err.message, usuario: input.usuarioId.slice(0, 8) }, '✗ Anthropic API error');
        throw new errorHandler_1.AppError('Error al procesar la consulta. Intentá nuevamente.', 502, 'AI_ERROR');
    }
    const latencia = Date.now() - t0;
    // 6. Guardar auditoría (sin la API key, sin el texto del prompt)
    const consultaId = await auditarConsulta(input, tokensEntrada, tokensSalida, latencia, 'OK');
    await (0, gpt_ratelimit_service_1.registrarConsumo)(input.usuarioId, tokensEntrada, tokensSalida, input.ip).catch(() => { });
    logger_1.log.mxm.info({
        consultaId: consultaId.slice(0, 8),
        usuarioId: input.usuarioId.slice(0, 8),
        tokensEntrada, tokensSalida, latencia,
        contexto: input.contexto ?? 'general',
    }, `✅ GPT consulta: ${tokensEntrada}+${tokensSalida} tokens ${latencia}ms`);
    // 7. Retornar solo lo que el cliente necesita (nunca la API key)
    return {
        consultaId,
        respuesta, // ← solo el texto de Anthropic
        tokens: {
            entrada: tokensEntrada,
            salida: tokensSalida,
            total: tokensEntrada + tokensSalida,
        },
        latenciaMs: latencia,
        rateLimit: {
            plan: rl.plan,
            restantesHora: rl.restantes.consultasHora,
            restantesDia: rl.restantes.consultasMes,
            resetMes: rl.resetMes,
            resetEn: rl.resetHora,
            consultasMes: rl.uso.consultasMes,
            limiteMes: rl.limites.consultasMes,
        },
    };
}
// ══════════════════════════════════════════════════════════
// STREAMING — SSE token a token
// ══════════════════════════════════════════════════════════
async function consultaGPTStream(input, onChunk, onDone, onError) {
    const t0 = Date.now();
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        onError(new errorHandler_1.AppError('Servicio de IA no disponible.', 503, 'AI_NO_DISPONIBLE'));
        return;
    }
    const rl = await (0, gpt_ratelimit_service_1.verificarLimitesPlan)(input.usuarioId, input.ip);
    if (!rl.ok) {
        onError(new errorHandler_1.AppError(rl.mensajeBloqueo ?? `Límite alcanzado (${rl.bloqueadoPor}).`, 429, 'RATE_LIMITED'));
        return;
    }
    const contexto = await (0, rodaid_context_service_1.buildContextoRico)(input.usuarioId, input.contexto);
    const system = SYSTEM_RODAID.replace('{CONTEXTO_USUARIO}', contexto);
    const historial = (input.historial ?? []).slice(-20);
    const mensajes = [
        ...historial.map(h => ({ role: h.rol === 'user' ? 'user' : 'assistant', content: h.contenido })),
        { role: 'user', content: input.mensaje },
    ];
    const client = new sdk_1.default({ apiKey });
    let respuesta = '', tokIn = 0, tokOut = 0;
    try {
        const stream = client.messages.stream({ model: MODELO_INTERNO, max_tokens: MAX_TOKENS, system, messages: mensajes });
        for await (const ev of stream) {
            if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
                onChunk(ev.delta.text);
                respuesta += ev.delta.text;
            }
            if (ev.type === 'message_start' && ev.message.usage)
                tokIn = ev.message.usage.input_tokens;
            if (ev.type === 'message_delta' && ev.usage)
                tokOut = ev.usage.output_tokens;
        }
        const latencia = Date.now() - t0;
        await (0, gpt_ratelimit_service_1.registrarConsumo)(input.usuarioId, tokIn, tokOut, input.ip).catch(() => { });
        const consultaId = await auditarConsulta(input, tokIn, tokOut, latencia, 'OK');
        onDone({
            consultaId, respuesta,
            tokens: { entrada: tokIn, salida: tokOut, total: tokIn + tokOut },
            latenciaMs: latencia,
            rateLimit: { plan: rl.plan, restantesHora: rl.restantes.consultasHora, restantesDia: rl.restantes.consultasMes, resetMes: rl.resetMes, resetEn: rl.resetHora, consultasMes: rl.uso.consultasMes, limiteMes: rl.limites.consultasMes },
        });
    }
    catch (err) {
        await auditarConsulta(input, tokIn, tokOut, Date.now() - t0, 'ERROR', 'STREAM_ERROR');
        onError(new errorHandler_1.AppError('Error en el stream de IA.', 502, 'AI_STREAM_ERROR'));
    }
}
// ══════════════════════════════════════════════════════════
// AUDITORÍA (sin PII, sin API key)
// ══════════════════════════════════════════════════════════
async function auditarConsulta(input, tokIn, tokOut, latencia, estado, errorTipo) {
    const row = await (0, database_1.queryOne)(`INSERT INTO gpt_consultas
       (usuario_id, prompt_hash, prompt_len, contexto,
        tokens_entrada, tokens_salida, latencia_ms, modelo,
        estado, error_tipo, ip_hash, user_agent_hash)
     VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id::text`, [
        input.usuarioId,
        hash64(input.mensaje), // SHA-256 del texto, no el texto
        input.mensaje.length,
        input.contexto ?? 'general',
        tokIn, tokOut, latencia,
        MODELO_INTERNO, // el modelo real, solo en DB
        estado, errorTipo ?? null,
        input.ip ? hash8(input.ip) : null,
        input.userAgent ? hash8(input.userAgent) : null,
    ]);
    return row?.id ?? 'unknown';
}
// ══════════════════════════════════════════════════════════
// CONSULTAS DE USO (para el usuario, sin datos sensibles)
// ══════════════════════════════════════════════════════════
async function getUsoGPT(usuarioId, dias = 30) {
    const [resumen, porDia] = await Promise.all([
        (0, database_1.queryOne)(`
      SELECT
        COUNT(*)::int                                              AS total_consultas,
        COUNT(*) FILTER(WHERE estado='OK')::int                   AS exitosas,
        COUNT(*) FILTER(WHERE estado='ERROR')::int                AS errores,
        COUNT(*) FILTER(WHERE estado='RATE_LIMITED')::int         AS rate_limited,
        COALESCE(SUM(tokens_entrada+tokens_salida),0)::int        AS tokens_total,
        COALESCE(AVG(latencia_ms)::int,0)                         AS latencia_promedio_ms,
        -- Costo estimado (precios públicos Anthropic, no la key)
        ROUND((SUM(tokens_entrada)*0.000003 + SUM(tokens_salida)*0.000015)::numeric,4) AS costo_usd_estimado
      FROM gpt_consultas
      WHERE usuario_id=$1::uuid
        AND creado_en > NOW()-($2||' days')::interval
    `, [usuarioId, dias]),
        (0, database_1.query)(`
      SELECT dia, consultas, tokens_total, latencia_promedio_ms, errores
      FROM gpt_uso_usuario
      WHERE usuario_id=$1::uuid
        AND dia > NOW()-($2||' days')::interval
      ORDER BY dia DESC LIMIT 30
    `, [usuarioId, dias]),
    ]);
    // Rate limit restante actual
    const redis = (0, redis_1.getRedis)();
    const hora = new Date().toISOString().slice(0, 13);
    const dia = new Date().toISOString().slice(0, 10);
    const [cHora, cDia] = await Promise.all([
        redis.get(`gpt:rl:hora:${usuarioId}:${hora}`).then(v => parseInt(v ?? '0')),
        redis.get(`gpt:rl:dia:${usuarioId}:${dia}`).then(v => parseInt(v ?? '0')),
    ]).catch(() => [0, 0]);
    return {
        periodo: `últimos ${dias} días`,
        resumen: { ...resumen, modeloPublico: 'claude-sonnet' }, // ← nunca el modelo interno real completo
        porDia,
        rateLimit: {
            limiteHora: RL_HORA_MAX,
            limiteDia: RL_DIA_MAX,
            usadosEstaHora: cHora,
            usadosHoy: cDia,
            restantesEstaHora: Math.max(0, RL_HORA_MAX - cHora),
            restantesHoy: Math.max(0, RL_DIA_MAX - cDia),
        },
    };
}
// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
/** SHA-256 completo — para auditoría sin revelar el texto */
function hash64(text) {
    return crypto_1.default.createHash('sha256').update(text, 'utf8').digest('hex');
}
/** SHA-256 truncado a 16 chars — para IP, user-agent (privacidad) */
function hash8(text) {
    return crypto_1.default.createHash('sha256').update(text).digest('hex').slice(0, 16);
}
