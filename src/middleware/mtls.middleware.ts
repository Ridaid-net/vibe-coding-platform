// ─── RODAID · Middleware mTLS ─────────────────────────────
// Valida el certificado de cliente (mutual TLS) para el
// endpoint seguro POST /seguridad/cross-reference.
//
// Flujo de validación:
//   1. El servidor HTTPS pide certificado de cliente (requestCert: true)
//   2. Node.js verifica la firma del cert contra la CA
//   3. Este middleware valida:
//        a. req.socket.authorized === true (cert válido y emitido por CA)
//        b. El CN del cert está en mtls_certificados
//        c. El cert no está revocado (activo=true)
//        d. El cert no expiró (valido_hasta > ahora)
//        e. No excedió la cuota diaria (max_consultas_dia)
//   4. Inyecta req.mtlsClient = { cn, organizacion, permisos }
//
// Configuración del servidor HTTPS:
//   https.createServer({
//     key:  fs.readFileSync('certs/server-key.pem'),
//     cert: fs.readFileSync('certs/server-cert.pem'),
//     ca:   fs.readFileSync('certs/ca-cert.pem'),
//     requestCert:        true,  // pedir cert de cliente
//     rejectUnauthorized: false, // rechazar en middleware (más logging)
//   }, app)
//
// En producción con nginx:
//   ssl_verify_client on;
//   ssl_client_certificate /etc/nginx/certs/rodaid-ca.pem;
//   proxy_set_header X-SSL-Client-Verify $ssl_client_verify;
//   proxy_set_header X-SSL-Client-DN     $ssl_client_s_dn;
//   proxy_set_header X-SSL-Client-Cert   $ssl_client_escaped_cert;

import { Request, Response, NextFunction } from 'express'
import crypto                               from 'crypto'
import forge                                from 'node-forge'
import { queryOne, query }                  from '../config/database'
import { getRedis }                         from '../config/redis'
import { log }                              from '../middleware/logger'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export interface MtlsClient {
  cn:           string
  organizacion: string
  thumbprint:   string
  permisos:     string[]
  certSerial:   string
}

declare global {
  namespace Express {
    interface Request {
      mtlsClient?: MtlsClient
    }
  }
}

// ══════════════════════════════════════════════════════════
// EXTRAER DATOS DEL CERTIFICADO TLS
// ══════════════════════════════════════════════════════════

function extraerDatosCert(req: Request): {
  pem:        string | null
  thumbprint: string | null
  cn:         string | null
  subject:    string | null
  serial:     string | null
  notAfter:   Date   | null
  authorized: boolean
} {
  const socket = req.socket as any

  // 1. Certificado desde socket TLS directo (puerto 8443)
  const tlsCert = socket?.getPeerCertificate?.()
  if (tlsCert && Object.keys(tlsCert).length > 0 && tlsCert.subject) {
    const thumbprint = tlsCert.fingerprint256
      ?.replace(/:/g, '').toLowerCase() ?? null
    return {
      pem:        null,     // no disponible desde getPeerCertificate()
      thumbprint,
      cn:         tlsCert.subject?.CN ?? null,
      subject:    JSON.stringify(tlsCert.subject),
      serial:     tlsCert.serialNumber ?? null,
      notAfter:   tlsCert.valid_to ? new Date(tlsCert.valid_to) : null,
      authorized: socket?.authorized === true,
    }
  }

  // 2. Certificado desde header (nginx con ssl_client_escaped_cert)
  const headerCert = (req.headers['x-ssl-client-cert'] as string)
    ?? (req.headers['x-ssl-client-escaped-cert'] as string)

  if (headerCert) {
    try {
      const pem = decodeURIComponent(headerCert)
      const cert = forge.pki.certificateFromPem(pem)
      const derBytes = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()
      const thumbprint = crypto.createHash('sha256')
        .update(Buffer.from(derBytes, 'binary'))
        .digest('hex')

      const cn      = cert.subject.getField('CN')?.value ?? null
      const org     = cert.subject.getField('O')?.value  ?? null
      const subject = `CN=${cn}, O=${org}`
      const authorized = req.headers['x-ssl-client-verify'] === 'SUCCESS'

      return { pem, thumbprint, cn, subject, serial: cert.serialNumber, notAfter: cert.validity.notAfter, authorized }
    } catch { /* fall through */ }
  }

  // 3. Modo STUB (sin TLS real) — usar header de prueba
  const stubThumb = req.headers['x-stub-cert-thumbprint'] as string | undefined
  if (stubThumb && process.env.MTLS_ALLOW_STUB === 'true') {
    log.minseg.warn({ thumb: stubThumb?.slice(0, 16) }, '⚠ mTLS STUB — sin TLS real')
    return {
      pem:        null,
      thumbprint: stubThumb,
      cn:         'minseg-client-001',
      subject:    'CN=minseg-client-001, O=Ministerio de Seguridad',
      serial:     '01',
      notAfter:   new Date(Date.now() + 730 * 86400000),
      authorized: true,
    }
  }

  return { pem: null, thumbprint: null, cn: null, subject: null, serial: null, notAfter: null, authorized: false }
}

