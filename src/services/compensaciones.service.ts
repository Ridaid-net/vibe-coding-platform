import { getPool, type DbClient } from '@/lib/marketplace'
import { getParametroPricing } from '@/src/services/parametros-pricing.service'

/**
 * RODAID — Hito 13: RODAID PAY. Motor de compensaciones.
 *
 * Concentra la logica de "compensaciones" (deudas a pagar) que se apoya sobre el
 * libro `pagos_liquidaciones` y la bitacora financiera inmutable `pagos_log`:
 *
 *   - registrarLiquidacionVendedor(client, tx)  -> al liberarse el escrow, deja
 *     registrada la deuda con el vendedor (precio - comision). Se llama DENTRO de
 *     la transaccion de liberacion (atomico con el cambio de estado del escrow).
 *
 *   - registrarRetribucionAliado(client, ...)   -> cuando un CIT se emite y valida
 *     con exito, calcula la parte proporcional del Taller Aliado (segun la
 *     configuracion del sistema) y deja registrada la deuda. Se llama DENTRO de la
 *     transaccion de aprobacion del CIT (atomico con la decision del pipeline).
 *
 *   - procesarLiquidacionesPendientes()         -> barrido ASINCRONO que ejecuta
 *     las transferencias pendientes. Si la transferencia al VENDEDOR falla, el
 *     escrow vuelve a DISPUTADA (el dinero queda para revision humana), tal como
 *     exige el hito.
 *
 *   - resumenFinanciero()                       -> Dashboard Financiero: Total
 *     Recaudado, Comisiones RODAID, Pagos a Aliados y Disputas abiertas. Admin ve
 *     todo; un dueño de taller (aliado) ve solo lo suyo.
 *
 * Principio del hito: el dinero NUNCA lo toca la logica de negocio de forma
 * sincrona. Las liquidaciones nacen como deuda (PENDIENTE) y la transferencia se
 * resuelve aparte, de modo asincrono respecto al flujo de negocio.
 */

// ── Configuracion del sistema (parametros_pricing_cit, Fase 0) ───────────────

/** Tasa CIT oficial (ARS) que se cobra por la verificacion (canal MxM). */
export async function getTasaCitARS(): Promise<number> {
  return getParametroPricing('tasa_cit_oficial_ars')
}

/**
 * Parte proporcional de la tasa CIT que le corresponde al Taller Aliado cuando
 * el CIT que validó se emite con exito. Fraccion en [0,1].
 */
