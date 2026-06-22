"use strict";
// ─── RODAID · RBAC — Role-Based Access Control ───────────
//
// 4 roles con jerarquía y herencia:
//
//   CICLISTA  → propietario de bicicletas, marketplace, denuncias
//   INSPECTOR → hereda CICLISTA + puede emitir CITs en su taller
//   ALIADO    → dueño de taller, gestiona inspectores propios
//   ADMIN     → acceso total + gestión de roles y habilitaciones
//
// La verificación de permisos es síncrona (sin DB) — la
// fuente de verdad es el JWT claim `rol`.
// El perfil de inspector (activo, taller vinculado) sí
// requiere DB — se usa solo en endpoints de emisión de CIT.
Object.defineProperty(exports, "__esModule", { value: true });
exports.PERMISOS = void 0;
exports.can = can;
exports.getPermissions = getPermissions;
exports.canAll = canAll;
exports.canAny = canAny;
exports.requireInspectorProfile = requireInspectorProfile;
exports.getAliHandler = getAliHandler;
exports.assignRole = assignRole;
exports.registerInspector = registerInspector;
exports.certifyInspector = certifyInspector;
exports.listUsuariosByRol = listUsuariosByRol;
exports.listInspectores = listInspectores;
exports.listTalleres = listTalleres;
exports.getRolesSummary = getRolesSummary;
const database_1 = require("../config/database");
const errorHandler_1 = require("../middleware/errorHandler");
const logger_1 = require("../middleware/logger");
// ══════════════════════════════════════════════════════════
// PERMISOS DISPONIBLES
// ══════════════════════════════════════════════════════════
exports.PERMISOS = [
    // Bicicletas (Garaje Digital)
    'bicicletas:read',
    'bicicletas:create',
    'bicicletas:update',
    // CIT — Certificado de Identidad Técnica
    'cit:read',
    'cit:verificar', // público — verificar serial
    'cit:iniciar', // INSPECTOR: emitir nuevo CIT
    'cit:validar', // ADMIN/WORKER: cross-reference Min.Seg
    'cit:finalizar', // ADMIN/WORKER: acuñar NFT en BFA
    'cit:denunciar', // CICLISTA: denunciar robo
    // Marketplace
    'marketplace:read',
    'marketplace:create', // publicar bicicleta
    'marketplace:update', // editar propia publicación
    'marketplace:comprar',
    'marketplace:confirmar',
    // Seguridad / denuncias
    'denuncia:create',
    'denuncia:read', // ver propias denuncias
    'denuncia:recuperar',
    // Inspector
    'inspector:read', // ver perfil propio
    'inspector:list', // ALIADO: ver inspectores de su taller
    // Taller Aliado
    'taller:read',
    'taller:update', // ALIADO: actualizar su propio taller
    'taller:create', // ADMIN
    'taller:habilitar', // ADMIN
    // Usuarios / Admin
    'usuario:read:own', // leer perfil propio
    'usuario:read:all', // ADMIN: leer todos los usuarios
    'usuario:update:own',
    'usuario:update:all', // ADMIN
    'roles:assign', // ADMIN: cambiar roles
    'inspector:certify', // ADMIN: certificar inspector
    'inspector:habilitar', // ADMIN: habilitar/deshabilitar
    'admin:queue', // ADMIN: gestión de colas Bull
    'admin:tokens', // ADMIN: purgar tokens
    'admin:rate-limits', // ADMIN: ver rate limits
    'admin:health:deep', // ADMIN: health check completo
];
// ══════════════════════════════════════════════════════════
// MATRIZ DE PERMISOS
// Cada rol lista sus permisos directos.
// ADMIN hereda todo — se define explícitamente para claridad.
// ══════════════════════════════════════════════════════════
const PERMISSIONS_MAP = {
    CICLISTA: new Set([
        'bicicletas:read', 'bicicletas:create', 'bicicletas:update',
        'cit:read', 'cit:verificar', 'cit:denunciar',
        'marketplace:read', 'marketplace:create', 'marketplace:update',
        'marketplace:comprar', 'marketplace:confirmar',
        'denuncia:create', 'denuncia:read', 'denuncia:recuperar',
        'usuario:read:own', 'usuario:update:own',
    ]),
    INSPECTOR: new Set([
        // Hereda todo CICLISTA
        'bicicletas:read', 'bicicletas:create', 'bicicletas:update',
        'cit:read', 'cit:verificar', 'cit:denunciar',
        'marketplace:read', 'marketplace:create', 'marketplace:update',
        'marketplace:comprar', 'marketplace:confirmar',
        'denuncia:create', 'denuncia:read', 'denuncia:recuperar',
        'usuario:read:own', 'usuario:update:own',
        // Exclusivos INSPECTOR
        'cit:iniciar',
        'inspector:read',
        'taller:read',
    ]),
    ALIADO: new Set([
        // Hereda todo CICLISTA
        'bicicletas:read', 'bicicletas:create', 'bicicletas:update',
        'cit:read', 'cit:verificar', 'cit:denunciar',
        'marketplace:read', 'marketplace:create', 'marketplace:update',
        'marketplace:comprar', 'marketplace:confirmar',
        'denuncia:create', 'denuncia:read', 'denuncia:recuperar',
        'usuario:read:own', 'usuario:update:own',
        // Exclusivos ALIADO (propietario de taller)
        'taller:read', 'taller:update',
        'inspector:read', 'inspector:list',
    ]),
    ADMIN: new Set([
        // Todos los permisos
        ...exports.PERMISOS,
    ]),
};
// ══════════════════════════════════════════════════════════
// FUNCIONES DE VERIFICACIÓN
// ══════════════════════════════════════════════════════════
// Verificación síncrona — no consulta DB
function can(rol, permiso) {
    return PERMISSIONS_MAP[rol]?.has(permiso) ?? false;
}
// Lista todos los permisos de un rol
function getPermissions(rol) {
    return [...(PERMISSIONS_MAP[rol] ?? [])];
}
// Verifica múltiples permisos (AND — todos deben cumplirse)
function canAll(rol, permisos) {
    return permisos.every(p => can(rol, p));
}
// Verifica múltiples permisos (OR — al menos uno)
function canAny(rol, permisos) {
    return permisos.some(p => can(rol, p));
}
// ══════════════════════════════════════════════════════════
// PERFIL DE INSPECTOR — requiere DB
// ══════════════════════════════════════════════════════════
// Verifica que el usuario tiene un perfil de inspector
// activo y habilitado — lanza AppError si no
async function requireInspectorProfile(userId) {
    const profile = await (0, database_1.queryOne)(`SELECT i.id, i.taller_aliado_id, ta.nombre AS taller_nombre,
            ta.localidad AS taller_localidad,
            i.certificado, i.activo,
            (i.activo AND ta.habilitado AND ta.activo) AS habilitado
     FROM inspectores i
     JOIN talleres_aliados ta ON ta.id = i.taller_aliado_id
     WHERE i.usuario_id = $1`, [userId]);
    if (!profile) {
        throw new errorHandler_1.AppError('No tenés un perfil de inspector registrado. Contactá a un Taller Aliado.', 403, 'NO_INSPECTOR_PROFILE');
    }
    if (!profile.activo) {
        throw new errorHandler_1.AppError('Tu perfil de inspector está inactivo.', 403, 'INSPECTOR_INACTIVE');
    }
    if (!profile.habilitado) {
        throw new errorHandler_1.AppError('Tu taller aliado no está habilitado. Contactá al soporte de RODAID.', 403, 'TALLER_DESHABILITADO');
    }
    return {
        inspectorId: profile.id,
        tallerAliadoId: profile.taller_aliado_id,
        tallerNombre: profile.taller_nombre,
        tallerLocalidad: profile.taller_localidad,
        certificado: profile.certificado,
        habilitado: profile.habilitado,
    };
}
// Obtener el taller de un usuario ALIADO
async function getAliHandler(userId) {
    const taller = await (0, database_1.queryOne)(`SELECT id, nombre, plan_aliado, habilitado, activo
     FROM talleres_aliados WHERE propietario_id = $1`, [userId]);
    if (!taller) {
        throw new errorHandler_1.AppError('No tenés un taller aliado registrado.', 403, 'NO_TALLER_ALIADO');
    }
    return {
        tallerAliadoId: taller.id,
        tallerNombre: taller.nombre,
        planAliado: taller.plan_aliado,
        habilitado: taller.habilitado && taller.activo,
    };
}
async function assignRole({ usuarioId, newRol, adminId, motivo }) {
    // Verificar que el usuario existe
    const usuario = await (0, database_1.queryOne)(`SELECT id, rol, email FROM usuarios WHERE id = $1 AND activo = TRUE`, [usuarioId]);
    if (!usuario)
        throw new errorHandler_1.AppError('Usuario no encontrado', 404, 'USER_NOT_FOUND');
    const oldRol = usuario.rol;
    // No puede auto-asignarse admin (excepto si ya es admin)
    if (newRol === 'ADMIN' && usuarioId === adminId) {
        throw new errorHandler_1.AppError('No podés auto-asignarte el rol ADMIN', 403, 'SELF_ROLE_ESCALATION');
    }
    // Si se asigna INSPECTOR, el perfil de inspector se gestiona por separado
    // Aquí solo cambiamos el claim de rol en el JWT (se refleja en próximo login)
    await (0, database_1.query)(`UPDATE usuarios SET rol = $2, actualizado_en = NOW() WHERE id = $1`, [usuarioId, newRol]);
    logger_1.log.auth.info({
        userId: usuarioId, email: usuario.email,
        oldRol, newRol, adminId, motivo,
    }, `Rol actualizado: ${oldRol} → ${newRol}`);
    // Si se degrada de INSPECTOR a otro rol, desactivar perfil de inspector
    if (oldRol === 'INSPECTOR' && newRol !== 'INSPECTOR' && newRol !== 'ADMIN') {
        await (0, database_1.query)(`UPDATE inspectores SET activo = FALSE, fecha_baja = NOW()
       WHERE usuario_id = $1 AND activo = TRUE`, [usuarioId]).catch(() => { }); // best-effort
    }
}
async function registerInspector(input) {
    // Verificar que el taller existe y está habilitado
    const taller = await (0, database_1.queryOne)(`SELECT id, nombre, localidad, habilitado FROM talleres_aliados WHERE id = $1 AND activo = TRUE`, [input.tallerAliadoId]);
    if (!taller)
        throw new errorHandler_1.AppError('Taller aliado no encontrado', 404, 'TALLER_NOT_FOUND');
    if (!taller.habilitado)
        throw new errorHandler_1.AppError('El taller no está habilitado', 409, 'TALLER_DESHABILITADO');
    // Verificar que el usuario existe y no es ya inspector
    const usuario = await (0, database_1.queryOne)(`SELECT id, rol FROM usuarios WHERE id = $1 AND activo = TRUE`, [input.usuarioId]);
    if (!usuario)
        throw new errorHandler_1.AppError('Usuario no encontrado', 404);
    // Crear o reactivar perfil de inspector + cambiar rol
    const rows = await (0, database_1.query)(`INSERT INTO inspectores
       (usuario_id, taller_aliado_id, certificado, activo, habilitado_por, certificacion, notas)
     VALUES ($1, $2, FALSE, TRUE, $3, $4, $5)
     ON CONFLICT (usuario_id)
     DO UPDATE SET
       taller_aliado_id = EXCLUDED.taller_aliado_id,
       activo           = TRUE,
       fecha_baja       = NULL,
       fecha_alta       = NOW(),
       habilitado_por   = EXCLUDED.habilitado_por,
       certificacion    = COALESCE(EXCLUDED.certificacion, inspectores.certificacion),
       notas            = COALESCE(EXCLUDED.notas, inspectores.notas)
     RETURNING id`, [input.usuarioId, input.tallerAliadoId, input.adminId,
        input.certificacion ?? null, input.notas ?? null]);
    // Cambiar rol a INSPECTOR
    await (0, database_1.query)(`UPDATE usuarios SET rol = 'INSPECTOR', actualizado_en = NOW() WHERE id = $1`, [input.usuarioId]);
    logger_1.log.auth.info({
        inspectorId: rows[0].id, userId: input.usuarioId,
        tallerId: input.tallerAliadoId, tallerNombre: taller.nombre,
    }, 'Inspector registrado');
    return {
        inspectorId: rows[0].id,
        tallerAliadoId: taller.id,
        tallerNombre: taller.nombre,
        tallerLocalidad: taller.localidad,
        certificado: false,
        habilitado: true,
    };
}
// Certificar inspector (ADMIN — habilita a emitir CITs)
async function certifyInspector(inspectorId, adminId, certificacion) {
    const result = await (0, database_1.query)(`UPDATE inspectores
     SET certificado = TRUE, certificacion = $2, habilitado_por = $3
     WHERE id = $1 AND activo = TRUE
     RETURNING id`, [inspectorId, certificacion, adminId]);
    if (!result.length)
        throw new errorHandler_1.AppError('Inspector no encontrado', 404);
    logger_1.log.auth.info({ inspectorId, adminId, certificacion }, 'Inspector certificado');
}
// ══════════════════════════════════════════════════════════
// QUERIES ADMIN — listas y reportes
// ══════════════════════════════════════════════════════════
async function listUsuariosByRol(rol, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const where = rol ? `WHERE u.rol = '${rol}'` : '';
    const [total] = await (0, database_1.query)(`SELECT COUNT(*)::text AS count FROM usuarios u ${where}`);
    const items = await (0, database_1.query)(`SELECT u.id, u.email, u.nombre, u.apellido, u.rol, u.activo,
            u.email_verificado, u.mxm_verificado, u.mxm_nivel,
            u.creado_en, p.nombre AS plan,
            i.id AS inspector_id, i.certificado, ta.nombre AS taller
     FROM usuarios u
     LEFT JOIN planes p ON p.id = u.plan_id
     LEFT JOIN inspectores i ON i.usuario_id = u.id AND i.activo = TRUE
     LEFT JOIN talleres_aliados ta ON ta.id = i.taller_aliado_id
     ${where}
     ORDER BY u.creado_en DESC
     LIMIT $1 OFFSET $2`, [limit, offset]);
    return { items, total: parseInt(total?.count ?? '0'), page, limit };
}
async function listInspectores(tallerAliadoId) {
    const where = tallerAliadoId ? `AND i.taller_aliado_id = '${tallerAliadoId}'` : '';
    return (0, database_1.query)(`SELECT i.id, i.certificado, i.activo, i.fecha_alta, i.certificacion,
            u.nombre, u.apellido, u.email, u.dni,
            ta.nombre AS taller, ta.localidad
     FROM inspectores i
     JOIN usuarios u ON u.id = i.usuario_id
     JOIN talleres_aliados ta ON ta.id = i.taller_aliado_id
     WHERE i.activo = TRUE ${where}
     ORDER BY i.fecha_alta DESC`);
}
async function listTalleres(habilitados) {
    const where = habilitados !== undefined ? `WHERE habilitado = ${habilitados}` : '';
    return (0, database_1.query)(`SELECT ta.id, ta.nombre, ta.localidad, ta.direccion, ta.plan_aliado,
            ta.habilitado, ta.activo, ta.creado_en,
            u.nombre AS propietario_nombre, u.email AS propietario_email,
            COUNT(i.id)::int AS inspectores_activos
     FROM talleres_aliados ta
     LEFT JOIN usuarios u ON u.id = ta.propietario_id
     LEFT JOIN inspectores i ON i.taller_aliado_id = ta.id AND i.activo = TRUE
     ${where}
     GROUP BY ta.id, u.nombre, u.email
     ORDER BY ta.nombre`);
}
// ══════════════════════════════════════════════════════════
// RESUMEN DE PERMISOS — para documentación y debug
// ══════════════════════════════════════════════════════════
function getRolesSummary() {
    return Object.keys(PERMISSIONS_MAP).reduce((acc, rol) => {
        const perms = [...PERMISSIONS_MAP[rol]];
        acc[rol] = { permissions: perms, count: perms.length };
        return acc;
    }, {});
}
