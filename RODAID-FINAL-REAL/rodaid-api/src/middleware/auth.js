"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inspectorConPerfil = exports.secureAuth = exports.onlyAliado = exports.onlyAdmin = exports.onlyInspector = exports.authenticated = void 0;
exports.auth = auth;
exports.authWithBlacklist = authWithBlacklist;
exports.requireRole = requireRole;
exports.requirePermission = requirePermission;
exports.requireInspectorProfile = requireInspectorProfile;
const jwt_service_1 = require("../services/jwt.service");
const errorHandler_1 = require("./errorHandler");
function extractBearerToken(req) {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer '))
        return header.slice(7);
    return null;
}
// ── auth — verificación JWT rápida (sin DB) ───────────────
function auth(req, res, next) {
    const token = extractBearerToken(req);
    if (!token) {
        res.status(401).json({ ok: false, error: { code: 'NO_TOKEN', message: 'Token de autenticación requerido' } });
        return;
    }
    try {
        req.user = (0, jwt_service_1.verifyAccessToken)(token);
        // Actualizar actividad de sesión (debounced, fire-and-forget)
        const jti = req.user.jti;
        if (jti) {
            import('../services/session.service').then(({ touchSession }) => touchSession(jti).catch(() => { })).catch(() => { });
        }
        next();
    }
    catch (err) {
        if (err instanceof errorHandler_1.AppError) {
            res.status(err.statusCode).json({ ok: false, error: { code: err.code, message: err.message } });
            return;
        }
        res.status(401).json({ ok: false, error: { code: 'TOKEN_INVALID', message: 'Token inválido' } });
    }
}
// ── authWithBlacklist — con consulta de blacklist en DB ───
function authWithBlacklist(req, res, next) {
    const token = extractBearerToken(req);
    if (!token) {
        res.status(401).json({ ok: false, error: { code: 'NO_TOKEN', message: 'Token requerido' } });
        return;
    }
    import('../services/jwt.service').then(({ verifyAndExtractToken }) => verifyAndExtractToken(token)).then(decoded => { req.user = decoded; next(); })
        .catch(err => {
        if (err instanceof errorHandler_1.AppError)
            res.status(err.statusCode).json({ ok: false, error: { code: err.code, message: err.message } });
        else
            res.status(401).json({ ok: false, error: { code: 'TOKEN_INVALID', message: 'Token inválido' } });
    });
}
// ── requireRole — verificar rol por JWT claim ─────────────
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            res.status(401).json({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'No autenticado' } });
            return;
        }
        if (!roles.includes(req.user.rol)) {
            res.status(403).json({
                ok: false, error: {
                    code: 'FORBIDDEN',
                    message: `Acceso denegado. Rol requerido: ${roles.join(' o ')}`,
                    detail: { yourRole: req.user.rol, requiredRoles: roles },
                },
            });
            return;
        }
        next();
    };
}
// ── requirePermission — verificar permiso granular en DB ──
// Más costoso que requireRole (consulta DB), usar en endpoints sensibles
function requirePermission(permiso) {
    return (req, res, next) => {
        if (!req.user) {
            res.status(401).json({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'No autenticado' } });
            return;
        }
        import('../services/rbac.service').then(({ can }) => can(req.user.rol, permiso)).then(allowed => {
            if (!allowed) {
                res.status(403).json({
                    ok: false, error: {
                        code: 'PERMISSION_DENIED',
                        message: `No tenés el permiso '${permiso}' para realizar esta acción`,
                        detail: { yourRole: req.user.rol, requiredPermission: permiso },
                    },
                });
                return;
            }
            next();
        }).catch(() => {
            // Si la DB falla, permitir (no bloquear por error de DB)
            next();
        });
    };
}
// ── requireInspectorProfile — inspector activo con taller ─
function requireInspectorProfile(req, res, next) {
    if (!req.user) {
        res.status(401).json({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'No autenticado' } });
        return;
    }
    import('../services/rbac.service').then(({ requireInspectorProfile: rip }) => rip(req.user.sub)).then(profile => {
        req.inspectorProfile = profile;
        next();
    }).catch(err => {
        if (err instanceof errorHandler_1.AppError)
            res.status(err.statusCode).json({ ok: false, error: { code: err.code, message: err.message } });
        else
            res.status(403).json({ ok: false, error: { code: 'NO_INSPECTOR_PROFILE', message: 'Perfil de inspector requerido' } });
    });
}
// ── Middleware compuestos ─────────────────────────────────
exports.authenticated = [auth];
exports.onlyInspector = [auth, requireRole('INSPECTOR', 'ADMIN')];
exports.onlyAdmin = [auth, requireRole('ADMIN')];
exports.onlyAliado = [auth, requireRole('ALIADO', 'ADMIN')];
exports.secureAuth = [authWithBlacklist];
// Inspector activo con perfil vinculado a taller
exports.inspectorConPerfil = [auth, requireRole('INSPECTOR', 'ADMIN'), requireInspectorProfile];
