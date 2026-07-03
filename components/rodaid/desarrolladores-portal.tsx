'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { authedFetch } from '@/lib/session'

/**
 * Portal de Desarrolladores de RODAID Open-Connect (Hito 16).
 *
 * Entorno de "App Registration" donde un desarrollador externo registra su app,
 * gestiona sus credenciales (client_id + client_secret + API Key), revisa el uso
 * y los límites de rate-limiting, y administra sus suscripciones a webhooks de
 * ecosistema. Todo el acceso real a datos se hace por OAuth2 con el consentimiento
 * del usuario; acá solo se administran las credenciales del integrador.
 */

interface ScopeDef {
  id: string
  titulo: string
  descripcion: string
}
interface EventoDef {
  id: string
  titulo: string
  descripcion: string
}
interface App {
  id: string
  nombre: string
  descripcion: string | null
  sitioUrl: string | null
  clientId: string
  apiKeyPrefix: string
  redirectUris: string[]
  scopes: string[]
  entorno: string
  estado: string
  rateLimitRpm: number
  createdAt: string
}
interface Secretos {
  clientSecret: string
  apiKey: string
}
interface Uso {
  total: number
  ultimas24h: number
  errores: number
  latenciaP95Ms: number | null
  recientes: Array<{
    endpoint: string
    metodo: string
    status: number
    scopeUsado: string | null
    latenciaMs: number | null
    createdAt: string
  }>
}
interface Webhook {
  id: string
  url: string
  eventos: string[]
  estado: string
  secret?: string
  createdAt: string
}

const ORIGIN_FALLBACK = 'https://rodaid.netlify.app'

