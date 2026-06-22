"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.actualizarBicicleta = exports.getBicicleta = exports.registrarBicicleta = exports.getBicicletas = void 0;
const zod_1 = require("zod");
const errorHandler_1 = require("../middleware/errorHandler");
const database_1 = require("../config/database");
const TIPOS_VALIDOS = ['MTB', 'RUTA', 'URBANA', 'GRAVEL', 'ELECTRICA', 'BMX', 'OTRO'];
// ══════════════════════════════════════════════════════════
// GET /api/v1/usuario/bicicletas  — Garaje Digital completo
// ══════════════════════════════════════════════════════════
exports.getBicicletas = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const bicicletas = await (0, database_1.query)(`SELECT
       b.id, b.numero_serie, b.marca, b.modelo, b.anio, b.tipo, b.color, b.fotos, b.creado_en,
       -- CIT activo o pendiente
       c.id            AS cit_id,
       c.numero_cit, c.estado AS cit_estado, c.puntos AS cit_puntos,
       c.hash_sha256, c.nft_token_id, c.bfa_tx_hash,
       c.fecha_emision, c.fecha_vencimiento, c.km_auditados,
       c.dj_firmada,
       -- Publicación activa en marketplace
       p.id            AS publicacion_id,
       p.precio_ars    AS precio_publicado,
       p.estado        AS publicacion_estado
     FROM bicicletas b
     LEFT JOIN cits c ON c.bicicleta_id=b.id AND c.estado IN ('ACTIVO','PENDIENTE','BLOQUEADO')
     LEFT JOIN publicaciones p ON p.bicicleta_id=b.id AND p.estado='ACTIVA'
     WHERE b.propietario_id=$1
     ORDER BY b.creado_en ASC`, [req.user.sub]);
    // Estadísticas del garaje
    const stats = await (0, database_1.queryOne)(`SELECT
       COUNT(b.id)::text                                              AS total,
       COUNT(c.id) FILTER (WHERE c.estado='ACTIVO')::text            AS cits_activos,
       COUNT(p.id) FILTER (WHERE p.estado='ACTIVA')::text            AS en_marketplace,
       COALESCE(SUM(c.km_auditados),0)::text                         AS km_total
     FROM bicicletas b
     LEFT JOIN cits c ON c.bicicleta_id=b.id AND c.estado IN ('ACTIVO','PENDIENTE')
     LEFT JOIN publicaciones p ON p.bicicleta_id=b.id AND p.estado='ACTIVA'
     WHERE b.propietario_id=$1`, [req.user.sub]);
    res.json({
        ok: true,
        data: {
            bicicletas,
            stats: {
                total: parseInt(stats?.total ?? '0'),
                citsActivos: parseInt(stats?.cits_activos ?? '0'),
                enMarketplace: parseInt(stats?.en_marketplace ?? '0'),
                kmTotal: parseInt(stats?.km_total ?? '0'),
            },
        },
    });
});
// ══════════════════════════════════════════════════════════
// POST /api/v1/usuario/bicicletas  — Registrar nueva unidad
// ══════════════════════════════════════════════════════════
exports.registrarBicicleta = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const data = zod_1.z.object({
        numeroSerie: zod_1.z.string().min(4).max(100).transform(s => s.toUpperCase().replace(/\s/g, '-')),
        marca: zod_1.z.string().min(2).max(100),
        modelo: zod_1.z.string().min(1).max(200),
        anio: zod_1.z.number().int().min(1980).max(new Date().getFullYear() + 1),
        tipo: zod_1.z.enum(TIPOS_VALIDOS),
        color: zod_1.z.string().max(80).optional(),
        fotos: zod_1.z.array(zod_1.z.string()).max(10).default([]),
    }).parse(req.body);
    // Verificar que el número de serie no esté registrado
    const existe = await (0, database_1.queryOne)(`SELECT id FROM bicicletas WHERE numero_serie=$1`, [data.numeroSerie]);
    if (existe)
        throw new errorHandler_1.AppError(`El número de serie ${data.numeroSerie} ya está registrado en RODAID`, 409, 'SERIE_DUPLICADA');
    const rows = await (0, database_1.query)(`INSERT INTO bicicletas (propietario_id, numero_serie, marca, modelo, anio, tipo, color, fotos)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, numero_serie, marca, modelo, creado_en`, [req.user.sub, data.numeroSerie, data.marca, data.modelo, data.anio, data.tipo, data.color ?? null, data.fotos]);
    res.status(201).json({
        ok: true,
        data: {
            ...rows[0],
            mensaje: 'Bicicleta registrada. Podés certificarla con POST /cit/iniciar desde un Taller Aliado.',
        },
    });
});
// ══════════════════════════════════════════════════════════
// GET /api/v1/usuario/bicicletas/:id — Detalle de una bici
// ══════════════════════════════════════════════════════════
exports.getBicicleta = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const bici = await (0, database_1.queryOne)(`SELECT b.*,
            c.id AS cit_id, c.numero_cit, c.estado AS cit_estado, c.puntos,
            c.hash_sha256, c.nft_token_id, c.bfa_tx_hash, c.fecha_emision, c.fecha_vencimiento,
            c.km_auditados, c.firma_inspector, c.dj_firmada, c.dj_firmada_en,
            ta.nombre AS taller_nombre, ta.localidad AS taller_localidad,
            ui.nombre AS inspector_nombre, ui.apellido AS inspector_apellido
     FROM bicicletas b
     LEFT JOIN cits c ON c.bicicleta_id=b.id AND c.estado IN ('ACTIVO','PENDIENTE','BLOQUEADO')
     LEFT JOIN talleres_aliados ta ON ta.id=c.taller_aliado_id
     LEFT JOIN inspectores i ON i.id=c.inspector_id
     LEFT JOIN usuarios ui ON ui.id=i.usuario_id
     WHERE b.id=$1 AND b.propietario_id=$2`, [req.params.id, req.user.sub]);
    if (!bici)
        throw new errorHandler_1.AppError('Bicicleta no encontrada', 404);
    res.json({ ok: true, data: bici });
});
// ══════════════════════════════════════════════════════════
// PATCH /api/v1/usuario/bicicletas/:id — Actualizar datos
// ══════════════════════════════════════════════════════════
exports.actualizarBicicleta = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const bici = await (0, database_1.queryOne)(`SELECT id FROM bicicletas WHERE id=$1 AND propietario_id=$2`, [req.params.id, req.user.sub]);
    if (!bici)
        throw new errorHandler_1.AppError('Bicicleta no encontrada', 404);
    const data = zod_1.z.object({
        color: zod_1.z.string().max(80).optional(),
        fotos: zod_1.z.array(zod_1.z.string()).max(10).optional(),
    }).parse(req.body);
    const updates = [];
    const params = [];
    let i = 1;
    if (data.color !== undefined) {
        updates.push(`color=$${i++}`);
        params.push(data.color);
    }
    if (data.fotos !== undefined) {
        updates.push(`fotos=$${i++}`);
        params.push(data.fotos);
    }
    if (updates.length === 0)
        throw new errorHandler_1.AppError('Nada que actualizar', 400);
    params.push(req.params.id);
    await (0, database_1.query)(`UPDATE bicicletas SET ${updates.join(',')} WHERE id=$${i}`, params);
    res.json({ ok: true, data: { mensaje: 'Bicicleta actualizada' } });
});
