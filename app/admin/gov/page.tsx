'use client'
import { useState, useEffect, useCallback } from 'react'
import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
import { Shield, Building2, AlertTriangle, CheckCircle, Activity, Webhook, RefreshCw, Search, FileText } from 'lucide-react'

const GOV_TOKEN = process.env.NEXT_PUBLIC_GOV_TOKEN ?? ''

const TENANTS = [
  { slug: 'ministerio_seguridad', label: 'Ministerio de Seguridad', color: '#0F1E35' },
  { slug: 'mpf_mendoza', label: 'MPF Mendoza', color: '#F47B20' },
  { slug: 'municipio_san_martin', label: 'Municipio San Martín', color: '#2BBCB8' },
  { slug: 'municipio_junin', label: 'Municipio Junín', color: '#7c3aed' },
  { slug: 'municipio_rivadavia', label: 'Municipio Rivadavia', color: '#16a34a' },
]

type Seccion = 'metricas' | 'verificar' | 'certificado' | 'historial' | 'estadisticas'

const SECCIONES: { id: Seccion; label: string }[] = [
  { id: 'metricas', label: 'Métricas' },
  { id: 'verificar', label: 'Verificar' },
  { id: 'certificado', label: 'Certificado' },
  { id: 'historial', label: 'Historial' },
  { id: 'estadisticas', label: 'Estadísticas' },
]

interface Metricas {
  bicicletas: { total: number }
  cits: Record<string, number>
  denuncias: Record<string, number>
  auditoria_tenant: { accion: string; total: string; ultima: string }[]
}

export default function GovDashboardPage() {
  const [tenantActivo, setTenantActivo] = useState(TENANTS[0])
  const [seccion, setSeccion] = useState<Seccion>('metricas')
  const [metricas, setMetricas] = useState<Metricas | null>(null)
  const [cargando, setCargando] = useState(false)
  const [errorToken, setErrorToken] = useState(false)
  const [webhooks, setWebhooks] = useState<{ id: string; url: string; eventos: string[]; activo: boolean }[]>([])

  const cargar = useCallback(async (slug: string) => {
    setCargando(true)
    setErrorToken(false)
    try {
      const headers = {
        'X-Gov-Token': GOV_TOKEN || '',
        'X-Tenant-ID': slug
      }
      const [mRes, wRes] = await Promise.all([
        fetch('/api/v1/gov/metricas', { headers }),
        fetch('/api/v1/gov/webhook', { headers }),
      ])
      if (mRes.status === 401 || wRes.status === 401) {
        setErrorToken(true)
        setMetricas(null)
        setWebhooks([])
        return
      }
      const [mData, wData] = await Promise.all([mRes.json(), wRes.json()])
      setMetricas(mData.metricas ?? null)
      setWebhooks(wData.webhooks ?? [])
    } catch { /* silencioso */ }
    finally { setCargando(false) }
  }, [])

  useEffect(() => {
    if (seccion === 'metricas') cargar(tenantActivo.slug)
  }, [tenantActivo, seccion, cargar])

  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
        <div className="mb-8">
          <span className="text-xs font-semibold uppercase tracking-widest text-[#F47B20]">RODAID · Panel Gubernamental</span>
          <h1 className="mt-2 font-display text-3xl font-bold text-[#0F1E35]">Dashboard Multi-Tenant</h1>
          <p className="mt-2 text-sm text-slate-warm">Métricas de acceso y actividad por organismo gubernamental.</p>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {TENANTS.map(t => (
            <button key={t.slug} type="button"
              onClick={() => setTenantActivo(t)}
              style={{ background: tenantActivo.slug === t.slug ? t.color : undefined, borderColor: tenantActivo.slug === t.slug ? t.color : undefined }}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold border transition-all ${tenantActivo.slug === t.slug ? 'text-white' : 'border-slate-200 text-slate-600 bg-white hover:bg-slate-50'}`}>
              <Building2 className="size-3" />
              {t.label}
            </button>
          ))}
          {seccion === 'metricas' && (
            <button type="button" onClick={() => cargar(tenantActivo.slug)}
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">
              <RefreshCw className={`size-3 ${cargando ? 'animate-spin' : ''}`} />
              Actualizar
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mb-8 border-b border-slate-200 pb-5">
          {SECCIONES.map(s => (
            <button key={s.id} type="button" onClick={() => setSeccion(s.id)}
              className={`rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
                seccion === s.id ? 'bg-[#0F1E35] text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}>
              {s.label}
            </button>
          ))}
        </div>

        {seccion === 'metricas' && (
          cargando ? (
            <div className="flex items-center gap-2 text-sm text-slate-warm py-12 justify-center">
              <RefreshCw className="size-4 animate-spin" /> Cargando métricas...
            </div>
          ) : errorToken ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-8 text-center">
              <AlertTriangle className="mx-auto size-6 text-red-500" />
              <p className="mt-3 text-sm font-semibold text-red-700">
                No se pudo autenticar con la API gubernamental.
              </p>
              <p className="mt-1 text-xs text-red-600">
                NEXT_PUBLIC_GOV_TOKEN (frontend) y GOV_API_TOKEN (backend) no coinciden.
                Revisá la configuración de variables de entorno antes de reintentar.
              </p>
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
          )
        )}

        {seccion === 'verificar' && <VerificarPanel tenantSlug={tenantActivo.slug} />}
        {seccion === 'certificado' && <CertificadoPanel tenantSlug={tenantActivo.slug} />}
        {seccion === 'historial' && <HistorialPanel tenantSlug={tenantActivo.slug} />}
        {seccion === 'estadisticas' && <EstadisticasPanel tenantSlug={tenantActivo.slug} />}
      </main>
      <Footer />
    </div>
  )
}

