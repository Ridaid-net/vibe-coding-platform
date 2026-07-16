'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Loader2,
  PiggyBank,
  RefreshCw,
  Store,
  Wallet,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  confirmarPagoLiquidacion,
  ensurePagosSession,
  liquidarPendientes,
  obtenerColaPagos,
  obtenerResumen,
  type LiquidacionListaParaPago,
  type ResumenFinanciero,
} from '@/lib/pagos'

const ARS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

/**
 * Dashboard Financiero (Hito 13 — RODAID PAY). Muestra Total Recaudado,
 * Comisiones RODAID, Pagos a Aliados y Disputas abiertas. El admin ve el resumen
 * global y puede ejecutar el barrido de transferencias pendientes; un dueño de
 * taller ve unicamente lo suyo.
 *
 * `puedeAccionar` (default true) gatea las acciones que mutan estado --
 * Marcar listas para pago / Confirmar pago / Reportar fallo -- por encima del
 * chequeo de rol admin. Lo pasa en `false` el tab Finanzas del Admin Dashboard
 * cuando el sub-rol es `auditor` (finanzas:ver sin finanzas:accion); en el uso
 * standalone (/admin/pagos, un dueño de Taller viendo lo suyo) queda en su
 * valor por defecto, sin cambios de comportamiento.
 */
