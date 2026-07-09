import { randomUUID } from 'node:crypto'
import { ApiError, getPool, type DbClient } from '@/lib/marketplace'
import {
  consultarPago,
  crearPreferencia,
  emitirReembolso,
  type PreferenciaCreada,
} from '@/src/services/mercadopago.service'
import { getParametroPricing } from '@/src/services/parametros-pricing.service'
import { evaluarCrossReference } from '@/src/services/seguridad.mock'
import { normalizarSerie } from '@/src/services/ministerio.service'
import { registrarPagoLog } from '@/src/services/compensaciones.service'
import { emitirEvento } from '@/src/services/notification.service'

/**
 * RODAID — Sistema de tarifas de denuncia de robo (Fase 7, caso 3: un
 * tercero denuncia una bici ajena que sospecha robada).
 *
 * Retencion reembolsable de $30.000 ARS (leida en vivo de
 * cit_completo_precio_publicado_ars -- nunca hardcodeada) al momento de
 * denunciar. Maquina de estados:
 *
 *   iniciarDenunciaTercero() (BLOQUEADO, ver TODO)
 *     -> PAGO_PENDIENTE
 *   webhookPagoDenunciaTercero(approved)
 *     -> VERIFICANDO_AUTOMATICO -> ejecutarVerificacionAutomatica()
 *        - riesgo ALTO (ya figuraba robada) -> RESUELTO_REEMBOLSADO (instantaneo)
 *        - riesgo BAJO -> ESPERANDO_POLICIA (policia_vence_en = +3hs)
 *   simularRespuestaPolicia(admin)  -- MOCK, sin canal real
 *     -> RESUELTO_REEMBOLSADO (confirmo robo) | RESUELTO_PERDIDO (confirmo denuncia falsa)
 *   procesarVencimientosDenunciaTercero() (worker, vencido sin respuesta)
 *     -> con bici registrada: ESPERANDO_PROPIETARIO (propietario_vence_en = +3hs)
 *     -> sin bici registrada: RESUELTO_REEMBOLSADO directo (nadie a quien consultarle)
 *   confirmarComoPropietario() -- ENDPOINT REAL de usuario (el dueño es una
 *   cuenta RODAID real, esto no es un mock)
 *     -> RESUELTO_REEMBOLSADO (confirma robo) | RESUELTO_PERDIDO (confirma que NO fue robada)
 *   procesarVencimientosDenunciaTercero() (vencido sin respuesta del propietario)
 *     -> RESUELTO_REEMBOLSADO (el silencio favorece siempre al denunciante)
 *
 * TODO(canal Policia Mendoza): el flujo esta DESHABILITADO DELIBERADAMENTE en
 * produccion. La Policia de Mendoza opera con radiocomunicacion TETRA, no una
 * API consultable -- no existe ningun canal real hoy para resolver
 * ESPERANDO_POLICIA de forma automatica ni semi-automatica
 * (evaluarCrossReference/policia-mendoza.mock.ts son mocks, igual que
 * ejecutarCrossReference en cit-express.service.ts). Federico se reune con el
 * Ministerio de Seguridad el miercoles 2026-07-15; este flujo solo se
 * habilita si ese canal prospera. Sacar el bloqueo de
 * iniciarDenunciaTercero() UNICAMENTE tras confirmacion explicita de
 * Federico -- cambio de codigo deliberado, no un flag/env var togglable
 * (mismo criterio que el bloqueo de VERDE en cit-express.service.ts). El
 * resto de esta maquina de estados (creacion, webhook, verificacion
 * automatica, resolucion, worker de vencimientos, confirmacion real del
 * propietario) ya esta completo e implementado, listo para el dia que el
 * guard se saque -- no hace falta otra pasada de codigo para eso.
 */

export type DenunciaTerceroEstado =
  | 'PAGO_PENDIENTE'
  | 'VERIFICANDO_AUTOMATICO'
  | 'ESPERANDO_POLICIA'
  | 'ESPERANDO_PROPIETARIO'
  | 'RESUELTO_REEMBOLSADO'
  | 'RESUELTO_PERDIDO'

const VENTANA_CONFIRMACION_HORAS = 3

export interface IniciarDenunciaTerceroInput {
  numeroSerie: string
  denuncianteId: string
  denuncianteEmail?: string | null
  denuncianteNombre?: string | null
}

