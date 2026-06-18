// ─── RODAID · Servidor mTLS ───────────────────────────────
// Servidor HTTPS independiente que corre en el puerto 8443
// con mutual TLS habilitado para el endpoint seguro del
// Ministerio de Seguridad.
//
// Puerto 8443  — TLS 1.3, requiere cert de cliente (mTLS)
// Puerto 3000  — HTTP normal (JWT, API pública)
//
// Diferencias vs servidor principal:
//   · requestCert: true  → Node.js solicita certificado al cliente
//   · rejectUnauthorized: false → dejamos que el middleware valide
//     con más contexto (logging, DB lookup, rate limit)
//   · Solo expone rutas bajo /api/v1/seguridad/
//   · TLS 1.3 obligatorio (minVersion)
//
// Configuración:
//   MTLS_PORT      = 8443 (default)
//   MTLS_CERT_PATH = certs/server-cert.pem
//   MTLS_KEY_PATH  = certs/server-key.pem
//   MTLS_CA_PATH   = certs/ca-cert.pem
//   MTLS_ALLOW_STUB= true (dev/test sin TLS real)
//
// Deployment con nginx (producción):
//   server {
//     listen 443 ssl;
//     ssl_certificate     /etc/nginx/certs/server-cert.pem;
//     ssl_certificate_key /etc/nginx/certs/server-key.pem;
//     ssl_client_certificate /etc/nginx/certs/rodaid-ca.pem;
//     ssl_verify_client   on;
//     ssl_protocols       TLSv1.3;
//
//     location /api/v1/seguridad/ {
//       proxy_pass http://rodaid-api:3000;
//       proxy_set_header X-SSL-Client-Verify $ssl_client_verify;
//       proxy_set_header X-SSL-Client-DN     $ssl_client_s_dn;
//       proxy_set_header X-SSL-Client-Cert   $ssl_client_escaped_cert;
//     }
//   }

import https       from 'https'
import http        from 'http'
import fs          from 'fs'
import path        from 'path'
import express     from 'express'
import { log }     from './middleware/logger'

const MTLS_PORT  = parseInt(process.env.MTLS_PORT ?? '8443')
const CERT_DIR   = path.join(process.cwd(), 'certs')
const ALLOW_STUB = process.env.MTLS_ALLOW_STUB === 'true'

/**
 * Iniciar el servidor mTLS en el puerto 8443.
 * Solo expone las rutas de seguridad cross-reference.
 */
export async function startMtlsServer(app: express.Application): Promise<https.Server | http.Server> {
  // En modo STUB (sin certs) → HTTP normal en puerto 8443
  if (ALLOW_STUB || !fs.existsSync(path.join(CERT_DIR, 'server-cert.pem'))) {
    log.minseg.warn(
      { port: MTLS_PORT },
      '⚠ mTLS STUB — usando HTTP sin TLS (solo para testing/desarrollo)'
    )
    return new Promise(resolve => {
      const server = http.createServer(app)
      server.listen(MTLS_PORT, () => {
        log.minseg.info({ port: MTLS_PORT }, `⚠ Servidor mTLS STUB escuchando en :${MTLS_PORT}`)
        resolve(server)
      })
    })
  }

  // Modo LIVE — HTTPS con mTLS real
  const tlsOptions: https.ServerOptions = {
    key:  fs.readFileSync(path.join(CERT_DIR, 'server-key.pem')),
    cert: fs.readFileSync(path.join(CERT_DIR, 'server-cert.pem')),
    ca:   fs.readFileSync(path.join(CERT_DIR, 'ca-cert.pem')),

    // Pedir certificado al cliente (mutual TLS)
    requestCert:        true,
    // No rechazar automáticamente — el middleware tiene más contexto
    rejectUnauthorized: false,

    // Solo TLS 1.2+ (preferir 1.3)
    minVersion: 'TLSv1.2',

    // Cipher suites seguros (NIST SP 800-52r2)
    ciphers: [
      'TLS_AES_256_GCM_SHA384',
      'TLS_CHACHA20_POLY1305_SHA256',
      'TLS_AES_128_GCM_SHA256',
      'ECDHE-ECDSA-AES256-GCM-SHA384',
      'ECDHE-RSA-AES256-GCM-SHA384',
    ].join(':'),
  }

  return new Promise((resolve, reject) => {
    const server = https.createServer(tlsOptions, app)
    server.on('error', reject)
    server.listen(MTLS_PORT, () => {
      log.minseg.info(
        { port: MTLS_PORT, tls: 'TLS 1.2+', requestCert: true },
        `🔒 Servidor mTLS escuchando en :${MTLS_PORT}`
      )
      resolve(server)
    })
  })
}

/**
 * Info de configuración del servidor mTLS (para health check).
 */
export function getMtlsServerInfo(): {
  puerto:    number
  modo:      'LIVE' | 'STUB'
  tlsVersion:string
  certPath:  string
  caPath:    string
} {
  const certsExisten = fs.existsSync(path.join(CERT_DIR, 'server-cert.pem'))
  return {
    puerto:     MTLS_PORT,
    modo:       certsExisten && !ALLOW_STUB ? 'LIVE' : 'STUB',
    tlsVersion: 'TLS 1.2+',
    certPath:   path.join(CERT_DIR, 'server-cert.pem'),
    caPath:     path.join(CERT_DIR, 'ca-cert.pem'),
  }
}