export function PagosDashboard({
  puedeAccionar = true,
}: {
  puedeAccionar?: boolean
} = {}) {
  const [resumen, setResumen] = useState<ResumenFinanciero | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rol, setRol] = useState<string | null>(null)
  const [liquidando, setLiquidando] = useState(false)
  const [cola, setCola] = useState<LiquidacionListaParaPago[] | null>(null)

  const cargar = useCallback(async () => {
    setResumen(null)
    setError(null)
    try {
      const session = await ensurePagosSession()
      setRol(session.rol)
      setResumen(await obtenerResumen())
      if (session.rol === 'admin') {
        setCola((await obtenerColaPagos()).liquidaciones)
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const liquidar = async () => {
    setLiquidando(true)
    try {
      const r = await liquidarPendientes()
      toast.success('Liquidaciones marcadas', {
        description: `${r.listas.length} de ${r.procesadas} quedaron listas para pago manual.`,
      })
      cargar()
    } catch (err) {
      toast.error('No pudimos marcar las liquidaciones', {
        description: (err as Error).message,
      })
    } finally {
      setLiquidando(false)
    }
  }

  const esGlobal = resumen?.alcance === 'global'

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-clay">
            RODAID PAY
          </span>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-ink">
            Dashboard Financiero
          </h1>
          <p className="mt-1 text-sm text-slate-warm">
            {esGlobal
              ? 'Resumen global del motor de pagos y compensaciones.'
              : 'Resumen de tu taller: retribuciones, ventas y disputas.'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={cargar}
            className="inline-flex items-center gap-2 rounded-full border border-ink/15 bg-white px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-ink/40"
          >
            <RefreshCw className="size-4" /> Actualizar
          </button>
          {rol === 'admin' && puedeAccionar && (
            <button
              onClick={liquidar}
              disabled={liquidando}
              className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft disabled:opacity-50"
            >
              {liquidando ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Banknote className="size-4 text-lime" />
              )}
              Marcar listas para pago
            </button>
          )}
        </div>
      </div>

      <div className="mt-8">
        {error ? (
          <div className="rounded-3xl border border-clay/30 bg-clay/5 px-6 py-12 text-center">
            <p className="font-display text-lg font-bold text-ink">
              No pudimos cargar el resumen
            </p>
            <p className="mt-1 text-sm text-slate-warm">{error}</p>
          </div>
        ) : resumen === null ? (
          <div className="flex items-center gap-2 text-sm text-slate-warm">
            <Loader2 className="size-4 animate-spin" /> Cargando…
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metrica
                icono={<PiggyBank className="size-5" />}
                etiqueta={esGlobal ? 'Total Recaudado' : 'Mis ventas (bruto)'}
                valor={ARS.format(resumen.totalRecaudado)}
              />
              <Metrica
                icono={<Wallet className="size-5" />}
                etiqueta="Comisiones RODAID"
                valor={ARS.format(resumen.comisionesRodaid)}
                atenuada={!esGlobal}
              />
              <Metrica
                icono={<Store className="size-5" />}
                etiqueta="Pagos a Aliados"
                valor={ARS.format(resumen.pagosAliados.total)}
                pie={`${ARS.format(resumen.pagosAliados.pendiente)} pendiente`}
              />
              <Metrica
                icono={<AlertTriangle className="size-5" />}
                etiqueta="Disputas abiertas"
                valor={String(resumen.disputasAbiertas)}
                alerta={resumen.disputasAbiertas > 0}
              />
            </div>

            <div className="mt-6 rounded-3xl border border-ink/12 bg-white p-6">
              <h2 className="font-display text-lg font-bold text-ink">Detalle</h2>
              <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                <Detalle
                  k="Escrow completado (bruto)"
                  v={ARS.format(resumen.detalle.escrowCompletadasBruto)}
                />
                <Detalle
                  k="Comisiones de escrow"
                  v={ARS.format(resumen.detalle.escrowComisiones)}
                />
                <Detalle
                  k="Tasas CIT cobradas (MxM)"
                  v={ARS.format(resumen.detalle.tasasCitPagadas)}
                />
                <Detalle
                  k="Comisión RODAID sobre tasas"
                  v={ARS.format(resumen.detalle.tasasCitComisionRodaid)}
                />
                <Detalle
                  k="Pagos a vendedores pendientes"
                  v={ARS.format(resumen.detalle.liquidacionesVendedorPendientes)}
                />
                <Detalle
                  k="Retribuciones a aliados pagadas"
                  v={ARS.format(resumen.pagosAliados.pagado)}
                />
              </dl>
            </div>

            {rol === 'admin' && (
              <ColaPagos cola={cola} onCambio={cargar} puedeAccionar={puedeAccionar} />
            )}
          </>
        )}
      </div>
    </>
  )
}

/**
 * Cola de Pagos: liquidaciones LISTA_PARA_PAGO, con su destino ya congelado
 * (cbu_destino/alias_destino/titular_destino). MercadoPago no expone ninguna
 * API de payout a un CBU/alias de tercero, así que la transferencia real la
 * ejecuta un empleado de cuentas por fuera del sistema — esta lista es donde
 * confirma el resultado.
 */
function ColaPagos({
  cola,
  onCambio,
  puedeAccionar,
}: {
  cola: LiquidacionListaParaPago[] | null
  onCambio: () => void
  puedeAccionar: boolean
}) {
  return (
    <div className="mt-6 rounded-3xl border border-ink/12 bg-white p-6">
      <h2 className="font-display text-lg font-bold text-ink">
        Cola de Pagos
      </h2>
      <p className="mt-1 text-sm text-slate-warm">
        Transferí manualmente (MercadoPago o home banking) y confirmá el
        resultado acá.
      </p>

      {cola === null ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-warm">
          <Loader2 className="size-4 animate-spin" /> Cargando…
        </div>
      ) : cola.length === 0 ? (
        <p className="mt-4 text-sm text-slate-warm">
          No hay liquidaciones esperando pago manual.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {cola.map((liq) => (
            <ColaPagosItem
              key={liq.id}
              liq={liq}
              onConfirmado={onCambio}
              puedeAccionar={puedeAccionar}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function ColaPagosItem({
  liq,
  onConfirmado,
  puedeAccionar,
}: {
  liq: LiquidacionListaParaPago
  onConfirmado: () => void
  puedeAccionar: boolean
}) {
  const [modo, setModo] = useState<'ver' | 'pagada' | 'fallida'>('ver')
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)

  const destino = liq.cbuDestino
    ? `CBU ${liq.cbuDestino}`
    : liq.aliasDestino
      ? `Alias ${liq.aliasDestino}`
      : null

  const confirmar = async (resultado: 'PAGADA' | 'FALLIDA') => {
    setEnviando(true)
    try {
      await confirmarPagoLiquidacion(liq.id, {
        resultado,
        referencia: resultado === 'PAGADA' ? texto || undefined : undefined,
        motivo: resultado === 'FALLIDA' ? texto || undefined : undefined,
      })
      toast.success(
        resultado === 'PAGADA' ? 'Pago confirmado' : 'Fallo reportado',
        {
          description:
            resultado === 'FALLIDA' && liq.tipo === 'VENDEDOR'
              ? 'El escrow del vendedor pasó a disputa para revisión.'
              : undefined,
        }
      )
      onConfirmado()
    } catch (err) {
      toast.error('No pudimos registrar la confirmación', {
        description: (err as Error).message,
      })
    } finally {
      setEnviando(false)
      setModo('ver')
      setTexto('')
    }
  }

  return (
    <li className="rounded-2xl border border-ink/12 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-display text-sm font-semibold text-ink">
            {liq.tipo} · {ARS.format(liq.monto)}
          </p>
          <p className="mt-0.5 text-xs text-slate-warm">
            {destino ? (
              <>
                {destino}
                {liq.titularDestino ? ` — ${liq.titularDestino}` : ''}
              </>
            ) : (
              <span className="font-semibold text-clay">
                Sin datos bancarios cargados
              </span>
            )}
          </p>
        </div>

        {modo === 'ver' && puedeAccionar && (
          <div className="flex gap-2">
            <button
              onClick={() => setModo('pagada')}
              className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-paper transition-colors hover:bg-ink-soft"
            >
              <CheckCircle2 className="size-3.5 text-lime" /> Confirmar pago
            </button>
            <button
              onClick={() => setModo('fallida')}
              className="inline-flex items-center gap-1.5 rounded-full border border-clay/30 px-3 py-1.5 text-xs font-semibold text-clay transition-colors hover:bg-clay/5"
            >
              <XCircle className="size-3.5" /> Reportar fallo
            </button>
          </div>
        )}
      </div>

      {modo !== 'ver' && puedeAccionar && (
        <div className="mt-3 rounded-xl bg-paper-dim px-3 py-2.5">
          <label className="text-xs font-semibold text-slate-warm">
            {modo === 'pagada'
              ? 'Referencia / comprobante (opcional)'
              : 'Motivo del fallo (opcional)'}
          </label>
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className="mt-1 w-full rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink"
            placeholder={modo === 'pagada' ? 'Ej. comprobante #1234' : 'Ej. CBU inexistente'}
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => confirmar(modo === 'pagada' ? 'PAGADA' : 'FALLIDA')}
              disabled={enviando}
              className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-paper disabled:opacity-50"
            >
              {enviando && <Loader2 className="size-3 animate-spin" />}
              Confirmar
            </button>
            <button
              onClick={() => {
                setModo('ver')
                setTexto('')
              }}
              disabled={enviando}
              className="rounded-full border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

function Metrica({
  icono,
  etiqueta,
  valor,
  pie,
  alerta,
  atenuada,
}: {
  icono: React.ReactNode
  etiqueta: string
  valor: string
  pie?: string
  alerta?: boolean
  atenuada?: boolean
}) {
  return (
    <div
      className={`rounded-3xl border bg-white p-5 ${
        alerta ? 'border-clay/40' : 'border-ink/12'
      } ${atenuada ? 'opacity-60' : ''}`}
    >
      <span
        className={`flex size-10 items-center justify-center rounded-xl ${
          alerta ? 'bg-clay/15 text-clay' : 'bg-lime/20 text-ink'
        }`}
      >
        {icono}
      </span>
      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-warm">
        {etiqueta}
      </p>
      <p className="mt-1 font-display text-2xl font-bold text-ink">{valor}</p>
      {pie && <p className="mt-1 text-xs text-slate-warm">{pie}</p>}
    </div>
  )
}

function Detalle({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-ink/8 pb-2">
      <dt className="text-sm text-slate-warm">{k}</dt>
      <dd className="font-display text-sm font-semibold text-ink">{v}</dd>
    </div>
  )
}
