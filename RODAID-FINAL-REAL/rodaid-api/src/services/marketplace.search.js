"use strict";
// ─── RODAID · Marketplace Search Engine ───────────────────
// Búsqueda full-text + filtros + facetas + ordenamiento.
//
// Tecnologías:
//   · PostgreSQL tsvector / tsquery — Spanish stemming
//   · GIN index en search_vector — O(log N) lookup
//   · Redis caché por hash de params — TTL 60s
//
// Query params soportados:
//   q=trek               full-text en título, descripción, marca, serial
//   marca=Trek,Giant     array (OR)
//   tipo=MTB             enum de bicicletas
//   anio_min=2020        año de fabricación
//   anio_max=2023
//   precio_min=100000    en ARS
//   precio_max=500000
//   estado=ACTIVA        default
//   orden=relevancia     precio_asc | precio_desc | recientes | vistas
//   pagina=1
//   limite=12
//
// Respuesta:
//   { publicaciones, total, pagina, paginas, facetas, tiempoMs }
//   facetas: { marcas, tipos, rangos_precio }
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buscarPublicaciones = buscarPublicaciones;
exports.sugerirPublicaciones = sugerirPublicaciones;
exports.invalidarCacheSearch = invalidarCacheSearch;
const crypto_1 = __importDefault(require("crypto"));
const database_1 = require("../config/database");
const redis_1 = require("../config/redis");
const logger_1 = require("../middleware/logger");
// ══════════════════════════════════════════════════════════
// CACHE KEY
// ══════════════════════════════════════════════════════════
function cacheKey(q) {
    const canonical = JSON.stringify({
        q: q.q?.toLowerCase().trim(),
        marca: q.marca, tipo: q.tipo,
        anio_min: q.anio_min, anio_max: q.anio_max,
        precio_min: q.precio_min, precio_max: q.precio_max,
        estado: q.estado ?? 'ACTIVA',
        orden: q.orden ?? 'recientes',
        pagina: q.pagina ?? 1, limite: q.limite ?? 12,
    });
    return `mp:search:${crypto_1.default.createHash('md5').update(canonical).digest('hex')}`;
}
function buildWhere(q, parts) {
    const { conds, params, joins } = parts;
    const estado = q.estado ?? 'ACTIVA';
    // Estado y vigencia
    params.push(estado);
    conds.push(`mp.estado=$${params.length}::estado_publicacion`);
    conds.push('mp.vence_en > NOW()');
    // Full-text search
    if (q.q?.trim()) {
        const texto = q.q.trim();
        // Normalizar: remover caracteres especiales, construir tsquery
        // Estrategia: primero intenta match exacto de frase, luego palabras individuales
        const palabras = texto
            .toLowerCase()
            .replace(/[^a-záéíóúüñ\s]/g, ' ')
            .split(/\s+/)
            .filter(p => p.length >= 2);
        if (palabras.length > 0) {
            // Búsqueda: todas las palabras deben estar (AND) con prefijo para autocompletado
            const tsquery = palabras.map(p => `${p}:*`).join(' & ');
            params.push(tsquery);
            conds.push(`mp.search_vector @@ to_tsquery('spanish', $${params.length})`);
        }
    }
    // Marcas (OR entre ellas)
    if (q.marca) {
        const marcas = q.marca.split(',').map(m => m.trim()).filter(Boolean);
        if (marcas.length === 1) {
            params.push(marcas[0]);
            conds.push(`LOWER(b.marca) = LOWER($${params.length})`);
        }
        else if (marcas.length > 1) {
            params.push(marcas.map(m => m.toLowerCase()));
            conds.push(`LOWER(b.marca) = ANY($${params.length})`);
        }
    }
    // Tipo de bicicleta
    if (q.tipo) {
        params.push(q.tipo.toUpperCase());
        conds.push(`b.tipo::text = $${params.length}`);
    }
    // Rango de año
    if (q.anio_min) {
        params.push(q.anio_min);
        conds.push(`b.anio >= $${params.length}`);
    }
    if (q.anio_max) {
        params.push(q.anio_max);
        conds.push(`b.anio <= $${params.length}`);
    }
    // Rango de precio
    if (q.precio_min) {
        params.push(q.precio_min);
        conds.push(`mp.precio_ars >= $${params.length}`);
    }
    if (q.precio_max) {
        params.push(q.precio_max);
        conds.push(`mp.precio_ars <= $${params.length}`);
    }
}
// ══════════════════════════════════════════════════════════
// ORDER BY
// ══════════════════════════════════════════════════════════
function buildOrderBy(orden, hasQuery, destacadas) {
    const dest = destacadas ? 'mp.destacada DESC, ' : '';
    if (orden === 'relevancia' && hasQuery) {
        // Ordenar por rank de relevancia ts_rank
        return `${dest}ts_rank(mp.search_vector, to_tsquery('spanish', $TSQUERY_PH)) DESC, mp.publicado_en DESC`;
    }
    const ordenes = {
        precio_asc: 'mp.precio_ars ASC',
        precio_desc: 'mp.precio_ars DESC',
        recientes: 'mp.publicado_en DESC',
        vistas: 'mp.vistas DESC, mp.publicado_en DESC',
        relevancia: 'mp.publicado_en DESC',
    };
    return `${dest}${ordenes[orden] ?? 'mp.publicado_en DESC'}`;
}
// ══════════════════════════════════════════════════════════
// SELECT COLUMNS
// ══════════════════════════════════════════════════════════
const SELECT_COLS = `
  mp.id, mp.slug, mp.titulo, mp.descripcion,
  mp.precio_ars, mp.precio_usd, mp.fotos_urls,
  mp.estado::text AS estado, mp.vistas, mp.contactos,
  mp.publicado_en, mp.vence_en, mp.destacada,
  mp.vendido_en, mp.precio_final_ars,
  b.numero_serie AS serial, b.marca, b.modelo, b.anio,
  b.tipo::text AS tipo, b.color,
  c.numero_cit, c.estado::text AS cit_estado,
  c.hash_sha256, c.puntos, c.fecha_vencimiento, c.codigo_verif,
  u.id AS vendedor_id, u.nombre AS vendedor_nombre,
  NULL::text AS localidad
`;
function mapRow(r) {
    const fotos = Array.isArray(r.fotos_urls)
        ? r.fotos_urls
        : String(r.fotos_urls ?? '').replace(/[{}]/g, '').split(',').filter(Boolean);
    return {
        id: r.id, slug: r.slug, titulo: r.titulo, descripcion: r.descripcion,
        precioARS: parseFloat(r.precio_ars), precioUSD: r.precio_usd ? parseFloat(r.precio_usd) : undefined,
        fotosUrls: fotos, estado: r.estado, vistas: r.vistas, contactos: r.contactos,
        publicadoEn: new Date(r.publicado_en), venceEn: new Date(r.vence_en), destacada: r.destacada,
        bicicleta: { serial: r.serial, marca: r.marca, modelo: r.modelo, anio: r.anio, tipo: r.tipo, color: r.color },
        cit: { numeroCIT: r.numero_cit, estado: r.cit_estado, hashSHA256: r.hash_sha256,
            puntos: r.puntos, fechaVencimiento: r.fecha_vencimiento ? new Date(r.fecha_vencimiento) : null,
            codigoVerif: r.codigo_verif ?? undefined },
        vendedor: { id: r.vendedor_id, nombre: r.vendedor_nombre },
    };
}
// ══════════════════════════════════════════════════════════
// FACETAS — conteos para los filtros de la sidebar
// ══════════════════════════════════════════════════════════
async function calcularFacetas(estado = 'ACTIVA') {
    const cacheKeyF = `mp:facetas:${estado}`;
    try {
        const cached = await (0, redis_1.getRedis)().get(cacheKeyF);
        if (cached)
            return JSON.parse(cached);
    }
    catch { /* continue */ }
    const [facRows, total, precioStats] = await Promise.all([
        (0, database_1.query)(`SELECT dimension, valor, conteo::text FROM mp_facetas($1)`, [estado]),
        (0, database_1.queryOne)(`SELECT COUNT(*)::text AS n FROM marketplace_publicaciones WHERE estado=$1::estado_publicacion AND vence_en > NOW()`, [estado]),
        (0, database_1.queryOne)(`SELECT
         MIN(precio_ars)::text AS min, MAX(precio_ars)::text AS max,
         PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY precio_ars)::text AS p25,
         PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY precio_ars)::text AS p50,
         PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY precio_ars)::text AS p75
       FROM marketplace_publicaciones WHERE estado=$1::estado_publicacion AND vence_en > NOW()`, [estado]),
    ]);
    const marcas = facRows.filter(r => r.dimension === 'marca')
        .map(r => ({ valor: r.valor, conteo: parseInt(r.conteo) }));
    const tipos = facRows.filter(r => r.dimension === 'tipo')
        .map(r => ({ valor: r.valor, conteo: parseInt(r.conteo) }));
    // Rangos de precio basados en percentiles reales
    const pMin = parseFloat(precioStats?.min ?? '0');
    const pMax = parseFloat(precioStats?.max ?? '0');
    const p25 = parseFloat(precioStats?.p25 ?? '0');
    const p50 = parseFloat(precioStats?.p50 ?? '0');
    const p75 = parseFloat(precioStats?.p75 ?? '0');
    const rangosPrecio = pMax > 0 ? [
        { etiqueta: `Hasta $${Math.round(p25 / 1000)}K`, min: 0, max: p25, conteo: 0 },
        { etiqueta: `$${Math.round(p25 / 1000)}K — $${Math.round(p50 / 1000)}K`, min: p25, max: p50, conteo: 0 },
        { etiqueta: `$${Math.round(p50 / 1000)}K — $${Math.round(p75 / 1000)}K`, min: p50, max: p75, conteo: 0 },
        { etiqueta: `Más de $${Math.round(p75 / 1000)}K`, min: p75, max: pMax, conteo: 0 },
    ] : [];
    const result = {
        marcas, tipos, rangosPrecio,
        totalActivas: parseInt(total?.n ?? '0'),
    };
    (0, redis_1.getRedis)().set(cacheKeyF, JSON.stringify(result), 'EX', 120).catch(() => { });
    return result;
}
// ══════════════════════════════════════════════════════════
// BÚSQUEDA PRINCIPAL
// ══════════════════════════════════════════════════════════
async function buscarPublicaciones(q) {
    const t0 = Date.now();
    const key = cacheKey(q);
    // Cache hit
    try {
        const cached = await (0, redis_1.getRedis)().get(key);
        if (cached) {
            const result = JSON.parse(cached);
            return { ...result, fromCache: true, tiempoMs: Date.now() - t0 };
        }
    }
    catch { /* continue */ }
    const pagina = Math.max(1, q.pagina ?? 1);
    const limite = Math.min(50, Math.max(1, q.limite ?? 12));
    const offset = (pagina - 1) * limite;
    const orden = q.orden ?? (q.q ? 'relevancia' : 'recientes');
    const hasQ = Boolean(q.q?.trim() && q.q.trim().length >= 2);
    // Build WHERE
    const parts = { conds: [], params: [], joins: [] };
    buildWhere(q, parts);
    const where = parts.conds.join(' AND ');
    // ORDER BY (inyectar el param de tsquery para ts_rank si aplica)
    let orderBy = buildOrderBy(orden, hasQ, q.destacadas_primero ?? true);
    let tsQueryParamIdx = null;
    if (orderBy.includes('$TSQUERY_PH')) {
        // Reuse the tsquery already in params from buildWhere (it's always the last before LIMIT/OFFSET)
        // Find its index: it was added as the last WHERE param
        const tsIdx = parts.params.length; // will be LIMIT param — tsquery is at tsIdx-1
        // Actually reuse the tsquery from the WHERE clause
        // The tsquery param is at some position < tsIdx — find it by looking for the tsquery string
        // Simplest: use a subselect or just fallback to publicado_en ordering for relevance
        orderBy = orderBy.replace('$TSQUERY_PH', `''`); // safe fallback, evaluated at runtime
        // Better: find the tsquery param index from WHERE conds
        const tsParamIdx = parts.params.findIndex(p => typeof p === 'string' && p.includes(':*'));
        if (tsParamIdx >= 0) {
            orderBy = orderBy.replace("''", `$${tsParamIdx + 1}`);
        }
    }
    // Agregar LIMIT y OFFSET
    parts.params.push(limite, offset);
    const limitIdx = parts.params.length - 1;
    const offsetIdx = parts.params.length;
    const sqlMain = `
    SELECT ${SELECT_COLS}
    FROM marketplace_publicaciones mp
    JOIN bicicletas b ON b.id = mp.bicicleta_id
    JOIN cits c ON c.id = mp.cit_id
    JOIN usuarios u ON u.id = mp.vendedor_id
    WHERE ${where}
    ORDER BY ${orderBy}
    LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
    const sqlCount = `
    SELECT COUNT(*)::text AS n
    FROM marketplace_publicaciones mp
    JOIN bicicletas b ON b.id = mp.bicicleta_id
    WHERE ${where}`;
    // Ejecutar en paralelo: resultados + total + facetas
    const [rows, totRow, facetas] = await Promise.all([
        (0, database_1.query)(sqlMain, parts.params),
        (0, database_1.queryOne)(sqlCount, parts.params.slice(0, -2)),
        calcularFacetas(q.estado ?? 'ACTIVA'),
    ]);
    const total = parseInt(totRow?.n ?? '0');
    const paginas = Math.ceil(total / limite);
    const ms = Date.now() - t0;
    const result = {
        publicaciones: rows.map(mapRow),
        total,
        pagina,
        paginas,
        facetas,
        tiempoMs: ms,
        fromCache: false,
        query: {
            q: q.q ?? undefined,
            filtros: {
                marca: q.marca,
                tipo: q.tipo,
                anio_min: q.anio_min,
                anio_max: q.anio_max,
                precio_min: q.precio_min,
                precio_max: q.precio_max,
                estado: q.estado ?? 'ACTIVA',
                orden,
            },
        },
    };
    // Cache (más corto si hay búsqueda textual — cambia más seguido)
    const ttl = hasQ ? 30 : 60;
    (0, redis_1.getRedis)().set(key, JSON.stringify(result), 'EX', ttl).catch(() => { });
    logger_1.log.marketplace.debug({
        q: q.q, filtros: result.query.filtros,
        total, ms, fromCache: false,
    }, `✓ Búsqueda marketplace: ${total} resultados en ${ms}ms`);
    return result;
}
// ══════════════════════════════════════════════════════════
// SUGERENCIAS DE AUTOCOMPLETADO — GET /marketplace/suggest?q=trek
// ══════════════════════════════════════════════════════════
async function sugerirPublicaciones(texto, limite = 5) {
    if (!texto || texto.trim().length < 2)
        return [];
    const t = texto.trim().toLowerCase();
    const cacheKeyS = `mp:suggest:${t}`;
    try {
        const cached = await (0, redis_1.getRedis)().get(cacheKeyS);
        if (cached)
            return JSON.parse(cached);
    }
    catch { /* continue */ }
    const [pubs, marcas, modelos] = await Promise.all([
        // Publicaciones que coinciden
        (0, database_1.query)(`SELECT mp.titulo, mp.slug, mp.precio_ars::text
       FROM marketplace_publicaciones mp
       WHERE mp.estado='ACTIVA' AND mp.vence_en > NOW()
         AND mp.search_vector @@ to_tsquery('spanish', $1)
       ORDER BY mp.vistas DESC
       LIMIT $2`, [`${t}:*`, Math.ceil(limite / 2)]),
        // Marcas que coinciden
        (0, database_1.query)(`SELECT DISTINCT b.marca, COUNT(mp.id)::text AS n
       FROM bicicletas b
       JOIN marketplace_publicaciones mp ON mp.bicicleta_id=b.id
       WHERE mp.estado='ACTIVA' AND LOWER(b.marca) LIKE $1
       GROUP BY b.marca ORDER BY n DESC LIMIT 3`, [`%${t}%`]),
        // Modelos que coinciden
        (0, database_1.query)(`SELECT b.modelo, b.marca, COUNT(mp.id) AS n
       FROM bicicletas b
       JOIN marketplace_publicaciones mp ON mp.bicicleta_id=b.id
       WHERE mp.estado='ACTIVA' AND LOWER(b.modelo) LIKE $1
       GROUP BY b.modelo, b.marca ORDER BY n DESC LIMIT 3`, [`%${t}%`]),
    ]);
    const sugerencias = [
        ...marcas.map(r => ({
            tipo: 'marca',
            valor: r.marca,
            extra: `${r.n} publicaciones`,
        })),
        ...modelos.map(r => ({
            tipo: 'modelo',
            valor: `${r.marca} ${r.modelo}`,
            extra: r.marca,
        })),
        ...pubs.map(r => ({
            tipo: 'publicacion',
            valor: r.titulo,
            slug: r.slug,
            extra: `$${parseFloat(r.precio_ars).toLocaleString('es-AR')} ARS`,
        })),
    ].slice(0, limite);
    (0, redis_1.getRedis)().set(cacheKeyS, JSON.stringify(sugerencias), 'EX', 30).catch(() => { });
    return sugerencias;
}
// ══════════════════════════════════════════════════════════
// INVALIDAR CACHES
// ══════════════════════════════════════════════════════════
async function invalidarCacheSearch() {
    try {
        const redis = (0, redis_1.getRedis)();
        const keys = await redis.keys('mp:search:*');
        const kFac = await redis.keys('mp:facetas:*');
        const kSug = await redis.keys('mp:suggest:*');
        const toDelete = [...keys, ...kFac, ...kSug];
        if (toDelete.length > 0)
            await redis.del(...toDelete);
    }
    catch { /* best-effort */ }
}
