'use client'

import useSWR from 'swr'
import { authedFetch } from '@/lib/session'

/** Espejo de src/services/spotify.service.ts::SpotifyTrack. */
export interface SpotifyTrack {
  id: string
  nombre: string
  artista: string
  imagenUrl: string | null
  spotifyUrl: string
}

export interface SpotifyTopTracksResponse {
  conectado: boolean
  tracks: SpotifyTrack[]
}

async function authedJson<T>(url: string): Promise<T> {
  const res = await authedFetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

export function useSpotifyTopTracks() {
  return useSWR<SpotifyTopTracksResponse>('/api/v1/spotify/top-tracks', authedJson, {
    revalidateOnFocus: false,
  })
}
