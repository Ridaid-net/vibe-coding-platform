'use client'
import { useState, useEffect, useCallback } from 'react'
import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
import { Shield, Building2, AlertTriangle, CheckCircle, Activity, Webhook, RefreshCw } from 'lucide-react'

const GOV_TOKEN = process.env.NEXT_PUBLIC_GOV_TOKEN ?? ''

const TENANTS = [
  { slug: 'ministerio_seguridad', label: 'Ministerio de Seguridad', color: '#0F1E35' },
  { slug: 'mpf_mendoza', label: 'MPF Mendoza', color: '#F47B20' },
  { slug: 'municipio_san_martin', label: 'Municipio San Martín', color: '#2BBCB8' },
  { slug: 'municipio_junin', label: 'Municipio Junín', color: '#7c3aed' },
  { slug: 'municipio_rivadavia', label: 'Municipio Rivadavia', color: '#16a34a' },
]

interface Metricas {
  bicicletas: { total: number }
  cits: Record<string, number>
  denuncias: Record<string, number>
  auditoria_tenant: { accion: string; total: string; ultima: string }[]
}

export default function GovDashboardPage() {
  const [tenantActivo, setTenantActivo] = useState(TENANTS[0])
  const [metricas, setMetricas] = useState<Metricas | null>(null)
  const [cargando, setCargando] = useState(false)
  const [webhooks, setWebhooks] = useState<{ id: string; url: string; eventos: string[]; activo: boolean }[]>([])

  const cargar = useCallback(async (slug: string) => {
    setCargando(true)
    try {
      const headers = {
        'X-Gov-Token': GOV_TOKEN || '',
        'X-Tenant-ID': slug
      }
      const [mRes, wRes] = await Promise.all([
        fetch('/api/v1/gov/metricas', { headers }).then(r => r.json()),
        fetch('/api/v1/gov/webhook', { headers }).then(r => r.json()),
      ])
      setMetricas(mRes.metricas ?? null)
      setWebhooks(wRes.webhooks ?? [])
    } catch { /* silencioso */ }
    finally { setCargando(false) }
  }, [])

  useEffect(() => { cargar(tenantActivo.slug) }, [tenantActivo, cargar])

  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
        <div className="mb-8">
          <span className="text-xs font-semibold uppercase tracking-widest text-[#F47B20]">RODAID · Panel Gubernamental</span>
          <h1 className="mt-2 font-display text-3xl font-bold text-[#0F1E35]">Dashboard Multi-Tenant</h1>
          <p className="mt-2 text-sm text-slate-warm">Métricas de acceso y actividad por organismo gubernamental.</p>
        </div>

        <div className="flex flex-wrap gap-2 mb-8">
          {TENANTS.map(t => (
            <button key={t.slug} type="button"
              onClick={() => setTenantActivo(t)}
              style={{ background: tenantActivo.slug === t.slug ? t.color : undefined, borderColor: tenantActivo.slug === t.slug ? t.color : undefined }}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold border transition-all ${tenantActivo.slug === t.slug ? 'text-white' : 'border-slate-200 text-slate-600 bg-white hover:bg-slate-50'}`}>
              <Building2 className="size-3" />
              {t.label}
            </button>
          ))}
          <button type="button" onClick={() => cargar(tenantActivo.slug)}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">
            <RefreshCw className={`size-3 ${cargando ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>

        {cargando ? (
          <div className="flex items-center gap-2 text-sm text-slate-warm py-12 justify-center">
            <RefreshCw className="size-4 animate-spin" /> Cargando métricas...
          </div>
        ) : metricas ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { icono: Shield, label: 'Bicicletas en red', valor: metricas.bicicletas?.total ?? 0, color: '#0F1E35' },
                { icono: CheckCircle, label: 'CITs activos', valor: metricas.cits?.activo ?? 0, color: '#2BBCB8' },
                { icono: AlertTriangle, label: 'Denuncias activas', valor: metricas.denuncias?.DENUNCIA_JUDICIAL_ACTIVA ?? 0, color: '#F47B20' },
                { icono: Activity, label: 'Consultas API', valor: metricas.auditoria_tenant?.reduce((a, r) => a + parseInt(r.total), 0) ?? 0, color: '#7c3aed' },
              ].map((s, i) => (
                <div key={i} className="rounded-2xl border border-ink/10 bg-white p-5">
                  <s.icono className="size-5 mb-3" style={{ color: s.color }} />
                  <p className="text-2xl font-bold text-[#0F1E35]">{s.valor}</p>
                  <p className="text-xs text-slate-warm mt-1">{s.label}</p>
                </div>
              ))}
            </div>

            {metricas.auditoria_tenant?.length > 0 && (
              <div className="rounded-2xl border border-ink/10 bg-white p-5">
                <h2 className="font-display text-base font-semibold text-[#0F1E35] mb-4">
                  <Activity className="size-4 inline mr-2 text-[#2BBCB8]" />
                  Actividad del organismo
                </h2>
                <div className="space-y-2">
                  {metricas.auditoria_tenant.map((row, i) => (
                    <div key={i} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2">
                      <span className="text-xs font-semibold text-[#0F1E35]">{row.accion}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-warm">{row.total} consultas</span>
                        <span className="text-[10px] text-slate-warm/60">{new Date(row.ultima).toLocaleString('es-AR')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-ink/10 bg-white p-5">
              <h2 className="font-display text-base font-semibold text-[#0F1E35] mb-4">
                <Webhook className="size-4 inline mr-2 text-[#F47B20]" />
                Webhooks registrados ({webhooks.length})
              </h2>
              {webhooks.length === 0 ? (
                <p className="text-sm text-slate-warm">No hay webhooks registrados para este organismo.</p>
              ) : (
                <div className="space-y-3">
                  {webhooks.map(w => (
                    <div key={w.id} className="rounded-xl border border-slate-100 p-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <p className="text-sm font-semibold text-[#0F1E35] truncate">{w.url}</p>
                        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${w.activo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {w.activo ? 'Activo' : 'Inactivo'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {w.eventos?.map((e: string) => (
                          <span key={e} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{e}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-warm text-center py-12">No se pudieron cargar las métricas.</p>
        )}
      </main>
      <Footer />
    </div>
  )
}