export async function getRetribucionAliadoPct(): Promise<number> {
  return getParametroPricing('retribucion_aliado_pct_generico')
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ── Bitacora financiera inmutable ─────────────────────────────────────────────

export interface PagoLogEntrada {
  evento: string
  origenTipo?: string | null
  origenId?: string | null
  monto?: number | null
  beneficiarioId?: string | null
  actorId?: string | null
  actorRol?: string | null
  metadata?: Record<string, unknown>
}

/** Escribe un registro en la bitacora financiera inmutable (append-only). */
export async function registrarPagoLog(
  client: DbClient,
  entrada: PagoLogEntrada
): Promise<void> {
  await client.query(
    `
      INSERT INTO pagos_log
        (evento, origen_tipo, origen_id, monto, beneficiario_id, actor_id, actor_rol, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    `,
    [
      entrada.evento,
      entrada.origenTipo ?? null,
      entrada.origenId ?? null,
      entrada.monto ?? null,
      entrada.beneficiarioId ?? null,
      entrada.actorId ?? null,
      entrada.actorRol ?? null,
      JSON.stringify(entrada.metadata ?? {}),
    ]
  )
}

// ── Liquidacion al VENDEDOR (al liberarse el escrow) ──────────────────────────

export interface LiquidacionVendedorInput {
  transaccionId: string
  vendedorId: string
  montoVendedor: number
  comision: number
}

/**
 * Registra la deuda a pagar al vendedor tras liberarse el escrow. Idempotente
 * (un solo registro por transaccion). Se ejecuta DENTRO de la transaccion de
 * liberacion para que el credito y el cambio de estado del escrow sean atomicos.
 */
export async function registrarLiquidacionVendedor(
  client: DbClient,
  input: LiquidacionVendedorInput
): Promise<string | null> {
  const res = await client.query<{ id: string }>(
    `
      INSERT INTO pagos_liquidaciones
        (tipo, estado, beneficiario_id, beneficiario_tipo, origen_tipo, origen_id,
         transaccion_id, monto, base_calculo, metadata)
      VALUES ('VENDEDOR', 'PENDIENTE', $1, 'usuario', 'ESCROW', $2, $2, $3, $4, $5::jsonb)
      ON CONFLICT (origen_tipo, origen_id, tipo, beneficiario_id) DO NOTHING
      RETURNING id
    `,
    [
      input.vendedorId,
      input.transaccionId,
      input.montoVendedor,
      round2(input.montoVendedor + input.comision),
      JSON.stringify({ comision: round2(input.comision) }),
    ]
  )
  const id = res.rows[0]?.id ?? null
  if (id) {
    await registrarPagoLog(client, {
      evento: 'LIQUIDACION_VENDEDOR_REGISTRADA',
      origenTipo: 'ESCROW',
      origenId: input.transaccionId,
      monto: round2(input.montoVendedor),
      beneficiarioId: input.vendedorId,
      actorRol: 'sistema',
      metadata: { comision: round2(input.comision) },
    })
  }
  return id
}

// ── Fee de Verificacion del CIT Completo (Fase 6, al sellar el checklist) ────

export interface LiquidacionAliadoFeeVerificacionInput {
  escrowTransaccionId: string
  aliadoId: string
  monto: number
}

/**
 * Registra la deuda de RODAID hacia el Taller Aliado por el Fee de
 * Verificacion Tecnica del CIT Completo. Se llama desde
 * aprobarInspeccionFisica (inspeccion.service.ts), en el momento exacto en
 * que el Taller sella el checklist de 20 puntos -- NUNCA desde
 * procesarReservasVencidas (escrow.service.ts), sin importar si la reserva
 * despues se concreta en venta o vence: el sellado es la unica fuente de
 * verdad de "el Taller hizo el trabajo", asi que es el unico lugar que
 * registra este pago. El monto ya viene congelado desde la reserva
 * (escrow_transacciones.fee_verificacion_ars) -- esta funcion no recalcula
 * nada. Idempotente por el mismo indice unico que el resto de las
 * liquidaciones.
 */
export async function registrarLiquidacionAliadoFeeVerificacion(
  client: DbClient,
  input: LiquidacionAliadoFeeVerificacionInput
): Promise<string | null> {
  const res = await client.query<{ id: string }>(
    `
      INSERT INTO pagos_liquidaciones
        (tipo, estado, beneficiario_id, beneficiario_tipo, origen_tipo, origen_id,
         transaccion_id, monto, metadata)
      VALUES ('ALIADO_FEE_VERIFICACION', 'PENDIENTE', $1, 'aliado', 'ESCROW', $2,
              $2, $3, $4::jsonb)
      ON CONFLICT (origen_tipo, origen_id, tipo, beneficiario_id) DO NOTHING
      RETURNING id
    `,
    [
      input.aliadoId,
      input.escrowTransaccionId,
      round2(input.monto),
      JSON.stringify({ concepto: 'fee_verificacion_cit_completo' }),
    ]
  )
  const id = res.rows[0]?.id ?? null
  if (id) {
    await registrarPagoLog(client, {
      evento: 'ALIADO_FEE_VERIFICACION_REGISTRADA',
      origenTipo: 'ESCROW',
      origenId: input.escrowTransaccionId,
      monto: round2(input.monto),
      beneficiarioId: input.aliadoId,
      actorRol: 'sistema',
      metadata: { concepto: 'fee_verificacion_cit_completo' },
    })
  }
  return id
}

// ── Fee de Logistica del CIT Completo (al cerrarse la venta) ────────────────

export interface LiquidacionAliadoFeeLogisticaInput {
  transaccionId: string
  aliadoId: string
  monto: number
}

/**
 * Registra la deuda de RODAID hacia el Taller Aliado por el Fee de Logistica
 * (embalaje) del CIT Completo. Se llama desde confirmarDespachoRemito()
 * (remito.service.ts), en el momento exacto en que el Taller confirma que
 * embalo y despacho la bici (boton "Despacho a Logistica") -- NUNCA desde
 * confirmarEntregaCitCompleto (comprador): el Taller cobra por el trabajo que
 * el efectivamente hizo, sin depender de que un tercero confirme la entrega
 * final dias despues. Mismo criterio que el Fee de Verificacion, que ya se
 * paga al sellar el checklist, no al cerrarse la venta. El monto ya viene
 * congelado desde la reserva (escrow_transacciones.fee_logistica_pagado_taller_ars).
 * Idempotente, mismo indice unico que el resto de las liquidaciones.
 */
export async function registrarLiquidacionAliadoFeeLogistica(
  client: DbClient,
  input: LiquidacionAliadoFeeLogisticaInput
): Promise<string | null> {
  const res = await client.query<{ id: string }>(
    `
      INSERT INTO pagos_liquidaciones
        (tipo, estado, beneficiario_id, beneficiario_tipo, origen_tipo, origen_id,
         transaccion_id, monto, metadata)
      VALUES ('ALIADO_FEE_LOGISTICA', 'PENDIENTE', $1, 'aliado', 'ESCROW', $2,
              $2, $3, $4::jsonb)
      ON CONFLICT (origen_tipo, origen_id, tipo, beneficiario_id) DO NOTHING
      RETURNING id
    `,
    [
      input.aliadoId,
      input.transaccionId,
      round2(input.monto),
      JSON.stringify({ concepto: 'fee_logistica_cit_completo' }),
    ]
  )
  const id = res.rows[0]?.id ?? null
  if (id) {
    await registrarPagoLog(client, {
      evento: 'ALIADO_FEE_LOGISTICA_REGISTRADA',
      origenTipo: 'ESCROW',
      origenId: input.transaccionId,
      monto: round2(input.monto),
      beneficiarioId: input.aliadoId,
      actorRol: 'sistema',
      metadata: { concepto: 'fee_logistica_cit_completo' },
    })
  }
  return id
}

// ── Fee de Exito del CIT Completo (al cerrarse la venta) ────────────────────

export interface LiquidacionAliadoFeeExitoInput {
  transaccionId: string
  aliadoId: string
  monto: number
}

/**
 * Registra la deuda de RODAID hacia el Taller Aliado por su mitad del Fee de
 * Exito del CIT Completo (la otra mitad es ingreso propio de RODAID, no se
 * liquida como deuda). Monto congelado desde la reserva
 * (escrow_transacciones.fee_exito_taller_ars). Idempotente.
 */
export async function registrarLiquidacionAliadoFeeExito(
  client: DbClient,
  input: LiquidacionAliadoFeeExitoInput
): Promise<string | null> {
  const res = await client.query<{ id: string }>(
    `
      INSERT INTO pagos_liquidaciones
        (tipo, estado, beneficiario_id, beneficiario_tipo, origen_tipo, origen_id,
         transaccion_id, monto, metadata)
      VALUES ('ALIADO_FEE_EXITO', 'PENDIENTE', $1, 'aliado', 'ESCROW', $2,
              $2, $3, $4::jsonb)
      ON CONFLICT (origen_tipo, origen_id, tipo, beneficiario_id) DO NOTHING
      RETURNING id
    `,
    [
      input.aliadoId,
      input.transaccionId,
      round2(input.monto),
      JSON.stringify({ concepto: 'fee_exito_cit_completo' }),
    ]
  )
  const id = res.rows[0]?.id ?? null
  if (id) {
    await registrarPagoLog(client, {
      evento: 'ALIADO_FEE_EXITO_REGISTRADA',
      origenTipo: 'ESCROW',
      origenId: input.transaccionId,
      monto: round2(input.monto),
      beneficiarioId: input.aliadoId,
      actorRol: 'sistema',
      metadata: { concepto: 'fee_exito_cit_completo' },
    })
  }
  return id
}

// ── Retribucion al Taller Aliado (al validarse un CIT) ────────────────────────

interface AliadoRetribucion {
  aliadoId: string
  motivo: 'inspeccion_fisica' | 'aliado_servicio'
}

/**
 * Resuelve el Taller Aliado que corresponde retribuir por un CIT validado:
 *   1) el aliado (taller_id) de un acta de inspeccion fisica APROBADA del CIT, o
 *   2) el aliado APROBADO vinculado a la bici por un servicio (preferentemente la
 *      venta) en `aliado_servicios`.
 * Devuelve null si la bici no esta vinculada a ningun aliado (no hay retribucion).
 */
async function resolverAliadoParaRetribucion(
  client: DbClient,
  citId: string,
  bicicletaId: string
): Promise<AliadoRetribucion | null> {
  const acta = await client.query<{ taller_id: string }>(
    `
      SELECT taller_id
      FROM inspecciones_fisicas
      WHERE cit_id = $1 AND resultado = 'APROBADA' AND taller_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [citId]
  )
  if (acta.rows[0]?.taller_id) {
    return { aliadoId: acta.rows[0].taller_id, motivo: 'inspeccion_fisica' }
  }

  const servicio = await client.query<{ aliado_id: string }>(
    `
      SELECT s.aliado_id
      FROM aliado_servicios s
      JOIN aliados a ON a.id = s.aliado_id
      WHERE s.bicicleta_id = $1 AND a.estado = 'aprobado'
      ORDER BY (s.tipo_servicio = 'venta') DESC, s.created_at DESC
      LIMIT 1
    `,
    [bicicletaId]
  )
  if (servicio.rows[0]?.aliado_id) {
    return { aliadoId: servicio.rows[0].aliado_id, motivo: 'aliado_servicio' }
  }
  return null
}

export interface RetribucionAliadoResultado {
  registrada: boolean
  liquidacionId?: string
  aliadoId?: string
  monto?: number
}

/**
 * Calcula y registra la retribucion proporcional al Taller Aliado por un CIT
 * emitido y validado con exito. Idempotente (un solo registro por CIT/aliado).
 * Pensada para llamarse DENTRO de la transaccion de aprobacion del pipeline, de
 * modo que la retribucion sea atomica con la activacion del CIT.
 */
export async function registrarRetribucionAliado(
  client: DbClient,
  input: { citId: string; bicicletaId: string }
): Promise<RetribucionAliadoResultado> {
  const aliado = await resolverAliadoParaRetribucion(
    client,
    input.citId,
    input.bicicletaId
  )
  if (!aliado) {
    return { registrada: false }
  }

  const pct = await getRetribucionAliadoPct()
  const base = await getTasaCitARS()
  const monto = round2(base * pct)
  if (monto <= 0) {
    return { registrada: false }
  }

  const res = await client.query<{ id: string }>(
    `
      INSERT INTO pagos_liquidaciones
        (tipo, estado, beneficiario_id, beneficiario_tipo, origen_tipo, origen_id,
         cit_id, monto, base_calculo, tasa_aplicada, metadata)
      VALUES ('ALIADO_RETRIBUCION', 'PENDIENTE', $1, 'aliado', 'CIT', $2,
              $2, $3, $4, $5, $6::jsonb)
      ON CONFLICT (origen_tipo, origen_id, tipo, beneficiario_id) DO NOTHING
      RETURNING id
    `,
    [
      aliado.aliadoId,
      input.citId,
      monto,
      base,
      pct,
      JSON.stringify({ motivo: aliado.motivo, baseTasaCit: base, pct }),
    ]
  )
  const id = res.rows[0]?.id ?? null
  if (!id) {
    // Ya estaba registrada (reproceso idempotente del pipeline): no duplicar.
    return { registrada: false, aliadoId: aliado.aliadoId, monto }
  }

  await registrarPagoLog(client, {
    evento: 'RETRIBUCION_ALIADO_REGISTRADA',
    origenTipo: 'CIT',
    origenId: input.citId,
    monto,
    beneficiarioId: aliado.aliadoId,
    actorRol: 'sistema',
    metadata: { motivo: aliado.motivo, base, pct },
  })

  return { registrada: true, liquidacionId: id, aliadoId: aliado.aliadoId, monto }
}

// ── Ejecucion de transferencias (barrido asincrono) ───────────────────────────

interface LiquidacionRow {
  id: string
  tipo: 'VENDEDOR' | 'ALIADO_RETRIBUCION'
  beneficiario_id: string
  beneficiario_tipo: string
  transaccion_id: string | null
  cit_id: string | null
  monto: string
}

/**
 * Ejecuta la transferencia real de una liquidacion. En esta plataforma no hay un
 * payout automatico real configurado: la transferencia se "agenda" como deuda a
 * pagar y se marca como ejecutada (modo registro). Si en el futuro se integra un
 * payout de MercadoPago / transferencia bancaria, este es el unico punto a
 * cambiar. Devuelve la referencia de la transferencia o lanza si falla.
 */
async function ejecutarTransferencia(liq: LiquidacionRow): Promise<string> {
  // Punto de integracion del payout real. Hoy registra la transferencia como
  // agendada (la conciliacion la hace finanzas contra este libro). Una integracion
  // futura podria lanzar aqui ante un fallo del proveedor para forzar la disputa.
  return `payout-${liq.tipo.toLowerCase()}-${liq.id}`
}

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

export interface ProcesarLiquidacionesResultado {
  procesadas: number
  pagadas: string[]
  fallidas: string[]
}

/**
 * Barre las liquidaciones PENDIENTE y ejecuta sus transferencias. Cada
 * liquidacion se aisla en su propia transaccion con lock `FOR UPDATE`
 * (idempotente: dos worker no la pagan dos veces). Si la transferencia al
 * VENDEDOR falla, el escrow asociado vuelve a DISPUTADA para revision humana.
 */
export async function procesarLiquidacionesPendientes(
  limite = 100
): Promise<ProcesarLiquidacionesResultado> {
  const pendientes = await getPool().query<{ id: string }>(
    `
      SELECT id FROM pagos_liquidaciones
      WHERE estado = 'PENDIENTE'
      ORDER BY created_at ASC
      LIMIT $1
    `,
    [limite]
  )

  const pagadas: string[] = []
  const fallidas: string[] = []

  for (const { id } of pendientes.rows) {
    try {
      const resultado = await withTx(async (client) => {
        const res = await client.query<LiquidacionRow>(
          `SELECT id, tipo, beneficiario_id, beneficiario_tipo, transaccion_id, cit_id, monto
           FROM pagos_liquidaciones WHERE id = $1 FOR UPDATE`,
          [id]
        )
        const liq = res.rows[0]
        if (!liq) {
          return 'SALTEADA' as const
        }
        // Re-chequear el estado bajo lock (idempotencia).
        const estadoRes = await client.query<{ estado: string }>(
          `SELECT estado FROM pagos_liquidaciones WHERE id = $1`,
          [id]
        )
        if (estadoRes.rows[0]?.estado !== 'PENDIENTE') {
          return 'SALTEADA' as const
        }

        try {
          const ref = await ejecutarTransferencia(liq)
          await client.query(
            `
              UPDATE pagos_liquidaciones
              SET estado = 'PAGADA', transferencia_ref = $2, intentos = intentos + 1,
                  ultimo_error = NULL, pagado_en = NOW(), updated_at = NOW()
              WHERE id = $1
            `,
            [id, ref]
          )
          await registrarPagoLog(client, {
            evento:
              liq.tipo === 'VENDEDOR'
                ? 'LIQUIDACION_VENDEDOR_PAGADA'
                : 'RETRIBUCION_ALIADO_PAGADA',
            origenTipo: liq.cit_id ? 'CIT' : 'ESCROW',
            origenId: liq.cit_id ?? liq.transaccion_id,
            monto: Number(liq.monto),
            beneficiarioId: liq.beneficiario_id,
            actorRol: 'sistema',
            metadata: { transferenciaRef: ref },
          })
          return 'PAGADA' as const
        } catch (transferError) {
          const mensaje =
            transferError instanceof Error
              ? transferError.message
              : String(transferError)
          await client.query(
            `
              UPDATE pagos_liquidaciones
              SET estado = 'FALLIDA', intentos = intentos + 1,
                  ultimo_error = $2, updated_at = NOW()
              WHERE id = $1
            `,
            [id, mensaje.slice(0, 480)]
          )
          await registrarPagoLog(client, {
            evento:
              liq.tipo === 'VENDEDOR'
                ? 'LIQUIDACION_VENDEDOR_FALLIDA'
                : 'RETRIBUCION_ALIADO_FALLIDA',
            origenTipo: liq.cit_id ? 'CIT' : 'ESCROW',
            origenId: liq.cit_id ?? liq.transaccion_id,
            monto: Number(liq.monto),
            beneficiarioId: liq.beneficiario_id,
            actorRol: 'sistema',
            metadata: { error: mensaje.slice(0, 480) },
          })

          // Restriccion del hito: si falla la transferencia al VENDEDOR, el dinero
          // del escrow debe quedar en disputa para revision humana.
          if (liq.tipo === 'VENDEDOR' && liq.transaccion_id) {
            await client.query(
              `
                UPDATE escrow_transacciones
                SET estado = 'DISPUTADA',
                    disputa_motivo = COALESCE(disputa_motivo,
                      'Fallo la transferencia al vendedor; en revision.'),
                    updated_at = NOW()
                WHERE id = $1 AND estado = 'COMPLETADA'
              `,
              [liq.transaccion_id]
            )
            await client.query(
              `
                INSERT INTO escrow_eventos
                  (transaccion_id, tipo, estado_nuevo, actor_rol, metadata)
                VALUES ($1, 'TRANSFERENCIA_VENDEDOR_FALLIDA', 'DISPUTADA', 'sistema', $2::jsonb)
              `,
              [
                liq.transaccion_id,
                JSON.stringify({ liquidacionId: id, error: mensaje.slice(0, 480) }),
              ]
            )
          }
          return 'FALLIDA' as const
        }
      })
      if (resultado === 'PAGADA') pagadas.push(id)
      else if (resultado === 'FALLIDA') fallidas.push(id)
    } catch (error) {
      console.error('[compensaciones] no se pudo procesar la liquidacion', id, error)
      fallidas.push(id)
    }
  }

  return {
    procesadas: pendientes.rows.length,
    pagadas,
    fallidas,
  }
}

// ── Dashboard Financiero ──────────────────────────────────────────────────────

export interface ResumenFinanciero {
  alcance: 'global' | 'aliado'
  moneda: 'ARS'
  totalRecaudado: number
  comisionesRodaid: number
  pagosAliados: {
    total: number
    pagado: number
    pendiente: number
  }
  disputasAbiertas: number
  detalle: {
    escrowCompletadasBruto: number
    escrowComisiones: number
    tasasCitPagadas: number
    tasasCitComisionRodaid: number
    liquidacionesVendedorPendientes: number
  }
}

interface SumaRow {
  bruto: string | null
  comision: string | null
  completadas: string | null
}

/**
 * Arma el Dashboard Financiero. Para un admin el alcance es GLOBAL; para el dueño
 * de un taller (aliado), todo se acota a su aliado (sus retribuciones, sus ventas
 * como vendedor y sus disputas).
 */
export async function resumenFinanciero(opts: {
  rol: string
  usuarioId: string
}): Promise<ResumenFinanciero> {
  const esAdmin = opts.rol === 'admin'
  const pool = getPool()

  // Aliado(s) cuya cuenta duena es el usuario (para el alcance de taller).
  let aliadoIds: string[] = []
  if (!esAdmin) {
    const al = await pool.query<{ id: string }>(
      `SELECT id FROM aliados WHERE usuario_id = $1 AND estado = 'aprobado'`,
      [opts.usuarioId]
    )
    aliadoIds = al.rows.map((r: { id: string }) => r.id)
    if (aliadoIds.length === 0) {
      // Un usuario sin taller solo ve, como mucho, sus propias ventas/disputas.
      aliadoIds = []
    }
  }

  // ── Escrow completado (bruto + comision) ──
  const escrow = esAdmin
    ? await pool.query<SumaRow>(
        `
          SELECT COALESCE(SUM(precio_ars), 0) AS bruto,
                 COALESCE(SUM(comision_rodaid), 0) AS comision,
                 COUNT(*) AS completadas
          FROM escrow_transacciones
          WHERE estado = 'COMPLETADA'
        `
      )
    : await pool.query<SumaRow>(
        `
          SELECT COALESCE(SUM(precio_ars), 0) AS bruto,
                 COALESCE(SUM(comision_rodaid), 0) AS comision,
                 COUNT(*) AS completadas
          FROM escrow_transacciones
          WHERE estado = 'COMPLETADA' AND vendedor_id = $1
        `,
        [opts.usuarioId]
      )
  const escrowBruto = Number(escrow.rows[0]?.bruto ?? 0)
  const escrowComision = Number(escrow.rows[0]?.comision ?? 0)

  // ── Tasas CIT pagadas (canal oficial MxM) ── (solo alcance global / admin)
  let tasasPagadas = 0
  if (esAdmin) {
    const tasas = await pool.query<{ total: string | null }>(
      `SELECT COALESCE(SUM(monto), 0) AS total FROM tasas_cit WHERE estado = 'PAGADA'`
    )
    tasasPagadas = Number(tasas.rows[0]?.total ?? 0)
  }

  // ── Pagos a Aliados (retribuciones) ──
  const retrib = esAdmin
    ? await pool.query<{ estado: string; total: string }>(
        `
          SELECT estado, COALESCE(SUM(monto), 0) AS total
          FROM pagos_liquidaciones
          WHERE tipo = 'ALIADO_RETRIBUCION'
          GROUP BY estado
        `
      )
    : await pool.query<{ estado: string; total: string }>(
        aliadoIds.length
          ? `
              SELECT estado, COALESCE(SUM(monto), 0) AS total
              FROM pagos_liquidaciones
              WHERE tipo = 'ALIADO_RETRIBUCION' AND beneficiario_id = ANY($1::uuid[])
              GROUP BY estado
            `
          : `SELECT NULL::text AS estado, 0::numeric AS total WHERE FALSE`,
        aliadoIds.length ? [aliadoIds] : []
      )

  let aliadosPagado = 0
  let aliadosPendiente = 0
  for (const row of retrib.rows) {
    const monto = Number(row.total)
    if (row.estado === 'PAGADA') aliadosPagado += monto
    else if (row.estado === 'PENDIENTE' || row.estado === 'FALLIDA') {
      aliadosPendiente += monto
    }
  }
  const aliadosTotal = round2(aliadosPagado + aliadosPendiente)

  // La comision de RODAID sobre las tasas = tasa recaudada - retribucion a aliados.
  const tasaComisionRodaid = esAdmin ? round2(tasasPagadas - aliadosTotal) : 0

  // ── Disputas abiertas ──
  const disputas = esAdmin
    ? await pool.query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM escrow_transacciones WHERE estado = 'DISPUTADA'`
      )
    : await pool.query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM escrow_transacciones
         WHERE estado = 'DISPUTADA' AND (vendedor_id = $1 OR comprador_id = $1)`,
        [opts.usuarioId]
      )
  const disputasAbiertas = Number(disputas.rows[0]?.n ?? 0)

  // ── Liquidaciones de vendedor pendientes (deuda viva) ──
  const liqVend = esAdmin
    ? await pool.query<{ total: string }>(
        `SELECT COALESCE(SUM(monto), 0) AS total FROM pagos_liquidaciones
         WHERE tipo = 'VENDEDOR' AND estado IN ('PENDIENTE', 'FALLIDA')`
      )
    : await pool.query<{ total: string }>(
        `SELECT COALESCE(SUM(monto), 0) AS total FROM pagos_liquidaciones
         WHERE tipo = 'VENDEDOR' AND estado IN ('PENDIENTE', 'FALLIDA')
           AND beneficiario_id = $1`,
        [opts.usuarioId]
      )
  const liqVendPendiente = Number(liqVend.rows[0]?.total ?? 0)

  const totalRecaudado = round2(escrowBruto + tasasPagadas)
  const comisionesRodaid = round2(escrowComision + tasaComisionRodaid)

  return {
    alcance: esAdmin ? 'global' : 'aliado',
    moneda: 'ARS',
    totalRecaudado,
    comisionesRodaid,
    pagosAliados: {
      total: aliadosTotal,
      pagado: round2(aliadosPagado),
      pendiente: round2(aliadosPendiente),
    },
    disputasAbiertas,
    detalle: {
      escrowCompletadasBruto: round2(escrowBruto),
      escrowComisiones: round2(escrowComision),
      tasasCitPagadas: round2(tasasPagadas),
      tasasCitComisionRodaid: round2(tasaComisionRodaid),
      liquidacionesVendedorPendientes: round2(liqVendPendiente),
    },
  }
}

/** Cancela las liquidaciones PENDIENTE de una transaccion (p. ej. al reembolsar). */
export async function cancelarLiquidacionesDeTransaccion(
  client: DbClient,
  transaccionId: string,
  motivo: string
): Promise<void> {
  const res = await client.query<{ id: string; monto: string; beneficiario_id: string }>(
    `
      UPDATE pagos_liquidaciones
      SET estado = 'CANCELADA', ultimo_error = $2, updated_at = NOW()
      WHERE transaccion_id = $1 AND estado IN ('PENDIENTE', 'FALLIDA')
      RETURNING id, monto, beneficiario_id
    `,
    [transaccionId, motivo.slice(0, 480)]
  )
  for (const row of res.rows) {
    await registrarPagoLog(client, {
      evento: 'LIQUIDACION_CANCELADA',
      origenTipo: 'ESCROW',
      origenId: transaccionId,
      monto: Number(row.monto),
      beneficiarioId: row.beneficiario_id,
      actorRol: 'sistema',
      metadata: { motivo },
    })
  }
}
