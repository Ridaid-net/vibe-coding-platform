'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { authedFetch } from '@/lib/session'

/**
 * Pantalla de CONSENTIMIENTO EXPRESO del usuario (Hito 16).
 *
 * Cierra el flujo OAuth2: una app de terceros redirige al dueño de la bici acá,
 * con sus parámetros (client_id, redirect_uri, scope, state, PKCE). La pantalla
 * describe qué pide la app, el usuario elige la bicicleta a compartir y autoriza
 * (o cancela). Solo entonces se emite el código y se vuelve a la app. En ningún
 * caso se comparten datos personales: el tercero solo accede a estado público.
 */

interface ScopeDef {
  id: string
  titulo: string
  descripcion: string
}
interface Metadata {
  valido: boolean
  app: { nombre: string; descripcion: string | null; sitioUrl: string | null; entorno: string }
  scopes: ScopeDef[]
  redirectUri: string
  state: string | null
}
interface Bici {
  id: string
  marca: string
  modelo: string
  numeroSerie: string
  estado: string
  codigoCit: string | null
}

export function ConectarConsent() {
  const params = useSearchParams()
  const [meta, setMeta] = useState<Metadata | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bicis, setBicis] = useState<Bici[]>([])
  const [seleccion, setSeleccion] = useState<string>('')
  const [enviando, setEnviando] = useState(false)

  const clientId = params.get('client_id')
  const redirectUri = params.get('redirect_uri')
  const scope = params.get('scope')

  useEffect(() => {
    let activo = true
    const qs = new URLSearchParams()
    if (clientId) qs.set('client_id', clientId)
    if (redirectUri) qs.set('redirect_uri', redirectUri)
    if (scope) qs.set('scope', scope)
    qs.set('response_type', params.get('response_type') ?? 'code')

    fetch(`/api/v1/developer/oauth/authorize?${qs.toString()}`)
      .then(async (r) => {
        const data = await r.json()
        if (!activo) return
        if (!r.ok) {
          setError(data?.message ?? 'La solicitud de autorización no es válida.')
          return
        }
        setMeta(data as Metadata)
      })
      .catch(() => activo && setError('No pudimos validar la solicitud.'))

    authedFetch('/api/usuario/bicicletas')
      .then(async (r) => (r.ok ? r.json() : { activos: [] }))
      .then((data) => {
        if (!activo) return
        const lista: Bici[] = (data.activos ?? []).map((a: Record<string, unknown>) => ({
          id: a.id as string,
          marca: (a.marca as string) ?? '',
          modelo: (a.modelo as string) ?? '',
          numeroSerie: (a.numeroSerie as string) ?? '',
          estado: (a.estado as string) ?? '',
          codigoCit: (a.codigoCit as string) ?? null,
        }))
        setBicis(lista)
        if (lista.length) setSeleccion(lista[0].id)
      })
      .catch(() => undefined)

    return () => {
      activo = false
    }
  }, [clientId, redirectUri, scope, params])

  async function decidir(aceptar: boolean) {
    setEnviando(true)
    try {
      const res = await authedFetch('/api/v1/developer/oauth/authorize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          scope,
          state: params.get('state') ?? undefined,
          code_challenge: params.get('code_challenge') ?? undefined,
          code_challenge_method: params.get('code_challenge_method') ?? undefined,
          bicicleta_id: seleccion || undefined,
          aceptar,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.message ?? 'No se pudo completar la autorización.')
        setEnviando(false)
        return
      }
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl as string
      }
    } catch {
      setError('No se pudo completar la autorización.')
      setEnviando(false)
    }
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-clay/30 bg-clay/5 p-8">
        <h1 className="text-xl font-semibold text-ink">Solicitud no válida</h1>
        <p className="mt-2 text-sm text-slate-warm">{error}</p>
      </div>
    )
  }
  if (!meta) {
    return (
      <div className="rounded-2xl border border-ink/10 bg-paper-dim/40 p-8 text-center text-slate-warm">
        Validando la solicitud…
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-ink/10 bg-paper-dim/30 p-7 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-warm">
        Solicitud de acceso
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
        {meta.app.nombre}{' '}
        <span className="align-middle text-xs font-medium text-slate-warm">
          ({meta.app.entorno})
        </span>
      </h1>
      {meta.app.descripcion && (
        <p className="mt-1 text-sm text-slate-warm">{meta.app.descripcion}</p>
      )}
      <p className="mt-3 text-sm text-ink/80">
        Esta aplicación quiere acceder al <strong>estado público verificado</strong> de una de tus
        bicicletas. Nunca verá tus datos personales.
      </p>

      <div className="mt-5">
        <p className="text-sm font-semibold text-ink">Permisos solicitados</p>
        <ul className="mt-2 space-y-2">
          {meta.scopes.map((s) => (
            <li key={s.id} className="rounded-xl border border-ink/10 bg-paper p-3">
              <p className="text-sm font-medium text-ink">{s.titulo}</p>
              <p className="text-xs text-slate-warm">{s.descripcion}</p>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5">
        <label className="text-sm font-semibold text-ink" htmlFor="bici">
          Bicicleta a compartir
        </label>
        {bicis.length ? (
          <select
            id="bici"
            value={seleccion}
            onChange={(e) => setSeleccion(e.target.value)}
            className="mt-2 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm text-ink"
          >
            {bicis.map((b) => (
              <option key={b.id} value={b.id}>
                {[b.marca, b.modelo].filter(Boolean).join(' ') || 'Bicicleta'} · Serie {b.numeroSerie}
                {b.codigoCit ? ` · ${b.codigoCit}` : ''}
              </option>
            ))}
          </select>
        ) : (
          <p className="mt-2 text-sm text-slate-warm">
            No encontramos bicicletas en tu cuenta. Registrá una antes de autorizar.
          </p>
        )}
      </div>

      <div className="mt-7 flex items-center gap-3">
        <button
          type="button"
          disabled={enviando || !seleccion}
          onClick={() => decidir(true)}
          className="inline-flex flex-1 items-center justify-center rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-transform hover:-translate-y-0.5 disabled:opacity-50"
        >
          {enviando ? 'Autorizando…' : 'Autorizar acceso'}
        </button>
        <button
          type="button"
          disabled={enviando}
          onClick={() => decidir(false)}
          className="inline-flex items-center justify-center rounded-full border border-ink/15 px-5 py-2.5 text-sm font-medium text-ink/80 transition-colors hover:bg-paper-dim disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>

      <p className="mt-4 text-center text-xs text-slate-warm">
        Vas a volver a {redirectUri ? new URL(redirectUri).host : 'la aplicación'} · Tu consentimiento
        es revocable desde tu cuenta de RODAID.
      </p>
    </div>
  )
}
