'use client'

import { authedFetch, ensureRoleSession } from '@/lib/session'

/**
 * Cliente del Dashboard Financiero (Hito 13 — RODAID PAY). Consume
 * /api/pagos/resumen (admin y dueños de talleres) y el barrido de pagos
 * pendientes /api/v1/admin/pagos/liquidar (admin).
 */

export interface ResumenFinanciero {
  alcance: 'global' | 'aliado'
  moneda: 'ARS'
  totalRecaudado: number
  comisionesRodaid: number
  pagosAliados: { total: number; pagado: number; pendiente: number }
  disputasAbiertas: number
  detalle: {
    escrowCompletadasBruto: number
    escrowComisiones: number
    tasasCitPagadas: number
    tasasCitComisionRodaid: number
    liquidacionesVendedorPendientes: number
  }
}

export interface LiquidarResultado {
  procesadas: number
  listas: string[]
}

/**
 * Cola de Pagos: liquidaciones LISTA_PARA_PAGO con su destino ya congelado.
 * MercadoPago no expone ninguna API de payout a un CBU/alias de tercero (ver
 * compensaciones.service.ts), así que el pago real lo ejecuta un empleado de
 * cuentas por fuera del sistema, y confirma el resultado desde acá.
 */
export interface LiquidacionListaParaPago {
  id: string
  tipo:
    | 'VENDEDOR'
    | 'ALIADO_RETRIBUCION'
    | 'ALIADO_FEE_VERIFICACION'
    | 'ALIADO_FEE_LOGISTICA'
    | 'ALIADO_FEE_EXITO'
  beneficiarioId: string
  beneficiarioTipo: string
  monto: number
  cbuDestino: string | null
  aliasDestino: string | null
  titularDestino: string | null
  createdAt: string
}

export interface ConfirmarPagoInput {
  resultado: 'PAGADA' | 'FALLIDA'
  referencia?: string
  motivo?: string
}

async function leer<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detalle = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(detalle?.message ?? `HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

/** Garantiza una sesion con rol admin o aliado para operar el dashboard. */
export async function ensurePagosSession() {
  return ensureRoleSession(['admin', 'aliado'], 'admin')
}

export async function obtenerResumen(): Promise<ResumenFinanciero> {
  return leer(await authedFetch('/api/pagos/resumen'))
}

export async function liquidarPendientes(): Promise<LiquidarResultado> {
  return leer(
    await authedFetch('/api/v1/admin/pagos/liquidar', { method: 'POST' })
  )
}

export async function obtenerColaPagos(): Promise<{
  liquidaciones: LiquidacionListaParaPago[]
}> {
  return leer(await authedFetch('/api/v1/admin/pagos/liquidaciones'))
}

export async function confirmarPagoLiquidacion(
  liquidacionId: string,
  input: ConfirmarPagoInput
): Promise<{ estado: 'PAGADA' | 'FALLIDA' }> {
  return leer(
    await authedFetch(`/api/v1/admin/pagos/liquidaciones/${liquidacionId}/confirmar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
  )
}
