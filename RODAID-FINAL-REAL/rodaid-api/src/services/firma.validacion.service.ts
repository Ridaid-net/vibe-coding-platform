// ─── RODAID · Validación de Firma Pre-BFA ─────────────────
// Ejecuta TODOS los checks de integridad sobre la firma digital
// del CIT antes de autorizar el mint en la Blockchain Federal
// Argentina. Si algún check falla, el mint es BLOQUEADO.
//
// Checks en orden de ejecución:
//
//   CHK-1  FIRMA_EXISTE        — hay entrada en firmas_payload_cit
//   CHK-2  RSA_PSS_OK          — firma RSA-PSS-SHA256 matemáticamente válida
//   CHK-3  CERT_VIGENTE        — certificado no vencido (notBefore ≤ ahora ≤ notAfter)
//   CHK-4  CERT_NO_REVOCADO    — firma no revocada en DB
//   CHK-5  INSPECTOR_ACTIVO    — inspector habilitado y taller activo al momento
//   CHK-6  PUNTOS_SUFICIENTES  — ≥ 16/20 puntos registrados en cit_puntos
//   CHK-7  FOTOS_MINIMAS       — ≥ 1 foto en cit_fotos
//   CHK-8  DJ_FIRMADA          — estado CIT es PENDIENTE (pasó el flujo correcto)
//
// Resultado:
//   aprobado=true  → mint autorizado → acuñarCITEnBFA()
//   aprobado=false → mint BLOQUEADO  → AppError 422 FIRMA_INVALIDA
//   El resultado queda en cit_firma_validaciones para auditoría.
//
// Integración:
//   En finalizarCIT() → antes de acuñarCITEnBFA():
//     const v = await validarFirmaPreBFA(citId)
//     if (!v.aprobado) throw new AppError(v.motivoRechazo, 422, 'FIRMA_INVALIDA')

import crypto            from 'crypto'
import forge             from 'node-forge'
import { query, queryOne } from '../config/database'
import { log }           from '../middleware/logger'
import { AppError }      from '../middleware/errorHandler'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export type CheckId =
  | 'FIRMA_EXISTE'
  | 'RSA_PSS_OK'
  | 'CERT_VIGENTE'
  | 'CERT_NO_REVOCADO'
  | 'INSPECTOR_ACTIVO'
  | 'PUNTOS_SUFICIENTES'
  | 'FOTOS_MINIMAS'
  | 'DJ_FIRMADA'

export interface CheckResult {
  id:        CheckId
  ok:        boolean
  mensaje:   string
  detalle?:  string
  ms?:       number   // tiempo de ejecución del check
}

export interface ValidacionFirmaResult {
  citId:          string
  aprobado:       boolean
  motivoRechazo?: string
  checks:         CheckResult[]
  firmaId?:       string
  payloadHash?:   string
  firmadoEn?:     Date
  validadoEn:     Date
  duracionMs:     number
  validacionId:   string
}

// ══════════════════════════════════════════════════════════
// VALIDADOR PRINCIPAL
// ══════════════════════════════════════════════════════════

