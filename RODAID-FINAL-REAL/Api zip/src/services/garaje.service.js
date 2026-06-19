"use strict";
// ─── RODAID · Garaje Digital Service ────────────────────────
//
// Endpoint optimizado que agrega en una sola query todo lo
// que necesita la UI del Garaje Digital:
//
//   GET /api/v1/garaje/resumen   → bicicletas + CIT activo + cert. aseg.
//                                  + póliza + km + score salud
//   GET /api/v1/usuario/bicicletas → mismo payload (alias legacy)
//   GET /api/v1/cit/:id           → estado real de un CIT específico
//
// ══ SHAPE DE RESPUESTA (GarajeResumen) ════════════════════
//
//   {
//     bicicletas: BicicletaGaraje[]
//     resumen: {
//       totalBicicletas, citsActivos, citsBorrador,
//       polizasActivas, scorePromedioSalud, kmTotales
//     }
//   }
//
// ══ REGLA DE ESTADO CIT ════════════════════════════════════
//
//   ACTIVO          → estado='ACTIVO' y fecha_vencimiento > NOW()
//   EXPIRADO        → estado='ACTIVO' y fecha_vencimiento <= NOW()
//   BORRADOR        → estado='BORRADOR' (inspección incompleta)
//   PENDIENTE_PAGO  → activo pero tasa_pagada=false
//   SIN_CIT         → bicicleta sin ningún CIT
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGarajeResumen = getGarajeResumen;
exports.getCITById = getCITById;
const database_1 = require("../config/database");
const redis_1 = require("../config/redis");
// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
function calcularEstadoCIT(row) {
    if (!row.cit_id)
        return 'SIN_CIT';
    if (row.cit_estado === 'BORRADOR')
        return 'BORRADOR';
    if (row.cit_estado === 'ACTIVO') {
        if (!row.tasa_pagada)
            return 'PENDIENTE_PAGO';
        const venc = row.fecha_vencimiento ? new Date(row.fecha_vencimiento) : null;
        if (venc && venc < new Date())
            return 'EXPIRADO';
        return 'ACTIVO';
    }
    return 'SIN_CIT';
}
function calcularScoreSalud(cit, certAseg) {
    if (!cit)
        return 0;
    const puntosNorm = Math.round((cit.puntosTotal / cit.puntajeMax) * 40); // 40 pts de puntos CIT
    const estadoBonus = cit.estado === 'ACTIVO' ? 20 : cit.estado === 'PENDIENTE_PAGO' ? 10 : 0;
    const nftBonus = cit.nftTokenId ? 10 : 0;
    const hashBonus = cit.hasHashBFA ? 5 : 0;
    const asegBonus = certAseg ? Math.round((certAseg.score / 100) * 25) : 0;
    return Math.min(100, puntosNorm + estadoBonus + nftBonus + hashBonus + asegBonus);
}
function formatARS(centavos) {
    if (!centavos)
        return '—';
    return '$' + Math.round(centavos / 100).toLocaleString('es-AR');
}
function diasHasta(fecha) {
    if (!fecha)
        return null;
    const diff = new Date(fecha).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
}
// ══════════════════════════════════════════════════════════
// QUERY PRINCIPAL — una sola ida a DB
// ══════════════════════════════════════════════════════════
async function getGarajeResumen(usuarioId) {
    const redis = (0, redis_1.getRedis)();
    const cacheKey = `garaje:${usuarioId}`;
    // Cache 30 segundos — suficiente para evitar N+1 en re-renders
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached)
        return JSON.parse(cached);
    const rows = await (0, database_1.query)(`
    SELECT
      b.id::text               AS id,
      b.marca,
      b.modelo,
      b.numero_serie,

      -- CIT más reciente de esta bici
      c.id::text               AS cit_id,
      c.numero_cit,
      c.estado                 AS cit_estado,
      c.puntos_total,
      c.hash_sha256,
      c.nft_token_id,
      c.tasa_pagada,
      c.fecha_emision,
      c.fecha_vencimiento,

      -- Certificado de Asegurabilidad más reciente
      ca.numero                AS cert_num,
      ca.score                 AS cert_score,
      ca.nivel                 AS cert_nivel,
      ca.asegurable            AS cert_asegurable,

      -- Póliza activa
      p.numero_poliza,
      p.prima_final,
      p.fin_vigencia,
      p.estado                 AS poliza_estado,
      aseg.nombre              AS aseguradora_nombre

    FROM bicicletas b
    LEFT JOIN LATERAL (
      SELECT * FROM cits
      WHERE bicicleta_id = b.id
      ORDER BY
        CASE estado WHEN 'ACTIVO' THEN 1 WHEN 'BORRADOR' THEN 2 ELSE 3 END,
        creado_en DESC
      LIMIT 1
    ) c ON TRUE
    LEFT JOIN LATERAL (
      SELECT * FROM certificados_asegurabilidad
      WHERE cit_id = c.id
      ORDER BY creado_en DESC
      LIMIT 1
    ) ca ON TRUE
    LEFT JOIN LATERAL (
      SELECT p2.*, a2.nombre
      FROM seguros_polizas p2
      JOIN seguros_aseguradoras a2 ON a2.id = p2.aseguradora_id
      WHERE p2.bicicleta_id = b.id AND p2.estado = 'ACTIVA'
      ORDER BY p2.creado_en DESC
      LIMIT 1
    ) p ON p.estado = 'ACTIVA'
    LEFT JOIN seguros_aseguradoras aseg ON aseg.nombre = p.nombre

    WHERE b.propietario_id = $1::uuid
    ORDER BY b.creado_en DESC
  `, [usuarioId]);
    // Deduplicar por bici (por si acaso el LATERAL produce duplicados)
    const bikesMap = new Map();
    for (const row of rows) {
        if (bikesMap.has(row.id))
            continue;
        const cit = row.cit_id ? {
            id: row.cit_id,
            numeroCIT: row.numero_cit,
            estado: calcularEstadoCIT(row),
            puntosTotal: row.puntos_total ?? 0,
            puntajeMax: 20,
            hasHashBFA: !!(row.hash_sha256 && row.hash_sha256.length >= 60),
            nftTokenId: row.nft_token_id ?? null,
            tasaPagada: !!row.tasa_pagada,
            fechaEmision: row.fecha_emision ?? null,
            fechaVencimiento: row.fecha_vencimiento ?? null,
            diasRestantes: diasHasta(row.fecha_vencimiento),
            hashSHA256: row.hash_sha256 ?? null,
        } : null;
        const certAseg = row.cert_num ? {
            numero: row.cert_num,
            score: parseFloat(row.cert_score ?? 0),
            nivel: row.cert_nivel,
            asegurable: !!row.cert_asegurable,
        } : null;
        const poliza = row.numero_poliza ? {
            numeroPoliza: row.numero_poliza,
            aseguradora: row.aseguradora_nombre ?? row.nombre ?? '—',
            primaFinalARS: formatARS(row.prima_final),
            estado: row.poliza_estado,
            finVigencia: row.fin_vigencia,
        } : null;
        bikesMap.set(row.id, {
            id: row.id,
            marca: row.marca,
            modelo: row.modelo,
            numeroSerie: row.numero_serie,
            cit,
            certAseg,
            poliza,
            scoreSalud: calcularScoreSalud(cit, certAseg),
        });
    }
    const bicicletas = Array.from(bikesMap.values());
    const resumen = {
        totalBicicletas: bicicletas.length,
        citsActivos: bicicletas.filter(b => ['ACTIVO', 'PENDIENTE_PAGO'].includes(b.cit?.estado ?? '')).length,
        citsBorrador: bicicletas.filter(b => b.cit?.estado === 'BORRADOR').length,
        polizasActivas: bicicletas.filter(b => b.poliza !== null).length,
        scorePromedioSalud: bicicletas.length
            ? Math.round(bicicletas.reduce((s, b) => s + b.scoreSalud, 0) / bicicletas.length)
            : 0,
    };
    const result = { bicicletas, resumen };
    await redis.set(cacheKey, JSON.stringify(result), 'EX', '30').catch(() => { });
    return result;
}
// ══════════════════════════════════════════════════════════
// GET /api/v1/cit/:id — estado real de un CIT específico
// ══════════════════════════════════════════════════════════
async function getCITById(citId, usuarioId) {
    const row = await (0, database_1.queryOne)(`
    SELECT
      c.id::text, c.numero_cit, c.estado, c.puntos_total,
      c.hash_sha256, c.nft_token_id, c.tasa_pagada,
      c.fecha_emision, c.fecha_vencimiento,
      c.mxm_expediente, c.expediente_estado,
      b.marca, b.modelo, b.numero_serie
    FROM cits c
    JOIN bicicletas b ON b.id = c.bicicleta_id
    WHERE c.id = $1::uuid AND (c.propietario_id = $2::uuid OR b.propietario_id = $2::uuid)
  `, [citId, usuarioId]);
    if (!row)
        return null;
    // Normalize row keys for calcularEstadoCIT (which expects cit_id and cit_estado)
    const rowNorm = { ...row, cit_id: row.id, cit_estado: row.estado };
    return {
        id: row.id,
        numeroCIT: row.numero_cit,
        estado: calcularEstadoCIT(rowNorm),
        puntosTotal: row.puntos_total ?? 0,
        puntajeMax: 20,
        hasHashBFA: !!(row.hash_sha256 && row.hash_sha256.length >= 60),
        nftTokenId: row.nft_token_id ?? null,
        tasaPagada: !!row.tasa_pagada,
        fechaEmision: row.fecha_emision ?? null,
        fechaVencimiento: row.fecha_vencimiento ?? null,
        diasRestantes: diasHasta(row.fecha_vencimiento),
        hashSHA256: row.hash_sha256 ?? null,
        mxmExpediente: row.mxm_expediente ?? null,
        expedienteEstado: row.expediente_estado ?? null,
        bicicleta: { marca: row.marca, modelo: row.modelo, numeroSerie: row.numero_serie },
    };
}
