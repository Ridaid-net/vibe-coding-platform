"use strict";
// ─── RODAID · Cross-Reference Service ────────────────────
// Motor de consulta cruzada para el Ministerio de Seguridad.
// Permite verificar: serial de bicicleta + propietario.
//
// Responde a:
//   POST /seguridad/cross-reference
//   Body: { serial, propietarioDNI?, propietarioNombre?, incluirHistorial? }
//
// Retorna:
//   {
//     encontrado:    boolean      — ¿existe en RODAID?
//     cit: {
//       numero, estado, fechaEmision, validoHasta,
//       txHashBFA, marca, modelo, serial
//     },
//     propietario: {               — SOLO si DNI/nombre coincide
//       nombre, coincide
//     },
//     alertas: {
//       alerta_activa:   boolean,      — true → alerta vigente (MinSeg)
//       tipoAlerta?:    string,       — ROBO | RECUPERADA | INVALIDO | BLOQUEADO_ADMIN
//       expediente?:    string,       — número de expediente RODAID
//       expedienteMxm?: string,       — número de expediente MxM
//       numeroDenuncia?:string,
//       fechaDenuncia?: string,
//       fechaRobo?:     string,       — fecha declarada del robo
//       bloqueado:      boolean,
//       motivoBloqueo?: string,       — DENUNCIA_ROBO | ADMIN | MINSEG | FIRMA_REVOCADA
//       alertasMinSeg?: AlertaMinSeg[]
//     },
//     historial?: {               — si incluirHistorial=true
//       denuncias:    [],
//       transferencias: []
//     },
//     meta: {
//       consultadaEn:  ISO8601,
//       consultadaPor: string,   — CN del cert cliente
//       validezRespuesta: 'TIEMPO_REAL' | 'CACHE'
//     }
//   }
//
// Seguridad de los datos:
//   · El DNI del propietario NO se devuelve — solo si coincide
//   · El nombre se devuelve truncado a iniciales si no hay match exacto
//   · Historial solo disponible para permisos 'crossref_extended'
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.crossReference = crossReference;
exports.getEstadisticasCrossRef = getEstadisticasCrossRef;
const crypto_1 = __importDefault(require("crypto"));
const database_1 = require("../config/database");
const redis_1 = require("../config/redis");
const logger_1 = require("../middleware/logger");
// ══════════════════════════════════════════════════════════
// CROSS-REFERENCE PRINCIPAL
// ══════════════════════════════════════════════════════════
async function crossReference(input, cliente) {
    const serialNorm = input.serial.toUpperCase().trim().replace(/\s+/g, '-');
    const inicio = Date.now();
    const redis = (0, redis_1.getRedis)();
    const cacheKey = `crossref:${crypto_1.default.createHash('sha256').update(serialNorm).digest('hex').slice(0, 16)}`;
    // Cache de 60 segundos para el mismo serial (datos no cambian tan rápido)
    const cached = await redis.get(cacheKey).catch(() => null);
    // ── Consultar CIT activo para este serial ──────────────
    const cit = await (0, database_1.queryOne)(`SELECT c.id, c.numero_cit, c.estado, c.creado_en, c.fecha_vencimiento,
            c.hash_sha256, c.firma_payload_hash,
            b.marca, b.modelo, b.numero_serie,
            u.nombre AS propietario_nombre, u.apellido AS propietario_apellido,
            u.id AS prop_id,
            ui.nombre AS inspector_nombre, ui.apellido AS inspector_apellido,
            ta.nombre AS taller_nombre
     FROM cits c
     JOIN bicicletas b  ON b.id=c.bicicleta_id
     JOIN usuarios u    ON u.id=c.propietario_id
     JOIN inspectores i ON i.id=c.inspector_id
     JOIN usuarios ui   ON ui.id=i.usuario_id
     JOIN talleres_aliados ta ON ta.id=i.taller_aliado_id
     WHERE UPPER(b.numero_serie)=$1
     ORDER BY c.creado_en DESC LIMIT 1`, [serialNorm]);
    // ── Verificar alertas (denuncias) ──────────────────────
    // Denuncia y alertas enriquecidas
    const [denuncia, alertasMinSeg] = await Promise.all([
        cit ? (0, database_1.queryOne)(`SELECT d.numero_denuncia, d.numero_expediente, d.expediente_mxm,
              d.estado, d.fuente, d.minseg_tipo, d.fecha_robo, d.creado_en,
              d.descripcion,
              d.estado NOT IN ('RECUPERADA','ARCHIVADA') AS alerta_activa,
              COALESCE(d.minseg_tipo, d.estado) AS tipo_alerta
       FROM denuncias d
       WHERE d.cit_id=$1
       ORDER BY d.estado NOT IN ('RECUPERADA','ARCHIVADA') DESC, d.creado_en DESC LIMIT 1`, [cit.id]) : Promise.resolve(null),
        cit ? (0, database_1.query)(`SELECT ma.tipo_alerta, ma.descripcion, ma.creado_en, ma.accion_tomada
       FROM minseg_alertas ma
       JOIN minseg_intercambios mi ON mi.id=ma.intercambio_id
       WHERE ma.serial=UPPER($1)
       ORDER BY ma.creado_en DESC LIMIT 5`, [serialNorm]) : Promise.resolve([]),
    ]);
    // Determinar tipo de bloqueo
    const bloqueado = cit?.estado === 'BLOQUEADO' || cit?.estado === 'RECHAZADO';
    let motivoBloqueo;
    if (bloqueado) {
        if (denuncia?.alerta_activa)
            motivoBloqueo = 'DENUNCIA_ROBO';
        else if (alertasMinSeg.length > 0)
            motivoBloqueo = 'MINSEG';
        else
            motivoBloqueo = 'ADMIN';
    }
    // Tipo de alerta normalizado
    let tipoAlerta;
    if (denuncia) {
        const raw = denuncia.tipo_alerta?.toUpperCase();
        if (['ROBO', 'RECUPERADA', 'INVALIDO'].includes(raw))
            tipoAlerta = raw;
        else
            tipoAlerta = denuncia.alerta_activa ? 'ROBO' : 'RECUPERADA';
    }
    else if (bloqueado) {
        tipoAlerta = 'BLOQUEADO_ADMIN';
    }
    const alertas = {
        alerta_activa: !!(denuncia?.alerta_activa) || bloqueado,
        tipo_alerta: tipoAlerta,
        expediente: denuncia?.numero_expediente ?? undefined,
        expediente_mxm: denuncia?.expediente_mxm ?? undefined,
        fuente: (denuncia?.fuente ?? 'RODAID'),
        numero_denuncia: denuncia?.numero_denuncia ?? undefined,
        fecha_denuncia: denuncia?.creado_en?.toISOString(),
        fecha_robo: denuncia?.fecha_robo?.toISOString() ?? undefined,
        descripcion: denuncia?.descripcion ?? undefined,
        bloqueado,
        motivo_bloqueo: motivoBloqueo,
        alertas_minseg: alertasMinSeg.length > 0 ? alertasMinSeg.map(a => ({
            tipo: a.tipo_alerta,
            descripcion: a.descripcion ?? undefined,
            fecha_alerta: new Date(a.creado_en).toISOString(),
            accion_tomada: a.accion_tomada ?? 'REGISTRADO',
        })) : undefined,
    };
    // ── Verificar propietario (sin exponer DNI) ────────────
    let propietarioInfo;
    if (cit && (input.propietarioDNI || input.propietarioNombre)) {
        // Comparar contra DB sin exponer los datos reales
        const propDB = await (0, database_1.queryOne)(`SELECT nombre, apellido, cuil FROM usuarios WHERE id=$1`, [cit.prop_id]);
        // Verificación por DNI (si el CUIL contiene el DNI)
        let coincideDNI = false;
        if (input.propietarioDNI && propDB?.cuil) {
            const dniLimpio = input.propietarioDNI.replace(/\D/g, '');
            coincideDNI = propDB.cuil.replace(/\D/g, '').includes(dniLimpio);
        }
        // Verificación por nombre (comparación fuzzy)
        let coincideNombre = false;
        if (input.propietarioNombre && propDB?.nombre) {
            const nombreDB = `${propDB.nombre ?? ''} ${propDB.apellido ?? ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
            const nombreQuery = input.propietarioNombre.toLowerCase().trim();
            const palabrasQuery = nombreQuery.split(' ').filter(Boolean);
            coincideNombre = palabrasQuery.every(p => nombreDB.includes(p));
        }
        const coincide = coincideDNI || coincideNombre;
        propietarioInfo = {
            coincide,
            nombre: coincide ? `${propDB?.nombre ?? ''} ${propDB?.apellido ?? ''}`.trim() : undefined,
            iniciales: !coincide ? extraerIniciales(`${propDB?.nombre ?? ''} ${propDB?.apellido ?? ''}`) : undefined,
        };
    }
    // ── Historial (solo con permisos extendidos) ───────────
    let historialInfo;
    if (input.incluirHistorial && cliente.permisos.includes('crossref_extended') && cit) {
        const [denuncias, transferencias] = await Promise.all([
            (0, database_1.query)(`SELECT d.numero_denuncia, d.estado, d.creado_en
         FROM denuncias d JOIN cits c ON c.id=d.cit_id
         WHERE c.bicicleta_id=(SELECT bicicleta_id FROM cits WHERE id=$1)
         ORDER BY d.creado_en DESC`, [cit.id]),
            (0, database_1.query)(`SELECT creado_en, hash_sha256 FROM cits
         WHERE bicicleta_id=(SELECT bicicleta_id FROM cits WHERE id=$1)
         ORDER BY creado_en DESC`, [cit.id]),
        ]);
        historialInfo = {
            denuncias: denuncias.map(d => ({ numeroDenuncia: d.numero_denuncia, fecha: d.creado_en.toISOString(), estado: d.estado })),
            transferencias: transferencias.map(t => ({ fecha: t.creado_en.toISOString(), txHash: t.hash_sha256?.slice(0, 20) + '...' })),
        };
    }
    // ── Construir respuesta ────────────────────────────────
    const resultado = {
        encontrado: !!cit,
        alertas,
        propietario: propietarioInfo,
        historial: historialInfo,
        meta: {
            consultadaEn: new Date().toISOString(),
            consultadaPor: cliente.cn,
            organizacion: cliente.organizacion,
            validezRespuesta: 'TIEMPO_REAL',
            protocoloVersion: 'v1.0',
        },
    };
    if (cit) {
        // Verificar firma si hay hash
        let firmaValida;
        if (cit.firma_payload_hash) {
            const firmaDB = await (0, database_1.queryOne)(`SELECT revocada FROM firmas_payload_cit WHERE cit_id=$1 AND NOT revocada LIMIT 1`, [cit.id]);
            firmaValida = !!firmaDB;
        }
        resultado.cit = {
            numeroCIT: cit.numero_cit,
            estado: cit.estado,
            fechaEmision: cit.creado_en.toISOString(),
            validoHasta: cit.fecha_vencimiento?.toISOString(),
            txHashBFA: cit.hash_sha256 ?? undefined,
            marca: cit.marca,
            modelo: cit.modelo,
            serial: cit.numero_serie,
            firmaValida,
            inspector: formatearNombre(cit.inspector_nombre, cit.inspector_apellido),
            taller: cit.taller_nombre ?? undefined,
        };
    }
    // ── Registrar en log de auditoría ─────────────────────
    await registrarConsulta({
        certSubject: cliente.cn,
        certThumb: cliente.thumbprint,
        serial: serialNorm,
        propietarioDNI: input.propietarioDNI,
        encontrado: !!cit,
        citEstado: cit?.estado,
        alertaActiva: alertas.alerta_activa,
        autorizado: true,
        ip: undefined,
    });
    // Cachear resultado (sin datos sensibles — propietario omitido del cache)
    const resultadoCache = { ...resultado, propietario: undefined };
    await redis.set(cacheKey, JSON.stringify(resultadoCache), 'EX', 60).catch(() => { });
    logger_1.log.minseg.info({
        serial: serialNorm,
        encontrado: !!cit,
        alertas: alertas.alerta_activa,
        bloqueado: alertas.bloqueado,
        cliente: cliente.cn,
        ms: Date.now() - inicio,
    }, `📋 Cross-reference: ${serialNorm} → ${!!cit ? `CIT ${cit.estado}` : 'NO ENCONTRADO'}`);
    return resultado;
}
// ══════════════════════════════════════════════════════════
// REGISTRO DE AUDITORÍA
// ══════════════════════════════════════════════════════════
async function registrarConsulta(opts) {
    await (0, database_1.query)(`INSERT INTO crossref_log
       (cert_subject, cert_thumbprint, serial, propietario_dni,
        encontrado, cit_estado, alerta_activa, autorizado, ip_origen)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::inet)`, [
        opts.certSubject, opts.certThumb, opts.serial,
        opts.propietarioDNI ? '***' : null, // no guardamos el DNI en claro
        opts.encontrado, opts.citEstado ?? null, opts.alertaActiva,
        opts.autorizado, opts.ip ?? null,
    ]).catch(() => { });
}
// ══════════════════════════════════════════════════════════
// ESTADÍSTICAS ADMIN
// ══════════════════════════════════════════════════════════
async function getEstadisticasCrossRef(dias = 30) {
    const [resumen, porCert, topSeriales] = await Promise.all([
        (0, database_1.queryOne)(`SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER(WHERE encontrado)::int AS encontradas,
              COUNT(*) FILTER(WHERE alerta_activa)::int AS con_alerta,
              COUNT(*) FILTER(WHERE NOT autorizado)::int AS rechazadas
       FROM crossref_log WHERE consultado_en > NOW()-($1||' days')::interval`, [dias]),
        (0, database_1.query)(`SELECT cert_subject, COUNT(*)::int AS consultas
       FROM crossref_log WHERE consultado_en > NOW()-($1||' days')::interval
       GROUP BY cert_subject ORDER BY consultas DESC`, [dias]),
        (0, database_1.query)(`SELECT serial, COUNT(*)::int AS veces
       FROM crossref_log WHERE consultado_en > NOW()-($1||' days')::interval
       GROUP BY serial ORDER BY veces DESC LIMIT 10`, [dias]),
    ]);
    return { resumen, porCertificado: porCert, topSeriales };
}
// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
function extraerIniciales(nombre) {
    return nombre.trim().split(' ')
        .filter(Boolean)
        .map(p => p[0].toUpperCase() + '.')
        .join(' ');
}
function formatearNombre(nombre, apellido) {
    if (!nombre && !apellido)
        return undefined;
    return [nombre, apellido].filter(Boolean).join(' ');
}
