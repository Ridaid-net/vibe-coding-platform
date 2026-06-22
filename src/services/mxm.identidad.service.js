"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.invalidarCache = invalidarCache;
exports.getIdentidadMxM = getIdentidadMxM;
exports.getNivelPorSerial = getNivelPorSerial;
exports.getResumenNivelesMxM = getResumenNivelesMxM;
const database_1 = require("../config/database");
const redis_1 = require("../config/redis");
const mxm_service_1 = require("./mxm.service");
const logger_1 = require("../middleware/logger");
// ══════════════════════════════════════════════════════════
// CONSTANTES
// ══════════════════════════════════════════════════════════
const CACHE_TTL_SEC = 300; // 5 min en Redis
const STALE_THRESHOLD_MIN = 5; // refrescar si el caché tiene > 5 min
const NIVEL_DESC = {
    0: 'Sin verificación MxM',
    1: 'Email / teléfono verificado (Nivel 1)',
    2: 'Identidad completa RENAPER (Nivel 2) ✓',
};
// ══════════════════════════════════════════════════════════
// CACHE REDIS
// ══════════════════════════════════════════════════════════
function cacheKey(userId) {
    return `mxm:identidad:${userId}`;
}
async function getCached(userId) {
    try {
        const raw = await (0, redis_1.getRedis)().get(cacheKey(userId));
        return raw ? JSON.parse(raw) : null;
    }
    catch {
        return null;
    }
}
async function setCache(userId, data) {
    try {
        await (0, redis_1.getRedis)().set(cacheKey(userId), JSON.stringify(data), 'EX', CACHE_TTL_SEC);
    }
    catch { /* best-effort */ }
}
async function invalidarCache(userId) {
    try {
        await (0, redis_1.getRedis)().del(cacheKey(userId));
    }
    catch { /* best-effort */ }
}
// ══════════════════════════════════════════════════════════
// DERIVAR CAPACIDADES
// ══════════════════════════════════════════════════════════
function derivarCapacidades(nivel) {
    const n2 = nivel >= 2;
    const n1 = nivel >= 1;
    const descripcion = [];
    if (n2) {
        descripcion.push('✓ Puede emitir Certificados de Identidad Técnica (CIT)');
        descripcion.push('✓ Puede transferir CIT al vender una bicicleta');
    }
    else if (n1) {
        descripcion.push('✓ Puede acceder al marketplace RODAID');
        descripcion.push('⚠ Requiere Nivel 2 para emitir CITs — verificá tu identidad con RENAPER en MxM');
    }
    else {
        descripcion.push('✗ Conectate con Mendoza por Mí para acceder a todas las funciones');
    }
    return {
        puedeEmitirCIT: n2,
        puedeTransferirCIT: n2,
        puedeVenderMarketplace: n1,
        puedeComprarMarketplace: n1,
        puedeRecibirNFT: n1,
        descripcion,
    };
}
// ══════════════════════════════════════════════════════════
// OBTENER IDENTIDAD — función principal
// ══════════════════════════════════════════════════════════
async function getIdentidadMxM(userId, opciones) {
    // ── 1. Cache hit ─────────────────────────────────────────
    if (!opciones?.forzarRefresh) {
        const cached = await getCached(userId);
        if (cached) {
            logger_1.log.mxm.debug({ userId: userId.slice(0, 8), origen: 'cache' }, 'identidad desde Redis');
            return { ...cached, esFresco: true, token: { ...cached.token, origen: 'cache' } };
        }
    }
    // ── 2. Leer de DB ─────────────────────────────────────────
    const [usuario, tokenRow, cacheRow] = await Promise.all([
        (0, database_1.queryOne)(`SELECT mxm_verificado, mxm_nivel, mxm_sub, mxm_email, mxm_ultimo_login,
              nombre, apellido, dni, cuil
       FROM usuarios WHERE id=$1`, [userId]),
        (0, database_1.queryOne)(`SELECT access_token, expires_at, cuil, nivel, nombre, apellido, dni, email
       FROM mxm_tokens WHERE usuario_id=$1`, [userId]),
        (0, database_1.queryOne)(`SELECT sub, cuil, dni, nombre, apellido, email, nivel, scopes, cacheado_en, verificado_en
       FROM mxm_identidad_cache WHERE usuario_id=$1`, [userId]),
    ]);
    // No conectado a MxM
    if (!usuario?.mxm_verificado && !tokenRow) {
        const identidad = {
            conectado: false,
            nivel: 0,
            nivelDescripcion: NIVEL_DESC[0],
            scopes: [],
            token: { vigente: false, origen: 'ninguno' },
            capacidades: derivarCapacidades(0),
            esFresco: true,
        };
        await setCache(userId, identidad);
        return identidad;
    }
    // ── 3. Verificar frescura del token ───────────────────────
    const ahora = new Date();
    const tokenExpiraEn = tokenRow?.expires_at ? new Date(tokenRow.expires_at) : null;
    const tokenVigente = tokenExpiraEn ? tokenExpiraEn > new Date(ahora.getTime() + 60_000) : false;
    const cacheadoHace = cacheRow?.cacheado_en
        ? (ahora.getTime() - new Date(cacheRow.cacheado_en).getTime()) / 60_000
        : Infinity;
    // ── 4. Refrescar desde /userinfo si el token está vigente ─
    let identidadFresca = {};
    let origenToken = 'db';
    if (tokenVigente && cacheadoHace > STALE_THRESHOLD_MIN) {
        try {
            const accessToken = await (0, mxm_service_1.getMxMAccessToken)(userId);
            if (accessToken) {
                const raw = await mxm_service_1.mxmService.getIdentidad(accessToken);
                identidadFresca = {
                    cuil: raw.cuil,
                    dni: raw.dni,
                    nombre: raw.nombre,
                    apellido: raw.apellido,
                    email: raw.email,
                };
                origenToken = 'userinfo';
                // Persistir en caché DB
                await upsertIdentidadCache(userId, { ...raw, sub: raw.sub ?? '' }, tokenExpiraEn);
                logger_1.log.mxm.info({ userId: userId.slice(0, 8), nivel: raw.nivel }, 'identidad refrescada desde /userinfo');
            }
        }
        catch (err) {
            logger_1.log.mxm.warn({ err: err.message }, 'No se pudo refrescar desde /userinfo — usando DB');
        }
    }
    // ── 5. Construir respuesta combinando fuentes ─────────────
    const cuil = identidadFresca.cuil ?? cacheRow?.cuil ?? tokenRow?.cuil ?? usuario?.cuil ?? undefined;
    const dni = identidadFresca.dni ?? cacheRow?.dni ?? tokenRow?.dni ?? usuario?.dni ?? undefined;
    const nombre = identidadFresca.nombre ?? cacheRow?.nombre ?? tokenRow?.nombre ?? usuario?.nombre ?? undefined;
    const apellido = identidadFresca.apellido ?? cacheRow?.apellido ?? tokenRow?.apellido ?? usuario?.apellido ?? undefined;
    const email = identidadFresca.email ?? cacheRow?.email ?? usuario?.mxm_email ?? undefined;
    const nivel = Math.max(identidadFresca?.nivel ?? 0, cacheRow?.nivel ?? 0, tokenRow?.nivel ?? 0, usuario?.mxm_nivel ?? 0);
    const minutosRestantes = tokenExpiraEn
        ? Math.max(0, Math.floor((tokenExpiraEn.getTime() - ahora.getTime()) / 60_000))
        : undefined;
    const cuilNormalizado = cuil?.replace(/-/g, '');
    const identidad = {
        conectado: true,
        sub: cacheRow?.sub ?? usuario?.mxm_sub ?? undefined,
        cuil,
        cuilNormalizado,
        dni,
        nombre,
        apellido,
        nombreCompleto: nombre && apellido ? `${nombre} ${apellido}` : nombre,
        email,
        nivel,
        nivelDescripcion: NIVEL_DESC[nivel] ?? NIVEL_DESC[0],
        scopes: cacheRow?.scopes ?? [],
        token: {
            vigente: tokenVigente,
            expiraEn: tokenExpiraEn ?? undefined,
            minutosRestantes,
            origen: origenToken,
        },
        capacidades: derivarCapacidades(nivel),
        cacheadoEn: cacheRow?.cacheado_en ?? undefined,
        verificadoEn: cacheRow?.verificado_en ?? undefined,
        esFresco: origenToken === 'userinfo',
    };
    await setCache(userId, identidad);
    return identidad;
}
// ══════════════════════════════════════════════════════════
// UPSERT CACHE DB
// ══════════════════════════════════════════════════════════
async function upsertIdentidadCache(userId, raw, tokenExpiraEn) {
    await (0, database_1.query)(`INSERT INTO mxm_identidad_cache
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
       verificado_en   = NOW()`, [userId, raw.sub, raw.cuil, raw.dni, raw.nombre, raw.apellido,
        raw.email ?? null, raw.nivel, tokenExpiraEn]);
}
// ══════════════════════════════════════════════════════════
// CONSULTA PÚBLICA POR SERIAL (para verificador — sin datos PII)
// ══════════════════════════════════════════════════════════
/**
 * Retorna solo el nivel de verificación del propietario actual de un CIT.
 * Sin PII — solo el nivel para que el comprador pueda evaluar la confianza.
 */