/**
 * Punto de entrada publico -- el unico que un usuario real puede invocar
 * (via POST /api/v1/denuncias-terceros). Ver el TODO al inicio del archivo:
 * DESHABILITADO DELIBERADAMENTE hasta que exista un canal real con la
 * Policia de Mendoza.
 */
export async function iniciarDenunciaTercero(
  _input: IniciarDenunciaTerceroInput
): Promise<never> {
  throw new ApiError(
    403,
    'CANAL_POLICIAL_NO_DISPONIBLE',
    'La denuncia de terceros todavia no esta disponible: falta el canal de confirmacion con la Policia de Mendoza.'
  )
}

// ── Helpers de transaccion + lock ───────────────────────────────────────────────

async function withTx<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

interface DenunciaTerceroRow {
  id: string
  bicicleta_id: string | null
  numero_serie_normalizado: string
  denunciante_id: string
  estado: DenunciaTerceroEstado
  monto_ars: string
  gateway: string
  preference_id: string | null
  payment_id: string | null
  pagado_en: string | null
  cross_reference_resultado: unknown
  policia_consultada_en: string | null
  policia_vence_en: string | null
  policia_confirmo: boolean | null
  propietario_consultado_en: string | null
  propietario_vence_en: string | null
  propietario_confirmo: boolean | null
  resolucion: string | null
  resolucion_motivo: string | null
  resuelto_en: string | null
  refund_id: string | null
  created_at: string
  updated_at: string
}

async function lockDenunciaTercero(client: DbClient, id: string): Promise<DenunciaTerceroRow> {
  const res = await client.query<DenunciaTerceroRow>(
    `SELECT * FROM denuncias_terceros WHERE id = $1 FOR UPDATE`,
    [id]
  )
  const row = res.rows[0]
  if (!row) {
    throw new ApiError(404, 'DENUNCIA_TERCERO_NOT_FOUND', 'No se encontró la denuncia.')
  }
  return row
}

// ── Creacion (implementacion real, inalcanzable mientras el guard esta arriba) ──

/**
 * Implementacion real de la creacion de una denuncia de tercero: resuelve la
 * bici (por numero de serie, nullable -- puede no estar registrada en
 * RODAID), congela el monto en vivo de cit_completo_precio_publicado_ars,
 * genera la preferencia de MercadoPago e inserta en PAGO_PENDIENTE. Ningun
 * codigo llama a esta funcion hoy (iniciarDenunciaTercero, el unico punto de
 * entrada publico, siempre tira antes de llegar aca) -- queda exportada y
 * lista para el dia que el guard se saque.
 */
export async function crearDenunciaTercero(
  input: IniciarDenunciaTerceroInput
): Promise<{ denunciaTerceroId: string; preferencia: PreferenciaCreada; montoARS: number }> {
  const serial = normalizarSerie(input.numeroSerie)
  if (!serial) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Ingresa el numero de serie de la bici.')
  }

  const pool = getPool()
  const biciRes = await pool.query<{ id: string }>(
    `SELECT id FROM bicicletas WHERE UPPER(numero_serie) = $1 LIMIT 1`,
    [serial]
  )
  const bicicletaId = biciRes.rows[0]?.id ?? null

  const montoARS = await getParametroPricing('cit_completo_precio_publicado_ars')
  const denunciaTerceroId = randomUUID()

  const preferencia = await crearPreferencia({
    transaccionId: denunciaTerceroId,
    titulo: `Denuncia de tercero — serie ${serial}`,
    descripcion: 'Retencion reembolsable mientras se confirma la denuncia de robo.',
    precioARS: montoARS,
    compradorEmail: input.denuncianteEmail,
    compradorNombre: input.denuncianteNombre,
    notificationPath: '/api/v1/denuncias-terceros/webhook/mp',
  })
  const gateway = preferencia.gateway === 'STUB' ? 'stub' : 'mercadopago'

  try {
    await pool.query(
      `
        INSERT INTO denuncias_terceros
          (id, bicicleta_id, numero_serie_normalizado, denunciante_id, estado,
           monto_ars, gateway, preference_id)
        VALUES ($1, $2, $3, $4, 'PAGO_PENDIENTE', $5, $6, $7)
      `,
      [denunciaTerceroId, bicicletaId, serial, input.denuncianteId, montoARS, gateway, preferencia.preferenceId]
    )
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(
        409,
        'DENUNCIA_TERCERO_YA_ACTIVA',
        'Ya hay una denuncia de tercero en curso para esta serie.'
      )
    }
    throw error
  }

  return { denunciaTerceroId, preferencia, montoARS }
}

