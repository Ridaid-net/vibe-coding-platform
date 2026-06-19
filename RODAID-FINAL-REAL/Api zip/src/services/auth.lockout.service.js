"use strict";
// ─── RODAID · Account Lockout Service ────────────────────
//
// Protección OWASP contra fuerza bruta en login.
//
// ══ POLÍTICA DE BLOQUEO ══════════════════════════════════
//
//   1–3 fallos  → sin bloqueo, solo registrar
//   4–5 fallos  → bloqueo 1 minuto
//   6–7 fallos  → bloqueo 5 minutos
//   8–9 fallos  → bloqueo 15 minutos
//   10+ fallos  → bloqueo 30 minutos + notificación admin
//
//   Un login exitoso resetea el contador a 0.
//   El bloqueo se verifica ANTES de validar la contraseña
//   para evitar timing attacks.
//
// ══ CAPA EXTRA: IP-level throttling ══════════════════════
//
//   Una IP que falla en 20+ cuentas distintas en 1 hora
//   entra en lista negra temporal (Redis, TTL 6h).
//   Esto detiene credential stuffing a nivel de IP.
Object.defineProperty(exports, "__esModule", { value: true });
exports.verificarBloqueoCuenta = verificarBloqueoCuenta;
exports.registrarFalloLogin = registrarFalloLogin;
exports.resetearContadorLogin = resetearContadorLogin;
exports.verificarBloqueoIP = verificarBloqueoIP;
exports.logAuthEvento = logAuthEvento;
exports.getAuditLog = getAuditLog;
exports.getAuthStats = getAuthStats;
const database_1 = require("../config/database");
const redis_1 = require("../config/redis");
const logger_1 = require("../middleware/logger");
// ══════════════════════════════════════════════════════════
// CONSTANTES
// ══════════════════════════════════════════════════════════
const BLOQUEO_MINUTOS = [
    { hasta: 3, minutos: 0 },
    { hasta: 5, minutos: 1 },
    { hasta: 7, minutos: 5 },
    { hasta: 9, minutos: 15 },
    { hasta: Infinity, minutos: 30 },
];
const IP_MAX_CUENTAS = 20; // IP bloqueada tras N cuentas distintas
const IP_TTL_HORAS = 6; // Bloqueo IP temporal en Redis
// ══════════════════════════════════════════════════════════
// VERIFICAR SI UNA CUENTA ESTÁ BLOQUEADA
// Llamar ANTES de verificar credenciales
// ══════════════════════════════════════════════════════════
async function verificarBloqueoCuenta(email) {
    const row = await (0, database_1.queryOne)(`SELECT lockout_hasta, login_intentos_fallidos
     FROM usuarios WHERE email = $1`, [email]);
    if (!row)
        return { bloqueado: false, segundosRestantes: 0, intentosFallidos: 0 };
    if (row.lockout_hasta && row.lockout_hasta > new Date()) {
        const segundosRestantes = Math.ceil((row.lockout_hasta.getTime() - Date.now()) / 1000);
        return { bloqueado: true, segundosRestantes, intentosFallidos: row.login_intentos_fallidos };
    }
    return { bloqueado: false, segundosRestantes: 0, intentosFallidos: row.login_intentos_fallidos };
}
// ══════════════════════════════════════════════════════════
// REGISTRAR INTENTO FALLIDO
// ══════════════════════════════════════════════════════════
async function registrarFalloLogin(opts) {
    // Incrementar contador y calcular bloqueo
    const row = await (0, database_1.queryOne)(`UPDATE usuarios
     SET login_intentos_fallidos = login_intentos_fallidos + 1,
         actualizado_en = NOW()
     WHERE email = $1
     RETURNING id, login_intentos_fallidos`, [opts.email]);
    if (!row)
        return { bloqueado: false, lockoutHasta: null, intentos: 0 };
    const intentos = row.login_intentos_fallidos;
    const politica = BLOQUEO_MINUTOS.find(p => intentos <= p.hasta);
    const minutos = politica.minutos;
    let lockoutHasta = null;
    if (minutos > 0) {
        lockoutHasta = new Date(Date.now() + minutos * 60_000);
        await (0, database_1.query)(`UPDATE usuarios SET lockout_hasta = $2 WHERE id = $1::uuid`, [row.id, lockoutHasta]);
        logger_1.log.auth.warn({
            email: opts.email, ip: opts.ip, intentos, lockoutMinutos: minutos,
        }, `Cuenta bloqueada por ${minutos}min tras ${intentos} intentos fallidos`);
    }
    // Registrar en audit log
    await (0, database_1.query)(`INSERT INTO auth_audit_log (usuario_id, evento, ip_address, user_agent, datos, ok)
     VALUES ($1::uuid, 'LOGIN_FALLIDO', $2::inet, $3, $4::jsonb, FALSE)`, [row.id, opts.ip, opts.userAgent, JSON.stringify({ intentos, bloqueado: minutos > 0 })]).catch(() => { });
    // Throttling por IP (Redis)
    await registrarIpFallo(opts.ip, opts.email);
    return { bloqueado: minutos > 0, lockoutHasta, intentos };
}
// ══════════════════════════════════════════════════════════
// RESETEAR CONTADOR AL HACER LOGIN EXITOSO
// ══════════════════════════════════════════════════════════
async function resetearContadorLogin(userId, ip) {
    await (0, database_1.query)(`UPDATE usuarios
     SET login_intentos_fallidos = 0,
         lockout_hasta = NULL,
         ultimo_login_en = NOW(),
         ultimo_login_ip = $2::inet,
         actualizado_en = NOW()
     WHERE id = $1::uuid`, [userId, ip]);
}
// ══════════════════════════════════════════════════════════
// BLOQUEO A NIVEL IP (Redis)
// ══════════════════════════════════════════════════════════
async function registrarIpFallo(ip, email) {
    try {
        const redis = (0, redis_1.getRedis)();
        const key = `lockout:ip:${ip}`;
        await redis.sadd(key, email);
        await redis.expire(key, IP_TTL_HORAS * 3600);
        const totalCuentas = await redis.scard(key);
        if (totalCuentas >= IP_MAX_CUENTAS) {
            const blockKey = `lockout:ip:blocked:${ip}`;
            await redis.set(blockKey, '1', 'EX', String(IP_TTL_HORAS * 3600));
            logger_1.log.auth.warn({ ip, cuentas: totalCuentas }, `IP bloqueada por ataque masivo (${totalCuentas} cuentas)`);
        }
    }
    catch { /* Redis puede no estar disponible; no bloquear el flujo */ }
}
async function verificarBloqueoIP(ip) {
    try {
        const redis = (0, redis_1.getRedis)();
        const blocked = await redis.get(`lockout:ip:blocked:${ip}`);
        return !!blocked;
    }
    catch {
        return false;
    }
}
// ══════════════════════════════════════════════════════════
// AUDIT LOG — helpers para endpoints auth
// ══════════════════════════════════════════════════════════
async function logAuthEvento(opts) {
    await (0, database_1.query)(`INSERT INTO auth_audit_log (usuario_id, evento, ip_address, user_agent, datos, ok)
     VALUES ($1::uuid, $2, $3::inet, $4, $5::jsonb, $6)`, [
        opts.usuarioId ?? null,
        opts.evento,
        opts.ip,
        opts.userAgent.slice(0, 512),
        JSON.stringify(opts.datos ?? {}),
        opts.ok ?? true,
    ]).catch(err => logger_1.log.auth.warn({ err: err.message }, 'logAuthEvento failed'));
}
async function getAuditLog(opts) {
    const conditions = ['TRUE'];
    const params = [];
    let i = 1;
    if (opts.usuarioId) {
        conditions.push(`usuario_id = $${i++}::uuid`);
        params.push(opts.usuarioId);
    }
    if (opts.evento) {
        conditions.push(`evento = $${i++}`);
        params.push(opts.evento);
    }
    if (opts.ip) {
        conditions.push(`ip_address = $${i++}::inet`);
        params.push(opts.ip);
    }
    return (0, database_1.query)(`SELECT id::text, evento, ip_address::text, ok, datos, creado_en
     FROM auth_audit_log
     WHERE ${conditions.join(' AND ')}
     ORDER BY creado_en DESC
     LIMIT $${i}`, [...params, opts.limit ?? 50]);
}
// ══════════════════════════════════════════════════════════
// ESTADÍSTICAS — para el dashboard admin
// ══════════════════════════════════════════════════════════
async function getAuthStats() {
    const [stats, bloqueados, ultimaHora] = await Promise.all([
        (0, database_1.queryOne)(`
      SELECT COUNT(*)::int AS total,
             SUM(CASE WHEN activo THEN 1 ELSE 0 END)::int AS activos,
             SUM(CASE WHEN totp_habilitado THEN 1 ELSE 0 END)::int AS con2fa,
             SUM(CASE WHEN rol='ADMIN' THEN 1 ELSE 0 END)::int AS admins
      FROM usuarios
    `),
        (0, database_1.queryOne)(`SELECT COUNT(*)::int AS count FROM usuarios WHERE lockout_hasta > NOW()`),
        (0, database_1.queryOne)(`
      SELECT
        SUM(CASE WHEN evento='LOGIN_FALLIDO' THEN 1 ELSE 0 END)::int AS intentos,
        SUM(CASE WHEN evento='LOGIN_FALLIDO' AND (datos->>'bloqueado')='true' THEN 1 ELSE 0 END)::int AS bloqueados,
        SUM(CASE WHEN evento='LOGIN_EXITOSO' THEN 1 ELSE 0 END)::int AS exitos
      FROM auth_audit_log WHERE creado_en > NOW() - INTERVAL '1 hour'
    `),
    ]);
    return {
        usuarios: stats ?? { total: 0, activos: 0, con2fa: 0, admins: 0 },
        bloqueadosNow: bloqueados?.count ?? 0,
        ultimaHora: ultimaHora ?? { intentos: 0, bloqueados: 0, exitos: 0 },
    };
}
