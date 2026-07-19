import { getPool } from '@/lib/marketplace'
import { cifrarSpotify, descifrarSpotify } from '@/src/services/cifrado.service'

/**
 * RODAID — Conexión de Spotify por usuario (Garaje Digital, "tarjeta
 * semanal"). Mismo patrón de OAuth2 que Strava (app/api/v1/auth/strava/*),
 * reusando `oauth_connections` (genérica por `provider`, sin migración
 * necesaria) y el mismo criterio de "una clave de cifrado por dominio"
 * (`cifrado.service.ts::cifrarSpotify`/`descifrarSpotify`).
 *
 * Scope minimo a proposito: `user-top-read` (top tracks por afinidad, sin
 * timestamps) en vez de `user-read-recently-played` (historial cronologico
 * de escucha, mas revelador de habitos/horarios) -- confirmado contra la
 * documentacion oficial de Spotify antes de implementar.
 *
 * LIMITE HONESTO, documentado tambien en CLAUDE.md: esta app opera en
 * Development Mode de Spotify (hasta 5 usuarios de prueba autenticados,
 * sin necesitar aprobacion de Spotify). Escalar a toda la base de RODAID
 * exige Extended Quota Mode, que requiere ser una entidad de negocio
 * registrada con minimo 250.000 MAU -- un piso que RODAID no cumple hoy.
 * El sexto usuario que intente conectar se encuentra con el propio rechazo
 * de Spotify en su pantalla de autorizacion (fuera del control de RODAID),
 * que ya cae en el manejo de `error` existente en el callback.
 */

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID ?? ''
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET ?? ''

export function spotifyBasicAuthHeader(): string {
  return 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')
}

interface OauthConnectionRow {
  access_token: string
  refresh_token: string
  expires_at: string
}

interface SpotifyTokenRefrescado {
  accessToken: string
  refreshToken: string
  expiresAt: Date
}

async function refrescarToken(refreshToken: string): Promise<SpotifyTokenRefrescado> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: spotifyBasicAuthHeader(),
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  })
  if (!res.ok) {
    throw new Error('No se pudo refrescar el token de Spotify.')
  }
  const data = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }
  return {
    accessToken: data.access_token,
    // Spotify a veces no rota el refresh_token -- si no viene uno nuevo, el
    // vigente sigue siendo valido.
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  }
}

/**
 * Access token vigente de Spotify para el usuario, refrescando (y
 * persistiendo el refresco) si hizo falta. `null` si el usuario no tiene
 * una conexion de Spotify.
 */
async function obtenerAccessTokenVigente(userId: string): Promise<string | null> {
  const pool = getPool()
  const res = await pool.query<OauthConnectionRow>(
    `SELECT access_token, refresh_token, expires_at
     FROM oauth_connections
     WHERE user_id = $1 AND provider = 'spotify'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId]
  )
  const row = res.rows[0]
  if (!row) return null

  const expiresAt = new Date(row.expires_at)
  // 30s de margen para no pisar el filo del vencimiento.
  if (expiresAt.getTime() > Date.now() + 30_000) {
    return descifrarSpotify(row.access_token)
  }

  const refrescado = await refrescarToken(descifrarSpotify(row.refresh_token))
  await pool.query(
    `UPDATE oauth_connections
     SET access_token = $2, refresh_token = $3, expires_at = $4, updated_at = NOW()
     WHERE user_id = $1 AND provider = 'spotify'`,
    [
      userId,
      cifrarSpotify(refrescado.accessToken),
      cifrarSpotify(refrescado.refreshToken),
      refrescado.expiresAt,
    ]
  )
  return refrescado.accessToken
}

export interface SpotifyTrack {
  id: string
  nombre: string
  artista: string
  imagenUrl: string | null
  spotifyUrl: string
}

export interface SpotifyTopTracksResultado {
  conectado: boolean
  tracks: SpotifyTrack[]
}

/**
 * Top tracks recientes (`time_range=short_term`, ~4 semanas) del usuario.
 * `conectado: false` si nunca vinculo su cuenta. Si Spotify rechaza el
 * access_token (revocado del lado del usuario, etc.) se devuelve
 * `conectado: true, tracks: []` en vez de lanzar -- un fallo de Spotify no
 * debe romper el Garaje.
 */
export async function obtenerTopTracks(userId: string): Promise<SpotifyTopTracksResultado> {
  const accessToken = await obtenerAccessTokenVigente(userId)
  if (!accessToken) {
    return { conectado: false, tracks: [] }
  }

  const res = await fetch(
    'https://api.spotify.com/v1/me/top/tracks?time_range=short_term&limit=5',
    { headers: { authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) {
    return { conectado: true, tracks: [] }
  }

  const data = (await res.json()) as {
    items: Array<{
      id: string
      name: string
      artists: Array<{ name: string }>
      album: { images: Array<{ url: string }> }
      external_urls: { spotify: string }
    }>
  }

  return {
    conectado: true,
    tracks: data.items.map((t) => ({
      id: t.id,
      nombre: t.name,
      artista: t.artists.map((a) => a.name).join(', '),
      imagenUrl: t.album.images[0]?.url ?? null,
      spotifyUrl: t.external_urls.spotify,
    })),
  }
}
