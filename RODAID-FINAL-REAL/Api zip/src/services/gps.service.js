"use strict";
// ─── RODAID · GPS Anomaly Detection — Inspecciones Aliadas ─
// Detecta patrones sospechosos en las coordenadas GPS de las
// inspecciones realizadas por Inspectores de Talleres Aliados.
//
// Tipos de anomalías detectadas:
//
//  FUERA_RANGO (CRITICA)
//    Inspector a >2km del taller → posible inspección no presencial
//    Umbral configurable (DEFAULT_RADIO_KM)
//
//  VELOCIDAD_IMPOSIBLE (CRITICA)
//    Dos inspecciones de mismo inspector en <30 min a >50km de distancia
//    Físicamente imposible desplazarse → inspección fraudulenta
//
//  CLUSTER_ESTATICO (ADVERTENCIA)
//    ≥5 inspecciones en exactamente el mismo punto GPS (<50m)
//    en las últimas 24h → posible bot o ingreso manual de coordenadas
//
//  ZONA_NO_HABITUAL (INFO)
//    Inspector fuera de su zona geográfica habitual (departamento)
//    Basado en historial de inspecciones previas
//
//  PATRON_SOSPECHOSO (CRITICA)
//    ≥3 anomalías CRITICAS del mismo inspector en 7 días
//    → sistema flagea al inspector para revisión humana
//
// Umbrales configurables por variable de entorno:
//   GPS_RADIO_MAXIMO_KM   (default: 2)
//   GPS_VELOCIDAD_MAX_KM  (default: 80)
//   GPS_CLUSTER_UMBRAL    (default: 5)
//   GPS_ZONA_RADIO_KM     (default: 30)
Object.defineProperty(exports, "__esModule", { value: true });
exports.haversineKm = haversineKm;
exports.checkGPSAnomalia = checkGPSAnomalia;
exports.getAnomaliasPendientes = getAnomaliasPendientes;
exports.getResumenAnomalias = getResumenAnomalias;
exports.marcarAnomaliaRevisada = marcarAnomaliaRevisada;
exports.getHistorialGPSInspector = getHistorialGPSInspector;
const database_1 = require("../config/database");
const logger_1 = require("../middleware/logger");
// ══════════════════════════════════════════════════════════
// CONSTANTES Y UMBRALES
// ══════════════════════════════════════════════════════════
const RADIO_MAXIMO_KM = parseFloat(process.env.GPS_RADIO_MAXIMO_KM ?? '2');
const VELOCIDAD_MAX_KMH = parseFloat(process.env.GPS_VELOCIDAD_MAX_KMH ?? '80');
const CLUSTER_UMBRAL = parseInt(process.env.GPS_CLUSTER_UMBRAL ?? '5');
const ZONA_RADIO_KM = parseFloat(process.env.GPS_ZONA_RADIO_KM ?? '30');
const PATRON_CRITICAS_MAX = parseInt(process.env.GPS_PATRON_CRITICAS ?? '3');
const PATRON_DIAS = parseInt(process.env.GPS_PATRON_DIAS ?? '7');
// ══════════════════════════════════════════════════════════
// HAVERSINE — distancia en km entre dos puntos GPS
// ══════════════════════════════════════════════════════════
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371; // radio de la Tierra en km
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function toRad(deg) { return deg * Math.PI / 180; }
// ══════════════════════════════════════════════════════════
// CHECKS INDIVIDUALES
// ══════════════════════════════════════════════════════════
/** 1. FUERA_RANGO: inspector a más de RADIO_MAXIMO_KM del taller */
async function checkFueraRango(input, tallerLat, tallerLng) {
    const distKm = haversineKm(input.lat, input.lng, tallerLat, tallerLng);
    const distM = Math.round(distKm * 1000);
    if (distKm > RADIO_MAXIMO_KM) {
        const esLejano = distKm > RADIO_MAXIMO_KM * 5;
        return {
            tipo: 'FUERA_RANGO',
            severidad: 'CRITICA',
            descripcion: `Inspector a ${distKm.toFixed(2)} km del taller aliado (máximo: ${RADIO_MAXIMO_KM} km)`,
            detalle: {
                distanciaKm: distKm,
                distanciaM: distM,
                radioMaximoKm: RADIO_MAXIMO_KM,
                latInspeccion: input.lat,
                lngInspeccion: input.lng,
                latTaller: tallerLat,
                lngTaller: tallerLng,
                esLejano,
            },
        };
    }
    return null;
}
/** 2. VELOCIDAD_IMPOSIBLE: desplazamiento irrealizable entre inspecciones */
async function checkVelocidadImposible(input) {
    const ts = input.timestamp ?? new Date();
    // Última inspección del mismo inspector en los últimos 90 min
    const anterior = await (0, database_1.queryOne)(`SELECT lat::text, lng::text, registrado_en
     FROM inspector_gps_historia
     WHERE inspector_id = $1
       AND registrado_en > NOW() - INTERVAL '90 minutes'
       AND cit_id != $2
     ORDER BY registrado_en DESC LIMIT 1`, [input.inspectorId, input.citId]);
    if (!anterior)
        return null;
    const latAnt = parseFloat(anterior.lat);
    const lngAnt = parseFloat(anterior.lng);
    const diffMin = (ts.getTime() - new Date(anterior.registrado_en).getTime()) / 60_000;
    if (diffMin <= 0)
        return null; // mismo instante
    const distKm = haversineKm(input.lat, input.lng, latAnt, lngAnt);
    const velocKmh = distKm / (diffMin / 60);
    if (velocKmh > VELOCIDAD_MAX_KMH) {
        return {
            tipo: 'VELOCIDAD_IMPOSIBLE',
            severidad: 'CRITICA',
            descripcion: `Velocidad de desplazamiento imposible: ${velocKmh.toFixed(0)} km/h en ${diffMin.toFixed(0)} min`,
            detalle: {
                velocidadKmh: velocKmh,
                distanciaKm: distKm,
                minutosTransc: diffMin,
                velocMaxKmh: VELOCIDAD_MAX_KMH,
                latAnterior: latAnt,
                lngAnterior: lngAnt,
                tsAnterior: anterior.registrado_en,
            },
        };
    }
    return null;
}
/** 3. CLUSTER_ESTÁTICO: múltiples inspecciones desde exactamente el mismo punto */
async function checkClusterEstatico(input) {
    // Contar inspecciones del mismo inspector en un radio de 50m en las últimas 24h
    const count = await (0, database_1.queryOne)(`SELECT COUNT(*)::text AS n
     FROM inspector_gps_historia
     WHERE inspector_id = $1
       AND registrado_en > NOW() - INTERVAL '24 hours'
       AND ABS(lat - $2) < 0.0005
       AND ABS(lng - $3) < 0.0005`, [input.inspectorId, input.lat, input.lng]);
    const n = parseInt(count?.n ?? '0');
    if (n >= CLUSTER_UMBRAL - 1) { // ya hay UMBRAL-1, esta sería la n-ésima
        return {
            tipo: 'CLUSTER_ESTATICO',
            severidad: 'ADVERTENCIA',
            descripcion: `${n + 1} inspecciones desde el mismo punto GPS en 24 horas`,
            detalle: {
                inspeccionesEnCluster: n + 1,
                umbral: CLUSTER_UMBRAL,
                lat: input.lat,
                lng: input.lng,
                radioMetros: 50,
            },
        };
    }
    return null;
}
/** 4. ZONA_NO_HABITUAL: inspector fuera de su zona geográfica histórica */
async function checkZonaNoHabitual(input) {
    // Calcular centroide del historial del inspector (últimas 30 inspecciones)
    const historial = await (0, database_1.queryOne)(`SELECT AVG(lat)::text AS lat_prom, AVG(lng)::text AS lng_prom, COUNT(*)::text AS n
     FROM inspector_gps_historia
     WHERE inspector_id = $1
       AND registrado_en < NOW() - INTERVAL '1 hour'  -- excluir la actual
     LIMIT 30`, [input.inspectorId]);
    const n = parseInt(historial?.n ?? '0');
    if (n < 5)
        return null; // insuficiente historial para análisis
    const latCentro = parseFloat(historial.lat_prom);
    const lngCentro = parseFloat(historial.lng_prom);
    const distKm = haversineKm(input.lat, input.lng, latCentro, lngCentro);
    if (distKm > ZONA_RADIO_KM) {
        return {
            tipo: 'ZONA_NO_HABITUAL',
            severidad: 'INFO',
            descripcion: `Inspector a ${distKm.toFixed(1)} km de su zona habitual (radio: ${ZONA_RADIO_KM} km)`,
            detalle: {
                distanciaZonaKm: distKm,
                zonaRadioKm: ZONA_RADIO_KM,
                centroideHistLat: latCentro,
                centroideHistLng: lngCentro,
                inspeccionesHist: n,
            },
        };
    }
    return null;
}
/** 5. PATRON_SOSPECHOSO: múltiples anomalías críticas recientes */
async function checkPatronSospechoso(input) {
    const resCrit = await (0, database_1.queryOne)(`SELECT COUNT(*)::text AS n
     FROM gps_anomalias
     WHERE inspector_id = $1
       AND severidad = 'CRITICA'
       AND creado_en > NOW() - INTERVAL '${PATRON_DIAS} days'`, [input.inspectorId]);
    const n = parseInt(resCrit?.n ?? '0');
    if (n >= PATRON_CRITICAS_MAX) {
        return {
            tipo: 'PATRON_SOSPECHOSO',
            severidad: 'CRITICA',
            descripcion: `Inspector con ${n} anomalías críticas en los últimos ${PATRON_DIAS} días — requiere revisión`,
            detalle: {
                anomaliasCriticas: n,
                umbral: PATRON_CRITICAS_MAX,
                periodos: `${PATRON_DIAS} días`,
            },
        };
    }
    return null;
}
// ══════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ══════════════════════════════════════════════════════════
async function checkGPSAnomalia(input) {
    const ts = input.timestamp ?? new Date();
    // Cargar datos del taller aliado
    const taller = await (0, database_1.queryOne)(`SELECT lat::text, lng::text, nombre, localidad
     FROM talleres_aliados WHERE id = $1`, [input.tallerAliadoId]);
    const tallerLat = taller?.lat ? parseFloat(taller.lat) : null;
    const tallerLng = taller?.lng ? parseFloat(taller.lng) : null;
    let distanciaTaller = null;
    const anomalias = [];
    // ── Ejecutar checks en paralelo (salvo los que dependen del taller) ──
    const [velCheck, clusterCheck, zonaCheck, patronCheck] = await Promise.all([
        checkVelocidadImposible(input),
        checkClusterEstatico(input),
        checkZonaNoHabitual(input),
        checkPatronSospechoso(input),
    ]);
    // Check fuera de rango (requiere coords del taller)
    if (tallerLat !== null && tallerLng !== null) {
        const rangoCheck = await checkFueraRango(input, tallerLat, tallerLng);
        const distKm = haversineKm(input.lat, input.lng, tallerLat, tallerLng);
        distanciaTaller = Math.round(distKm * 1000);
        if (rangoCheck)
            anomalias.push(rangoCheck);
    }
    else {
        logger_1.log.gps.warn({ tallerAliadoId: input.tallerAliadoId }, 'Taller sin coordenadas GPS — check FUERA_RANGO omitido');
    }
    if (velCheck)
        anomalias.push(velCheck);
    if (clusterCheck)
        anomalias.push(clusterCheck);
    if (zonaCheck)
        anomalias.push(zonaCheck);
    if (patronCheck)
        anomalias.push(patronCheck);
    const hayAnomaliasCrit = anomalias.some(a => a.severidad === 'CRITICA');
    // ── Persistir en DB ──────────────────────────────────────
    if (anomalias.length > 0) {
        for (const a of anomalias) {
            await (0, database_1.query)(`INSERT INTO gps_anomalias
           (cit_id, inspector_id, taller_aliado_id, tipo, severidad,
            lat_inspeccion, lng_inspeccion, lat_taller, lng_taller,
            distancia_m, detalle)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
                input.citId,
                input.inspectorId,
                input.tallerAliadoId,
                a.tipo,
                a.severidad,
                input.lat, input.lng,
                tallerLat, tallerLng,
                distanciaTaller,
                JSON.stringify(a.detalle),
            ]).catch(err => logger_1.log.gps.warn({ err: err.message }, 'gps_anomalias insert error'));
        }
    }
    // ── Guardar en historial GPS ─────────────────────────────
    await (0, database_1.query)(`INSERT INTO inspector_gps_historia (inspector_id, cit_id, lat, lng, registrado_en)
     VALUES ($1, $2, $3, $4, $5)`, [input.inspectorId, input.citId, input.lat, input.lng, ts]).catch(() => { });
    // ── Marcar el CIT con el resultado ──────────────────────
    const tiposCrit = anomalias
        .filter(a => a.severidad === 'CRITICA')
        .map(a => a.tipo)
        .join(',');
    await (0, database_1.query)(`UPDATE cits
     SET inspeccion_lat    = $2,
         inspeccion_lng    = $3,
         distancia_taller  = $4,
         gps_anomalia      = $5,
         gps_anomalia_tipo = $6,
         gps_anomalia_desc = $7
     WHERE id = $1`, [
        input.citId,
        input.lat, input.lng,
        distanciaTaller,
        hayAnomaliasCrit || anomalias.length > 0,
        tiposCrit || (anomalias[0]?.tipo ?? null),
        anomalias.map(a => a.descripcion).join(' · ') || null,
    ]).catch(() => { });
    const resumen = anomalias.length === 0
        ? `GPS OK · ${distanciaTaller !== null ? `${(distanciaTaller / 1000).toFixed(2)} km del taller` : 'sin coords del taller'}`
        : `${anomalias.length} anomalía(s): ${anomalias.map(a => `${a.tipo}(${a.severidad})`).join(', ')}`;
    logger_1.log.gps.info({
        citId: input.citId,
        inspectorId: input.inspectorId.slice(0, 8),
        anomalias: anomalias.length,
        criticas: anomalias.filter(a => a.severidad === 'CRITICA').length,
        distM: distanciaTaller,
    }, resumen);
    return {
        coordsValidas: true,
        distanciaTaller,
        anomalias,
        hayAnomaliasCrit,
        resumen,
    };
}
// ══════════════════════════════════════════════════════════
// ADMIN — consultas y monitoreo
// ══════════════════════════════════════════════════════════
async function getAnomaliasPendientes(limit = 50) {
    return (0, database_1.query)(`SELECT a.id, a.tipo, a.severidad,
            a.lat_inspeccion || ',' || a.lng_inspeccion AS descripcion,
            a.inspector_id, a.taller_aliado_id, a.distancia_m, a.creado_en, a.cit_id
     FROM gps_anomalias a
     WHERE a.revisada = FALSE
     ORDER BY a.severidad DESC, a.creado_en DESC
     LIMIT $1`, [limit]);
}
async function getResumenAnomalias() {
    const [totales, porTipo, topInspectores, ultimasSemana] = await Promise.all([
        (0, database_1.query)(`SELECT severidad, COUNT(*)::text AS count FROM gps_anomalias GROUP BY severidad`, []),
        (0, database_1.query)(`SELECT tipo, COUNT(*)::text AS count FROM gps_anomalias GROUP BY tipo ORDER BY count DESC`, []),
        (0, database_1.query)(`SELECT inspector_id, COUNT(*)::text AS count, MAX(creado_en) AS ultima
       FROM gps_anomalias WHERE severidad='CRITICA' AND revisada=FALSE
       GROUP BY inspector_id ORDER BY count DESC LIMIT 10`, []),
        (0, database_1.queryOne)(`SELECT COUNT(*)::text AS count FROM gps_anomalias WHERE creado_en > NOW()-INTERVAL '7 days'`, []),
    ]);
    return {
        porSeveridad: Object.fromEntries(totales.map(r => [r.severidad, parseInt(r.count)])),
        porTipo: Object.fromEntries(porTipo.map(r => [r.tipo, parseInt(r.count)])),
        topInspectores: topInspectores.map(r => ({ ...r, count: parseInt(r.count) })),
        ultimaSemana: parseInt(ultimasSemana?.count ?? '0'),
    };
}
async function marcarAnomaliaRevisada(anomaliaId, revisadaPor) {
    const row = await (0, database_1.queryOne)(`UPDATE gps_anomalias
     SET revisada=TRUE, revisada_por=$2, revisada_en=NOW()
     WHERE id=$1 AND revisada=FALSE RETURNING id`, [anomaliaId, revisadaPor]);
    return !!row;
}
async function getHistorialGPSInspector(inspectorId, limit = 50) {
    return (0, database_1.query)(`SELECT lat::text, lng::text, registrado_en, cit_id
     FROM inspector_gps_historia
     WHERE inspector_id = $1
     ORDER BY registrado_en DESC LIMIT $2`, [inspectorId, limit]);
}
