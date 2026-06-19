"use strict";
// ─── RODAID · Marketplace Controller ─────────────────────
// POST   /marketplace/publicar          → publicar bicicleta
// GET    /marketplace                   → listar publicaciones
// GET    /marketplace/mis-publicaciones → publicaciones del vendedor
// GET    /marketplace/:slug             → detalle de publicación
// PATCH  /marketplace/:id               → editar publicación
// PATCH  /marketplace/:id/estado        → pausar/activar/cancelar
// POST   /marketplace/:id/vender        → marcar vendida
// POST   /marketplace/:id/contactar     → enviar consulta
// GET    /admin/marketplace             → admin: todas las publicaciones
Object.defineProperty(exports, "__esModule", { value: true });
exports.suggest = exports.adminListar = exports.contactar = exports.vender = exports.cambiarEstado = exports.editar = exports.detalle = exports.misPublicaciones = exports.listar = exports.buscar = exports.publicar = void 0;
const zod_1 = require("zod");
const errorHandler_1 = require("../middleware/errorHandler");
const marketplace_search_1 = require("../services/marketplace.search");
const marketplace_service_1 = require("../services/marketplace.service");
const database_1 = require("../config/database");
// ══════════════════════════════════════════════════════════
// PUBLICAR — POST /marketplace/publicar
// ══════════════════════════════════════════════════════════
exports.publicar = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('Autenticación requerida', 401);
    const body = zod_1.z.object({
        citId: zod_1.z.string().uuid('citId debe ser un UUID válido'),
        titulo: zod_1.z.string().min(10, 'Mínimo 10 caracteres').max(120, 'Máximo 120 caracteres'),
        descripcion: zod_1.z.string().min(20, 'Mínimo 20 caracteres').max(3000),
        precioARS: zod_1.z.number().positive().max(50_000_000, 'Precio máximo $50M ARS'),
        precioUSD: zod_1.z.number().positive().optional(),
        fotosUrls: zod_1.z.array(zod_1.z.string().url()).max(10).optional(),
    }).parse(req.body);
    const pub = await (0, marketplace_service_1.publicarBicicleta)({
        vendedorId: req.user.sub,
        ...body,
    });
    res.status(201).json({
        ok: true,
        data: pub,
        message: `Publicación creada: ${pub.slug}`,
    });
});
// ══════════════════════════════════════════════════════════
// BUSCAR + LISTAR — GET /marketplace
// ══════════════════════════════════════════════════════════
exports.buscar = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const q = zod_1.z.object({
        q: zod_1.z.string().max(100).optional(),
        marca: zod_1.z.string().optional(),
        tipo: zod_1.z.string().optional(),
        anio_min: zod_1.z.coerce.number().int().optional(),
        anio_max: zod_1.z.coerce.number().int().optional(),
        precio_min: zod_1.z.coerce.number().optional(),
        precio_max: zod_1.z.coerce.number().optional(),
        estado: zod_1.z.enum(['ACTIVA', 'VENDIDA', 'PAUSADA']).optional(),
        orden: zod_1.z.enum(['relevancia', 'precio_asc', 'precio_desc', 'recientes', 'vistas']).optional(),
        pagina: zod_1.z.coerce.number().int().positive().default(1),
        limite: zod_1.z.coerce.number().int().min(1).max(50).default(12),
    }).parse(req.query);
    const result = await (0, marketplace_search_1.buscarPublicaciones)(q);
    res.setHeader('X-Total-Count', String(result.total));
    res.setHeader('X-Page', String(result.pagina));
    res.setHeader('X-Pages', String(result.paginas));
    res.setHeader('X-Search-Ms', String(result.tiempoMs));
    res.setHeader('X-From-Cache', result.fromCache ? '1' : '0');
    res.json({ ok: true, data: result });
});
exports.listar = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const q = zod_1.z.object({
        estado: zod_1.z.enum(['ACTIVA', 'VENDIDA', 'PAUSADA']).optional(),
        marcas: zod_1.z.string().optional(), // "Trek,Giant" → array
        tipo: zod_1.z.string().optional(),
        precioMin: zod_1.z.coerce.number().optional(),
        precioMax: zod_1.z.coerce.number().optional(),
        orden: zod_1.z.enum(['precio_asc', 'precio_desc', 'recientes', 'vistas']).optional(),
        pagina: zod_1.z.coerce.number().int().positive().default(1),
        limite: zod_1.z.coerce.number().int().min(1).max(50).default(12),
    }).parse(req.query);
    const result = await (0, marketplace_service_1.listarPublicaciones)({
        estado: q.estado,
        marcas: q.marcas?.split(',').filter(Boolean),
        tipo: q.tipo,
        precioMin: q.precioMin,
        precioMax: q.precioMax,
        orden: q.orden,
        pagina: q.pagina,
        limite: q.limite,
    });
    res.setHeader('X-Total-Count', String(result.total));
    res.setHeader('X-Page', String(result.pagina));
    res.setHeader('X-Pages', String(result.paginas));
    res.json({ ok: true, data: result });
});
// ══════════════════════════════════════════════════════════
// MIS PUBLICACIONES — GET /marketplace/mis-publicaciones
// ══════════════════════════════════════════════════════════
exports.misPublicaciones = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('Autenticación requerida', 401);
    const q = zod_1.z.object({
        estado: zod_1.z.enum(['ACTIVA', 'PAUSADA', 'VENDIDA', 'CANCELADA', 'todas']).default('todas'),
        pagina: zod_1.z.coerce.number().int().min(1).default(1),
        porPagina: zod_1.z.coerce.number().int().min(1).max(50).default(25),
    }).parse(req.query);
    const result = await (0, marketplace_service_1.misPublicaciones)({
        vendedorId: req.user.sub,
        estado: q.estado,
        pagina: q.pagina,
        porPagina: q.porPagina,
    });
    res.json({ ok: true, data: result });
});
// ══════════════════════════════════════════════════════════
// DETALLE — GET /marketplace/:slug
// ══════════════════════════════════════════════════════════
exports.detalle = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const pub = await (0, marketplace_service_1.getPublicacion)(req.params.slug);
    if (!pub)
        throw new errorHandler_1.AppError('Publicación no encontrada', 404);
    res.json({ ok: true, data: pub });
});
// ══════════════════════════════════════════════════════════
// EDITAR — PATCH /marketplace/:id
// ══════════════════════════════════════════════════════════
exports.editar = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('Autenticación requerida', 401);
    const body = zod_1.z.object({
        titulo: zod_1.z.string().min(10).max(120).optional(),
        descripcion: zod_1.z.string().min(20).max(3000).optional(),
        precioARS: zod_1.z.number().positive().max(50_000_000).optional(),
        precioUSD: zod_1.z.number().positive().nullable().optional(),
        fotosUrls: zod_1.z.array(zod_1.z.string().url()).max(10).optional(),
    }).parse(req.body);
    const pub = await (0, marketplace_service_1.editarPublicacion)({
        publicacionId: req.params.id,
        vendedorId: req.user.sub,
        ...body,
        precioARS: body.precioARS,
    });
    res.json({ ok: true, data: pub, message: 'Publicación actualizada' });
});
// ══════════════════════════════════════════════════════════
// CAMBIAR ESTADO — PATCH /marketplace/:id/estado
// ══════════════════════════════════════════════════════════
exports.cambiarEstado = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('Autenticación requerida', 401);
    const { estado } = zod_1.z.object({
        estado: zod_1.z.enum(['ACTIVA', 'PAUSADA', 'CANCELADA']),
    }).parse(req.body);
    const esAdmin = ['ADMIN', 'admin'].includes(req.user.rol);
    await (0, marketplace_service_1.pausarPublicacion)(req.params.id, req.user.sub);
    res.json({ ok: true, data: { id: req.params.id } });
});
// ══════════════════════════════════════════════════════════
// MARCAR VENDIDA — POST /marketplace/:id/vender
// ══════════════════════════════════════════════════════════
exports.vender = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('Autenticación requerida', 401);
    const body = zod_1.z.object({
        precioFinalARS: zod_1.z.number().positive('Precio final requerido'),
        compradorId: zod_1.z.string().uuid().optional(),
    }).parse(req.body);
    const result = await (0, marketplace_service_1.marcarVendida)(req.params.id, req.user.sub, body.precioFinalARS, body.compradorId);
    res.json({
        ok: true,
        data: result,
        message: `Venta registrada. Comisión RODAID: $${result.comisionRodaid.toLocaleString('es-AR')} ARS`,
    });
});
// ══════════════════════════════════════════════════════════
// CONTACTAR — POST /marketplace/:id/contactar
// ══════════════════════════════════════════════════════════
exports.contactar = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const body = zod_1.z.object({
        mensaje: zod_1.z.string().min(10, 'Mínimo 10 caracteres').max(1000),
        telefono: zod_1.z.string().regex(/^\+?[0-9 ()-]{7,20}$/).optional(),
        email: zod_1.z.string().email().optional(),
    }).refine(d => d.telefono || d.email || req.user?.sub, { message: 'Incluí teléfono o email para que el vendedor pueda contactarte' }).parse(req.body);
    const result = await (0, marketplace_service_1.registrarContacto)({
        publicacionId: req.params.id,
        interesadoId: req.user?.sub,
        ...body,
    });
    res.status(201).json({ ok: true, data: result, message: 'Consulta enviada al vendedor' });
});
// ══════════════════════════════════════════════════════════
// ADMIN — GET /admin/marketplace
// ══════════════════════════════════════════════════════════
exports.adminListar = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const { estado, pagina = 1, limite = 50 } = zod_1.z.object({
        estado: zod_1.z.string().optional(),
        pagina: zod_1.z.coerce.number().default(1),
        limite: zod_1.z.coerce.number().max(100).default(50),
    }).parse(req.query);
    const offset = (pagina - 1) * limite;
    const cond = estado ? `WHERE mp.estado=$1::estado_publicacion` : '';
    const params = estado ? [estado, limite, offset] : [limite, offset];
    const pIdx = estado ? 2 : 1;
    const rows = await (0, database_1.query)(`SELECT mp.id, mp.slug, mp.titulo, mp.precio_ars, mp.estado::text,
            mp.vistas, mp.contactos, mp.publicado_en, mp.vence_en,
            b.marca, b.modelo, b.anio, b.numero_serie AS serial,
            c.numero_cit, u.nombre AS vendedor_nombre, u.email AS vendedor_email
     FROM marketplace_publicaciones mp
     JOIN bicicletas b ON b.id=mp.bicicleta_id
     JOIN cits c ON c.id=mp.cit_id
     JOIN usuarios u ON u.id=mp.vendedor_id
     ${cond}
     ORDER BY mp.publicado_en DESC
     LIMIT $${pIdx} OFFSET $${pIdx + 1}`, params);
    res.json({ ok: true, data: { publicaciones: rows, pagina, limite } });
});
// ══════════════════════════════════════════════════════════
// SUGERENCIAS — GET /marketplace/suggest?q=trek
// ══════════════════════════════════════════════════════════
exports.suggest = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const { q, limite } = zod_1.z.object({
        q: zod_1.z.string().min(2).max(50),
        limite: zod_1.z.coerce.number().int().min(1).max(10).default(5),
    }).parse(req.query);
    const sugerencias = await (0, marketplace_search_1.sugerirPublicaciones)(q, limite);
    res.json({ ok: true, data: sugerencias });
});