export function DesarrolladoresPortal() {
  const [apps, setApps] = useState<App[]>([])
  const [scopes, setScopes] = useState<ScopeDef[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nuevosSecretos, setNuevosSecretos] = useState<{ appId: string; secretos: Secretos } | null>(
    null
  )
  const [expandida, setExpandida] = useState<string | null>(null)

  const origin = typeof window !== 'undefined' ? window.location.origin : ORIGIN_FALLBACK

  const cargar = useCallback(async () => {
    try {
      const res = await authedFetch('/api/v1/developer/apps')
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? 'No se pudieron cargar las apps.')
      setApps(data.apps ?? [])
      setScopes(data.scopes ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  return (
    <div className="space-y-10">
      <IntroDocs origin={origin} />

      <section>
        <h2 className="text-xl font-semibold text-ink">Registrar una aplicación</h2>
        <p className="mt-1 text-sm text-slate-warm">
          Toda app nace en el entorno <strong>sandbox</strong> para que ejercites el flujo de punta a
          punta. Las credenciales se muestran una sola vez.
        </p>
        <FormularioApp
          scopes={scopes}
          onCreada={(app, secretos) => {
            setApps((prev) => [app, ...prev])
            setNuevosSecretos({ appId: app.id, secretos })
          }}
        />
      </section>

      <section>
        <h2 className="text-xl font-semibold text-ink">Mis aplicaciones</h2>
        {cargando ? (
          <p className="mt-3 text-sm text-slate-warm">Cargando…</p>
        ) : error ? (
          <p className="mt-3 text-sm text-clay">{error}</p>
        ) : apps.length === 0 ? (
          <p className="mt-3 text-sm text-slate-warm">Todavía no registraste ninguna app.</p>
        ) : (
          <div className="mt-4 space-y-4">
            {apps.map((app) => (
              <TarjetaApp
                key={app.id}
                app={app}
                origin={origin}
                scopes={scopes}
                secretos={nuevosSecretos?.appId === app.id ? nuevosSecretos.secretos : null}
                expandida={expandida === app.id}
                onToggle={() => setExpandida((cur) => (cur === app.id ? null : app.id))}
                onCambio={cargar}
                onRotada={(secretos) => setNuevosSecretos({ appId: app.id, secretos })}
              />
            ))}
          </div>
        )}
      </section>
      <SeccionSeguros />
    </div>
  )
}

// ── Documentación / SDK ──────────────────────────────────────────────────────

function IntroDocs({ origin }: { origin: string }) {
  const snippet = `<script src="${origin}/sdk/rodaid-connect.js"\n        data-rodaid-serial="TU-NUMERO-DE-SERIE" async></script>`
  return (
    <section className="rounded-2xl border border-ink/10 bg-paper-dim/30 p-6">
      <h2 className="text-xl font-semibold text-ink">Botón de Verificación (SDK)</h2>
      <p className="mt-1 text-sm text-slate-warm">
        Integrá el estado de confianza de una bici en tu sitio con una sola línea. El botón consulta
        el Verificador Público y muestra el veredicto, sin exponer datos personales.
      </p>
      <Copiable texto={snippet} />
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Recurso titulo="OAuth2 + OIDC" detalle={`${origin}/.well-known/oauth-authorization-server`} />
        <Recurso titulo="Clave pública (JWKS)" detalle={`${origin}/.well-known/jwks.json`} />
        <Recurso titulo="Credenciales W3C" detalle={`${origin}/.well-known/did.json`} />
      </div>
    </section>
  )
}

function Recurso({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <a
      href={detalle}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl border border-ink/10 bg-paper p-3 transition-colors hover:border-ink/25"
    >
      <p className="text-sm font-medium text-ink">{titulo}</p>
      <p className="mt-0.5 truncate text-xs text-slate-warm">{detalle.replace(/^https?:\/\//, '')}</p>
    </a>
  )
}

function Copiable({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false)
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-ink/15 bg-ink">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-paper/60">snippet</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(texto)
            setCopiado(true)
            setTimeout(() => setCopiado(false), 1500)
          }}
          className="rounded-full bg-lime/90 px-2.5 py-1 text-[11px] font-semibold text-ink"
        >
          {copiado ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 pb-3 text-xs leading-relaxed text-paper/90">
        <code>{texto}</code>
      </pre>
    </div>
  )
}

// ── Formulario de registro ─────────────────────────────────────────────────

function FormularioApp({
  scopes,
  onCreada,
}: {
  scopes: ScopeDef[]
  onCreada: (app: App, secretos: Secretos) => void
}) {
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [sitioUrl, setSitioUrl] = useState('')
  const [redirects, setRedirects] = useState('')
  const [elegidos, setElegidos] = useState<string[]>(['verificacion:read'])
  const [enviando, setEnviando] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function toggle(id: string) {
    setElegidos((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]))
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setErr(null)
    try {
      const res = await authedFetch('/api/v1/developer/apps', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nombre,
          descripcion: descripcion || undefined,
          sitioUrl: sitioUrl || undefined,
          redirectUris: redirects
            .split(/[\n,]+/)
            .map((s) => s.trim())
            .filter(Boolean),
          scopes: elegidos,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? 'No se pudo registrar la app.')
      onCreada(data.app, data.secretos)
      setNombre('')
      setDescripcion('')
      setSitioUrl('')
      setRedirects('')
      setElegidos(['verificacion:read'])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al registrar.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form onSubmit={enviar} className="mt-4 space-y-4 rounded-2xl border border-ink/10 bg-paper p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="Nombre de la app">
          <input
            required
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="campo"
            placeholder="Seguros Pedalea"
          />
        </Campo>
        <Campo label="Sitio web (opcional)">
          <input
            value={sitioUrl}
            onChange={(e) => setSitioUrl(e.target.value)}
            className="campo"
            placeholder="https://pedalea.example"
          />
        </Campo>
      </div>
      <Campo label="Descripción (opcional)">
        <input
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          className="campo"
          placeholder="Cobertura de bicis verificadas en tiempo real."
        />
      </Campo>
      <Campo label="Redirect URIs (una por línea)">
        <textarea
          value={redirects}
          onChange={(e) => setRedirects(e.target.value)}
          rows={2}
          className="campo font-mono text-xs"
          placeholder="https://pedalea.example/oauth/callback"
        />
      </Campo>
      <div>
        <p className="text-sm font-medium text-ink">Scopes</p>
        <div className="mt-2 space-y-2">
          {scopes.map((s) => (
            <label key={s.id} className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={elegidos.includes(s.id)}
                onChange={() => toggle(s.id)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-ink">{s.titulo}</span>{' '}
                <code className="text-xs text-slate-warm">{s.id}</code>
                <span className="block text-xs text-slate-warm">{s.descripcion}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      {err && <p className="text-sm text-clay">{err}</p>}
      <button
        type="submit"
        disabled={enviando}
        className="inline-flex items-center justify-center rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-transform hover:-translate-y-0.5 disabled:opacity-50"
      >
        {enviando ? 'Registrando…' : 'Registrar app'}
      </button>
      <style jsx>{`
        :global(.campo) {
          width: 100%;
          border-radius: 0.6rem;
          border: 1px solid rgba(20, 22, 14, 0.15);
          background: var(--color-paper, #f2efe4);
          padding: 0.55rem 0.75rem;
          font-size: 0.875rem;
          color: var(--color-ink, #14160e);
        }
      `}</style>
    </form>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  )
}

// ── Tarjeta de app ───────────────────────────────────────────────────────────

function TarjetaApp({
  app,
  origin,
  secretos,
  expandida,
  onToggle,
  onCambio,
  onRotada,
}: {
  app: App
  origin: string
  scopes: ScopeDef[]
  secretos: Secretos | null
  expandida: boolean
  onToggle: () => void
  onCambio: () => void
  onRotada: (s: Secretos) => void
}) {
  const [accion, setAccion] = useState(false)

  async function patch(body: Record<string, unknown>) {
    setAccion(true)
    try {
      await authedFetch(`/api/v1/developer/apps/${app.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      onCambio()
    } finally {
      setAccion(false)
    }
  }

  async function rotar() {
    if (!confirm('Rotar credenciales invalida las anteriores y revoca los tokens vivos. ¿Continuar?'))
      return
    setAccion(true)
    try {
      const res = await authedFetch(`/api/v1/developer/apps/${app.id}/rotar`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) onRotada(data.secretos)
    } finally {
      setAccion(false)
    }
  }

  async function eliminar() {
    if (!confirm(`¿Eliminar "${app.nombre}"? Esta acción no se puede deshacer.`)) return
    setAccion(true)
    try {
      await authedFetch(`/api/v1/developer/apps/${app.id}`, { method: 'DELETE' })
      onCambio()
    } finally {
      setAccion(false)
    }
  }

  return (
    <div className="rounded-2xl border border-ink/10 bg-paper p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-ink">{app.nombre}</h3>
            <Pill tono={app.estado === 'activa' ? 'ok' : 'warn'}>{app.estado}</Pill>
            <Pill tono="neutro">{app.entorno}</Pill>
          </div>
          {app.descripcion && <p className="mt-0.5 text-sm text-slate-warm">{app.descripcion}</p>}
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="rounded-full border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink/80 hover:bg-paper-dim"
        >
          {expandida ? 'Ocultar' : 'Uso y webhooks'}
        </button>
      </div>

      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
        <CampoCred label="client_id" valor={app.clientId} />
        <CampoCred label="API Key" valor={`${app.apiKeyPrefix}··················`} />
      </dl>
      <p className="mt-2 text-xs text-slate-warm">
        Scopes: {app.scopes.join(', ') || '—'} · Límite: {app.rateLimitRpm} req/min
      </p>

      {secretos && <SecretosBox secretos={secretos} />}

      <div className="mt-4 flex flex-wrap gap-2">
        <BtnMini disabled={accion} onClick={rotar}>
          Rotar credenciales
        </BtnMini>
        <BtnMini
          disabled={accion}
          onClick={() => patch({ estado: app.estado === 'activa' ? 'suspendida' : 'activa' })}
        >
          {app.estado === 'activa' ? 'Suspender' : 'Reactivar'}
        </BtnMini>
        {app.entorno === 'sandbox' && (
          <BtnMini disabled={accion} onClick={() => patch({ entorno: 'produccion' })}>
            Promover a producción
          </BtnMini>
        )}
        <BtnMini disabled={accion} onClick={eliminar} peligro>
          Eliminar
        </BtnMini>
      </div>

      {expandida && (
        <div className="mt-5 space-y-5 border-t border-ink/10 pt-5">
          <UsoApp appId={app.id} />
          <WebhooksApp appId={app.id} origin={origin} />
        </div>
      )}
    </div>
  )
}

function SecretosBox({ secretos }: { secretos: Secretos }) {
  return (
    <div className="mt-4 rounded-xl border border-lime-deep/40 bg-lime/15 p-4">
      <p className="text-sm font-semibold text-ink">Guardá estas credenciales ahora</p>
      <p className="text-xs text-slate-warm">No se vuelven a mostrar. Conservalas en un lugar seguro.</p>
      <div className="mt-3 space-y-2">
        <CampoCred label="client_secret" valor={secretos.clientSecret} resaltado />
        <CampoCred label="API Key" valor={secretos.apiKey} resaltado />
      </div>
    </div>
  )
}

function CampoCred({
  label,
  valor,
  resaltado,
}: {
  label: string
  valor: string
  resaltado?: boolean
}) {
  const [copiado, setCopiado] = useState(false)
  return (
    <div>
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-warm">{label}</span>
      <div
        className={`mt-0.5 flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 ${
          resaltado ? 'border-ink/20 bg-paper' : 'border-ink/10 bg-paper-dim/40'
        }`}
      >
        <code className="truncate font-mono text-xs text-ink">{valor}</code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(valor)
            setCopiado(true)
            setTimeout(() => setCopiado(false), 1200)
          }}
          className="shrink-0 text-[11px] font-semibold text-lime-deep"
        >
          {copiado ? '✓' : 'Copiar'}
        </button>
      </div>
    </div>
  )
}

function UsoApp({ appId }: { appId: string }) {
  const [uso, setUso] = useState<Uso | null>(null)
  useEffect(() => {
    let activo = true
    authedFetch(`/api/v1/developer/apps/${appId}`)
      .then((r) => r.json())
      .then((d) => activo && setUso(d.uso ?? null))
      .catch(() => undefined)
    return () => {
      activo = false
    }
  }, [appId])

  if (!uso) return <p className="text-sm text-slate-warm">Cargando uso…</p>
  return (
    <div>
      <p className="text-sm font-semibold text-ink">Uso de la API</p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metrica n={uso.total} t="Llamadas" />
        <Metrica n={uso.ultimas24h} t="Últimas 24 h" />
        <Metrica n={uso.errores} t="Errores" />
        <Metrica n={uso.latenciaP95Ms ?? '—'} t="P95 (ms)" />
      </div>
      {uso.recientes.length > 0 && (
        <div className="mt-3 max-h-48 overflow-y-auto rounded-xl border border-ink/10">
          <table className="w-full text-left text-xs">
            <thead className="bg-paper-dim/50 text-slate-warm">
              <tr>
                <th className="px-2 py-1.5 font-medium">Endpoint</th>
                <th className="px-2 py-1.5 font-medium">Estado</th>
                <th className="px-2 py-1.5 font-medium">ms</th>
              </tr>
            </thead>
            <tbody>
              {uso.recientes.map((r, i) => (
                <tr key={i} className="border-t border-ink/5">
                  <td className="px-2 py-1.5 font-mono">
                    {r.metodo} {r.endpoint}
                  </td>
                  <td className={`px-2 py-1.5 ${r.status >= 400 ? 'text-clay' : 'text-ink'}`}>
                    {r.status}
                  </td>
                  <td className="px-2 py-1.5">{r.latenciaMs ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Metrica({ n, t }: { n: number | string; t: string }) {
  return (
    <div className="rounded-xl border border-ink/10 bg-paper-dim/30 p-3 text-center">
      <p className="text-lg font-semibold text-ink">{n}</p>
      <p className="text-[11px] text-slate-warm">{t}</p>
    </div>
  )
}

function WebhooksApp({ appId, origin }: { appId: string; origin: string }) {
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [eventos, setEventos] = useState<EventoDef[]>([])
  const [url, setUrl] = useState('')
  const [elegidos, setElegidos] = useState<string[]>([])
  const [nuevoSecret, setNuevoSecret] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const cargar = useCallback(() => {
    authedFetch(`/api/v1/developer/apps/${appId}/webhooks`)
      .then((r) => r.json())
      .then((d) => {
        setWebhooks(d.webhooks ?? [])
        setEventos(d.eventos ?? [])
      })
      .catch(() => undefined)
  }, [appId])

  useEffect(() => cargar(), [cargar])

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    const res = await authedFetch(`/api/v1/developer/apps/${appId}/webhooks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, eventos: elegidos }),
    })
    const data = await res.json()
    if (!res.ok) {
      setErr(data?.message ?? 'No se pudo crear.')
      return
    }
    setNuevoSecret(data.webhook?.secret ?? null)
    setUrl('')
    setElegidos([])
    cargar()
  }

  async function eliminar(id: string) {
    await authedFetch(`/api/v1/developer/apps/${appId}/webhooks/${id}`, { method: 'DELETE' })
    cargar()
  }

  return (
    <div>
      <p className="text-sm font-semibold text-ink">Webhooks de ecosistema</p>
      <p className="text-xs text-slate-warm">
        Recibí en tiempo real los cambios de estado público de las bicis. Cada entrega se firma con
        HMAC-SHA256 (cabecera <code>X-RODAID-Signature</code>).
      </p>

      {webhooks.length > 0 && (
        <ul className="mt-3 space-y-2">
          {webhooks.map((w) => (
            <li
              key={w.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink/10 bg-paper-dim/30 p-3 text-xs"
            >
              <div>
                <p className="font-mono text-ink">{w.url}</p>
                <p className="text-slate-warm">{w.eventos.join(', ')}</p>
              </div>
              <button
                type="button"
                onClick={() => eliminar(w.id)}
                className="text-clay hover:underline"
              >
                Eliminar
              </button>
            </li>
          ))}
        </ul>
      )}

      {nuevoSecret && (
        <div className="mt-3">
          <CampoCred label="signing secret (se muestra una vez)" valor={nuevoSecret} resaltado />
        </div>
      )}

      <form onSubmit={crear} className="mt-3 space-y-2">
        <input
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={`${origin}/webhooks/rodaid`}
          className="w-full rounded-lg border border-ink/15 bg-paper px-3 py-2 font-mono text-xs text-ink"
        />
        <div className="flex flex-wrap gap-3">
          {eventos.map((ev) => (
            <label key={ev.id} className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={elegidos.includes(ev.id)}
                onChange={() =>
                  setElegidos((prev) =>
                    prev.includes(ev.id) ? prev.filter((x) => x !== ev.id) : [...prev, ev.id]
                  )
                }
              />
              <span title={ev.descripcion}>{ev.titulo}</span>
            </label>
          ))}
        </div>
        {err && <p className="text-xs text-clay">{err}</p>}
        <button
          type="submit"
          className="rounded-full border border-ink/20 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-paper-dim"
        >
          Suscribir webhook
        </button>
      </form>
    </div>
  )
}


function SeccionSeguros() {
  return (
    <div className="mt-10 rounded-2xl border border-ink/10 bg-white p-6">
      <span className="text-xs font-semibold uppercase tracking-widest text-clay">Sector asegurador</span>
      <h2 className="mt-2 font-display text-xl font-semibold text-ink">RODAID para companias de seguros</h2>
      <p className="mt-2 text-sm text-slate-warm leading-relaxed">Integra la verificacion CIT en tu flujo de contratacion de polizas. Consulta si la bicicleta existe, tiene inspeccion tecnica auditada y no figura en la red de hurtos — todo via API REST en tiempo real.</p>
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-warm uppercase tracking-wide mb-1">Verificacion previa</p><p className="text-sm text-ink">Consulta el CIT antes de emitir la poliza. Elimina el riesgo de asegurar bicis robadas o inexistentes.</p></div>
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-warm uppercase tracking-wide mb-1">Alerta de hurto</p><p className="text-sm text-ink">Recibe un webhook automatico cuando una bici asegurada es denunciada como hurtada en la red RODAID.</p></div>
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-warm uppercase tracking-wide mb-1">Seguro CIT</p><p className="text-sm text-ink">Ofrece prima reducida a bicis con CIT activo. Menor riesgo, producto diferencial y alianza con RODAID.</p></div>
      </div>
      <div className="mt-6 rounded-xl bg-ink/3 p-4">
        <p className="text-xs font-semibold text-ink mb-2">Endpoint de verificacion</p>
        <code className="text-xs font-mono text-slate-warm">GET /api/v1/verificar/{'{numero_serie}'}</code>
      </div>
      <div className="mt-4 flex gap-3">
        <a href="mailto:contactoarribaeleste@gmail.com" className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-xs font-semibold text-paper hover:bg-ink/80">Solicitar acceso API</a>
        <a href="/sobre" className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-4 py-2 text-xs font-semibold text-ink hover:bg-ink/5">Ver propuesta completa</a>
      </div>
    </div>
  )
}

// ── Átomos ─────────────────────────────────────────────────────────────────

function Pill({ children, tono }: { children: React.ReactNode; tono: 'ok' | 'warn' | 'neutro' }) {
  const clases =
    tono === 'ok'
      ? 'bg-lime/30 text-ink'
      : tono === 'warn'
        ? 'bg-clay/15 text-clay'
        : 'bg-paper-dim text-slate-warm'
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${clases}`}>{children}</span>
  )
}

function BtnMini({
  children,
  onClick,
  disabled,
  peligro,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  peligro?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
        peligro
          ? 'border-clay/30 text-clay hover:bg-clay/10'
          : 'border-ink/15 text-ink/80 hover:bg-paper-dim'
      }`}
    >
      {children}
    </button>
  )
}
