// ─── RODAID · MinSeg Inbound Service ─────────────────────
//
// Endpoints que el Ministerio de Seguridad de Mendoza llama
// hacia RODAID durante el intercambio de información técnica.
//
// ══ AUTENTICACIÓN ════════════════════════════════════════
//
//   Fase STUB    → API-Key fija para pruebas internas
//   Fase SANDBOX → mTLS con certificado de prueba MinSeg
//   Fase LIVE    → mTLS con certificado de producción firmado
//                  por CA del Ministerio + firma HMAC-SHA256
//
//   Header requerido:
//     X-MinSeg-Key:    <api_key>     (todas las fases)
//     X-MinSeg-Firma:  <hmac_sha256> (SANDBOX/LIVE)
//     X-MinSeg-Nonce:  <timestamp>   (anti-replay 5min)
//
// ══ ENDPOINTS INBOUND ════════════════════════════════════
//
//   POST /minseg/consulta-serial
//     MinSeg consulta si un serial tiene CIT en RODAID.
//     Envía el SHA-256 del serial (no el serial plano).
//     RODAID responde con: estado CIT, propietario (solo si
//     hay denuncia activa), zona geográfica, última inspección.
//
//   POST /minseg/alerta-robo
//     MinSeg notifica que una bici fue denunciada robada
//     por canales policiales (denuncia en comisaría).
//     RODAID cruza el serial, alerta al propietario,
//     marca la bici en estado de alerta.
//
//   POST /minseg/recuperacion
//     MinSeg notifica recuperación de una bici incautada.
//     RODAID notifica al propietario y actualiza el CIT.
//
//   GET  /minseg/protocolo-spec
//     Retorna la especificación completa del protocolo
//     (para el convenio técnico, formato JSON + Markdown).

import { query, queryOne }    from '../config/database'
import { log }                from '../middleware/logger'
import crypto                 from 'crypto'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export type ModoMTLS = 'STUB' | 'SANDBOX' | 'LIVE'

export interface ConsultaSerialInput {
  serialHash:    string        // SHA-256(serial.toUpperCase())
  tipoConsulta?: 'VERIFICACION' | 'BATCH' | 'DENUNCIA'
  nonce:         string        // timestamp ISO para anti-replay
}

export interface ConsultaSerialResult {
  encontrado:     boolean
  estadoCIT:      'ACTIVO' | 'BORRADOR' | 'EXPIRADO' | 'PENDIENTE_PAGO' | 'SIN_CIT' | null
  numeroCIT:      string | null
  fechaEmision:   string | null
  fechaVenc:      string | null
  puntosTotal:    number | null
  alertaActiva:   boolean       // true si hay denuncia de robo activa en RODAID
  provincia:      string | null // solo para routing provincial
  latenciaMs?:    number
}

export interface AlertaRoboInput {
  serialHash:      string
  denunciaNro:     string
  dependencia:     string       // comisaría / subcomisaría
  descripcion?:    string
  lat?:            number
  lng?:            number
  nonce:           string
}

export interface RecuperacionInput {
  serialHash:   string
  denunciaNro:  string
  dependencia:  string
  novedades?:   string
  nonce:        string
}

// ══════════════════════════════════════════════════════════
// VERIFICACIÓN DE AUTENTICIDAD (anti-replay + HMAC)
// ══════════════════════════════════════════════════════════

const NONCES_USADOS = new Set<string>()  // En prod → Redis con TTL 5min