// ── Webhook de pago ──────────────────────────────────────────────────────────

export type AccionWebhookDenunciaTercero = 'APROBADO' | 'RECHAZADO' | 'IGNORADO'

/**
 * Confirma el pago de la retencion y dispara la verificacion automatica.
 * Mismo patron que webhookPago()/webhookPagoDenuncia(): re-consulta el estado
 * real a MercadoPago (nunca el payload), idempotente por payment_id.
 */
export async function webhookPagoDenunciaTercero(input: {
  paymentId: string
  externalReferenceHint?: string | null
}): Promise<{ accion: AccionWebhookDenunciaTercero; denunciaTerceroId: string | null }> {
  const pago = await consultarPago(input.paymentId)
  const denunciaTerceroId = pago.externalReference ?? input.externalReferenceHint ?? null
  if (!denunciaTerceroId) {
    return { accion: 'IGNORADO', denunciaTerceroId: null }
  }

  const accion = await withTx(async (client) => {
    const row = await lockDenunciaTercero(client, denunciaTerceroId)

    if (pago.status === 'approved') {
      if (row.estado !== 'PAGO_PENDIENTE') return 'IGNORADO' as const
      if (row.payment_id === input.paymentId) return 'IGNORADO' as const
      await client.query(
        `
          UPDATE denuncias_terceros
          SET estado = 'VERIFICANDO_AUTOMATICO', payment_id = $2, pagado_en = NOW(), updated_at = NOW()
          WHERE id = $1
        `,
        [denunciaTerceroId, input.paymentId]
      )
      return 'APROBADO' as const
    }

    if (pago.status === 'rejected' || pago.status === 'cancelled') {
      // Se queda en PAGO_PENDIENTE -- binary_mode:false permite reintentar.
      return 'RECHAZADO' as const
    }

    return 'IGNORADO' as const
  })

  if (accion === 'APROBADO') {
    await ejecutarVerificacionAutomatica(denunciaTerceroId).catch((err) =>
      console.error('[denuncia-tercero] fallo la verificacion automatica', err)
    )
  }

  return { accion, denunciaTerceroId }
}

/**
 * Paso 1 del caso 3: consulta automatica contra la misma base de bicis
 * robadas que usa clasificarNivelCIT (evaluarCrossReference, ya existente).
 * Si la bici ya figuraba como robada, la confirmacion es instantanea.
 */
async function ejecutarVerificacionAutomatica(denunciaTerceroId: string): Promise<void> {
  const res = await getPool().query<{ numero_serie_normalizado: string }>(
    `SELECT numero_serie_normalizado FROM denuncias_terceros WHERE id = $1`,
    [denunciaTerceroId]
  )
  const row = res.rows[0]
  if (!row) return

  const resultado = evaluarCrossReference(
    { numeroSerie: row.numero_serie_normalizado },
    new Date().toISOString()
  )

  if (resultado.riesgo === 'ALTO') {
    await resolverDenunciaTercero(denunciaTerceroId, {
      resolucion: 'REEMBOLSADO',
      motivo: 'La bici ya figuraba denunciada en el cross-reference automatico.',
      crossReferenceResultado: resultado,
    })
    return
  }

  await withTx(async (client) => {
    await client.query(
      `
        UPDATE denuncias_terceros
        SET estado = 'ESPERANDO_POLICIA',
            cross_reference_resultado = $2::jsonb,
            policia_consultada_en = NOW(),
            policia_vence_en = NOW() + ($3 || ' hours')::interval,
            updated_at = NOW()
        WHERE id = $1
      `,
      [denunciaTerceroId, JSON.stringify(resultado), String(VENTANA_CONFIRMACION_HORAS)]
    )
  })
}

// ── Resolucion (compartida por cross-reference, policia, propietario y worker) ──

