// ─── RODAID · CIT Controller ──────────────────────────────
import { Request, Response } from 'express'
import { z }                  from 'zod'
import { AuthRequest }        from '../types'
import { AppError, asyncHandler } from '../middleware/errorHandler'
import { queryOne }           from '../config/database'
import {
  iniciarCIT, validarCIT, finalizarCIT, getCITById,
  verificarSerial as _verificarSerial, misCITs as _misCITs,
  PuntosInspeccion,
} from '../services/cit.service'
import { validarSerial, vincularValidacionACIT } from '../services/serial.service'

// ══════════════════════════════════════════════════════════
// SCHEMAS Zod
// ══════════════════════════════════════════════════════════

const puntosSchema = z.object({
  serial:           z.boolean(), cuadro:           z.boolean(),
  horquilla:        z.boolean(), manubrio:          z.boolean(),
  freno_delantero:  z.boolean(), freno_trasero:     z.boolean(),
  cables:           z.boolean(), cambio_delantero:  z.boolean(),
  cambio_trasero:   z.boolean(), cassette:          z.boolean(),
  cadena:           z.boolean(), bielas:            z.boolean(),
  pedales:          z.boolean(), rueda_delantera:   z.boolean(),
  rueda_trasera:    z.boolean(), cubiertas:         z.boolean(),
  asiento:          z.boolean(), luces:             z.boolean(),
  accesorios:       z.boolean(), prueba_funcional:  z.boolean(),
})

const iniciarSchema = z.object({
  bicicletaId:       z.string().uuid('bicicletaId debe ser UUID'),
  puntos:            puntosSchema,
  fotosUrls:         z.array(z.string().url()).min(1, 'Al menos 1 foto requerida'),
  firmaInspector:    z.string().min(10, 'Firma digital requerida'),
  djFirmada:         z.literal(true, { errorMap: () => ({ message: 'DJ debe estar firmada (true)' }) }),
  propietarioDNI:    z.string().min(7, 'DNI inválido').max(20).regex(/^\d/, 'DNI debe comenzar con número'),
  propietarioNombre: z.string().min(3, 'Nombre requerido').max(100),
  propietarioGeoLat: z.number().min(-90).max(90).optional(),
  propietarioGeoLng: z.number().min(-180).max(180).optional(),
})

const finalizarSchema = z.object({
  propietarioWallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Wallet Ethereum inválida').optional(),
})

// ══════════════════════════════════════════════════════════
// POST /api/v1/cit/iniciar         [Inspector | Admin]
// ══════════════════════════════════════════════════════════

export const iniciarCITHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)

  // ── 1. Validar payload ────────────────────────────────────
  const data = iniciarSchema.parse(req.body)

  // ── 2. Verificar perfil inspector ────────────────────────
  const inspector = await queryOne<{
    id: string; taller_aliado_id: string; certificado: boolean
  }>(
    `SELECT id, taller_aliado_id, certificado
     FROM inspectores WHERE usuario_id=$1 AND activo=TRUE`,
    [req.user.sub]
  )
  if (!inspector) throw new AppError('No tenés perfil de inspector habilitado', 403, 'NOT_INSPECTOR')

  // ── 3. Obtener número de serie de la bicicleta ───────────
  const bici = await queryOne<{ numero_serie: string; propietario_id: string }>(
    `SELECT numero_serie, propietario_id FROM bicicletas WHERE id=$1`,
    [data.bicicletaId]
  )
  if (!bici) throw new AppError('Bicicleta no encontrada', 404, 'BICICLETA_NOT_FOUND')

  // ── 4. VALIDACIÓN REAL DEL SERIAL ─────────────────────────
  const validacion = await validarSerial({
    serial:            bici.numero_serie,
    propietarioDNI:    data.propietarioDNI,
    propietarioNombre: data.propietarioNombre,
  })

  // Checks bloqueantes → responder con detalle completo (no 500, sino 422)
  if (!validacion.aprobado) {
    const bloqueantes = validacion.checks.filter(c => c.resultado === 'BLOQUEANTE')
    throw new AppError(
      `Validación del serial rechazada: ${bloqueantes[0]?.mensaje ?? 'error de validación'}`,
      422,
      'SERIAL_INVALIDO',
      {
        serial:     validacion.serial,
        resumen:    validacion.resumen,
        checks:     validacion.checks,
        bloqueantes: bloqueantes.map(c => ({ nombre: c.nombre, mensaje: c.mensaje })),
      }
    )
  }

  // ── 5. Emitir advertencias si hay alertas ────────────────
  // (no bloquean pero el inspector es notificado)
  const alertas = validacion.checks.filter(c => c.resultado === 'ALERTA')
  if (alertas.length > 0) {
    req.validacionAlertas = alertas.map(a => a.mensaje)
  }

  // ── 6. Iniciar el CIT ────────────────────────────────────
  // El bicicletaId de la validación coincide con data.bicicletaId (check de existencia pasó)
  const result = await iniciarCIT({
    ...data,
    inspectorId:    inspector.id,
    tallerAliadoId: inspector.taller_aliado_id,
  })

  // ── 7. Vincular la validación de serial al CIT creado ────
  await vincularValidacionACIT(bici.numero_serie, result.citId)

  // ── 8. Respuesta con estado de validación incluido ───────
  res.status(201).json({
    ok: true,
    data: {
      ...result,
      serialValidacion: {
        aprobado:     validacion.aprobado,
        tieneAlertas: validacion.tieneAlertas,
        alertas:      alertas.map(a => a.mensaje),
        checksOK:     validacion.checks.filter(c => c.resultado === 'OK').length,
        checksTotal:  validacion.checks.length,
      },
    },
  })
})