async function getNivelPorSerial(serial) {
    const row = await (0, database_1.queryOne)(`SELECT u.mxm_nivel AS nivel, u.mxm_verificado AS verificado
     FROM cits c
     JOIN bicicletas b ON b.id=c.bicicleta_id
     JOIN usuarios u ON u.id=c.propietario_id
     WHERE b.numero_serie=$1 AND c.estado='ACTIVO'
     ORDER BY c.creado_en DESC LIMIT 1`, [serial]);
    const nivel = (row?.nivel ?? 0);
    return {
        nivelPropietario: nivel,
        nivelDescripcion: NIVEL_DESC[nivel] ?? NIVEL_DESC[0],
        verificadoPorMxM: row?.verificado === true,
    };
}
// ══════════════════════════════════════════════════════════
// ADMIN — resumen de niveles MxM en RODAID
// ══════════════════════════════════════════════════════════
async function getResumenNivelesMxM() {
    const row = await (0, database_1.queryOne)(`SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE NOT mxm_verificado OR mxm_nivel=0)::text AS n0,
       COUNT(*) FILTER (WHERE mxm_verificado AND mxm_nivel=1)::text AS n1,
       COUNT(*) FILTER (WHERE mxm_verificado AND mxm_nivel=2)::text AS n2
     FROM usuarios`, []);
    const total = parseInt(row?.total ?? '0');
    const n2 = parseInt(row?.n2 ?? '0');
    return {
        total,
        nivel0: parseInt(row?.n0 ?? '0'),
        nivel1: parseInt(row?.n1 ?? '0'),
        nivel2: n2,
        pctVerificados: total > 0 ? Math.round(n2 / total * 100) : 0,
    };
}