/**
 * Resuelve una denuncia de tercero: REEMBOLSADO devuelve la retencion al
 * denunciante (emitirReembolso, ya existente); PERDIDO la deja capturada y
 * registra el hecho en la bitacora financiera (registrarPagoLog, atomico con
 * el cambio de estado) -- visible en resumenFinanciero(). Idempotente: si ya
 * esta en un estado terminal, no hace nada.
 */
async function resolverDenunciaTercero(
  denunciaTerceroId: string,
  input: {
    resolucion: 'REEMBOLSADO' | 'PERDIDO'
    motivo: string
    crossReferenceResultado?: unknown
  }
): Promise<void> {
  const denuncianteId = await withTx(async (client) => {
    const row = await lockDenunciaTercero(client, denunciaTerceroId)
    if (row.estado === 'RESUELTO_REEMBOLSADO' || row.estado === 'RESUELTO_PERDIDO') {
      return null
    }

    let refundId: string | null = null
    if (input.resolucion === 'REEMBOLSADO' && row.payment_id) {
      const reembolso = await emitirReembolso({ paymentId: row.payment_id, motivo: input.motivo })
      refundId = reembolso.refundId
    }

    if (input.resolucion === 'PERDIDO') {
      await registrarPagoLog(client, {
        evento: 'DENUNCIA_TERCERO_FEE_PERDIDO',
        origenTipo: 'DENUNCIA_TERCERO',
        origenId: denunciaTerceroId,
        monto: Number(row.monto_ars),
        actorRol: 'sistema',
        metadata: { motivo: input.motivo },
      })
    }

    const estadoFinal: DenunciaTerceroEstado =
      input.resolucion === 'REEMBOLSADO' ? 'RESUELTO_REEMBOLSADO' : 'RESUELTO_PERDIDO'

    const updated = await client.query<{ denunciante_id: string }>(
      `
        UPDATE denuncias_terceros
        SET estado = $2,
            resolucion = $3,
            resolucion_motivo = $4,
            refund_id = $5,
            resuelto_en = NOW(),
            cross_reference_resultado = COALESCE($6::jsonb, cross_reference_resultado),
            updated_at = NOW()
        WHERE id = $1
        RETURNING denunciante_id
      `,
      [
        denunciaTerceroId,
        estadoFinal,
        input.resolucion,
        input.motivo,
        refundId,
        input.crossReferenceResultado ? JSON.stringify(input.crossReferenceResultado) : null,
      ]
    )
    return updated.rows[0]?.denunciante_id ?? null
  })

  if (!denuncianteId) return

  await emitirEvento({
    tipo: 'denuncia_tercero.resuelta',
    usuarioId: denuncianteId,
    data: { denunciaTerceroId, resolucion: input.resolucion, motivo: input.motivo },
  }).catch(() => undefined)
}

// ── Paso 2: Policia de Mendoza (MOCK -- admin simula, sin canal real) ───────────

/**
 * Simula la respuesta de la Policia de Mendoza. No hay usuario "policia" real
 * en RODAID ni canal automatico (ver policia-mendoza.mock.ts) -- por eso esto
 * es una accion de ADMIN, no un endpoint de usuario como
 * confirmarComoPropietario().
 */
export async function simularRespuestaPolicia(
  denunciaTerceroId: string,
  confirmaRobo: boolean,
  adminId: string
): Promise<void> {
  await withTx(async (client) => {
    const row = await lockDenunciaTercero(client, denunciaTerceroId)
    if (row.estado !== 'ESPERANDO_POLICIA') {
      throw new ApiError(
        409,
        'ESTADO_INVALIDO',
        'Esta denuncia no esta esperando confirmacion policial.'
      )
    }
    await client.query(
      `UPDATE denuncias_terceros SET policia_confirmo = $2, updated_at = NOW() WHERE id = $1`,
      [denunciaTerceroId, confirmaRobo]
    )
  })

  await resolverDenunciaTercero(denunciaTerceroId, {
    resolucion: confirmaRobo ? 'REEMBOLSADO' : 'PERDIDO',
    motivo: confirmaRobo
      ? `La Policia de Mendoza confirmo el robo (simulado por admin ${adminId} -- sin canal real).`
      : `La Policia de Mendoza confirmo que la denuncia era falsa (simulado por admin ${adminId} -- sin canal real).`,
  })
}

