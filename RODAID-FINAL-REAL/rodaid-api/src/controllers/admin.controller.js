"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMiTaller = exports.habilitarTaller = exports.crearTaller = exports.getTalleres = exports.getMiPerfilInspector = exports.habilitarInspector = exports.certificarInspector = exports.crearInspector = exports.getInspectores = exports.asignarRol = exports.listUsuarios = exports.checkPermission = exports.getMyPermissions = exports.getRolesInfo = void 0;
const zod_1 = require("zod");
const errorHandler_1 = require("../middleware/errorHandler");
const logger_1 = require("../middleware/logger");
const rbac_service_1 = require("../services/rbac.service");
const database_1 = require("../config/database");
// GET /api/v1/roles
exports.getRolesInfo = (0, errorHandler_1.asyncHandler)(async (_req, res) => {
    const summary = (0, rbac_service_1.getRolesSummary)();
    const info = {
        CICLISTA: { emoji: '🚲', descripcion: 'Propietario de bicicletas. Garaje Digital, CITs, Marketplace y denuncias.', ...summary.CICLISTA },
        INSPECTOR: { emoji: '🔧', descripcion: 'Técnico certificado. Emite CITs con 20 puntos de inspección según Ley 9556.', ...summary.INSPECTOR },
        ALIADO: { emoji: '🏪', descripcion: 'Propietario o gestor de Taller Aliado. Administra taller e inspectores.', ...summary.ALIADO },
        ADMIN: { emoji: '⚙️', descripcion: 'Administrador RODAID. Gestión de roles, talleres, inspectores y sistema.', ...summary.ADMIN },
    };
    res.json({ ok: true, data: info });
});
// GET /api/v1/roles/mine
exports.getMyPermissions = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const perms = (0, rbac_service_1.getPermissions)(req.user.rol);
    res.json({ ok: true, data: { rol: req.user.rol, permissions: perms, count: perms.length } });
});
// GET /api/v1/roles/check/:permiso
exports.checkPermission = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const permiso = req.params.permiso;
    const allowed = (0, rbac_service_1.can)(req.user.rol, permiso);
    res.json({ ok: true, data: { permiso, allowed, rol: req.user.rol } });
});
// GET /api/v1/admin/usuarios
exports.listUsuarios = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const { rol, page, limit } = zod_1.z.object({
        rol: zod_1.z.enum(['CICLISTA', 'INSPECTOR', 'ALIADO', 'ADMIN']).optional(),
        page: zod_1.z.coerce.number().int().positive().default(1),
        limit: zod_1.z.coerce.number().int().min(1).max(100).default(20),
    }).parse(req.query);
    const result = await (0, rbac_service_1.listUsuariosByRol)(rol, page, limit);
    res.json({ ok: true, data: result });
});
// POST /api/v1/admin/usuarios/:id/rol
exports.asignarRol = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const { rol, motivo } = zod_1.z.object({
        rol: zod_1.z.enum(['CICLISTA', 'INSPECTOR', 'ALIADO', 'ADMIN']),
        motivo: zod_1.z.string().max(500).optional(),
    }).parse(req.body);
    await (0, rbac_service_1.assignRole)({ usuarioId: req.params.id, newRol: rol, adminId: req.user.sub, motivo });
    res.json({ ok: true, data: { usuarioId: req.params.id, nuevoRol: rol, mensaje: `Rol actualizado a ${rol}. Cambio en próximo login.` } });
});
// GET /api/v1/admin/inspectores
exports.getInspectores = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const { taller } = zod_1.z.object({ taller: zod_1.z.string().uuid().optional() }).parse(req.query);
    res.json({ ok: true, data: await (0, rbac_service_1.listInspectores)(taller) });
});
// POST /api/v1/admin/inspectores
exports.crearInspector = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const data = zod_1.z.object({
        usuarioId: zod_1.z.string().uuid(),
        tallerAliadoId: zod_1.z.string().uuid(),
        certificacion: zod_1.z.string().max(200).optional(),
        notas: zod_1.z.string().max(1000).optional(),
    }).parse(req.body);
    const profile = await (0, rbac_service_1.registerInspector)({ ...data, adminId: req.user.sub });
    res.status(201).json({ ok: true, data: { ...profile, mensaje: 'Inspector registrado. Pendiente de certificación.' } });
});
// POST /api/v1/admin/inspectores/:id/certificar
exports.certificarInspector = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const { certificacion } = zod_1.z.object({ certificacion: zod_1.z.string().min(3).max(200) }).parse(req.body);
    await (0, rbac_service_1.certifyInspector)(req.params.id, req.user.sub, certificacion);
    res.json({ ok: true, data: { inspectorId: req.params.id, certificado: true, mensaje: 'Inspector certificado. Ya puede emitir CITs.' } });
});
// PATCH /api/v1/admin/inspectores/:id/habilitar
exports.habilitarInspector = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const insp = await (0, database_1.queryOne)('SELECT activo FROM inspectores WHERE id=$1', [req.params.id]);
    if (!insp)
        throw new errorHandler_1.AppError('Inspector no encontrado', 404);
    const newActivo = !insp.activo;
    await (0, database_1.query)(`UPDATE inspectores SET activo=$2, fecha_${newActivo ? 'alta' : 'baja'}=NOW(), habilitado_por=$3 WHERE id=$1`, [req.params.id, newActivo, req.user.sub]);
    logger_1.log.auth.info({ inspectorId: req.params.id, activo: newActivo }, 'Inspector habilitación cambiada');
    res.json({ ok: true, data: { inspectorId: req.params.id, activo: newActivo } });
});
// GET /api/v1/inspector/perfil
exports.getMiPerfilInspector = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const profile = await (0, rbac_service_1.requireInspectorProfile)(req.user.sub);
    const stats = await (0, database_1.queryOne)(`SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE c.estado='ACTIVO')::text AS activos,
            COUNT(*) FILTER (WHERE c.creado_en>NOW()-INTERVAL '30d')::text AS mes
     FROM cits c JOIN inspectores i ON i.id=c.inspector_id WHERE i.usuario_id=$1`, [req.user.sub]);
    res.json({ ok: true, data: { ...profile, stats: { totalCITs: parseInt(stats?.total ?? '0'), citsActivos: parseInt(stats?.activos ?? '0'), citsEsteMes: parseInt(stats?.mes ?? '0') } } });
});
// GET /api/v1/admin/talleres
exports.getTalleres = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const { habilitados } = zod_1.z.object({ habilitados: zod_1.z.enum(['true', 'false']).optional() }).parse(req.query);
    res.json({ ok: true, data: await (0, rbac_service_1.listTalleres)(habilitados === undefined ? undefined : habilitados === 'true') });
});
// POST /api/v1/admin/talleres
exports.crearTaller = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const data = zod_1.z.object({
        nombre: zod_1.z.string().min(3).max(200), direccion: zod_1.z.string().min(5).max(300),
        localidad: zod_1.z.string().min(2).max(100), provincia: zod_1.z.string().default('Mendoza'),
        lat: zod_1.z.number().optional(), lng: zod_1.z.number().optional(),
        telefono: zod_1.z.string().max(30).optional(), email: zod_1.z.string().email().optional(),
        descripcion: zod_1.z.string().max(1000).optional(),
        planAliado: zod_1.z.enum(['base', 'estandar', 'premium']).default('base'),
        propietarioId: zod_1.z.string().uuid().optional(),
    }).parse(req.body);
    const rows = await (0, database_1.query)(`INSERT INTO talleres_aliados (nombre,direccion,localidad,provincia,lat,lng,telefono,email,descripcion,plan_aliado,propietario_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,nombre`, [data.nombre, data.direccion, data.localidad, data.provincia, data.lat ?? null, data.lng ?? null,
        data.telefono ?? null, data.email ?? null, data.descripcion ?? null, data.planAliado, data.propietarioId ?? null]);
    if (data.propietarioId) {
        await (0, rbac_service_1.assignRole)({ usuarioId: data.propietarioId, newRol: 'ALIADO', adminId: req.user.sub, motivo: `Propietario: ${rows[0].nombre}` }).catch(() => { });
    }
    logger_1.log.auth.info({ tallerId: rows[0].id, adminId: req.user.sub }, 'Taller creado');
    res.status(201).json({ ok: true, data: rows[0] });
});
// PATCH /api/v1/admin/talleres/:id/habilitar
exports.habilitarTaller = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const { motivo } = zod_1.z.object({ motivo: zod_1.z.string().max(500).optional() }).parse(req.body);
    const taller = await (0, database_1.queryOne)('SELECT nombre,habilitado FROM talleres_aliados WHERE id=$1', [req.params.id]);
    if (!taller)
        throw new errorHandler_1.AppError('Taller no encontrado', 404);
    const newHab = !taller.habilitado;
    await (0, database_1.query)('UPDATE talleres_aliados SET habilitado=$2,actualizado_en=NOW() WHERE id=$1', [req.params.id, newHab]);
    logger_1.log.auth.info({ tallerId: req.params.id, habilitado: newHab, motivo }, 'Taller habilitación cambiada');
    res.json({ ok: true, data: { tallerId: req.params.id, nombre: taller.nombre, habilitado: newHab } });
});
// GET /api/v1/aliado/mi-taller
exports.getMiTaller = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const ah = await (0, rbac_service_1.getAliHandler)(req.user.sub);
    const taller = await (0, database_1.queryOne)(`SELECT ta.*, COUNT(i.id)::int AS inspectores_activos,
            COUNT(c.id) FILTER (WHERE c.creado_en>NOW()-INTERVAL '30d')::int AS cits_este_mes
     FROM talleres_aliados ta
     LEFT JOIN inspectores i ON i.taller_aliado_id=ta.id AND i.activo=TRUE
     LEFT JOIN cits c ON c.taller_aliado_id=ta.id
     WHERE ta.id=$1 GROUP BY ta.id`, [ah.tallerAliadoId]);
    res.json({ ok: true, data: taller });
});