// ── Verificar (GOV_VERIFICAR) ────────────────────────────────────────────────

interface ResultadoVerificacion {
  encontrado: boolean
  message?: string
  bicicleta?: {
    numero_serie: string
    marca: string | null
    modelo: string | null
    anio: number | null
    tipo: string | null
    color: string | null
  }
  cit?: {
    codigo: string
    estado: string
    emitido_en: string
    vence_en: string
    hash_bfa: string | null
  } | null
  alerta?: { tipo: string; message: string } | null
}

function VerificarPanel({ tenantSlug }: { tenantSlug: string }) {
  const [query, setQuery] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [errorToken, setErrorToken] = useState(false)
  const [resultado, setResultado] = useState<ResultadoVerificacion | null>(null)

  const buscar = async () => {
    const serie = query.trim()
    if (!serie || buscando) return
    setBuscando(true)
    setErrorToken(false)
    setResultado(null)
    try {
      const headers = { 'X-Gov-Token': GOV_TOKEN || '', 'X-Tenant-ID': tenantSlug }
      const res = await fetch(`/api/v1/gov/verificar?serie=${encodeURIComponent(serie)}`, { headers })
      if (res.status === 401) {
        setErrorToken(true)
        return
      }
      const data = (await res.json()) as ResultadoVerificacion
      setResultado(data)
    } catch { /* silencioso, mismo criterio que el resto del panel */ }
    finally { setBuscando(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') buscar() }}
          placeholder="Número de serie de la bicicleta"
          className="min-w-[220px] flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-[#0F1E35] focus:outline-none"
        />
        <button
          type="button"
          onClick={buscar}
          disabled={buscando || !query.trim()}
          className="inline-flex items-center gap-2 rounded-full bg-[#0F1E35] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0F1E35]/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {buscando ? <RefreshCw className="size-4 animate-spin" /> : <Search className="size-4" />}
          Buscar
        </button>
      </div>

      {errorToken && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-center">
          <p className="text-sm font-semibold text-red-700">No se pudo autenticar con la API gubernamental.</p>
        </div>
      )}

      {resultado && !resultado.encontrado && (
        <div className="rounded-2xl border border-ink/10 bg-white px-5 py-8 text-center">
          <p className="text-sm text-slate-warm">{resultado.message}</p>
        </div>
      )}

      {resultado?.encontrado && resultado.bicicleta && (
        <div className="space-y-4">
          {resultado.alerta && (
            <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3.5 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{resultado.alerta.message}</span>
            </div>
          )}

          <div className="rounded-2xl border border-ink/10 bg-white p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-warm">Bicicleta</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <CampoDato label="Número de serie" valor={resultado.bicicleta.numero_serie} />
              <CampoDato label="Marca" valor={resultado.bicicleta.marca ?? '-'} />
              <CampoDato label="Modelo" valor={resultado.bicicleta.modelo ?? '-'} />
              <CampoDato label="Año" valor={resultado.bicicleta.anio?.toString() ?? '-'} />
              <CampoDato label="Tipo" valor={resultado.bicicleta.tipo ?? '-'} />
              <CampoDato label="Color" valor={resultado.bicicleta.color ?? '-'} />
            </div>
          </div>

          {resultado.cit ? (
            <div className="rounded-2xl border border-ink/10 bg-white p-5">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-warm">
                Certificado de Identidad Técnica (CIT)
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <CampoDato label="Código" valor={resultado.cit.codigo} />
                <CampoDato label="Estado" valor={resultado.cit.estado?.toUpperCase() ?? '-'} />
                <CampoDato label="Emitido" valor={new Date(resultado.cit.emitido_en).toLocaleDateString('es-AR')} />
                <CampoDato label="Vence" valor={new Date(resultado.cit.vence_en).toLocaleDateString('es-AR')} />
              </div>
              {resultado.cit.hash_bfa && (
                <div className="mt-3 break-all rounded-xl bg-slate-50 px-4 py-2.5 font-mono text-[11px] text-slate-600">
                  {resultado.cit.hash_bfa}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-warm">Esta bicicleta no tiene un CIT activo.</p>
          )}
        </div>
      )}
    </div>
  )
}

function CampoDato({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-warm">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-[#0F1E35]">{valor}</p>
    </div>
  )
}

// ── Certificado (GOV_CERTIFICADO) ────────────────────────────────────────────

function CertificadoPanel({ tenantSlug }: { tenantSlug: string }) {
  const [query, setQuery] = useState('')
  const [generando, setGenerando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null)

  const generar = async () => {
    const serie = query.trim()
    if (!serie || generando) return

    // Se abre ANTES del fetch, de forma sincronica dentro del handler de click:
    // si se abriera despues del await, Safari (y a veces otros navegadores)
    // tratan la ventana como un popup no solicitado y la bloquean, aunque el
    // usuario haya clickeado un boton real.
    const ventana = window.open('', '_blank')

    setGenerando(true)
    setError(null)
    setFallbackUrl(null)
    try {
      const headers = { 'X-Gov-Token': GOV_TOKEN || '', 'X-Tenant-ID': tenantSlug }
      const res = await fetch(`/api/v1/gov/certificado?serie=${encodeURIComponent(serie)}`, { headers })

      if (!res.ok) {
        ventana?.close()
        const data = await res.json().catch(() => ({}))
        setError(
          res.status === 401 ? 'No se pudo autenticar con la API gubernamental.' :
          res.status === 404 ? 'No se encontró ninguna bicicleta con esa serie.' :
          res.status === 429 ? 'Se alcanzó el límite de consultas. Esperá unos segundos e intentá de nuevo.' :
          data.message || 'No se pudo generar el certificado.'
        )
        return
      }

      const html = await res.text()
      if (ventana) {
        ventana.document.open()
        ventana.document.write(html)
        ventana.document.close()
      } else {
        // El navegador bloqueo incluso la ventana pre-abierta -- no reintentamos
        // otro window.open() (la misma politica lo bloquearia igual). Fallback:
        // un link real que el usuario clickea el mismo, eso casi nunca se bloquea.
        const blob = new Blob([html], { type: 'text/html' })
        setFallbackUrl(URL.createObjectURL(blob))
      }
    } catch {
      ventana?.close()
      setError('No pudimos generar el certificado. Revisá tu conexión e intentá de nuevo.')
    } finally {
      setGenerando(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') generar() }}
          placeholder="Número de serie de la bicicleta"
          className="min-w-[220px] flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-[#0F1E35] focus:outline-none"
        />
        <button
          type="button"
          onClick={generar}
          disabled={generando || !query.trim()}
          className="inline-flex items-center gap-2 rounded-full bg-[#0F1E35] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0F1E35]/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {generando ? <RefreshCw className="size-4 animate-spin" /> : <FileText className="size-4" />}
          Generar certificado
        </button>
      </div>

      <p className="text-xs text-slate-warm">
        Se abre en una pestaña nueva, lista para imprimir o guardar como PDF.
      </p>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-center">
          <p className="text-sm font-semibold text-red-700">{error}</p>
        </div>
      )}

      {fallbackUrl && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-center">
          <p className="text-sm text-amber-700">
            Tu navegador bloqueó la ventana automática.{' '}
            <a href={fallbackUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
              Abrir el certificado manualmente
            </a>
          </p>
        </div>
      )}
    </div>
  )
}

// ── Historial (GOV_HISTORIAL) ─────────────────────────────────────────────────

interface HistorialResultado {
  bicicleta: {
    id: string
    numero_serie: string
    marca: string | null
    modelo: string | null
    anio: number | null
    tipo: string | null
    color: string | null
    created_at: string
  }
  cits: {
    codigo_cit: string
    estado: string
    created_at: string
    fecha_vencimiento: string | null
    hash_sha256: string | null
  }[]
  denuncias: {
    estado: string
    numero_expediente: string | null
    creado_en: string
    actualizado_en: string
    metadata: Record<string, unknown> | null
  }[]
  consultas_organismo: {
    accion: string
    created_at: string
    metadata: Record<string, unknown> | null
  }[]
}

function HistorialPanel({ tenantSlug }: { tenantSlug: string }) {
  const [query, setQuery] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [errorToken, setErrorToken] = useState(false)
  const [errorMensaje, setErrorMensaje] = useState<string | null>(null)
  const [resultado, setResultado] = useState<HistorialResultado | null>(null)

  const buscar = async () => {
    const serie = query.trim()
    if (!serie || buscando) return
    setBuscando(true)
    setErrorToken(false)
    setErrorMensaje(null)
    setResultado(null)
    try {
      const headers = { 'X-Gov-Token': GOV_TOKEN || '', 'X-Tenant-ID': tenantSlug }
      const res = await fetch(`/api/v1/gov/historial?serie=${encodeURIComponent(serie)}`, { headers })
      if (res.status === 401) {
        setErrorToken(true)
        return
      }
      const data = await res.json()
      if (!res.ok) {
        setErrorMensaje(data.message ?? 'No se pudo consultar el historial.')
        return
      }
      setResultado(data.historial as HistorialResultado)
    } catch {
      setErrorMensaje('No pudimos consultar el historial. Revisá tu conexión e intentá de nuevo.')
    } finally {
      setBuscando(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') buscar() }}
          placeholder="Número de serie de la bicicleta"
          className="min-w-[220px] flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-[#0F1E35] focus:outline-none"
        />
        <button
          type="button"
          onClick={buscar}
          disabled={buscando || !query.trim()}
          className="inline-flex items-center gap-2 rounded-full bg-[#0F1E35] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0F1E35]/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {buscando ? <RefreshCw className="size-4 animate-spin" /> : <Search className="size-4" />}
          Buscar
        </button>
      </div>

      {errorToken && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-center">
          <p className="text-sm font-semibold text-red-700">No se pudo autenticar con la API gubernamental.</p>
        </div>
      )}

      {errorMensaje && (
        <div className="rounded-2xl border border-ink/10 bg-white px-5 py-8 text-center">
          <p className="text-sm text-slate-warm">{errorMensaje}</p>
        </div>
      )}

      {resultado && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-ink/10 bg-white p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-warm">
              Bicicleta · registrada el {new Date(resultado.bicicleta.created_at).toLocaleDateString('es-AR')}
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <CampoDato label="Número de serie" valor={resultado.bicicleta.numero_serie} />
              <CampoDato label="Marca" valor={resultado.bicicleta.marca ?? '-'} />
              <CampoDato label="Modelo" valor={resultado.bicicleta.modelo ?? '-'} />
              <CampoDato label="Año" valor={resultado.bicicleta.anio?.toString() ?? '-'} />
              <CampoDato label="Tipo" valor={resultado.bicicleta.tipo ?? '-'} />
              <CampoDato label="Color" valor={resultado.bicicleta.color ?? '-'} />
            </div>
          </div>

          <div className="rounded-2xl border border-ink/10 bg-white p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-warm">
              CITs emitidos ({resultado.cits.length})
            </p>
            {resultado.cits.length === 0 ? (
              <p className="text-sm text-slate-warm">Esta bicicleta nunca tuvo un CIT emitido.</p>
            ) : (
              <div className="space-y-2">
                {resultado.cits.map((c, i) => (
                  <div key={i} className="rounded-xl bg-slate-50 px-4 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#0F1E35]">{c.codigo_cit}</span>
                      <span className="text-xs text-slate-warm">{c.estado?.toUpperCase()}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-warm/70">
                      <span>Emitido: {new Date(c.created_at).toLocaleDateString('es-AR')}</span>
                      {c.fecha_vencimiento && (
                        <span>Vence: {new Date(c.fecha_vencimiento).toLocaleDateString('es-AR')}</span>
                      )}
                    </div>
                    {c.hash_sha256 && (
                      <div className="mt-1.5 break-all font-mono text-[10px] text-slate-500">{c.hash_sha256}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-ink/10 bg-white p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-warm">
              Denuncias ({resultado.denuncias.length})
            </p>
            {resultado.denuncias.length === 0 ? (
              <p className="text-sm text-slate-warm">Sin denuncias registradas.</p>
            ) : (
              <div className="space-y-2">
                {resultado.denuncias.map((d, i) => (
                  <div key={i} className="rounded-xl bg-slate-50 px-4 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className={`text-xs font-semibold ${d.estado === 'DENUNCIA_JUDICIAL_ACTIVA' ? 'text-red-600' : 'text-[#0F1E35]'}`}>
                        {d.estado}
                      </span>
                      {d.numero_expediente && (
                        <span className="text-xs text-slate-warm">Exp. {d.numero_expediente}</span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-warm/70">
                      <span>Creada: {new Date(d.creado_en).toLocaleString('es-AR')}</span>
                      <span>Actualizada: {new Date(d.actualizado_en).toLocaleString('es-AR')}</span>
                    </div>
                    {d.metadata && Object.keys(d.metadata).length > 0 && (
                      <div className="mt-1.5 break-all font-mono text-[10px] text-slate-500">
                        {JSON.stringify(d.metadata)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-ink/10 bg-white p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-warm">
              Consultas de este organismo sobre esta serie ({resultado.consultas_organismo.length})
            </p>
            {resultado.consultas_organismo.length === 0 ? (
              <p className="text-sm text-slate-warm">Este organismo no consultó antes esta serie.</p>
            ) : (
              <div className="space-y-2">
                {resultado.consultas_organismo.map((c, i) => (
                  <div key={i} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2">
                    <span className="text-xs font-semibold text-[#0F1E35]">{c.accion}</span>
                    <span className="text-[10px] text-slate-warm/60">{new Date(c.created_at).toLocaleString('es-AR')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Estadisticas (GOV_ESTADISTICAS) ──────────────────────────────────────────

const TENANTS_ESTADISTICAS = ['ministerio_seguridad', 'rodaid']

interface EstadisticasResultado {
  resumen: {
    total_bicicletas: number
    cits: Record<string, number>
    denuncias: Record<string, number>
  }
  actividad_organismos: { slug: string; nombre: string; consultas_24h: number }[]
  eventos_recientes: { accion: string; created_at: string; tenant: string; metadata: Record<string, unknown> }[]
  tendencia_semanal: { dia: string; consultas: number }[]
}

function EstadisticasPanel({ tenantSlug }: { tenantSlug: string }) {
  const permitido = TENANTS_ESTADISTICAS.includes(tenantSlug)
  const [cargando, setCargando] = useState(false)
  const [errorToken, setErrorToken] = useState(false)
  const [data, setData] = useState<EstadisticasResultado | null>(null)

  const cargar = useCallback(async () => {
    if (!permitido) return
    setCargando(true)
    setErrorToken(false)
    setData(null)
    try {
      const headers = { 'X-Gov-Token': GOV_TOKEN || '', 'X-Tenant-ID': tenantSlug }
      const res = await fetch('/api/v1/gov/estadisticas', { headers })
      if (res.status === 401) {
        setErrorToken(true)
        return
      }
      const json = await res.json()
      if (res.ok) setData(json.estadisticas)
    } catch { /* silencioso */ }
    finally { setCargando(false) }
  }, [tenantSlug, permitido])

  // Todos los hooks se llaman incondicionalmente, ANTES de cualquier return
  // temprano -- los early returns de abajo (permitido/cargando/errorToken/data)
  // van despues, como exige las Rules of Hooks.
  useEffect(() => { cargar() }, [cargar])

  if (!permitido) {
    return (
      <div className="rounded-2xl border border-ink/10 bg-white px-5 py-8 text-center">
        <p className="text-sm text-slate-warm">
          Las estadísticas agregadas solo están disponibles para el Ministerio de Seguridad.
          Cambiá el organismo activo arriba para verlas.
        </p>
      </div>
    )
  }

  if (cargando) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-warm py-12 justify-center">
        <RefreshCw className="size-4 animate-spin" /> Cargando estadísticas...
      </div>
    )
  }

  if (errorToken) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-8 text-center">
        <AlertTriangle className="mx-auto size-6 text-red-500" />
        <p className="mt-3 text-sm font-semibold text-red-700">No se pudo autenticar con la API gubernamental.</p>
      </div>
    )
  }

  if (!data) {
    return <p className="text-sm text-slate-warm text-center py-12">No se pudieron cargar las estadísticas.</p>
  }

  const tendenciaMax = Math.max(...data.tendencia_semanal.map((d) => d.consultas), 1)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-2xl border border-ink/10 bg-white p-5">
          <Shield className="mb-3 size-5" style={{ color: '#0F1E35' }} />
          <p className="text-2xl font-bold text-[#0F1E35]">{data.resumen.total_bicicletas}</p>
          <p className="mt-1 text-xs text-slate-warm">Bicicletas en red</p>
        </div>
        {Object.entries(data.resumen.cits).map(([estado, total]) => (
          <div key={`cit-${estado}`} className="rounded-2xl border border-ink/10 bg-white p-5">
            <CheckCircle className="mb-3 size-5 text-[#2BBCB8]" />
            <p className="text-2xl font-bold text-[#0F1E35]">{total}</p>
            <p className="mt-1 text-xs text-slate-warm">CITs · {estado}</p>
          </div>
        ))}
        {Object.entries(data.resumen.denuncias).map(([estado, total]) => (
          <div key={`denuncia-${estado}`} className="rounded-2xl border border-ink/10 bg-white p-5">
            <AlertTriangle className="mb-3 size-5 text-[#F47B20]" />
            <p className="text-2xl font-bold text-[#0F1E35]">{total}</p>
            <p className="mt-1 text-xs text-slate-warm">Denuncias · {estado}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-ink/10 bg-white p-5">
        <h2 className="mb-4 font-display text-base font-semibold text-[#0F1E35]">
          <Building2 className="mr-2 inline size-4 text-[#2BBCB8]" />
          Actividad por organismo (últimas 24hs)
        </h2>
        <div className="space-y-2">
          {data.actividad_organismos.map((o) => (
            <div key={o.slug} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2">
              <span className="text-xs font-semibold text-[#0F1E35]">{o.nombre}</span>
              <span className="text-xs text-slate-warm">{o.consultas_24h} consultas</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-ink/10 bg-white p-5">
        <h2 className="mb-4 font-display text-base font-semibold text-[#0F1E35]">
          <Activity className="mr-2 inline size-4 text-[#7c3aed]" />
          Eventos recientes (últimas 48hs)
        </h2>
        {data.eventos_recientes.length === 0 ? (
          <p className="text-sm text-slate-warm">Sin eventos en las últimas 48hs.</p>
        ) : (
          <div className="space-y-2">
            {data.eventos_recientes.map((e, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2">
                <div>
                  <span className="text-xs font-semibold text-[#0F1E35]">{e.accion}</span>
                  <span className="ml-2 text-[11px] text-slate-warm">{e.tenant}</span>
                </div>
                <span className="text-[10px] text-slate-warm/60">{new Date(e.created_at).toLocaleString('es-AR')}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-ink/10 bg-white p-5">
        <h2 className="mb-4 font-display text-base font-semibold text-[#0F1E35]">
          <Activity className="mr-2 inline size-4 text-[#16a34a]" />
          Tendencia semanal
        </h2>
        {data.tendencia_semanal.length === 0 ? (
          <p className="text-sm text-slate-warm">Sin datos de la última semana.</p>
        ) : (
          <div className="space-y-2">
            {data.tendencia_semanal.map((d, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-[11px] text-slate-warm">
                  {new Date(d.dia).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' })}
                </span>
                <div className="h-2 flex-1 rounded-full bg-slate-100">
                  <div className="h-2 rounded-full bg-[#0F1E35]" style={{ width: `${(d.consultas / tendenciaMax) * 100}%` }} />
                </div>
                <span className="w-8 shrink-0 text-right text-[11px] font-semibold text-[#0F1E35]">{d.consultas}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
