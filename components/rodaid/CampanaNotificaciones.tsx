'use client'
import { useState, useEffect, useRef } from 'react'
import { Bell, X, CheckCheck, AlertTriangle, ShieldCheck, ShoppingBag, Activity } from 'lucide-react'
import { authedFetch, getSession } from '@/lib/session'
import Link from 'next/link'

interface Notif {
  id: string
  tipo: string
  titulo: string
  mensaje: string
  leida: boolean
  url: string | null
  created_at: string
}

function IconoTipo({ tipo }: { tipo: string }) {
  if (tipo.includes('denuncia') || tipo.includes('GOV')) return <AlertTriangle className="size-4 text-red-500" />
  if (tipo.includes('cit') || tipo.includes('inspeccion')) return <ShieldCheck className="size-4 text-[#2BBCB8]" />
  if (tipo.includes('pago') || tipo.includes('venta')) return <ShoppingBag className="size-4 text-[#F47B20]" />
  return <Activity className="size-4 text-[#0F1E35]" />
}

export function CampanaNotificaciones() {
  const [notifs, setNotifs] = useState<Notif[]>([])
  const [abierto, setAbierto] = useState(false)
  const [cargando, setCargando] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const sesion = getSession()
  const noLeidas = notifs.filter(n => !n.leida).length

  const cargar = async () => {
    if (!sesion) return
    setCargando(true)
    try {
      const res = await authedFetch('/api/v1/notificaciones/lista?limite=10').then(r => r.json())
      setNotifs(res.notificaciones ?? [])
    } catch { /* silencioso */ }
    finally { setCargando(false) }
  }

  useEffect(() => {
    if (sesion) {
      cargar()
      const interval = setInterval(cargar, 60000) // Refrescar cada minuto
      return () => clearInterval(interval)
    }
  }, [])

  // Cerrar al click fuera
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const marcarLeida = async (id: string) => {
    await authedFetch(`/api/v1/notificaciones/${id}/leer`, { method: 'PATCH' }).catch(() => undefined)
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, leida: true } : n))
  }

  const marcarTodasLeidas = async () => {
    await authedFetch('/api/v1/notificaciones/leer-todas', { method: 'PATCH' }).catch(() => undefined)
    setNotifs(prev => prev.map(n => ({ ...n, leida: true })))
  }

  if (!sesion) return null

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => { setAbierto(v => !v); if (!abierto) cargar() }}
        className="relative flex size-9 items-center justify-center rounded-full hover:bg-ink/5 transition-colors">
        <Bell className="size-4.5 text-ink/70" />
        {noLeidas > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-[#F47B20] text-[9px] font-bold text-white">
            {noLeidas > 9 ? '9+' : noLeidas}
          </span>
        )}
      </button>

      {abierto && (
        <div className="absolute right-0 top-11 z-50 w-80 rounded-2xl border border-ink/10 bg-white shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <span className="font-display text-sm font-semibold text-[#0F1E35]">
              Notificaciones {noLeidas > 0 && <span className="ml-1 text-[#F47B20]">({noLeidas})</span>}
            </span>
            <div className="flex items-center gap-2">
              {noLeidas > 0 && (
                <button type="button" onClick={marcarTodasLeidas}
                  className="text-[10px] text-[#2BBCB8] hover:underline flex items-center gap-1">
                  <CheckCheck className="size-3" /> Marcar leídas
                </button>
              )}
              <button type="button" onClick={() => setAbierto(false)}>
                <X className="size-3.5 text-slate-warm" />
              </button>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {cargando ? (
              <div className="py-8 text-center text-xs text-slate-warm">Cargando...</div>
            ) : notifs.length === 0 ? (
              <div className="py-8 text-center">
                <Bell className="size-6 text-slate-200 mx-auto mb-2" />
                <p className="text-xs text-slate-warm">Sin notificaciones</p>
              </div>
            ) : (
              notifs.map(n => (
                <div key={n.id}
                  className={`flex gap-3 px-4 py-3 border-b border-slate-50 hover:bg-slate-50 cursor-pointer transition-colors ${!n.leida ? 'bg-[#2BBCB8]/5' : ''}`}
                  onClick={() => { marcarLeida(n.id); if (n.url) window.location.href = n.url }}>
                  <div className="shrink-0 mt-0.5">
                    <IconoTipo tipo={n.tipo} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold text-[#0F1E35] truncate ${!n.leida ? 'font-bold' : ''}`}>{n.titulo}</p>
                    <p className="text-[10px] text-slate-warm leading-relaxed line-clamp-2">{n.mensaje}</p>
                    <p className="text-[9px] text-slate-warm/60 mt-0.5">
                      {new Date(n.created_at).toLocaleString('es-AR')}
                    </p>
                  </div>
                  {!n.leida && <div className="shrink-0 mt-1.5 size-1.5 rounded-full bg-[#F47B20]" />}
                </div>
              ))
            )}
          </div>

          <div className="px-4 py-2 border-t border-slate-100">
            <Link href="/garaje" onClick={() => setAbierto(false)}
              className="text-[10px] text-[#2BBCB8] hover:underline">
              Ver todas en el Garaje →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
