"use strict";
// ─── RODAID · Gestión del Convenio Técnico MinSeg ────────
//
// Formaliza el proceso de habilitación del canal mTLS con
// el Ministerio de Seguridad de Mendoza para intercambio
// de información sobre bicicletas robadas.
//
// ══ FASES DEL CONVENIO ═══════════════════════════════════
//
//   INICIADO       → Convenio borrador enviado a Dir. TI
//   CSR_GENERADO   → Certificado SSL generado, listo para firmar
//   EN_REVISION    → ← ESTADO ACTUAL (EXP-MINSEG-2026-0847)
//                      CSR enviado, MinSeg en revisión legal/técnica
//   CERT_EMITIDO   → MinSeg firma y emite el certificado
//   SANDBOX_ACTIVO → Canal de prueba activo (sandbox.seguridadmendoza.gob.ar)
//   PRODUCCION     → Canal productivo activo con mTLS real
//
// ══ ARQUITECTURA mTLS ════════════════════════════════════
//
//   MinSeg (cliente)          RODAID (servidor)
//       │                          │
//       │── TLS ClientHello ──────▶│
//       │◀─ ServerCert (rodaid.net)│
//       │── ClientCert (minseg.gob)│  ← el certificado que MinSeg presenta
//       │── HMAC-SHA256(payload) ──│  ← segunda capa de firma
//       │── X-MinSeg-Nonce ────────│  ← anti-replay 5 minutos
//       │◀─ Response JSON ─────────│
//
// ══ ENDPOINTS HABILITADOS CON MTLS ═══════════════════════
//
//   GET  /api/v1/minseg/health          ← sin auth (health probe)
//   POST /api/v1/minseg/consulta-serial ← mTLS + HMAC requerido
//   POST /api/v1/minseg/alerta-robo     ← mTLS + HMAC requerido
//   POST /api/v1/minseg/recuperacion    ← mTLS + HMAC requerido
//   GET  /api/v1/minseg/protocolo-spec  ← API key MinSeg requerida
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConvenioChecklist = getConvenioChecklist;
exports.validarApiKeyMinSeg = validarApiKeyMinSeg;
exports.registrarApiKeyMinSeg = registrarApiKeyMinSeg;
exports.simularClienteMinSeg = simularClienteMinSeg;
const database_1 = require("../config/database");
const logger_1 = require("../middleware/logger");
const crypto_1 = __importDefault(require("crypto"));
// ══════════════════════════════════════════════════════════
// DEFINICIÓN DEL CHECKLIST POR FASE
// ══════════════════════════════════════════════════════════
function buildChecklist(convenio) {
    const f = convenio.fase;
    const completada = (fase) => {
        const orden = [
            'INICIADO', 'CSR_GENERADO', 'EN_REVISION', 'CERT_EMITIDO', 'SANDBOX_ACTIVO', 'PRODUCCION',
        ];
        const actualIdx = orden.indexOf(f);
        const faseIdx = orden.indexOf(fase);
        return faseIdx < actualIdx;
    };
    const enCurso = (fase) => f === fase;
    return [
        {
            fase: 'INICIADO',
            titulo: 'Inicio del convenio',
            descripcion: 'Establecimiento del contacto institucional y firma del convenio marco',
            faseRequerida: null,
            completada: completada('INICIADO'),
            bloqueante: true,
            items: [
                {
                    id: 'ini-1', titulo: 'Nota de intención RODAID', responsable: 'RODAID',
                    descripcion: 'Carta formal a Dir. TI del Ministerio expresando el interés en el intercambio de datos',
                    estado: 'COMPLETADO', completadoEn: '2026-04-15', requerido: true,
                },
                {
                    id: 'ini-2', titulo: 'Reunión técnica inicial', responsable: 'AMBOS',
                    descripcion: 'Reunión de alineamiento técnico para definir el alcance del convenio y los datos a intercambiar',
                    estado: 'COMPLETADO', completadoEn: '2026-05-10', requerido: true,
                },
                {
                    id: 'ini-3', titulo: 'Borrador de convenio técnico', responsable: 'RODAID',
                    descripcion: 'Documento técnico que especifica: endpoints, autenticación, datos compartidos, roles y responsabilidades',
                    estado: 'COMPLETADO', completadoEn: '2026-05-28', requerido: true,
                },
                {
                    id: 'ini-4', titulo: 'Expediente TAD iniciado', responsable: 'RODAID',
                    descripcion: `Expediente abierto en el Ministerio bajo número ${convenio.expedienteNro ?? '(pendiente)'}`,
                    estado: convenio.expedienteNro ? 'COMPLETADO' : 'EN_CURSO',
                    completadoEn: convenio.expedienteNro ? '2026-05-30' : null,
                    notas: convenio.expedienteNro ?? undefined, requerido: true,
                },
            ],
        },
        {
            fase: 'CSR_GENERADO',
            titulo: 'Generación del certificado SSL',
            descripcion: 'RODAID genera su CSR (Certificate Signing Request) para que MinSeg lo firme',
            faseRequerida: 'INICIADO',
            completada: completada('CSR_GENERADO') || enCurso('EN_REVISION'),
            bloqueante: true,
            items: [
                {
                    id: 'csr-1', titulo: 'CSR generado con clave 4096 bits', responsable: 'RODAID',
                    descripcion: 'CSR RSA-4096 con CN=rodaid.net / O=RODAID SAS / OU=Certificacion Bicicletas / C=AR / ST=Mendoza',
                    estado: 'COMPLETADO', completadoEn: '2026-06-01', requerido: true,
                },
                {
                    id: 'csr-2', titulo: 'Fingerprint SHA-256 verificado', responsable: 'RODAID',
                    descripcion: 'El fingerprint del CSR se comparte con MinSeg para verificar integridad en la entrega',
                    estado: 'COMPLETADO', completadoEn: '2026-06-01', requerido: true,
                },
                {
                    id: 'csr-3', titulo: 'CSR entregado a Dir. TI MinSeg', responsable: 'RODAID',
                    descripcion: 'Envío formal del archivo CSR.pem + fingerprint + especificación técnica del protocolo',
                    estado: convenio.csrEnviadoEn ? 'COMPLETADO' : 'PENDIENTE',
                    completadoEn: convenio.csrEnviadoEn ?? null, requerido: true,
                },
                {
                    id: 'csr-4', titulo: 'Configuración HTTPS en rodaid.net', responsable: 'RODAID',
                    descripcion: 'El servidor de RODAID debe estar configurado para requerir certificado de cliente (mTLS)',
                    estado: 'EN_CURSO', requerido: true,
                    notas: 'Pendiente de certificado final para configurar nginx con ssl_verify_client=on',
                },
            ],
        },
        {
            fase: 'EN_REVISION',
            titulo: 'Revisión legal y técnica — MinSeg',
            descripcion: 'El Ministerio revisa el convenio y firma el certificado SSL de RODAID',
            faseRequerida: 'CSR_GENERADO',
            completada: completada('EN_REVISION'),
            bloqueante: true,
            items: [
                {
                    id: 'rev-1', titulo: 'Revisión legal en Asesoría Jurídica', responsable: 'MINSEG',
                    descripcion: 'La Asesoría Jurídica del Ministerio revisa el convenio técnico y su compatibilidad con la normativa provincial',
                    estado: enCurso('EN_REVISION') ? 'EN_CURSO' : (completada('EN_REVISION') ? 'COMPLETADO' : 'PENDIENTE'),
                    requerido: true,
                    notas: `Expediente ${convenio.expedienteNro ?? 'EXP-MINSEG-2026-0847'} en revisión desde ${convenio.csrEnviadoEn?.slice(0, 10) ?? '2026-06-13'}`,
                },
                {
                    id: 'rev-2', titulo: 'Revisión técnica en Dir. TI', responsable: 'MINSEG',
                    descripcion: 'El equipo técnico del Ministerio valida la especificación del protocolo y los endpoints propuestos',
                    estado: enCurso('EN_REVISION') ? 'EN_CURSO' : (completada('EN_REVISION') ? 'COMPLETADO' : 'PENDIENTE'),
                    requerido: true,
                },
                {
                    id: 'rev-3', titulo: 'Firma del convenio por autoridad ministerial', responsable: 'MINSEG',
                    descripcion: 'El Ministro o funcionario delegado firma el convenio técnico formalizando el intercambio',
                    estado: completada('EN_REVISION') ? 'COMPLETADO' : 'PENDIENTE',
                    requerido: true,
                },
                {
                    id: 'rev-4', titulo: 'Certificado SSL de RODAID emitido por CA MinSeg', responsable: 'MINSEG',
                    descripcion: 'La CA (Certificate Authority) interna del Ministerio firma el CSR de RODAID y emite el certificado',
                    estado: completada('EN_REVISION') ? 'COMPLETADO' : 'PENDIENTE',
                    requerido: true,
                    notas: 'Este certificado es el que habilita el mTLS en producción',
                },
            ],
        },
        {
            fase: 'CERT_EMITIDO',
            titulo: 'Certificado recibido — configurar mTLS',
            descripcion: 'RODAID recibe el certificado firmado por MinSeg y configura el canal mTLS',
            faseRequerida: 'EN_REVISION',
            completada: completada('CERT_EMITIDO'),
            bloqueante: true,
            items: [
                {
                    id: 'cert-1', titulo: 'Certificado RODAID recibido', responsable: 'RODAID',
                    descripcion: 'Recibir el certificado rodaid.net.crt firmado por la CA de MinSeg',
                    estado: completada('CERT_EMITIDO') ? 'COMPLETADO' : (enCurso('CERT_EMITIDO') ? 'EN_CURSO' : 'PENDIENTE'),
                    requerido: true,
                },
                {
                    id: 'cert-2', titulo: 'CA Chain de MinSeg descargada', responsable: 'RODAID',
                    descripcion: 'Descargar la cadena CA del Ministerio para validar los certificados de cliente que presente MinSeg',
                    estado: completada('CERT_EMITIDO') ? 'COMPLETADO' : 'PENDIENTE',
                    requerido: true,
                },
                {
                    id: 'cert-3', titulo: 'Variables de entorno configuradas', responsable: 'RODAID',
                    descripcion: 'Configurar MINSEG_CERT_PEM, MINSEG_KEY_PEM y MINSEG_CA_PEM en el servidor de producción',
                    estado: completada('CERT_EMITIDO') ? 'COMPLETADO' : 'PENDIENTE',
                    requerido: true,
                    notas: 'Railway/Render: agregar como environment variables cifradas',
                },
                {
                    id: 'cert-4', titulo: 'nginx configurado con ssl_verify_client=on', responsable: 'RODAID',
                    descripcion: 'El reverse proxy debe requerir certificado de cliente para /api/v1/minseg/* excepto /health',
                    estado: completada('CERT_EMITIDO') ? 'COMPLETADO' : 'PENDIENTE',
                    requerido: true,
                },
                {
                    id: 'cert-5', titulo: 'API Key de MinSeg registrada en minseg_api_keys', responsable: 'RODAID',
                    descripcion: 'Registrar la API Key que MinSeg usará para las llamadas, con permisos [consulta-serial, alerta-robo, recuperacion]',
                    estado: completada('CERT_EMITIDO') ? 'COMPLETADO' : 'PENDIENTE',
                    requerido: true,
                },
            ],
        },
        {
            fase: 'SANDBOX_ACTIVO',
            titulo: 'Pruebas en ambiente sandbox',
            descripcion: 'Validación end-to-end en sandbox antes de producción',
            faseRequerida: 'CERT_EMITIDO',
            completada: completada('SANDBOX_ACTIVO'),
            bloqueante: true,
            items: [
                {
                    id: 'sb-1', titulo: 'Health check exitoso desde MinSeg sandbox', responsable: 'AMBOS',
                    descripcion: 'MinSeg llama a GET /api/v1/minseg/health con su certificado de sandbox y confirma que responde 200',
                    estado: completada('SANDBOX_ACTIVO') ? 'COMPLETADO' : 'PENDIENTE',
                    requerido: true,
                },
                {
                    id: 'sb-2', titulo: 'Prueba de consulta-serial (20 seriales)', responsable: 'AMBOS',
                    descripcion: 'MinSeg consulta 20 seriales del entorno de prueba incluyendo casos conocidos (con CIT, sin CIT, con denuncia)',
                    estado: completada('SANDBOX_ACTIVO') ? 'COMPLETADO' : 'PENDIENTE',
                    requerido: true,
                },
                {
                    id: 'sb-3', titulo: 'Prueba de alerta-robo (simulada)', responsable: 'AMBOS',
                    descripcion: 'MinSeg envía una alerta de robo de prueba. RODAID verifica que notifica al propietario y registra correctamente',
                    estado: completada('SANDBOX_ACTIVO') ? 'COMPLETADO' : 'PENDIENTE',
                    requerido: true,
                },
                {
                    id: 'sb-4', titulo: 'Prueba de recuperación (simulada)', responsable: 'AMBOS',
                    descripcion: 'MinSeg envía recuperación de prueba. RODAID verifica que notifica al propietario y actualiza el CIT',
                    estado: completada('SANDBOX_ACTIVO') ? 'COMPLETADO' : 'PENDIENTE',
                    requerido: true,
                },
                {
                    id: 'sb-5', titulo: 'Prueba de carga — 100 consultas/hora', responsable: 'RODAID',
                    descripcion: 'Verificar que el sistema responde dentro del SLA (< 2 segundos) bajo la carga esperada de MinSeg',
                    estado: completada('SANDBOX_ACTIVO') ? 'COMPLETADO' : 'PENDIENTE',
                    requerido: false,
                },
                {
                    id: 'sb-6', titulo: 'Pen test del canal mTLS', responsable: 'MINSEG',
                    descripcion: 'Prueba de seguridad del canal: inyección, replay, certificado inválido, rate limiting',
                    estado: completada('SANDBOX_ACTIVO') ? 'COMPLETADO' : 'PENDIENTE',
                    requerido: false,
                    notas: 'Requerido por MinSeg antes del paso a producción',
                },
            ],
        },
        {
            fase: 'PRODUCCION',
            titulo: 'Canal productivo habilitado',
            descripcion: 'mTLS productivo con datos reales de bicicletas robadas',
            faseRequerida: 'SANDBOX_ACTIVO',
            completada: convenio.produccionDesde != null,
            bloqueante: false,
            items: [
                {
                    id: 'prod-1', titulo: 'Certificado producción activo', responsable: 'AMBOS',
                    descripcion: 'Reemplazar certificado sandbox por el de producción en ambos lados',
                    estado: convenio.produccionDesde ? 'COMPLETADO' : 'PENDIENTE',
                    requerido: true,
                },
                {
                    id: 'prod-2', titulo: 'Acta de puesta en marcha firmada', responsable: 'AMBOS',
                    descripcion: 'Documento formal que certifica el inicio del intercambio productivo',
                    estado: convenio.produccionDesde ? 'COMPLETADO' : 'PENDIENTE',
                    requerido: true,
                },
                {
                    id: 'prod-3', titulo: 'Monitoreo y alertas configurados', responsable: 'RODAID',
                    descripcion: 'Health checks cada 5 minutos. Alerta si la latencia supera 3 segundos o si hay errores de autenticación',
                    estado: convenio.produccionDesde ? 'COMPLETADO' : 'PENDIENTE',
                    requerido: true,
                },
            ],
        },
    ];
}
// ══════════════════════════════════════════════════════════
// CALCULAR AVANCE
// ══════════════════════════════════════════════════════════
function calcularAvance(fases) {
    const total = fases.flatMap(f => f.items.filter(i => i.requerido)).length;
    const ok = fases.flatMap(f => f.items.filter(i => i.requerido && i.estado === 'COMPLETADO')).length;
    return total > 0 ? Math.round((ok / total) * 100) : 0;
}
function siguientePasoStr(fases, faseActual) {
    const faseActualChecklist = fases.find(f => f.fase === faseActual);
    if (!faseActualChecklist)
        return 'Ver estado del convenio';
    const pendientePropio = faseActualChecklist.items.find(i => i.requerido && (i.estado === 'PENDIENTE' || i.estado === 'EN_CURSO') && i.responsable !== 'MINSEG');
    if (pendientePropio)
        return `RODAID: ${pendientePropio.titulo}`;
    const pendienteMinSeg = faseActualChecklist.items.find(i => i.requerido && (i.estado === 'PENDIENTE' || i.estado === 'EN_CURSO'));
    if (pendienteMinSeg)
        return `Esperando a MinSeg: ${pendienteMinSeg.titulo}`;
    const siguienteFase = fases.find(f => f.faseRequerida === faseActual);
    if (siguienteFase)
        return `Iniciar fase: ${siguienteFase.titulo}`;
    return 'Canal productivo operativo';
}
// ══════════════════════════════════════════════════════════
// API PÚBLICA
// ══════════════════════════════════════════════════════════
async function getConvenioChecklist() {
    const conv = await (0, database_1.queryOne)(`
    SELECT id::text, fase, expediente_nro,
           csr_enviado_en, cert_emitido_en,
           sandbox_desde, produccion_desde,
           contacto_minseg, email_minseg, notas
    FROM minseg_convenio ORDER BY creado_en DESC LIMIT 1
  `, []);
    if (!conv)
        return null;
    const fases = buildChecklist({
        fase: conv.fase,
        expedienteNro: conv.expediente_nro,
        csrEnviadoEn: conv.csr_enviado_en?.toISOString() ?? null,
        certEmitidoEn: conv.cert_emitido_en?.toISOString() ?? null,
        sandboxDesde: conv.sandbox_desde?.toISOString() ?? null,
        produccionDesde: conv.produccion_desde?.toISOString() ?? null,
    });
    return {
        convenioId: conv.id,
        faseActual: conv.fase,
        expedienteNro: conv.expediente_nro,
        fases,
        siguientePaso: siguientePasoStr(fases, conv.fase),
        porcentaje: calcularAvance(fases),
    };
}
// ══════════════════════════════════════════════════════════
// VALIDAR API KEY DE MINSEG (para middleware mTLS)
// ══════════════════════════════════════════════════════════
const KEY_CACHE = new Map();
async function validarApiKeyMinSeg(rawKey, endpoint) {
    // Hash de la key para comparar contra DB
    const keyHash = crypto_1.default.createHash('sha256').update(rawKey).digest('hex');
    // Cache en memoria (TTL 5min)
    const cached = KEY_CACHE.get(keyHash);
    if (cached) {
        if (cached.expira_en < new Date())
            KEY_CACHE.delete(keyHash);
        else {
            const permiso = endpoint.replace('/api/v1/minseg/', '').split('/')[0];
            if (!cached.permisos.includes(permiso) && !cached.permisos.includes('*')) {
                return { ok: false, motivo: `Sin permiso para ${permiso}` };
            }
            return { ok: true, keyId: keyHash.slice(0, 12), permisos: cached.permisos };
        }
    }
    const key = await (0, database_1.queryOne)(`SELECT key_id, activa, permisos, expira_en
     FROM minseg_api_keys
     WHERE key_hash = $1`, [keyHash]);
    // Modo STUB: aceptar clave de desarrollo
    if (!key) {
        const stubKey = process.env.MINSEG_STUB_KEY ?? 'minseg-dev-key-rodaid';
        if (rawKey === stubKey) {
            return { ok: true, keyId: 'STUB', permisos: ['*'] };
        }
        return { ok: false, motivo: 'API Key no reconocida' };
    }
    if (!key.activa)
        return { ok: false, motivo: 'API Key inactiva' };
    if (key.expira_en < new Date())
        return { ok: false, motivo: 'API Key vencida' };
    // Verificar permiso
    const permiso = endpoint.replace('/api/v1/minseg/', '').split('/')[0];
    if (!key.permisos.includes(permiso) && !key.permisos.includes('*')) {
        return { ok: false, motivo: `Sin permiso para ${permiso}` };
    }
    // Actualizar último uso
    await (0, database_1.query)(`UPDATE minseg_api_keys SET ultimo_uso_en=NOW() WHERE key_id=$1`, [key.key_id]).catch(() => { });
    KEY_CACHE.set(keyHash, { permisos: key.permisos, expira_en: new Date(Date.now() + 5 * 60_000) });
    return { ok: true, keyId: key.key_id, permisos: key.permisos };
}
// ══════════════════════════════════════════════════════════
// REGISTRAR API KEY DE MINSEG
// ══════════════════════════════════════════════════════════
async function registrarApiKeyMinSeg(opts) {
    const rawKey = crypto_1.default.randomBytes(32).toString('hex');
    const keyHash = crypto_1.default.createHash('sha256').update(rawKey).digest('hex');
    const keyId = `minseg-${Date.now().toString(36)}`;
    const expira = opts.expirarEn ?? new Date(Date.now() + 365 * 86400_000);
    await (0, database_1.query)(`
    INSERT INTO minseg_api_keys
      (key_id, key_hash, descripcion, activa, permisos, expira_en)
    VALUES ($1, $2, $3, TRUE, $4::text[], $5)
  `, [keyId, keyHash, opts.descripcion, opts.permisos, expira]);
    logger_1.log.bfa.info({ keyId, permisos: opts.permisos }, '✓ API Key MinSeg registrada');
    return { keyId, rawKey, keyHash };
}
// ══════════════════════════════════════════════════════════
// SIMULAR LLAMADA DE MINSEG (para testing E2E)
// ══════════════════════════════════════════════════════════
async function simularClienteMinSeg(opts) {
    const t0 = Date.now();
    const apiKey = opts.apiKey ?? process.env.MINSEG_STUB_KEY ?? 'minseg-dev-key-rodaid';
    const base = opts.baseUrl ?? 'http://localhost:3000';
    const nonce = new Date().toISOString();
    const serialHash = opts.serial
        ? crypto_1.default.createHash('sha256').update(opts.serial.toUpperCase()).digest('hex')
        : crypto_1.default.createHash('sha256').update('SN-GIANT-002-2021').digest('hex');
    const payloads = {
        'consulta-serial': { serialHash, tipoConsulta: 'VERIFICACION', nonce },
        'alerta-robo': { serialHash, denunciaNro: 'DEN-2026-SIM-001', dependencia: 'Comisaría 1ª San Martín', nonce },
        'recuperacion': { serialHash, denunciaNro: 'DEN-2026-SIM-001', dependencia: 'Comisaría 1ª San Martín', novedades: 'Bicicleta recuperada en operativo', nonce },
        'health': null,
    };
    const hmac = crypto_1.default.createHmac('sha256', apiKey)
        .update(nonce + JSON.stringify(payloads[opts.endpoint] ?? ''))
        .digest('hex');
    const method = opts.endpoint === 'health' ? 'GET' : 'POST';
    const headers = {
        'Content-Type': 'application/json',
        'X-MinSeg-Key': apiKey,
        'X-MinSeg-Firma': hmac,
        'X-MinSeg-Nonce': nonce,
        'User-Agent': 'MinSeg-Client-Simulator/1.0',
    };
    try {
        const res = await fetch(`${base}/api/v1/minseg/${opts.endpoint}`, {
            method,
            headers,
            ...(method === 'POST' ? { body: JSON.stringify(payloads[opts.endpoint]) } : {}),
            signal: AbortSignal.timeout(10_000),
        });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, statusCode: res.status, data, latenciaMs: Date.now() - t0 };
    }
    catch (err) {
        return { ok: false, statusCode: 0, data: { error: err.message }, latenciaMs: Date.now() - t0 };
    }
}
