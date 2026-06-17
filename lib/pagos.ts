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
  pagadas: string[]
  fallidas: string[]
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