// ══════════════════════════════════════════════════════════
// MIDDLEWARE PRINCIPAL
// ══════════════════════════════════════════════════════════

export async function requireMtls(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ip    = req.ip ?? (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
  const cert  = extraerDatosCert(req)

  // 1. Sin certificado o no autorizado por la CA
  if (!cert.authorized || !cert.thumbprint) {
    log.minseg.warn({ ip, cn: cert.cn }, '⛔ mTLS: certificado ausente o no autorizado por CA')
    res.status(401).json({
      ok:    false,
      error: 'CERTIFICADO_REQUERIDO',
      msg:   'Este endpoint requiere autenticación por certificado de cliente (mTLS). Adjuntá tu certificado emitido por RODAID CA.',
    })
    return
  }

  // 2. Consultar registro en DB
  const registro = await queryOne<{
    organizacion: string; cn: string; permisos: string[]
    activo: boolean; valido_hasta: Date; max_consultas_dia: number
  }>(
    `SELECT organizacion, cn, permisos, activo, valido_hasta, max_consultas_dia
     FROM mtls_certificados WHERE thumbprint=$1`,
    [cert.thumbprint]
  )

  if (!registro) {
    log.minseg.warn({ ip, thumb: cert.thumbprint?.slice(0, 16), cn: cert.cn },
      '⛔ mTLS: certificado no registrado')
    res.status(403).json({
      ok:    false,
      error: 'CERTIFICADO_NO_REGISTRADO',
      msg:   'Certificado no registrado en RODAID. Contactá soporte@rodaid.com.ar para registrarlo.',
    })
    return
  }

  // 3. Certificado activo
  if (!registro.activo) {
    res.status(403).json({ ok: false, error: 'CERTIFICADO_REVOCADO', msg: 'Certificado revocado.' })
    return
  }

  // 4. Certificado no vencido
  if (new Date(registro.valido_hasta) < new Date()) {
    res.status(403).json({ ok: false, error: 'CERTIFICADO_VENCIDO', msg: `Certificado vencido el ${registro.valido_hasta}.` })
    return
  }

  // 5. Rate limit diario (por thumbprint)
  const redis   = getRedis()
  const rateKey = `mtls:daily:${cert.thumbprint}:${new Date().toISOString().slice(0, 10)}`
  const count   = await redis.incr(rateKey).catch(() => 1)
  if (count === 1) await redis.expire(rateKey, 86_400).catch(() => {})
  if (count > registro.max_consultas_dia) {
    log.minseg.warn({ cn: cert.cn, count, max: registro.max_consultas_dia }, '⛔ mTLS: cuota diaria agotada')
    res.status(429).json({
      ok:    false,
      error: 'CUOTA_AGOTADA',
      msg:   `Cuota diaria de ${registro.max_consultas_dia} consultas agotada. Se restablece a las 00:00 ART.`,
      consultasHoy: count,
    })
    return
  }

  // 6. Inyectar contexto del cliente certificado
  req.mtlsClient = {
    cn:           cert.cn!,
    organizacion: registro.organizacion,
    thumbprint:   cert.thumbprint,
    permisos:     registro.permisos,
    certSerial:   cert.serial ?? '',
  }

  log.minseg.info({
    cn:    cert.cn,
    org:   registro.organizacion,
    count: `${count}/${registro.max_consultas_dia}`,
    ip,
  }, '✅ mTLS autenticado')

  next()
}

/** Middleware de IP whitelist (complementa mTLS) */
export async function requireMtlsIpWhitelist(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.mtlsClient) { next(); return }  // requireMtls debe ir antes
  const ip = req.ip ?? (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? ''
  // En producción: verificar IP de MinSeg contra whitelist en DB
  // Por ahora: permitir todas si pasó mTLS
  next()
}
