'use client'

import { useEffect } from 'react'
import { Music } from 'lucide-react'
import { toast } from 'sonner'
import { useSpotifyTopTracks } from '@/lib/spotify'

/**
 * "Tarjeta semanal" — Garaje Digital, junto a ArmaTuSalida/MisSalidas (mismo
 * criterio de ubicacion: "algo tuyo antes de salir a rodar"). Resultado de
 * la conexion de Spotify (ver iot-tiempo-real.tsx para el boton "Conectar
 * Spotify" -- esta tarjeta NUNCA inicia la conexion, solo muestra el
 * resultado, tal como se definio).
 *
 * LIMITE HONESTO, a proposito visible en la UI (mismo criterio que "Modo
 * Robo"): esta app de Spotify opera en Development Mode (hasta 5 cuentas de
 * prueba) mientras no se solicite Extended Quota Mode -- ver CLAUDE.md /
 * spotify.service.ts para el detalle completo.
 */
export function TarjetaSemanal() {
  const { data, isLoading, mutate } = useSpotifyTopTracks()

  // Cierra el loop del redirect de OAuth (?spotify=vinculada / ?error=spotify_*)
  // -- sin esto, el usuario vuelve del login de Spotify y no ve ninguna
  // confirmacion, solo la tarjeta "recargandose" en silencio.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const spotify = params.get('spotify')
    const error = params.get('error')
    if (spotify === 'vinculada') {
      toast.success('Spotify conectado', {
        description: 'Ya podés ver tu música en tu Garaje.',
      })
      mutate()
    } else if (error?.startsWith('spotify_')) {
      toast.error('No pudimos conectar Spotify', {
        description:
          error === 'spotify_cancelada'
            ? 'Cancelaste la conexión o Spotify la rechazó.'
            : 'Probá de nuevo en unos minutos.',
      })
    } else {
      return
    }
    const url = new URL(window.location.href)
    url.searchParams.delete('spotify')
    url.searchParams.delete('error')
    window.history.replaceState({}, '', url.toString())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (isLoading) {
    return (
      <div className="mt-4 h-24 animate-pulse rounded-3xl border border-ink/10 bg-white/50" />
    )
  }

  const conectado = data?.conectado ?? false
  const tracks = data?.tracks ?? []

  return (
    <div className="mt-4 rounded-3xl border border-ink/10 bg-white p-5">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#1DB954]/15 text-[#1DB954]">
          <Music className="size-4.5" />
        </span>
        <div>
          <p className="font-display text-base font-bold text-ink">
            Tu música antes de rodar
          </p>
          <p className="text-xs text-slate-warm">Lo que más escuchaste este mes, vía Spotify.</p>
        </div>
      </div>

      {!conectado ? (
        // PAUSADO a proposito (2026-07-18): ver la nota gemela en
        // iot-tiempo-real.tsx -- SPOTIFY_CLIENT_ID/SECRET todavia no estan
        // cargados en Netlify, asi que el boton de conectar (comentado mas
        // abajo) mandaria a un login de Spotify que siempre rechaza. NO
        // reactivar hasta confirmar las credenciales (ver CLAUDE.md).
        <div className="mt-4">
          <p className="text-xs text-slate-warm">
            Muy pronto vas a poder conectar tu Spotify acá.
          </p>
          {/*
          <a
            href="/api/v1/auth/spotify"
            className="inline-flex items-center gap-2 rounded-full bg-[#1DB954] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#1DB954]/80"
          >
            <Music className="size-3.5" />
            Conectar Spotify
          </a>
          <p className="mt-2 text-[11px] leading-snug text-slate-warm">
            Beta — cupo limitado a pocas cuentas mientras validamos la integración con Spotify.
          </p>
          */}
        </div>
      ) : tracks.length === 0 ? (
        <p className="mt-4 text-xs text-slate-warm">
          Todavía no tenemos suficiente actividad tuya en Spotify. Volvé a pasar en unos días.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {tracks.slice(0, 3).map((t) => (
            <iframe
              key={t.id}
              title={`${t.nombre} — ${t.artista}`}
              src={`https://open.spotify.com/embed/track/${t.id}?theme=0`}
              width="100%"
              height="80"
              loading="lazy"
              style={{ borderRadius: 12, border: 'none' }}
              allow="encrypted-media"
            />
          ))}
        </div>
      )}
    </div>
  )
}
