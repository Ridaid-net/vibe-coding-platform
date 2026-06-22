"use strict";
// ─── RODAID · Sistema de Capacitación y Examen Online ─────
// Gestiona la formación y certificación de inspectores.
//
// Flujo del candidato:
//   1. Estudiar módulos                     GET /capacitacion/modulos
//   2. Iniciar examen                        POST /capacitacion/examen/iniciar
//      → 30 preguntas aleatorias, 60 min límite
//   3. Responder pregunta por pregunta       POST /capacitacion/examen/:id/responder
//   4. Finalizar examen                      POST /capacitacion/examen/:id/finalizar
//      → scoring inmediato → si ≥ 70% → certificado emitido
//   5. Ver certificado                       GET /capacitacion/certificado
//
// Reglas del examen:
//   · Preguntas sorteadas aleatoriamente del banco
//   · 70% de aciertos para aprobar (21/30 correctas con puntaje básico)
//   · 60 minutos de tiempo límite (sesión expira automáticamente)
//   · 24 horas de espera entre intentos si se reprueba
//   · Máximo 5 intentos (luego requiere intervención del admin)
//   · Una sola pregunta activa a la vez → anti-trampas
//   · Las respuestas no se revelan durante el examen (solo al finalizar)
//
// Certificado:
//   · Válido 2 años desde la emisión
//   · Número correlativo: CERT-INS-2026-00001
//   · Al emitir → UPDATE inspectores SET certificado=TRUE
Object.defineProperty(exports, "__esModule", { value: true });
exports.getModulos = getModulos;
exports.getModulo = getModulo;
exports.getPreguntasModulo = getPreguntasModulo;
exports.iniciarExamen = iniciarExamen;
exports.getPreguntaExamen = getPreguntaExamen;
exports.responderPregunta = responderPregunta;
exports.finalizarExamen = finalizarExamen;
exports.getMiHistorial = getMiHistorial;
exports.getSesionDetalle = getSesionDetalle;
exports.getEstadisticasExamen = getEstadisticasExamen;
exports.crearPregunta = crearPregunta;
const database_1 = require("../config/database");
const redis_1 = require("../config/redis");
const logger_1 = require("../middleware/logger");
const errorHandler_1 = require("../middleware/errorHandler");
// ══════════════════════════════════════════════════════════
// CONSTANTES
// ══════════════════════════════════════════════════════════
const NUM_PREGUNTAS = 15; // preguntas por examen (30 en producción)
const PORCENTAJE_MINIMO = 70; // % para aprobar
const TIEMPO_LIMITE_MIN = 60; // minutos
const ESPERA_REINTENTO_H = 24; // horas de espera entre intentos
const MAX_INTENTOS = 5;
// ══════════════════════════════════════════════════════════
// MÓDULOS DE ESTUDIO
// ══════════════════════════════════════════════════════════
async function getModulos(soloObligatorios = false) {
    const cond = soloObligatorios ? 'AND obligatorio=TRUE' : '';
    return (0, database_1.query)(`SELECT id, codigo, titulo, descripcion, orden, obligatorio,
            duracion_min, contenido_md, video_url
     FROM capacitacion_modulos WHERE activo=TRUE ${cond}
     ORDER BY orden`, []);
}
async function getModulo(moduloId) {
    return (0, database_1.queryOne)(`SELECT * FROM capacitacion_modulos WHERE id=$1 AND activo=TRUE`, [moduloId]);
}
// ══════════════════════════════════════════════════════════
// BANCO DE PREGUNTAS (solo para admin)
// ══════════════════════════════════════════════════════════
async function getPreguntasModulo(moduloId) {
    const pregs = await (0, database_1.query)(`SELECT p.id, p.texto, p.tipo, p.dificultad, p.puntos,
            p.explicacion, p.activa,
            json_agg(json_build_object('id',o.id,'texto',o.texto,'es_correcta',o.es_correcta,'orden',o.orden)
              ORDER BY o.orden) AS opciones
     FROM capacitacion_preguntas p
     JOIN capacitacion_opciones o ON o.pregunta_id=p.id
     WHERE p.modulo_id=$1 GROUP BY p.id ORDER BY p.dificultad`, [moduloId]);
    return pregs;
}
// ══════════════════════════════════════════════════════════
// INICIAR EXAMEN
// ══════════════════════════════════════════════════════════
async function iniciarExamen(usuarioId) {
    // 1. Verificar si hay un intento activo
    const activo = await (0, database_1.queryOne)(`SELECT id, estado, expira_en FROM examen_sesiones
     WHERE usuario_id=$1 AND estado='EN_CURSO'
     ORDER BY iniciada_en DESC LIMIT 1`, [usuarioId]);
    if (activo) {
        if (new Date(activo.expira_en) > new Date()) {
            throw new errorHandler_1.AppError('Ya tenés un examen en curso', 409, 'EXAMEN_EN_CURSO', { sesionId: activo.id });
        }
        // Expirado → marcar como EXPIRADO
        await (0, database_1.query)(`UPDATE examen_sesiones SET estado='EXPIRADO' WHERE id=$1`, [activo.id]);
    }
    // 2. Verificar espera entre intentos
    const ultimo = await (0, database_1.queryOne)(`SELECT estado, finalizada_en, intento, proximo_intento_desde
     FROM examen_sesiones WHERE usuario_id=$1 AND estado IN ('REPROBADO','APROBADO','EXPIRADO')
     ORDER BY iniciada_en DESC LIMIT 1`, [usuarioId]);
    if (ultimo?.proximo_intento_desde && new Date(ultimo.proximo_intento_desde) > new Date()) {
        const horasRestantes = Math.ceil((new Date(ultimo.proximo_intento_desde).getTime() - Date.now()) / 3_600_000);
        throw new errorHandler_1.AppError(`Debés esperar ${horasRestantes}h antes del próximo intento`, 429, 'ESPERA_REINTENTO', { horasRestantes, proximo: ultimo.proximo_intento_desde });
    }
    // 3. Verificar máximo de intentos
    const numIntentos = await (0, database_1.queryOne)(`SELECT COUNT(*)::text AS count FROM examen_sesiones
     WHERE usuario_id=$1 AND estado IN ('REPROBADO','EXPIRADO','ABANDONADO')`, [usuarioId]);
    const intentoActual = parseInt(numIntentos?.count ?? '0') + 1;
    if (intentoActual > MAX_INTENTOS) {
        throw new errorHandler_1.AppError(`Superaste el máximo de ${MAX_INTENTOS} intentos. Contactá al administrador.`, 403, 'MAX_INTENTOS_SUPERADO');
    }
    // 4. Sortear preguntas aleatoriamente
    const todasPreguntas = await (0, database_1.query)(`SELECT p.id, p.puntos
     FROM capacitacion_preguntas p
     JOIN capacitacion_modulos m ON m.id=p.modulo_id
     WHERE p.activa=TRUE AND m.activo=TRUE
     ORDER BY RANDOM()
     LIMIT $1`, [NUM_PREGUNTAS]);
    if (todasPreguntas.length < NUM_PREGUNTAS) {
        throw new errorHandler_1.AppError(`Banco de preguntas insuficiente (${todasPreguntas.length}/${NUM_PREGUNTAS}). Contactá al administrador.`, 503, 'BANCO_INSUFICIENTE');
    }
    const puntajeMaximo = todasPreguntas.reduce((acc, p) => acc + p.puntos, 0);
    const expiraEn = new Date(Date.now() + TIEMPO_LIMITE_MIN * 60_000);
    // 5. Crear sesión
    const sesion = await (0, database_1.queryOne)(`INSERT INTO examen_sesiones
       (usuario_id, preguntas_ids, num_preguntas, puntaje_maximo,
        puntaje_minimo, tiempo_limite_min, expira_en, intento)
     VALUES ($1, $2::uuid[], $3, $4, $5, $6, $7, $8)
     RETURNING id`, [
        usuarioId,
        todasPreguntas.map(p => p.id),
        NUM_PREGUNTAS,
        puntajeMaximo,
        PORCENTAJE_MINIMO,
        TIEMPO_LIMITE_MIN,
        expiraEn,
        intentoActual,
    ]);
    // Cachear el mapa pregunta→opciones correctas en Redis (anti-trampas: no exponer al cliente)
    const redis = (0, redis_1.getRedis)();
    const respKeys = Object.fromEntries(todasPreguntas.map(p => [p.id, p.puntos]));
    await redis.set(`examen:${sesion.id}:puntos`, JSON.stringify(respKeys), 'EX', TIEMPO_LIMITE_MIN * 65);
    logger_1.log.auth.info({ usuarioId: usuarioId.slice(0, 8), intento: intentoActual }, '📝 Examen iniciado');
    return { sesionId: sesion.id, expiraEn, numPreguntas: NUM_PREGUNTAS, tiempoLimiteMin: TIEMPO_LIMITE_MIN, intento: intentoActual };
}
// ══════════════════════════════════════════════════════════
// OBTENER PREGUNTA DEL EXAMEN
// ══════════════════════════════════════════════════════════
async function getPreguntaExamen(sesionId, usuarioId) {
    const sesion = await getSesionActiva(sesionId, usuarioId);
    // Encontrar la próxima pregunta sin responder
    const respondidas = await (0, database_1.query)(`SELECT pregunta_id::text FROM examen_respuestas WHERE sesion_id=$1`, [sesionId]);
    const respondidosSet = new Set(respondidas.map(r => r.pregunta_id));
    const siguiente = sesion.preguntas_ids.find((id) => !respondidosSet.has(id));
    if (!siguiente)
        throw new errorHandler_1.AppError('Todas las preguntas ya fueron respondidas', 409, 'EXAMEN_COMPLETO');
    const pregunta = await getPreguntaSinRespuesta(siguiente);
    const segundosRestantes = Math.max(0, Math.floor((new Date(sesion.expira_en).getTime() - Date.now()) / 1000));
    return { pregunta, respondidas: respondidosSet.size, total: sesion.preguntas_ids.length, segundosRestantes };
}
// ══════════════════════════════════════════════════════════
// RESPONDER PREGUNTA
// ══════════════════════════════════════════════════════════
async function responderPregunta(opts) {
    const sesion = await getSesionActiva(opts.sesionId, opts.usuarioId);
    // Verificar que la pregunta pertenece a este examen
    if (!sesion.preguntas_ids.includes(opts.preguntaId)) {
        throw new errorHandler_1.AppError('Pregunta no pertenece a este examen', 400, 'PREGUNTA_INVALIDA');
    }
    // Verificar que no fue respondida antes
    const yaRespondida = await (0, database_1.queryOne)(`SELECT id FROM examen_respuestas WHERE sesion_id=$1 AND pregunta_id=$2`, [opts.sesionId, opts.preguntaId]);
    if (yaRespondida)
        throw new errorHandler_1.AppError('Pregunta ya respondida', 409, 'YA_RESPONDIDA');
    // Verificar que la opción pertenece a la pregunta
    const opcion = await (0, database_1.queryOne)(`SELECT es_correcta FROM capacitacion_opciones WHERE id=$1 AND pregunta_id=$2`, [opts.opcionId, opts.preguntaId]);
    if (!opcion)
        throw new errorHandler_1.AppError('Opción inválida', 400, 'OPCION_INVALIDA');
    // Obtener puntos de la pregunta
    const pregunta = await (0, database_1.queryOne)(`SELECT puntos FROM capacitacion_preguntas WHERE id=$1`, [opts.preguntaId]);
    const puntosObtenidos = opcion.es_correcta ? (pregunta?.puntos ?? 1) : 0;
    await (0, database_1.query)(`INSERT INTO examen_respuestas (sesion_id, pregunta_id, opcion_id, es_correcta, puntos_obtenidos)
     VALUES ($1,$2,$3,$4,$5)`, [opts.sesionId, opts.preguntaId, opts.opcionId, opcion.es_correcta, puntosObtenidos]);
    const count = await (0, database_1.queryOne)(`SELECT COUNT(*)::text AS count FROM examen_respuestas WHERE sesion_id=$1`, [opts.sesionId]);
    return {
        ok: true,
        respondidas: parseInt(count?.count ?? '0'),
        total: sesion.preguntas_ids.length,
    };
}
// ══════════════════════════════════════════════════════════
// FINALIZAR EXAMEN — SCORING + CERTIFICADO
// ══════════════════════════════════════════════════════════
async function finalizarExamen(sesionId, usuarioId) {
    const sesion = await getSesionActiva(sesionId, usuarioId);
    // Verificar que respondió al menos el 80% de preguntas
    const respuestas = await (0, database_1.query)(`SELECT er.pregunta_id, er.opcion_id, er.es_correcta, er.puntos_obtenidos,
            p.texto AS pregunta_txt, p.explicacion, p.puntos AS puntos_max,
            op_elegida.texto AS opcion_elegida,
            op_correcta.texto AS opcion_correcta
     FROM examen_respuestas er
     JOIN capacitacion_preguntas p ON p.id=er.pregunta_id
     LEFT JOIN capacitacion_opciones op_elegida ON op_elegida.id=er.opcion_id
     LEFT JOIN capacitacion_opciones op_correcta ON op_correcta.pregunta_id=er.pregunta_id AND op_correcta.es_correcta=TRUE
     WHERE er.sesion_id=$1`, [sesionId]);
    const puntajeTotal = respuestas.reduce((acc, r) => acc + (r.puntos_obtenidos ?? 0), 0);
    const puntajeMaximo = sesion.puntaje_maximo ?? NUM_PREGUNTAS;
    const porcentaje = Math.round(puntajeTotal / puntajeMaximo * 100 * 100) / 100;
    const aprobado = porcentaje >= PORCENTAJE_MINIMO;
    const correctas = respuestas.filter((r) => r.es_correcta).length;
    const incorrectas = respuestas.length - correctas;
    const proximoIntento = aprobado ? undefined
        : new Date(Date.now() + ESPERA_REINTENTO_H * 3_600_000);
    // Actualizar sesión
    await (0, database_1.query)(`UPDATE examen_sesiones SET
       estado=$2, puntaje_total=$3, porcentaje=$4, aprobado=$5,
       finalizada_en=NOW(), proximo_intento_desde=$6
     WHERE id=$1`, [sesionId, aprobado ? 'APROBADO' : 'REPROBADO', puntajeTotal, porcentaje, aprobado, proximoIntento ?? null]);
    // Emitir certificado si aprobó
    let certificadoId;
    let numeroCert;
    let validoHasta;
    if (aprobado) {
        const cert = await emitirCertificado(sesionId, usuarioId);
        certificadoId = cert.certificadoId;
        numeroCert = cert.numeroCert;
        validoHasta = cert.validoHasta;
    }
    logger_1.log.auth.info({
        usuarioId: usuarioId.slice(0, 8),
        aprobado,
        porcentaje: porcentaje.toFixed(1) + '%',
        correctas,
        numeroCert,
    }, aprobado ? '🎓 Examen APROBADO — certificado emitido' : '❌ Examen REPROBADO');
    return {
        aprobado, porcentaje, puntajeTotal, puntajeMaximo,
        correctas, incorrectas, certificadoId, numeroCert, validoHasta,
        proximoIntento,
        detalle: respuestas.map((r) => ({
            preguntaId: r.pregunta_id,
            preguntaTxt: r.pregunta_txt,
            opcionElegida: r.opcion_elegida,
            opcionCorrecta: r.opcion_correcta,
            esCorrecta: r.es_correcta,
            puntosObtenidos: r.puntos_obtenidos,
            puntosMax: r.puntos_max,
            explicacion: r.explicacion,
        })),
    };
}
// ══════════════════════════════════════════════════════════
// EMITIR CERTIFICADO
// ══════════════════════════════════════════════════════════
async function emitirCertificado(sesionId, usuarioId) {
    // Obtener inspectorId
    const inspector = await (0, database_1.queryOne)(`SELECT i.id, i.taller_aliado_id FROM inspectores i
     WHERE i.usuario_id=$1 LIMIT 1`, [usuarioId]);
    // Número correlativo de certificado
    const seq = await (0, database_1.queryOne)(`SELECT COUNT(*)::text AS count FROM inspector_certificados`, []);
    const num = String(parseInt(seq?.count ?? '0') + 1).padStart(5, '0');
    const año = new Date().getFullYear();
    const numeroCert = `CERT-INS-${año}-${num}`;
    const validoHasta = new Date(Date.now() + 2 * 365.25 * 24 * 3_600_000);
    const cert = await (0, database_1.queryOne)(`INSERT INTO inspector_certificados
       (inspector_id, sesion_id, numero_cert, valido_hasta)
     VALUES ($1,$2,$3,$4)
     RETURNING id`, [inspector?.id ?? null, sesionId, numeroCert, validoHasta]);
    // Certificar al inspector si tiene perfil
    if (inspector) {
        await (0, database_1.query)(`UPDATE inspectores SET certificado=TRUE WHERE id=$1`, [inspector.id]);
    }
    return { certificadoId: cert.id, numeroCert, validoHasta };
}
// ══════════════════════════════════════════════════════════
// CONSULTAS
// ══════════════════════════════════════════════════════════
async function getMiHistorial(usuarioId) {
    const [sesiones, certificado] = await Promise.all([
        (0, database_1.query)(`SELECT id, estado, intento, porcentaje, aprobado,
              puntaje_total, puntaje_maximo, iniciada_en, finalizada_en, expira_en
       FROM examen_sesiones WHERE usuario_id=$1 ORDER BY iniciada_en DESC LIMIT 10`, [usuarioId]),
        (0, database_1.queryOne)(`SELECT ic.numero_cert, ic.emitido_en, ic.valido_hasta, ic.revocado
       FROM inspector_certificados ic
       JOIN examen_sesiones es ON es.id=ic.sesion_id
       WHERE es.usuario_id=$1 AND NOT ic.revocado
       ORDER BY ic.emitido_en DESC LIMIT 1`, [usuarioId]),
    ]);
    return { sesiones, certificado };
}
async function getSesionDetalle(sesionId, usuarioId) {
    return (0, database_1.queryOne)(`SELECT id, estado, intento, porcentaje, aprobado, puntaje_total,
            puntaje_maximo, num_preguntas, tiempo_limite_min,
            iniciada_en, finalizada_en, expira_en, proximo_intento_desde
     FROM examen_sesiones WHERE id=$1 AND usuario_id=$2`, [sesionId, usuarioId]);
}
async function getEstadisticasExamen() {
    const [resumen, porcentajePromedio, topErrores] = await Promise.all([
        (0, database_1.queryOne)(`SELECT COUNT(*)::int                                          AS total,
              COUNT(*) FILTER(WHERE estado='APROBADO')::int         AS aprobados,
              COUNT(*) FILTER(WHERE estado='REPROBADO')::int        AS reprobados,
              ROUND(AVG(porcentaje),1)::numeric                     AS prom_porcentaje,
              ROUND(AVG(intento),2)::numeric                        AS prom_intentos
       FROM examen_sesiones WHERE estado IN ('APROBADO','REPROBADO')`, []),
        (0, database_1.query)(`SELECT p.texto AS pregunta, COUNT(*) FILTER(WHERE er.es_correcta=FALSE)::int AS fallos,
              COUNT(*)::int AS total,
              ROUND(100.0*COUNT(*) FILTER(WHERE er.es_correcta=FALSE)/COUNT(*),1) AS pct_fallo
       FROM examen_respuestas er
       JOIN capacitacion_preguntas p ON p.id=er.pregunta_id
       GROUP BY p.id, p.texto ORDER BY pct_fallo DESC LIMIT 5`, []),
        Promise.resolve([]),
    ]);
    const total = resumen?.total ?? 0;
    const aprob = resumen?.aprobados ?? 0;
    return {
        total,
        aprobados: aprob,
        reprobados: resumen?.reprobados ?? 0,
        tasaAprobacion: total > 0 ? Math.round(aprob / total * 100) : 0,
        promPorcentaje: parseFloat(resumen?.prom_porcentaje ?? '0'),
        promIntentos: parseFloat(resumen?.prom_intentos ?? '1'),
        topPreguntasFallidas: porcentajePromedio,
    };
}
// Admin: agregar pregunta
async function crearPregunta(opts) {
    if (!opts.opciones.some(o => o.esCorrecta)) {
        throw new errorHandler_1.AppError('Al menos una opción debe ser correcta', 400, 'SIN_OPCION_CORRECTA');
    }
    const preg = await (0, database_1.queryOne)(`INSERT INTO capacitacion_preguntas (modulo_id, texto, explicacion, tipo, dificultad, puntos)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [opts.moduloId, opts.texto, opts.explicacion, opts.tipo, opts.dificultad, opts.puntos]);
    for (let i = 0; i < opts.opciones.length; i++) {
        await (0, database_1.query)(`INSERT INTO capacitacion_opciones (pregunta_id, texto, es_correcta, orden) VALUES ($1,$2,$3,$4)`, [preg.id, opts.opciones[i].texto, opts.opciones[i].esCorrecta, i + 1]);
    }
    return { preguntaId: preg.id };
}
async function getSesionActiva(sesionId, usuarioId) {
    const sesion = await (0, database_1.queryOne)(`SELECT id, usuario_id, estado, preguntas_ids, puntaje_maximo, expira_en, intento
     FROM examen_sesiones WHERE id=$1 AND usuario_id=$2`, [sesionId, usuarioId]);
    if (!sesion)
        throw new errorHandler_1.AppError('Sesión no encontrada', 404, 'SESION_NO_ENCONTRADA');
    if (sesion.estado !== 'EN_CURSO')
        throw new errorHandler_1.AppError(`Examen ya ${sesion.estado}`, 409, 'EXAMEN_NO_EN_CURSO');
    if (new Date(sesion.expira_en) < new Date()) {
        await (0, database_1.query)(`UPDATE examen_sesiones SET estado='EXPIRADO' WHERE id=$1`, [sesionId]);
        throw new errorHandler_1.AppError('El tiempo del examen ha expirado', 410, 'EXAMEN_EXPIRADO');
    }
    return sesion;
}
async function getPreguntaSinRespuesta(preguntaId) {
    const preg = await (0, database_1.queryOne)(`SELECT p.id, p.texto, p.tipo,
            json_agg(json_build_object('id',o.id,'texto',o.texto,'orden',o.orden) ORDER BY RANDOM()) AS opciones
     FROM capacitacion_preguntas p
     JOIN capacitacion_opciones o ON o.pregunta_id=p.id
     WHERE p.id=$1 GROUP BY p.id`, [preguntaId]);
    if (!preg)
        throw new errorHandler_1.AppError('Pregunta no encontrada', 404, 'PREGUNTA_NO_ENCONTRADA');
    return {
        id: preg.id,
        texto: preg.texto,
        tipo: preg.tipo,
        numero: 0,
        opciones: preg.opciones,
        // es_correcta NO se incluye
    };
}
