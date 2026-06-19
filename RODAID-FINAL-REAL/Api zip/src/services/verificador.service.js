"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.invalidarCacheVerificador = invalidarCacheVerificador;
exports.verificarSerial = verificarSerial;
exports.verificarNumeroCIT = verificarNumeroCIT;
exports.verificarCodigo = verificarCodigo;
exports.getVerificacionesStats = getVerificacionesStats;
const crypto_1 = __importDefault(require("crypto"));
const env_1 = require("../config/env");
const estado_service_1 = require("./estado.service");
const database_1 = require("../config/database");
const redis_1 = require("../config/redis");
const logger_1 = require("../middleware/logger");
// ══════════════════════════════════════════════════════════
// ANONIMIZACIÓN DE IPs — privacidad by design
// SHA-256(ip + fecha_utc + salt) → primeros 16 hex chars
// El salt diario hace imposible correlacionar días distintos
// ══════════════════════════════════════════════════════════
function hashIP(ip) {
    const salt = env_1.env.ANALYTICS_IP_SALT ?? 'rodaid-analytics-2026';
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const payload = `${ip}:${today}:${salt}`;
    return crypto_1.default.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}
function detectarBot(userAgent) {
    if (!userAgent)
        return false;
    const ua = userAgent.toLowerCase();
    return /bot|crawl|spider|scan|curl|wget|python|go-http|java|axios|fetch|node/i.test(ua);
}
// ══════════════════════════════════════════════════════════
// HELPERS DE PRIVACIDAD
// ══════════════════════════════════════════════════════════
function ocultarApellido(nombre) {
    const partes = nombre.trim().split(/\s+/);
    if (partes.length <= 1)
        return partes[0] ?? '';
    // "Federico Alejandro De Gea" → "Federico A.**"
    const primerNombre = partes[0];
    const segundoNombre = partes[1]?.charAt(0) + '.';
    return `${primerNombre} ${segundoNombre}**`;
}
function ocultarDNI(dni) {
    const solo = dni.replace(/\D/g, '');
    if (solo.length < 6)
        return '***';
    const visible = solo.slice(0, -3);
    return visible.replace(/(\d{2})(\d*)/, (_, a, b) => {
        const grupos = (a + b).match(/.{1,3}/g) ?? [a + b];
        return grupos.join('.') + '.***';
    });
}
function estadoLabel(estado) {
    const labels = {
        ACTIVO: '✓ Certificado activo y vigente',
        EXPIRADO: '⚠ Certificado vencido — requiere re-inspección',
        BLOQUEADO: '✗ Certificado bloqueado — denuncia activa',
        RECHAZADO: '✗ Inspección rechazada',
        PENDIENTE: '⏳ Certificado en proceso de validación',
        NO_ENCONTRADO: '— Serial no registrado en RODAID',
    };
    return labels[estado] ?? estado;
}
function modoSelloLabel(modo) {
    const labels = {
        GOB_MENDOZA: 'Gobierno de Mendoza — TSA oficial',
        RFC3161: 'RFC 3161 — TSA pública reconocida',
        STUB: 'RODAID — sello local (en desarrollo)',
    };
    return labels[modo] ?? modo;
}
// ══════════════════════════════════════════════════════════
// CONSULTA PRINCIPAL EN DB
// ══════════════════════════════════════════════════════════
async function consultarDB(serial) {
    return (0, database_1.queryOne)(`SELECT
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
     LIMIT 1`, [serial]);
}
async function consultarBFAOnChain(hashSHA256, tokenId, citId) {
    const t0 = Date.now();
    try {
        const { bfaService } = await import('./bfa.service');
        const { env } = await import('../config/env');
        // Llamada 1: verificarIntegridad(hash) — siempre disponible (view function)
        const integridad = await bfaService.verificarIntegridad(hashSHA256);
        // Llamada 2: datosCIT(tokenId) — solo si tenemos tokenId
        let datosCIT = null;
        if (integridad.valido && integridad.tokenId) {
            datosCIT = await bfaService.datosCIT(integridad.tokenId);
        }
        else if (tokenId) {
            datosCIT = await bfaService.datosCIT(tokenId);
        }
        const latenciaNodo = Date.now() - t0;
        // Comparar hash DB vs hash on-chain
        const hashOnChain = datosCIT?.hashSHA256 ?? null;
        const hashCoincide = hashOnChain
            ? hashOnChain.toLowerCase() === hashSHA256.toLowerCase()
            : integridad.valido; // si integridad.valido=true el hash está registrado
        const tokenIdFinal = integridad.tokenId || tokenId || undefined;
        const bloqueado = datosCIT?.bloqueado ?? integridad.bloqueado;
        const nodo = env.BFA_RPC_URL
            ? new URL(env.BFA_RPC_URL).hostname
            : 'STUB';
        logger_1.log.verificador.debug({
            citId, hashCoincide, tokenId: tokenIdFinal,
            bloqueadoOnChain: bloqueado, latenciaNodo, nodo,
        }, `BFA on-chain: ${hashCoincide ? '✓ hash coincide' : '⚠ hash NO coincide'}`);
        return {
            consultada: true,
            hashCoincide,
            hashDB: hashSHA256.slice(0, 16) + '...',
            hashOnChain: hashOnChain ? hashOnChain.slice(0, 16) + '...' : undefined,
            bloqueadoOnChain: bloqueado,
            tokenIdOnChain: tokenIdFinal,
            latenciaNodo,
            nodo,
        };
    }
    catch (err) {
        const ms = Date.now() - t0;
        logger_1.log.verificador.warn({ citId, err: err.message, ms }, 'BFA on-chain consulta falló — usando solo índice local');
        return {
            consultada: false,
            hashCoincide: null,
            bloqueadoOnChain: null,
            latenciaNodo: ms,
            nodo: 'ERROR',
            error: err.message.slice(0, 100),
        };
    }
}
async function consultarDenuncias(serial) {
    return (0, database_1.query)(`SELECT estado, creado_en FROM denuncias_robo
     WHERE numero_serie=$1 AND estado='ACTIVA'
     ORDER BY creado_en DESC LIMIT 5`, [serial]);
}
// ══════════════════════════════════════════════════════════
// CACHÉ REDIS
// ══════════════════════════════════════════════════════════
const CACHE_TTL_ENCONTRADO = 300; // 5 min
const CACHE_TTL_NO_ENCONTRADO = 30; // 30 s
function cacheKey(tipo, valor) {
    return `verificar:${tipo}:${valor.toUpperCase()}`;
}
async function getCache(key) {
    try {
        const redis = (0, redis_1.getRedis)();
        const raw = await redis.get(key);
        return raw ? JSON.parse(raw) : null;
    }
    catch {
        return null;
    }
}
async function setCache(key, data) {
    try {
        const redis = (0, redis_1.getRedis)();
        const ttl = data.encontrado ? CACHE_TTL_ENCONTRADO : CACHE_TTL_NO_ENCONTRADO;
        await redis.set(key, JSON.stringify(data), 'EX', ttl);
    }
    catch { /* best-effort */ }
}
async function invalidarCacheVerificador(serial, numeroCIT) {
    try {
        const redis = (0, redis_1.getRedis)();
        const keys = await redis.keys('verificar:*');
        const toDelete = keys.filter(k => (!serial || k.includes(serial.toUpperCase())) ||
            (!numeroCIT || k.includes(numeroCIT.toUpperCase())));
        if (toDelete.length > 0)
            await redis.del(...toDelete);
    }
    catch { /* best-effort */ }
}
// ══════════════════════════════════════════════════════════
// AUDIT LOG
// ══════════════════════════════════════════════════════════
async function registrarLog(opts) {
    const ipHash = opts.ip ? hashIP(opts.ip) : null;
    const esBot = detectarBot(opts.userAgent);
    await (0, database_1.query)(`INSERT INTO verificaciones_log
       (serial, hash_sha256, numero_cit, codigo_verif, encontrado, estado_cit,
        ip_origen, ip_hash, user_agent, origen, ms, from_cache, es_bot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [
        opts.serial ?? null, opts.hash ?? null, opts.numeroCIT ?? null,
        opts.codigoVerif ?? null, opts.encontrado, opts.estadoCIT ?? null,
        null, // ip_origen: NO almacenar IP cruda (privacidad)
        ipHash,
        opts.userAgent?.slice(0, 255) ?? null,
        opts.origen ?? 'API', opts.ms, opts.fromCache, esBot,
    ]).catch(() => { });
}
// ══════════════════════════════════════════════════════════
// ENSAMBLADO DE RESPUESTA
// ══════════════════════════════════════════════════════════
async function armarRespuesta(serial, t0, fromCache, ip, userAgent, origen) {
    const baseURL = process.env.RODAID_BASE_URL ?? 'https://rodaid.com.ar';
    // ── Consultas en paralelo ─────────────────────────────────
    // DB (CIT + bicicleta + inspector + sello + firma) y denuncias
    const [dbRow, denuncias] = await Promise.all([
        consultarDB(serial),
        consultarDenuncias(serial),
    ]);
    // ── BFA Index (local, sin nodo) ────────────────────────────
    let bfaData = { indexado: false, estado: 'NO_ENCONTRADO', bloqueado: false, transferencias: 0 };
    try {
        const { verificarPorSerial } = await import('./bfa.indexer');
        const bfa = await verificarPorSerial(serial);
        bfaData = {
            indexado: bfa.encontrado,
            tokenId: bfa.bfa.tokenId,
            txHash: bfa.bfa.mintTxHash?.slice(0, 18),
            estado: bfa.estado,
            bloqueado: bfa.bfa.bloqueado,
            bloqueoMotivo: bfa.bfa.bloqueoMotivo,
            transferencias: bfa.bfa.transferencias,
        };
    }
    catch { /* BFA index opcional */ }
    // ── BFA On-Chain: verificarIntegridad + datosCIT en paralelo ──
    // Se lanza en paralelo con el resto — no bloquea si el nodo BFA no responde
    const hashParaVerif = dbRow?.hashSHA256 ?? null;
    const tokenIdParaVerif = dbRow?.nftTokenId ?? bfaData.tokenId ?? null;
    let bfaOnChain = {
        consultada: false,
        hashCoincide: null,
        bloqueadoOnChain: null,
        nodo: 'NO_CONSULTADO',
    };
    if (hashParaVerif) {
        bfaOnChain = await consultarBFAOnChain(hashParaVerif, tokenIdParaVerif, dbRow?.citId ?? '');
    }
    // Respuesta "no encontrado"
    if (!dbRow) {
        const resp = {
            consultadoEn: new Date().toISOString(),
            fromCache,
            duracionMs: Date.now() - t0,
            serial,
            encontrado: false,
            estado: 'NO_ENCONTRADO',
            estadoLabel: estadoLabel('NO_ENCONTRADO'),
            vigente: false,
            blockchain: { ...bfaData, red: 'Blockchain Federal Argentina (BFA)',
                validacionOnChain: { consultada: false, hashCoincide: null, bloqueadoOnChain: null, nodo: 'NO_CONSULTADO' } },
            selloTemporal: { emitido: false },
            firmaDigital: { firmado: false },
            links: { verificarURL: `${baseURL}/verificar/${encodeURIComponent(serial)}` },
            alertas: [],
        };
        await registrarLog({ serial, encontrado: false, ip, userAgent, origen, ms: resp.duracionMs, fromCache });
        return resp;
    }
    // ── Motor de estados (resolución con todas las fuentes) ──
    const estadoInput = {
        dbEstado: dbRow.estado,
        pipelineEstado: dbRow.pipelineEstado,
        pipelineInicio: dbRow.pipelineInicio,
        fechaVencimiento: dbRow.fechaVencimiento,
        fechaEmision: dbRow.fechaEmision,
        bfaBloqueado: bfaData.bloqueado,
        bfaBloqueadoOnChain: bfaOnChain.bloqueadoOnChain,
        bfaIndexado: bfaData.indexado,
        denunciasActivas: denuncias.length,
        ultimaDenuncia: denuncias[0]?.creado_en,
        citId: dbRow.citId,
        serial,
    };
    const estadoResuelto = (0, estado_service_1.resolverEstado)(estadoInput);
    const estadoFinal = estadoResuelto.estado;
    const vigente = estadoResuelto.vigente;
    // Puntos de inspección
    const puntoDetalle = typeof dbRow.puntoDetalle === 'string'
        ? JSON.parse(dbRow.puntoDetalle) : (dbRow.puntoDetalle ?? {});
    const puntosAprobados = Object.values(puntoDetalle)
        .filter(Boolean).length;
    const totalPuntos = dbRow.puntos ?? puntosAprobados;
    const ahora = new Date();
    // Alertas
    const alertas = [];
    if (denuncias.length > 0) {
        alertas.push({
            tipo: 'DENUNCIA_ROBO',
            mensaje: 'Esta bicicleta tiene una denuncia de robo activa en RODAID',
            desde: denuncias[0].creado_en.toISOString(),
        });
    }
    if (estadoFinal === 'EXPIRADO') {
        alertas.push({ tipo: 'CIT_EXPIRADO',
            mensaje: `El certificado venció el ${dbRow.fechaVencimiento?.toLocaleDateString('es-AR')}` });
    }
    if (bfaData.bloqueado || bfaOnChain.bloqueadoOnChain) {
        alertas.push({ tipo: 'BLOQUEADO_BFA',
            mensaje: `Bloqueado en BFA: ${bfaData.bloqueoMotivo ?? 'motivo no especificado'}` });
    }
    // ⚠ CRÍTICO: hash en DB no coincide con hash on-chain → posible manipulación
    if (bfaOnChain.consultada && bfaOnChain.hashCoincide === false) {
        alertas.push({
            tipo: 'HASH_MISMATCH_ONCHAIN',
            mensaje: `ALERTA: El hash del certificado en la base de datos (${bfaOnChain.hashDB}) ` +
                `NO COINCIDE con el hash registrado en la Blockchain Federal Argentina ` +
                `(${bfaOnChain.hashOnChain}). El documento puede haber sido manipulado.`,
        });
        logger_1.log.verificador.error({
            serial, citId: dbRow?.citId,
            hashDB: bfaOnChain.hashDB,
            hashOnChain: bfaOnChain.hashOnChain,
        }, '🚨 HASH MISMATCH ONCHAIN — posible manipulación del CIT');
    }
    const hashPrefix = dbRow.hashSHA256 ? dbRow.hashSHA256.slice(0, 16) + '...' : undefined;
    const resp = {
        consultadoEn: ahora.toISOString(),
        fromCache,
        duracionMs: Date.now() - t0,
        serial,
        numeroCIT: dbRow.numeroCIT,
        hashSHA256: hashPrefix,
        encontrado: true,
        estado: estadoFinal,
        estadoLabel: estadoResuelto.estadoLabel,
        vigente,
        estadoDetalle: {
            descripcion: estadoResuelto.descripcion,
            accion: estadoResuelto.accion,
            color: estadoResuelto.color,
            icono: estadoResuelto.icono,
            diasParaVencer: estadoResuelto.diasParaVencer,
            diasEnEstado: estadoResuelto.diasEnEstado,
            fuentesPrincipales: estadoResuelto.fuentesPrincipales,
            pipelineVenceEn: estadoResuelto.pipelineVenceEn?.toISOString(),
            bloqueoFecha: estadoResuelto.bloqueoFecha?.toISOString(),
            bloqueoMotivo: estadoResuelto.bloqueoMotivo,
        },
        badge: (0, estado_service_1.estadoBadge)(estadoResuelto),
        bicicleta: {
            marca: dbRow.marca,
            modelo: dbRow.modelo,
            anio: dbRow.anio,
            tipo: dbRow.tipo,
            color: dbRow.color,
        },
        inspeccion: {
            resultado: totalPuntos >= 15 ? 'APROBADO' : 'RECHAZADO',
            puntos: totalPuntos,
            maximo: 20,
            porcentaje: Math.round(totalPuntos / 20 * 100),
            fechaEmision: dbRow.fechaEmision?.toISOString() ?? '',
            fechaVencimiento: dbRow.fechaVencimiento?.toISOString() ?? '',
        },
        propietario: {
            nombre: ocultarApellido(`${dbRow.propietarioNombre} ${dbRow.propietarioApellido}`.trim()),
            dni: ocultarDNI(dbRow.propietarioDNI),
        },
        inspector: {
            nombre: dbRow.inspectorNombre,
            apellido: dbRow.inspectorApellido,
            taller: dbRow.tallerNombre,
            localidad: dbRow.tallerLocalidad,
        },
        blockchain: {
            red: 'Blockchain Federal Argentina (BFA)',
            indexado: bfaData.indexado,
            tokenId: bfaData.tokenId ?? dbRow.nftTokenId ?? undefined,
            txHash: bfaData.txHash ?? dbRow.bfaTxHash?.slice(0, 18) ?? undefined,
            estado: bfaData.estado,
            bloqueado: bfaData.bloqueado || (bfaOnChain.bloqueadoOnChain ?? false),
            bloqueoMotivo: bfaData.bloqueoMotivo,
            transferencias: bfaData.transferencias,
            validacionOnChain: bfaOnChain,
        },
        selloTemporal: {
            emitido: !!dbRow.codigoVerif,
            codigoVerif: dbRow.codigoVerif ?? undefined,
            selladoEn: dbRow.selloSelladoEn?.toISOString() ?? undefined,
            modo: dbRow.selloModo ?? undefined,
            modoLabel: dbRow.selloModo ? modoSelloLabel(dbRow.selloModo) : undefined,
        },
        firmaDigital: {
            firmado: !!dbRow.firmaFirmadoEn,
            firmadoEn: dbRow.firmaFirmadoEn?.toISOString() ?? undefined,
            certSubject: dbRow.firmaCertSubject ?? undefined,
            validaHasta: dbRow.firmaValidaHasta?.toISOString() ?? undefined,
        },
        links: {
            verificarURL: `${baseURL}/verificar/${encodeURIComponent(serial)}`,
            qrPNG: `/api/v1/qr/${encodeURIComponent(serial)}`,
        },
        alertas,
    };
    await registrarLog({
        serial, numeroCIT: dbRow.numeroCIT, encontrado: true, estadoCIT: estadoFinal,
        ip, userAgent, origen, ms: resp.duracionMs, fromCache,
    });
    return resp;
}
// ══════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL — por serial
// ══════════════════════════════════════════════════════════
async function verificarSerial(serial, ip, userAgent, origen) {
    const t0 = Date.now();
    const serialNorm = serial.trim().toUpperCase();
    const key = cacheKey('serial', serialNorm);
    // Caché hit
    const cached = await getCache(key);
    if (cached) {
        logger_1.log.verificador.debug({ serial: serialNorm, fromCache: true }, 'Verificación desde caché');
        const resp = { ...cached, consultadoEn: new Date().toISOString(),
            duracionMs: Date.now() - t0, fromCache: true };
        await registrarLog({ serial: serialNorm, encontrado: cached.encontrado,
            ip, userAgent, origen, ms: resp.duracionMs, fromCache: true });
        return resp;
    }
    const resp = await armarRespuesta(serialNorm, t0, false, ip, userAgent, origen);
    await setCache(key, resp);
    logger_1.log.verificador.info({
        serial: serialNorm, encontrado: resp.encontrado,
        estado: resp.estado, ms: resp.duracionMs,
    }, `✓ Verificación ${resp.encontrado ? resp.estado : 'NOT_FOUND'}`);
    return resp;
}
// ══════════════════════════════════════════════════════════
// FUNCIÓN — por número de CIT
// ══════════════════════════════════════════════════════════
async function verificarNumeroCIT(numeroCIT, ip, userAgent, origen) {
    const t0 = Date.now();
    // Resolver el serial desde el número de CIT
    const row = await (0, database_1.queryOne)(`SELECT b.numero_serie FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id
     WHERE c.numero_cit=$1 LIMIT 1`, [numeroCIT.toUpperCase()]);
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
        };
    }
    return verificarSerial(row.numero_serie, ip, userAgent, origen);
}
// ══════════════════════════════════════════════════════════
// FUNCIÓN — por código de verificación RODAID
// ══════════════════════════════════════════════════════════
async function verificarCodigo(codigo, ip, userAgent, origen) {
    const row = await (0, database_1.queryOne)(`SELECT cit_id FROM sellos_temporales WHERE codigo_verif=$1`, [codigo]);
    if (!row) {
        const t0 = Date.now();
        return {
            consultadoEn: new Date().toISOString(), fromCache: false,
            duracionMs: Date.now() - t0, serial: '',
            encontrado: false, estado: 'NO_ENCONTRADO',
            estadoLabel: estadoLabel('NO_ENCONTRADO'), vigente: false,
            blockchain: { red: 'BFA', indexado: false, estado: 'NO_ENCONTRADO', bloqueado: false, transferencias: 0,
                validacionOnChain: { consultada: false, hashCoincide: null, bloqueadoOnChain: null, nodo: 'NO_CONSULTADO' } },
            selloTemporal: { emitido: false, codigoVerif: codigo }, firmaDigital: { firmado: false },
            links: { verificarURL: '' }, alertas: [],
        };
    }
    // Resolver serial desde citId
    const citRow = await (0, database_1.queryOne)(`SELECT b.numero_serie FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id WHERE c.id=$1`, [row.cit_id]);
    if (!citRow)
        return verificarSerial('', ip, userAgent, origen);
    return verificarSerial(citRow.numero_serie, ip, userAgent, origen);
}
// ══════════════════════════════════════════════════════════
// ADMIN — estadísticas de verificaciones
// ══════════════════════════════════════════════════════════
async function getVerificacionesStats(dias = 7) {
    const [totales, porOrigen, topSeriales, porHora] = await Promise.all([
        (0, database_1.queryOne)(`SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE encontrado)::text AS encontradas,
              COUNT(*) FILTER (WHERE NOT encontrado)::text AS no_encontradas,
              COUNT(*) FILTER (WHERE from_cache)::text AS desde_cache
       FROM verificaciones_log
       WHERE creado_en > NOW() - INTERVAL '${dias} days'`, []),
        (0, database_1.query)(`SELECT origen, COUNT(*)::text AS count FROM verificaciones_log
       WHERE creado_en > NOW() - INTERVAL '${dias} days'
       GROUP BY origen ORDER BY count DESC`, []),
        (0, database_1.query)(`SELECT serial, COUNT(*)::text AS consultas FROM verificaciones_log
       WHERE creado_en > NOW() - INTERVAL '${dias} days' AND serial IS NOT NULL
       GROUP BY serial ORDER BY consultas DESC LIMIT 10`, []),
        (0, database_1.query)(`SELECT DATE_TRUNC('hour', creado_en)::text AS hora, COUNT(*)::text AS consultas
       FROM verificaciones_log
       WHERE creado_en > NOW() - INTERVAL '24 hours'
       GROUP BY hora ORDER BY hora DESC`, []),
    ]);
    return {
        periodo: `${dias} días`,
        total: parseInt(totales?.total ?? '0'),
        encontradas: parseInt(totales?.encontradas ?? '0'),
        noEncontradas: parseInt(totales?.no_encontradas ?? '0'),
        desdeCache: parseInt(totales?.desde_cache ?? '0'),
        porOrigen: Object.fromEntries(porOrigen.map(r => [r.origen, parseInt(r.count)])),
        topSeriales: topSeriales.map(r => ({ serial: r.serial, consultas: parseInt(r.consultas) })),
        porHora,
    };
}