export async function validarFirmaPreBFA(citId: string): Promise<ValidacionFirmaResult> {
  const inicio = Date.now()
  const checks: CheckResult[] = []
  let aprobado        = true
  let motivoRechazo: string | undefined
  let firmaId: string | undefined
  let payloadHash: string | undefined
  let firmadoEn: Date | undefined

  // Helper: añadir check y cortar si es bloqueante
  function addCheck(result: CheckResult): boolean {
    checks.push(result)
    if (!result.ok && aprobado) {
      aprobado = false
      motivoRechazo = result.mensaje
    }
    return result.ok
  }

  // ── CHK-1: FIRMA_EXISTE ────────────────────────────────
  const t1 = Date.now()
  const firmaRow = await queryOne<{
    id: string; payload_json: string; firma_base64url: string; cert_pem: string
    cert_serial: string; cert_subject: string; firmado_en: Date; valida_hasta: Date
    revocada: boolean; inspector_id: string | null; payload_hash: string
  }>(
    `SELECT id, payload_json, firma_base64url, cert_pem, cert_serial, cert_subject,
            firmado_en, valida_hasta, revocada, inspector_id, payload_hash
     FROM firmas_payload_cit WHERE cit_id=$1 ORDER BY firmado_en DESC LIMIT 1`,
    [citId]
  )
  addCheck({
    id:      'FIRMA_EXISTE',
    ok:      !!firmaRow,
    mensaje: firmaRow ? '✓ Firma digital registrada en DB' : '✗ El CIT no tiene firma digital. Debe firmarse antes de emitir en BFA.',
    ms:      Date.now() - t1,
  })

  if (!firmaRow) {
    // Sin firma no podemos continuar con otros checks
    return await persistirYRetornar(citId, checks, aprobado, motivoRechazo,
      undefined, undefined, undefined, inicio)
  }

  firmaId    = firmaRow.id
  payloadHash = firmaRow.payload_hash
  firmadoEn  = new Date(firmaRow.firmado_en)

  // ── CHK-2: RSA_PSS_OK — verificar matemáticamente ─────
  const t2 = Date.now()
  let rsaOk = false
  let rsaDetalle: string | undefined
  try {
    const verifier = crypto.createVerify('SHA256')
    verifier.update(firmaRow.payload_json, 'utf8')
    rsaOk = verifier.verify(
      {
        key:        firmaRow.cert_pem,
        padding:    crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      },
      Buffer.from(firmaRow.firma_base64url, 'base64url')
    )
  } catch (err) {
    rsaDetalle = (err as Error).message
    rsaOk = false
  }
  addCheck({
    id:      'RSA_PSS_OK',
    ok:      rsaOk,
    mensaje: rsaOk
      ? `✓ Firma RSA-PSS-SHA256 verificada (cert: ${firmaRow.cert_serial.slice(0, 12)})`
      : `✗ Firma RSA-PSS inválida — el payload pudo haber sido alterado`,
    detalle: rsaDetalle,
    ms:      Date.now() - t2,
  })

  // ── CHK-3: CERT_VIGENTE ────────────────────────────────
  const t3 = Date.now()
  let certVigente = false
  let certVigenteDetalle: string | undefined
  try {
    const cert   = forge.pki.certificateFromPem(firmaRow.cert_pem)
    const ahora  = new Date()
    certVigente  = ahora >= cert.validity.notBefore && ahora <= cert.validity.notAfter
    const diasRestantes = Math.floor(
      (cert.validity.notAfter.getTime() - ahora.getTime()) / 86_400_000
    )
    certVigenteDetalle = certVigente
      ? `Vence el ${cert.validity.notAfter.toISOString().slice(0, 10)} (${diasRestantes} días)`
      : `Venció el ${cert.validity.notAfter.toISOString().slice(0, 10)}`
  } catch (err) {
    certVigenteDetalle = `Error parseando certificado: ${(err as Error).message}`
  }
  addCheck({
    id:      'CERT_VIGENTE',
    ok:      certVigente,
    mensaje: certVigente ? `✓ Certificado vigente` : `✗ Certificado vencido`,
    detalle: certVigenteDetalle,
    ms:      Date.now() - t3,
  })

  // ── CHK-4: CERT_NO_REVOCADO ────────────────────────────
  const t4 = Date.now()
  addCheck({
    id:      'CERT_NO_REVOCADO',
    ok:      !firmaRow.revocada,
    mensaje: !firmaRow.revocada
      ? '✓ Firma no revocada'
      : '✗ Firma revocada — no puede emitirse en BFA',
    ms:      Date.now() - t4,
  })

  // ── CHK-5: INSPECTOR_ACTIVO ────────────────────────────
  const t5 = Date.now()
  let inspActivo = false
  if (firmaRow.inspector_id) {
    const insp = await queryOne<{ activo: boolean; taller_habilitado: boolean }>(
      `SELECT i.activo, (ta.habilitado AND ta.activo) AS taller_habilitado
       FROM inspectores i
       JOIN talleres_aliados ta ON ta.id = i.taller_aliado_id
       WHERE i.id=$1`,
      [firmaRow.inspector_id]
    )
    inspActivo = !!(insp?.activo && insp?.taller_habilitado)
  } else {
    // Firmado con clave RODAID (sin inspectorId específico) — también válido
    inspActivo = true
  }
  addCheck({
    id:      'INSPECTOR_ACTIVO',
    ok:      inspActivo,
    mensaje: inspActivo
      ? '✓ Inspector y taller habilitados'
      : '✗ Inspector deshabilitado o taller inactivo al momento de la emisión',
    ms:      Date.now() - t5,
  })

  // ── CHK-6: PUNTOS_SUFICIENTES (≥ 16/20) ───────────────
  const t6 = Date.now()
  const ptRow = await queryOne<{ puntos_total: number | null }>(
    `SELECT puntos_total FROM cit_puntos WHERE cit_id=$1`,
    [citId]
  )
  const PUNTOS_MINIMOS = 16
  const puntosOk = (ptRow?.puntos_total ?? 0) >= PUNTOS_MINIMOS
  addCheck({
    id:      'PUNTOS_SUFICIENTES',
    ok:      puntosOk,
    mensaje: puntosOk
      ? `✓ Puntos aprobados: ${ptRow?.puntos_total ?? 0}/20`
      : `✗ Puntos insuficientes: ${ptRow?.puntos_total ?? 0}/20 (mínimo ${PUNTOS_MINIMOS})`,
    ms:      Date.now() - t6,
  })

  // ── CHK-7: FOTOS_MINIMAS (≥ 1) ────────────────────────
  const t7 = Date.now()
  const fotosRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM cit_fotos WHERE cit_id=$1`,
    [citId]
  )
  const fotoCount = parseInt(fotosRow?.count ?? '0')
  addCheck({
    id:      'FOTOS_MINIMAS',
    ok:      fotoCount >= 1,
    mensaje: fotoCount >= 1
      ? `✓ Fotos presentes: ${fotoCount}`
      : '✗ Sin fotos de inspección — se requiere al menos 1',
    ms:      Date.now() - t7,
  })

  // ── CHK-8: DJ_FIRMADA (estado PENDIENTE) ───────────────
  const t8 = Date.now()
  const citRow = await queryOne<{ estado: string; puntos_total: number | null }>(
    `SELECT estado, puntos_total FROM cits WHERE id=$1`, [citId]
  )
  const djOk = citRow?.estado === 'PENDIENTE'
  addCheck({
    id:      'DJ_FIRMADA',
    ok:      djOk,
    mensaje: djOk
      ? `✓ CIT en estado PENDIENTE — DJ registrada correctamente`
      : `✗ Estado inesperado: ${citRow?.estado} (se esperaba PENDIENTE)`,
    ms:      Date.now() - t8,
  })

  return await persistirYRetornar(citId, checks, aprobado, motivoRechazo,
    firmaId, payloadHash, firmadoEn, inicio)
}

// ══════════════════════════════════════════════════════════
// PERSISTIR RESULTADO Y RETORNAR
// ══════════════════════════════════════════════════════════

async function persistirYRetornar(
  citId:          string,
  checks:         CheckResult[],
  aprobado:       boolean,
  motivoRechazo:  string | undefined,
  firmaId:        string | undefined,
  payloadHash:    string | undefined,
  firmadoEn:      Date | undefined,
  inicio:         number
): Promise<ValidacionFirmaResult> {
  const duracionMs  = Date.now() - inicio
  const validadoEn  = new Date()

  const get = (id: CheckId) => checks.find(c => c.id === id)?.ok ?? false

  const row = await queryOne<{ id: string }>(
    `INSERT INTO cit_firma_validaciones
       (cit_id, firma_id, payload_hash,
        chk_firma_existe, chk_rsa_pss_ok, chk_cert_vigente, chk_cert_no_revocado,
        chk_inspector_activo, chk_puntos_suficientes, chk_fotos_minimas, chk_dj_firmada,
        aprobado, motivo_rechazo, firmado_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id`,
    [
      citId, firmaId ?? null, payloadHash ?? null,
      get('FIRMA_EXISTE'), get('RSA_PSS_OK'), get('CERT_VIGENTE'), get('CERT_NO_REVOCADO'),
      get('INSPECTOR_ACTIVO'), get('PUNTOS_SUFICIENTES'), get('FOTOS_MINIMAS'), get('DJ_FIRMADA'),
      aprobado, motivoRechazo ?? null, firmadoEn ?? null,
    ]
  )

  const nivel = aprobado ? 'info' : 'warn'
  log.firma[nivel]({
    citId:       citId.slice(0, 8),
    aprobado,
    checksOk:    checks.filter(c => c.ok).length,
    checksFail:  checks.filter(c => !c.ok).length,
    duracionMs,
    motivo:      motivoRechazo,
  }, aprobado ? '✅ Firma validada — BFA autorizado' : `⛔ Firma INVÁLIDA — BFA bloqueado`)

  return {
    citId, aprobado, motivoRechazo, checks,
    firmaId, payloadHash, firmadoEn,
    validadoEn,
    duracionMs,
    validacionId: row!.id,
  }
}

// ══════════════════════════════════════════════════════════
// INTEGRACIÓN: patch de finalizarCIT para incluir validación
// ══════════════════════════════════════════════════════════

/**
 * Wrapper de finalizarCIT con validación pre-BFA incluida.
 * Usar este wrapper en lugar de finalizarCIT directamente.
 *
 * @throws AppError 422 FIRMA_INVALIDA si algún check falla
 */
export async function finalizarCITConValidacion(
  citId:            string,
  propietarioWallet?: string
): Promise<{
  mintResult: Awaited<ReturnType<typeof import('./cit.service').finalizarCIT>>
  validacion: ValidacionFirmaResult
}> {
  // 1. Validar firma ANTES del mint
  const validacion = await validarFirmaPreBFA(citId)

  if (!validacion.aprobado) {
    throw new AppError(
      `Firma digital inválida — BFA bloqueado: ${validacion.motivoRechazo}`,
      422,
      'FIRMA_INVALIDA',
      {
        validacionId: validacion.validacionId,
        checks:       validacion.checks,
        motivoRechazo:validacion.motivoRechazo,
      }
    )
  }

  // 2. Firma válida → mint en BFA
  const { finalizarCIT } = await import('./cit.service')
  const mintResult = await finalizarCIT(citId, propietarioWallet)

  return { mintResult, validacion }
}

// ══════════════════════════════════════════════════════════
// HISTORIAL DE VALIDACIONES
// ══════════════════════════════════════════════════════════

export async function getHistorialValidaciones(citId: string) {
  return query(
    `SELECT id, aprobado, motivo_rechazo,
            chk_firma_existe, chk_rsa_pss_ok, chk_cert_vigente, chk_cert_no_revocado,
            chk_inspector_activo, chk_puntos_suficientes, chk_fotos_minimas, chk_dj_firmada,
            firmado_en, validado_en
     FROM cit_firma_validaciones WHERE cit_id=$1 ORDER BY validado_en DESC`,
    [citId]
  )
}

export async function getEstadisticasValidaciones(dias = 30): Promise<{
  total: number; aprobadas: number; rechazadas: number; tasaAprobacion: number
  motivosRechazo: Array<{ motivo: string; count: number }>
}> {
  const [resumen, motivos] = await Promise.all([
    queryOne<{ total: string; aprob: string }>(
      `SELECT COUNT(*)::text AS total, COUNT(*) FILTER(WHERE aprobado)::text AS aprob
       FROM cit_firma_validaciones WHERE validado_en > NOW()-($1||' days')::interval`, [dias]
    ),
    query<{ motivo: string; count: string }>(
      `SELECT motivo_rechazo AS motivo, COUNT(*)::text AS count
       FROM cit_firma_validaciones
       WHERE NOT aprobado AND motivo_rechazo IS NOT NULL
         AND validado_en > NOW()-($1||' days')::interval
       GROUP BY motivo_rechazo ORDER BY count DESC LIMIT 10`, [dias]
    ),
  ])
  const total = parseInt(resumen?.total ?? '0')
  const aprob = parseInt(resumen?.aprob ?? '0')
  return {
    total,
    aprobadas:     aprob,
    rechazadas:    total - aprob,
    tasaAprobacion:total > 0 ? Math.round(aprob / total * 100) : 100,
    motivosRechazo:motivos.map(m => ({ motivo: m.motivo, count: parseInt(m.count) })),
  }
}