// ── Paso 3: propietario registrado (ENDPOINT REAL de usuario, no mock) ──────────

/**
 * Confirmacion REAL del propietario registrado de la bici -- a diferencia de
 * la Policia, el dueño es una cuenta RODAID de verdad que puede loguearse y
 * responder por si misma, sin depender de ningun canal externo.
 */
export async function confirmarComoPropietario(
  denunciaTerceroId: string,
  usuarioId: string,
  confirmaRobo: boolean
): Promise<void> {
  await withTx(async (client) => {
    const row = await lockDenunciaTercero(client, denunciaTerceroId)
    if (row.estado !== 'ESPERANDO_PROPIETARIO') {
      throw new ApiError(409, 'ESTADO_INVALIDO', 'Esta denuncia no esta esperando tu confirmacion.')
    }
    if (!row.bicicleta_id) {
      throw new ApiError(500, 'BICI_NOT_FOUND', 'Esta denuncia no tiene una bici registrada asociada.')
    }
    const biciRes = await client.query<{ propietario_id: string }>(
      `SELECT propietario_id FROM bicicletas WHERE id = $1`,
      [row.bicicleta_id]
    )
    if (biciRes.rows[0]?.propietario_id !== usuarioId) {
      throw new ApiError(403, 'NOT_OWNER', 'No sos el propietario de esta bicicleta.')
    }
    await client.query(
      `UPDATE denuncias_terceros SET propietario_confirmo = $2, updated_at = NOW() WHERE id = $1`,
      [denunciaTerceroId, confirmaRobo]
    )
  })

  await resolverDenunciaTercero(denunciaTerceroId, {
    resolucion: confirmaRobo ? 'REEMBOLSADO' : 'PERDIDO',
    motivo: confirmaRobo
      ? 'El propietario confirmo que la bici fue robada.'
      : 'El propietario confirmo que la bici NO fue robada (evidencia de mala fe).',
  })
}

// ── Worker de vencimientos ───────────────────────────────────────────────────────

/**
 * Barre ESPERANDO_POLICIA/ESPERANDO_PROPIETARIO vencidas sin respuesta.
 * ESPERANDO_POLICIA vencida: si hay bici registrada, pasa a
 * ESPERANDO_PROPIETARIO (+ notifica al dueño); si no, resuelve REEMBOLSADO
 * directo (no hay a quien consultarle). ESPERANDO_PROPIETARIO vencida:
 * REEMBOLSADO por defecto -- el silencio siempre favorece al denunciante,
 * la perdida del fee se reserva para evidencia real de mala fe.
 */
export async function procesarVencimientosDenunciaTercero(limite = 100): Promise<{
  policiaVencidas: number
  propietarioVencidas: number
}> {
  const pool = getPool()

  const vencidasPolicia = await pool.query<{ id: string; bicicleta_id: string | null }>(
    `
      SELECT id, bicicleta_id FROM denuncias_terceros
      WHERE estado = 'ESPERANDO_POLICIA' AND policia_vence_en <= NOW() AND policia_confirmo IS NULL
      ORDER BY policia_vence_en ASC
      LIMIT $1
    `,
    [limite]
  )
  for (const row of vencidasPolicia.rows) {
    try {
      if (row.bicicleta_id) {
        await withTx(async (client) => {
          await client.query(
            `
              UPDATE denuncias_terceros
              SET estado = 'ESPERANDO_PROPIETARIO',
                  propietario_consultado_en = NOW(),
                  propietario_vence_en = NOW() + ($2 || ' hours')::interval,
                  updated_at = NOW()
              WHERE id = $1 AND estado = 'ESPERANDO_POLICIA'
            `,
            [row.id, String(VENTANA_CONFIRMACION_HORAS)]
          )
        })
        const biciRes = await pool.query<{ propietario_id: string }>(
          `SELECT propietario_id FROM bicicletas WHERE id = $1`,
          [row.bicicleta_id]
        )
        const propietarioId = biciRes.rows[0]?.propietario_id
        if (propietarioId) {
          await emitirEvento({
            tipo: 'denuncia_tercero.confirmar_propietario',
            usuarioId: propietarioId,
            data: { denunciaTerceroId: row.id },
          }).catch(() => undefined)
        }
      } else {
        await resolverDenunciaTercero(row.id, {
          resolucion: 'REEMBOLSADO',
          motivo:
            'La Policia no respondio dentro del plazo y la bici no esta registrada en RODAID (sin dueño a quien consultar).',
        })
      }
    } catch (error) {
      console.error('[denuncia-tercero] fallo procesar vencimiento de policia para', row.id, error)
    }
  }

  const vencidasPropietario = await pool.query<{ id: string }>(
    `
      SELECT id FROM denuncias_terceros
      WHERE estado = 'ESPERANDO_PROPIETARIO' AND propietario_vence_en <= NOW() AND propietario_confirmo IS NULL
      ORDER BY propietario_vence_en ASC
      LIMIT $1
    `,
    [limite]
  )
  for (const row of vencidasPropietario.rows) {
    try {
      await resolverDenunciaTercero(row.id, {
        resolucion: 'REEMBOLSADO',
        motivo: 'El propietario no respondio dentro del plazo (el silencio favorece al denunciante).',
      })
    } catch (error) {
      console.error('[denuncia-tercero] fallo procesar vencimiento de propietario para', row.id, error)
    }
  }

  return {
    policiaVencidas: vencidasPolicia.rows.length,
    propietarioVencidas: vencidasPropietario.rows.length,
  }
}