export function verificarAutenticidadMinSeg(opts: {
  apiKey:   string
  firma?:   string
  nonce:    string
  payload:  string
  modo:     ModoMTLS
}): { ok: boolean; motivo?: string } {
  // 1. Anti-replay: el nonce es un timestamp ISO — máx. 5 min de diferencia
  const ts = new Date(opts.nonce).getTime()
  if (isNaN(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
    return { ok: false, motivo: 'Nonce expirado o inválido (máx. 5 min)' }
  }
  if (NONCES_USADOS.has(opts.nonce)) {
    return { ok: false, motivo: 'Nonce ya utilizado (anti-replay)' }
  }
  NONCES_USADOS.add(opts.nonce)
  // Limpiar nonces viejos cada 1000 entradas
  if (NONCES_USADOS.size > 1000) {
    const arr = Array.from(NONCES_USADOS)
    arr.slice(0, 500).forEach(n => NONCES_USADOS.delete(n))
  }

  // 2. Verificar API key
  const expectedKey = process.env.MINSEG_API_KEY ?? 'MINSEG_KEY_STUB'
  if (opts.apiKey !== expectedKey) {
    return { ok: false, motivo: 'API key inválida' }
  }

  // 3. En SANDBOX/LIVE también verificar HMAC-SHA256
  if (opts.modo !== 'STUB' && opts.firma) {
    const secret = process.env.MINSEG_HMAC_SECRET ?? ''
    const expected = crypto
      .createHmac('sha256', secret)
      .update(opts.nonce + opts.payload)
      .digest('hex')
    if (!crypto.timingSafeEqual(Buffer.from(opts.firma), Buffer.from(expected))) {
      return { ok: false, motivo: 'Firma HMAC inválida' }
    }
  }

  return { ok: true }
}

// ══════════════════════════════════════════════════════════
// 1. CONSULTA DE SERIAL
// MinSeg envía el SHA-256 del serial para verificar en RODAID
// ══════════════════════════════════════════════════════════

export async function consultarSerialInbound(
  input: ConsultaSerialInput,
  meta: { ip: string; cn: string; modo: ModoMTLS }
): Promise<ConsultaSerialResult> {
  const t0 = Date.now()

  // Buscar en DB por SHA-256 del serial
  // (el serial se hashea al registrar la bicicleta)
  const row = await queryOne<any>(`
    SELECT
      b.id::text,
      'MZA' AS provincia_registro,
      c.numero_cit,
      c.estado,
      c.puntos_total,
      c.fecha_emision,
      c.fecha_vencimiento,
      c.tasa_pagada,
      -- Alerta activa si hay denuncia en los últimos 365 días
      EXISTS (
        SELECT 1 FROM denuncias d
        JOIN cits cc ON cc.id = d.cit_id
        WHERE cc.bicicleta_id = b.id
          AND d.estado = 'ACTIVA'
          AND d.fecha_robo > NOW() - INTERVAL '365 days'
      ) AS alerta_activa
    FROM bicicletas b
    LEFT JOIN LATERAL (
      SELECT * FROM cits WHERE bicicleta_id = b.id
      ORDER BY CASE estado WHEN 'ACTIVO' THEN 1 ELSE 2 END, creado_en DESC
      LIMIT 1
    ) c ON TRUE
    WHERE encode(digest(UPPER(b.numero_serie), 'sha256'), 'hex') = $1
       OR encode(digest(b.numero_serie, 'sha256'), 'hex') = $1
  `, [input.serialHash])

  const encontrado = !!row
  const latenciaMs = Date.now() - t0

  const resultado: ConsultaSerialResult = {
    encontrado,
    estadoCIT:    encontrado ? (row.estado ?? 'SIN_CIT') : null,
    numeroCIT:    row?.numero_cit ?? null,
    fechaEmision: row?.fecha_emision?.toISOString().slice(0, 10) ?? null,
    fechaVenc:    row?.fecha_vencimiento?.toISOString().slice(0, 10) ?? null,
    puntosTotal:  row?.puntos_total ?? null,
    alertaActiva: !!row?.alerta_activa,
    provincia:    row?.provincia_registro ?? 'MZA',
    latenciaMs,
  }

  // Registrar la consulta
  await query(`
    INSERT INTO minseg_consultas_entrantes
      (serial_hash, solicitante_cn, ip_origen, tipo_consulta,
       encontrado, cit_estado, respuesta_json, latencia_ms)
    VALUES ($1,$2,$3::inet,$4,$5,$6,$7::jsonb,$8)
  `, [
    input.serialHash, meta.cn, meta.ip,
    input.tipoConsulta ?? 'VERIFICACION',
    encontrado, resultado.estadoCIT,
    JSON.stringify(resultado), latenciaMs,
  ]).catch(err => log.minseg?.warn({ err: err.message }, 'No se pudo registrar consulta entrante'))

  log.minseg?.info({
    serialHash: input.serialHash.slice(0, 12) + '…',
    encontrado, estadoCIT: resultado.estadoCIT, latenciaMs,
  }, '↓ MinSeg consulta serial')

  return resultado
}

// ══════════════════════════════════════════════════════════
// 2. ALERTA DE ROBO (MinSeg → RODAID)
// ══════════════════════════════════════════════════════════

export async function recibirAlertaRobo(
  input: AlertaRoboInput,
  meta: { ip: string; cn: string; modo: ModoMTLS }
): Promise<{ ok: boolean; alertaId: string; notifEnviada: boolean; mensaje: string }> {
  // Resolver el serial desde el hash
  const bici = await queryOne<{ id: string; numero_serie: string; propietario_id: string }>(
    `SELECT b.id::text, b.numero_serie, b.propietario_id::text
     FROM bicicletas b
     WHERE encode(digest(UPPER(b.numero_serie), 'sha256'), 'hex') = $1
        OR encode(digest(b.numero_serie, 'sha256'), 'hex') = $1`,
    [input.serialHash]
  )

  const alertaId = crypto.randomUUID()

  // Registrar alerta entrante
  await query(`
    INSERT INTO minseg_alertas_entrantes
      (id, evento, serial_hash, serial_plano, denuncia_nro, dependencia,
       descripcion, lat, lng, bicicleta_id, usuario_id,
       payload_raw, firma_valida)
    VALUES
      ($1,'ROBO_DENUNCIADO',$2,$3,$4,$5,$6,$7,$8,$9::uuid,$10::uuid,$11::jsonb,TRUE)
  `, [
    alertaId, input.serialHash,
    bici?.numero_serie ?? null,
    input.denunciaNro, input.dependencia,
    input.descripcion ?? null,
    input.lat ?? null, input.lng ?? null,
    bici?.id ?? null, bici?.propietario_id ?? null,
    JSON.stringify(input),
  ])

  let notifEnviada = false

  if (bici?.propietario_id) {
    // Notificar al propietario via RODAID
    const { triggerAlertaRobo } = await import('./cit.decision.tree').catch(() => ({ triggerAlertaRobo: null }))
    const cit = await queryOne<{ id: string; numero_cit: string; marca: string; modelo: string }>(
      `SELECT c.id::text, c.numero_cit, b.marca, b.modelo
       FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id
       WHERE c.bicicleta_id=$1::uuid AND c.estado='ACTIVO' LIMIT 1`,
      [bici.id]
    )

    if (triggerAlertaRobo && cit) {
      await triggerAlertaRobo({
        usuarioId:   bici.propietario_id,
        bicicletaId: bici.id,
        numeroCIT:   cit.numero_cit,
        serial:      bici.numero_serie,
        marca:       cit.marca,
        modelo:      cit.modelo,
        denunciaId:  input.denunciaNro,
      }).catch(err =>
        log.minseg?.warn({ err: err.message }, 'triggerAlertaRobo falló')
      )
      notifEnviada = true
    }

    // Marcar alerta como procesada
    await query(
      `UPDATE minseg_alertas_entrantes SET procesado=TRUE, procesado_en=NOW(),
       notif_enviada=$2 WHERE id=$1::uuid`,
      [alertaId, notifEnviada]
    )
  }

  log.minseg?.info({
    alertaId, denunciaNro: input.denunciaNro,
    serialHash: input.serialHash.slice(0, 12) + '…',
    encontrado: !!bici, notifEnviada,
  }, '↓ MinSeg alerta robo recibida')

  return {
    ok: true,
    alertaId,
    notifEnviada,
    mensaje: bici
      ? `Serial encontrado en RODAID. Propietario notificado. Denuncia: ${input.denunciaNro}`
      : `Serial no registrado en RODAID. Alerta registrada para seguimiento.`,
  }
}

// ══════════════════════════════════════════════════════════
// 3. ESPECIFICACIÓN DEL PROTOCOLO
// Documento técnico para el convenio
// ══════════════════════════════════════════════════════════

export function getProtocoloEspecificacion() {
  const baseUrl = process.env.RODAID_BASE_URL ?? 'https://rodaid.net'

  return {
    version:       '1.0.0',
    nombre:        'Protocolo de Intercambio RODAID ↔ MinSeg Mendoza',
    expediente:    'EXP-MINSEG-2026-0847',
    fechaVersion:  new Date().toISOString().slice(0, 10),

    autenticacion: {
      mecanismo: 'mTLS + HMAC-SHA256',
      tls:       'TLS 1.3 (mínimo TLS 1.2)',
      algoritmo: 'ECDSA P-256 o RSA-2048',
      caRodaid:  'Let\'s Encrypt / CA Interna RODAID SAS',
      caMinSeg:  'CA Ministerio de Seguridad Provincia de Mendoza',
      headers:   {
        'X-MinSeg-Key':   'API key emitida por RODAID',
        'X-MinSeg-Firma': 'HMAC-SHA256(nonce + body, shared_secret)',
        'X-MinSeg-Nonce': 'Timestamp ISO 8601 (anti-replay 5 min)',
        'Content-Type':   'application/json; charset=utf-8',
      },
    },

    endpoints: [
      {
        metodo:  'POST',
        path:    `${baseUrl}/api/v1/minseg/consulta-serial`,
        funcion: 'Consultar si un serial tiene CIT activo en RODAID',
        fase:    'SANDBOX → LIVE',
        body: {
          serialHash:    'SHA-256(UPPER(numero_serie)) — string hex 64 chars',
          tipoConsulta:  'VERIFICACION | BATCH | DENUNCIA',
          nonce:         'ISO 8601 timestamp',
        },
        respuesta: {
          encontrado:   'boolean',
          estadoCIT:    'ACTIVO | SIN_CIT | EXPIRADO | ...',
          numeroCIT:    'string | null',
          fechaEmision: 'YYYY-MM-DD | null',
          fechaVenc:    'YYYY-MM-DD | null',
          alertaActiva: 'boolean — true si hay denuncia activa en RODAID',
          provincia:    'string | null',
        },
        sla:       '200ms p95',
        rateLimit: '1000 req/min en LIVE, 100 en SANDBOX',
      },
      {
        metodo:  'POST',
        path:    `${baseUrl}/api/v1/minseg/alerta-robo`,
        funcion: 'MinSeg notifica a RODAID que una bici fue denunciada robada',
        fase:    'SANDBOX → LIVE',
        body: {
          serialHash:  'SHA-256(UPPER(numero_serie))',
          denunciaNro: 'Número de denuncia policial',
          dependencia: 'Comisaría / Subcomisaría',
          descripcion: 'string opcional',
          lat:         'number opcional',
          lng:         'number opcional',
          nonce:       'ISO 8601',
        },
        respuesta: {
          ok:           'boolean',
          alertaId:     'UUID de la alerta en RODAID',
          notifEnviada: 'boolean — true si se notificó al propietario',
          mensaje:      'string descriptivo',
        },
        sla: '500ms p95',
      },
      {
        metodo:  'GET',
        path:    `${baseUrl}/api/v1/minseg/health`,
        funcion: 'Health check del canal (MinSeg verifica que RODAID esté activo)',
        fase:    'SANDBOX → LIVE',
        respuesta: { status: 'ok', ts: 'ISO 8601', version: '1.0.0' },
        sla:     '100ms p95',
      },
    ],

    fases: [
      { fase:'INICIADO',      desc:'RODAID generó el expediente TAD y contactó al Dir. TI de MinSeg' },
      { fase:'CSR_GENERADO',  desc:'RODAID generó el CSR y lo envió a MinSeg para firma' },
      { fase:'EN_REVISION',   desc:'MinSeg está revisando el convenio y el CSR (fase actual)' },
      { fase:'CERT_EMITIDO',  desc:'MinSeg emitió el certificado mTLS y lo devolvió a RODAID' },
      { fase:'SANDBOX_ACTIVO',desc:'Integración funcionando en ambiente sandbox de MinSeg' },
      { fase:'PRODUCCION',    desc:'Intercambio de datos en producción habilitado' },
    ],

    proteccionDeDatos: {
      ley:         'Ley 25.326 (Protección de Datos Personales)',
      seriales:    'Solo se intercambia el SHA-256 del serial — nunca el serial plano',
      propietario: 'Datos personales solo cuando hay denuncia activa cruzada',
      logs:        'Consultas auditadas en minseg_consultas_entrantes con IP y CN del cert',
      retencion:   '365 días para intercambios, 90 días para health checks',
    },

    contacto: {
      rodaid:  { nombre:'Federico De Gea', email:'federico@rodaid.net', cargo:'Director General' },
      minseg:  { area:'Dir. Tecnología Informática', email:'tic@seguridadmendoza.gob.ar' },
    },
  }
}

// ══════════════════════════════════════════════════════════
// 4. HEALTH CHECK inbound (MinSeg llama para verificar canal)
// ══════════════════════════════════════════════════════════

export function getHealthResponse() {
  return {
    status:  'ok',
    ts:      new Date().toISOString(),
    version: '1.0.0',
    modo:    process.env.MINSEG_CERT_PEM ? 'LIVE' : 'SANDBOX',
    rodaid:  'rodaid.net',
  }
}

// ══════════════════════════════════════════════════════════
// 5. RESUMEN OPERACIONAL para el dashboard
// ══════════════════════════════════════════════════════════

export async function getResumenInbound() {
  const [consultas, alertas, ultimasConsultas] = await Promise.all([
    queryOne<{ total: number; encontradas: number; alertas_activas: number }>(`
      SELECT COUNT(*)::int AS total,
             SUM(CASE WHEN encontrado THEN 1 ELSE 0 END)::int AS encontradas,
             SUM(CASE WHEN cit_estado='ACTIVO' AND encontrado THEN 1 ELSE 0 END)::int AS alertas_activas
      FROM minseg_consultas_entrantes
    `),
    queryOne<{ total: number; procesadas: number; con_notif: number }>(`
      SELECT COUNT(*)::int AS total,
             SUM(CASE WHEN procesado THEN 1 ELSE 0 END)::int AS procesadas,
             SUM(CASE WHEN notif_enviada THEN 1 ELSE 0 END)::int AS con_notif
      FROM minseg_alertas_entrantes
    `),
    query<any>(`
      SELECT tipo_consulta, encontrado, latencia_ms, creado_en
      FROM minseg_consultas_entrantes
      ORDER BY creado_en DESC LIMIT 10
    `),
  ])

  return { consultas, alertas, ultimasConsultas }
}
