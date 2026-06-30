'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, RefreshCw, Store, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  ensureAdminSession,
  listarAliados,
  resolverAliado,
  type AliadoPublico,
} from '@/lib/aliados'

const FILTROS = [
  { value: 'pendiente', label: 'Pendientes' },
  { value: 'aprobado', label: 'Aprobados' },
  { value: 'rechazado', label: 'Rechazados' },
  { value: '', label: 'Todos' },
]

/**
 * Panel de administración de Aliados (Hito 11): el admin aprueba o rechaza las
 * solicitudes de talleres/tiendas. Al aprobar, la cuenta dueña recibe el rol
 * 'aliado' y puede inspeccionar sus bicis vinculadas.
 */
export function AliadosAdmin() {
  const [filtro, setFiltro] = useState('pendiente')
  const [aliados, setAliados] = useState<AliadoPublico[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [accionId, setAccionId] = useState<string | null>(null)

  const cargar = useCallback(async (estado: string) => {
    setAliados(null)
    setError(null)
    try {
      await ensureAdminSession()
      setAliados(await listarAliados(estado || undefined))
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    cargar(filtro)
  }, [cargar, filtro])

  const resolver = async (
    id: string,
    accion: 'aprobar' | 'rechazar'
  ) => {
    setAccionId(id)
    try {
      const r = await resolverAliado(id, accion)
      toast.success(accion === 'aprobar' ? 'Aliado aprobado' : 'Solicitud rechazada', {
        description: r.rolAsignado
          ? 'La cuenta dueña ahora tiene el rol aliado.'
          : undefined,
      })
      cargar(filtro)
    } catch (err) {
      toast.error('No pudimos resolver la solicitud', {
        description: (err as Error).message,
      })
    } finally {
      setAccionId(null)
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-clay">
            Administración
          </span>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-ink">
            Solicitudes de Aliados
          </h1>
        </div>
        <button
          onClick={() => cargar(filtro)}
          className="inline-flex items-center gap-2 rounded-full border border-ink/15 bg-white px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-ink/40"
        >
          <RefreshCw className="size-4" /> Actualizar
        </button>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.value || 'todos'}
            onClick={() => setFiltro(f.value)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
              filtro === f.value
                ? 'bg-ink text-paper'
                : 'border border-ink/15 bg-white text-ink hover:border-ink/40'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {error ? (
          <div className="rounded-3xl border border-clay/30 bg-clay/5 px-6 py-12 text-center">
            <p className="font-display text-lg font-bold text-ink">
              No pudimos cargar las solicitudes
            </p>
            <p className="mt-1 text-sm text-slate-warm">{error}</p>
          </div>
        ) : aliados === null ? (
          <div className="flex items-center gap-2 text-sm text-slate-warm">
            <Loader2 className="size-4 animate-spin" /> Cargando…
          </div>
        ) : aliados.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-ink/20 bg-white/50 px-6 py-16 text-center">
            <Store className="mx-auto size-8 text-ink/30" />
            <p className="mt-3 font-display text-lg font-bold text-ink">
              Sin solicitudes
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {aliados.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center gap-4 rounded-2xl border border-ink/12 bg-white p-4"
              >
                <span className="flex size-12 items-center justify-center rounded-xl bg-lime/20 text-ink">
                  <Store className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-display font-semibold text-ink">
                    {a.nombre}{' '}
                    <span className="text-xs font-normal text-slate-warm">({a.tipo})</span>
                  </p>
                  <p className="truncate text-xs text-slate-warm">
                    {a.email}
                    {a.ciudad ? ` · ${a.ciudad}` : ''}
                    {typeof a.serviciosCount === 'number'
                      ? ` · ${a.serviciosCount} bici(s) vinculada(s)`
                      : ''}
                  </p>
                </div>
                <EstadoAliado estado={a.estado} />
                {a.estado === 'pendiente' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => resolver(a.id, 'aprobar')}
                      disabled={accionId === a.id}
                      className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-xs font-semibold text-paper transition-colors hover:bg-ink-soft disabled:opacity-50"
                    >
                      {accionId === a.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Check className="size-3.5 text-lime" />
                      )}
                      Aprobar
                    </button>
                    <button
                      onClick={() => resolver(a.id, 'rechazar')}
                      disabled={accionId === a.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-clay/40 bg-white px-3.5 py-2 text-xs font-semibold text-clay transition-colors hover:bg-clay/5 disabled:opacity-50"
                    >
                      <X className="size-3.5" />
                      Rechazar
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

function EstadoAliado({ estado }: { estado: string }) {
  const map: Record<string, string> = {
    pendiente: 'bg-amber-100 text-amber-700',
    aprobado: 'bg-lime/30 text-ink',
    rechazado: 'bg-clay/15 text-clay',
  }
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold ${map[estado] ?? 'bg-paper-dim text-slate-warm'}`}
    >
      {estado}
    </span>
  )
}