// ── Consultas de lectura ─────────────────────────────────────────────────────────

export interface DenunciaTerceroResumen {
  id: string
  estado: DenunciaTerceroEstado
  numeroSerie: string
  bicicletaId: string | null
  montoARS: number
  crossReferenceResultado: unknown
  policiaVenceEn: string | null
  policiaConfirmo: boolean | null
  propietarioVenceEn: string | null
  propietarioConfirmo: boolean | null
  resolucion: 'REEMBOLSADO' | 'PERDIDO' | null
  resolucionMotivo: string | null
  resueltoEn: string | null
}

function mapDenunciaTercero(row: DenunciaTerceroRow): DenunciaTerceroResumen {
  return {
    id: row.id,
    estado: row.estado,
    numeroSerie: row.numero_serie_normalizado,
    bicicletaId: row.bicicleta_id,
    montoARS: Number(row.monto_ars),
    crossReferenceResultado: row.cross_reference_resultado,
    policiaVenceEn: row.policia_vence_en,
    policiaConfirmo: row.policia_confirmo,
    propietarioVenceEn: row.propietario_vence_en,
    propietarioConfirmo: row.propietario_confirmo,
    resolucion: row.resolucion === 'REEMBOLSADO' || row.resolucion === 'PERDIDO' ? row.resolucion : null,
    resolucionMotivo: row.resolucion_motivo,
    resueltoEn: row.resuelto_en,
  }
}

export async function obtenerDenunciaTercero(
  id: string,
  denuncianteId: string
): Promise<DenunciaTerceroResumen> {
  const res = await getPool().query<DenunciaTerceroRow>(
    `SELECT * FROM denuncias_terceros WHERE id = $1`,
    [id]
  )
  const row = res.rows[0]
  if (!row) {
    throw new ApiError(404, 'DENUNCIA_TERCERO_NOT_FOUND', 'No se encontró la denuncia.')
  }
  if (row.denunciante_id !== denuncianteId) {
    throw new ApiError(403, 'NOT_DENUNCIANTE', 'No sos quien inicio esta denuncia.')
  }
  return mapDenunciaTercero(row)
}

/** Denuncia de tercero mas reciente sobre una bici, para el dueño (vista del garaje). */
export async function obtenerDenunciaTerceroPorBici(
  bicicletaId: string,
  propietarioId: string
): Promise<DenunciaTerceroResumen | null> {
  const biciRes = await getPool().query<{ propietario_id: string }>(
    `SELECT propietario_id FROM bicicletas WHERE id = $1`,
    [bicicletaId]
  )
  if (biciRes.rows[0]?.propietario_id !== propietarioId) {
    throw new ApiError(403, 'NOT_OWNER', 'No sos el propietario de esta bicicleta.')
  }
  const res = await getPool().query<DenunciaTerceroRow>(
    `SELECT * FROM denuncias_terceros WHERE bicicleta_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [bicicletaId]
  )
  const row = res.rows[0]
  return row ? mapDenunciaTercero(row) : null
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  )
}