// ══════════════════════════════════════════════════════════
// GET /api/v1/cit/serial/validar   [Inspector — pre-check]
// Validar un serial ANTES de ir al taller (preview sin crear CIT)
// ══════════════════════════════════════════════════════════

export const prevalidarSerialHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { serial, propietarioDNI, propietarioNombre } = z.object({
    serial:            z.string().min(1),
    propietarioDNI:    z.string().min(7),
    propietarioNombre: z.string().min(3).optional().default(''),
  }).parse(req.query)

  const validacion = await validarSerial({
    serial:            serial.trim().toUpperCase(),
    propietarioDNI:    propietarioDNI.trim(),
    propietarioNombre: propietarioNombre,
  })

  res.json({
    ok:   true,
    data: validacion,
  })
})

// ══════════════════════════════════════════════════════════
// POST /api/v1/cit/:id/validar     [Admin | Worker]
// ══════════════════════════════════════════════════════════

export const validarCITHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await validarCIT(req.params.id)

  if (result.aprobadoParaFinalizar && !result.alertaActiva) {
    try {
      const { encolarFinalizar } = await import('../services/queue.service')
      const jobId = await encolarFinalizar(req.params.id)
      Object.assign(result, { finalizarJobId: jobId })
    } catch { /* best-effort */ }
  }

  res.json({ ok: true, data: result })
})

// ══════════════════════════════════════════════════════════
// POST /api/v1/cit/:id/finalizar   [Admin | Worker]
// ══════════════════════════════════════════════════════════

export const finalizarCITHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { propietarioWallet } = finalizarSchema.parse(req.body)
  const result = await finalizarCIT(req.params.id, propietarioWallet)
  res.json({ ok: true, data: result })
})

// ══════════════════════════════════════════════════════════
// GET /api/v1/cit/:id              [Autenticado]
// ══════════════════════════════════════════════════════════

export const getCITHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const cit = await getCITById(req.params.id, req.user?.sub)
  res.json({ ok: true, data: cit })
})

// ══════════════════════════════════════════════════════════
// GET /api/v1/cit/verificar/:serial  [Público]
// ══════════════════════════════════════════════════════════

export const verificarSerialHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await _verificarSerial(decodeURIComponent(req.params.serial))
  res.json({ ok: true, data: result })
})

// ══════════════════════════════════════════════════════════
// GET /api/v1/cit/mis-cits           [Autenticado]
// ══════════════════════════════════════════════════════════

export const misCITsHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const cits = await _misCITs(req.user.sub)
  res.json({ ok: true, data: cits })
})

// ══════════════════════════════════════════════════════════
// POST /api/v1/cit/:id/denunciar     [Autenticado — propietario]
// ══════════════════════════════════════════════════════════

export const denunciarRoboHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const { motivo } = z.object({ motivo: z.string().min(10) }).parse(req.body)

  const cit = await queryOne<{ id: string; estado: string }>(
    `SELECT id, estado FROM cits WHERE id=$1 AND propietario_id=$2`,
    [req.params.id, req.user.sub]
  )
  if (!cit) throw new AppError('CIT no encontrado', 404)
  if (cit.estado !== 'ACTIVO') throw new AppError('Solo se pueden denunciar CITs activos', 400, 'CIT_NOT_ACTIVE')

  await queryOne(`UPDATE cits SET estado='BLOQUEADO',actualizado_en=NOW() WHERE id=$1`, [cit.id])
  res.json({ ok: true, data: {
    citId: cit.id, estado: 'BLOQUEADO', motivo,
    mensaje: 'CIT bloqueado · Ministerio de Seguridad Mendoza notificado',
  }})
})
