import { getPool } from '@/lib/marketplace'
import { withTenant } from '@/lib/tenant'

/**
 * RODAID — Hito 17 BYOD: Ingesta de eventos Strava (webhook).
 *
 * Port 2026-07-18: este archivo reemplaza a `stravaWebhookService.ts`, que
 * nacio como stub Express (`Router()`, sin siquiera importar `express`) en
 * el mismo commit que creo la ruta Next.js real, y quedo desconectado desde
 * entonces con un comentario "hasta migrar a Next.js routes" que nunca se
 * cumplio. La logica de dominio (decodificar polilinea, renovar token,
 * odometro) ya estaba confirmada sana contra el schema real -- este port
 * solo cambia la forma (Express -> funcion llamada desde
 * app/api/v1/webhooks/strava/route.ts) y corrige dos bugs reales que tenia
 * el codigo muerto:
 *
 *   1. RLS silencioso: la busqueda de la bici del usuario toca `bicicletas`
 *      (RLS activo desde 20260706000003_multi_tenant_rls.sql) via
 *      `getPool()` directo -- sin `withTenant()`, esa query siempre
 *      devolveria 0 filas sin error visible. Ahora corre dentro de
 *      `withTenant('rodaid', ...)`, unico tramo de esta funcion que toca
 *      una tabla con RLS (`oauth_connections`/`bike_activities`/
 *      `bici_odometro` no tienen RLS, siguen en `pool.query` directo).
 *   2. `tenant_id` en `oauth_connections`/`bike_activities`: columna
 *      eliminada (ver migracion 20260718000007) -- quedaba apuntando a nada
 *      real desde que `tenants` se recreo con PK UUID, sin RLS que la
 *      necesite y sin ningun codigo que la filtrara.
 *
 * `c.estado = 'activo'` (minuscula) SI se verifico contra datos reales de
 * produccion antes de este port (2 filas 'activo', 1 'pendiente', ambas
 * minuscula) -- no es un casing sin confirmar.
 */

// ─── Helper: Decodificador de Google Encoded Polyline ────────────────────────

/**
 * Decodifica una polilínea comprimida en formato Google Encoded Polyline
 * a un array de coordenadas [[lat, lng], ...].
 * Spec: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
function decodificarPolyline(encoded: string): [number, number][] {
  const coords: [number, number][] = []
  let index = 0
  let lat = 0
  let lng = 0

  while (index < encoded.length) {
    let b: number
    let shift = 0
    let result = 0

    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)

    lat += result & 1 ? ~(result >> 1) : result >> 1
    shift = 0
    result = 0

    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)

    lng += result & 1 ? ~(result >> 1) : result >> 1
    coords.push([lat / 1e5, lng / 1e5])
  }

  return coords
}

/**
 * Convierte array de coordenadas a WKT LineString.
 * PostGIS requiere el orden: LONGITUD LATITUD (no lat/lng).
 */
function coordsAWkt(coords: [number, number][]): string | null {
  if (coords.length < 2) return null
  const puntos = coords.map(([lat, lng]) => `${lng} ${lat}`).join(', ')
  return `LINESTRING(${puntos})`
}

// ─── Helper: Renovar token Strava si expiró ───────────────────────────────────

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID ?? ''
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET ?? ''

interface ConexionOauth {
  id: string
  user_id: string
  access_token: string
  refresh_token: string
  expires_at: Date
}

async function getTokenValido(conn: ConexionOauth): Promise<string> {
  // Si el token expira en menos de 5 minutos, renovamos
  const expiraEn = new Date(conn.expires_at).getTime()
  if (expiraEn > Date.now() + 5 * 60 * 1000) {
    return conn.access_token
  }

  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      refresh_token: conn.refresh_token,
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) throw new Error(`Error renovando token Strava: ${res.status}`)

  const data = (await res.json()) as {
    access_token: string
    refresh_token: string
    expires_at: number
  }

  const pool = getPool()
  await pool.query(
    `UPDATE oauth_connections SET
      access_token  = $1,
      refresh_token = $2,
      expires_at    = to_timestamp($3),
      updated_at    = NOW()
    WHERE id = $4`,
    [data.access_token, data.refresh_token, data.expires_at, conn.id]
  )

  return data.access_token
}

// ─── Mantenimiento predictivo por odómetro acumulado ────────────────────────

const UMBRAL_ALERTA_KM = 500 // Cada 500 km → alerta de mantenimiento

async function actualizarOdometro(bicicletaId: string, distanciaKm: number): Promise<void> {
  const pool = getPool()

  const res = await pool.query<{ km_totales: string; ultima_alerta_km: string }>(
    `
    INSERT INTO bici_odometro (bicicleta_id, km_totales, ultima_actividad, ultima_alerta_km)
    VALUES ($1, $2, NOW(), 0)
    ON CONFLICT (bicicleta_id) DO UPDATE SET
      km_totales       = bici_odometro.km_totales + EXCLUDED.km_totales,
      ultima_actividad = NOW(),
      updated_at       = NOW()
    RETURNING km_totales, ultima_alerta_km
    `,
    [bicicletaId, distanciaKm]
  )

  const { km_totales, ultima_alerta_km } = res.rows[0]
  const kmTotal = parseFloat(km_totales)
  const kmUltimaAlerta = parseFloat(ultima_alerta_km)

  const multiploActual = Math.floor(kmTotal / UMBRAL_ALERTA_KM)
  const multiploAnterior = Math.floor(kmUltimaAlerta / UMBRAL_ALERTA_KM)

  if (multiploActual > multiploAnterior) {
    const kmAlerta = multiploActual * UMBRAL_ALERTA_KM

    console.log(
      `[Strava webhook] Bici ${bicicletaId} alcanzó ${kmTotal.toFixed(0)} km totales.` +
        ' Alerta de mantenimiento preventivo: revisión de transmisión/cadena recomendada.'
    )

    await pool.query(`UPDATE bici_odometro SET ultima_alerta_km = $1 WHERE bicicleta_id = $2`, [
      kmAlerta,
      bicicletaId,
    ])

    // TODO: Integrar con sistema de notificaciones RODAID (Hito 18)
  }
}

// ─── Ingesta de eventos ──────────────────────────────────────────────────────

interface ActividadStrava {
  id: number
  distance: number // metros
  moving_time: number // segundos
  total_elevation_gain: number
  average_speed: number // m/s
  start_date: string
  map: { summary_polyline: string }
}

export interface EventoStrava {
  object_type?: string
  aspect_type?: string
  object_id?: number
  owner_id?: number
}

export async function procesarEventoStrava(evento: EventoStrava): Promise<void> {
  // Solo procesar creaciones de actividades.
  if (evento.object_type !== 'activity' || evento.aspect_type !== 'create') return
  if (!evento.object_id || !evento.owner_id) return

  const pool = getPool()

  try {
    // 1. Conexión OAuth del atleta (sin RLS -- pool.query directo).
    const connRes = await pool.query<ConexionOauth>(
      `SELECT id, user_id, access_token, refresh_token, expires_at
       FROM oauth_connections
       WHERE provider = 'strava' AND provider_user_id = $1`,
      [String(evento.owner_id)]
    )

    const conn = connRes.rows[0]
    if (!conn) {
      console.warn(`[Strava webhook] Atleta ${evento.owner_id} no encontrado en RODAID.`)
      return
    }

    // 2. Token válido (renueva si expiró).
    const accessToken = await getTokenValido(conn)

    // 3. Datos de la actividad desde la API de Strava.
    const actRes = await fetch(`https://www.strava.com/api/v3/activities/${evento.object_id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!actRes.ok) {
      console.error(`[Strava webhook] Error al obtener actividad ${evento.object_id}: ${actRes.status}`)
      return
    }

    const actividad = (await actRes.json()) as ActividadStrava

    // 4. Decodificar polilínea y convertir a WKT.
    const polyline = actividad.map?.summary_polyline
    const coords = polyline ? decodificarPolyline(polyline) : []
    const wkt = coordsAWkt(coords)

    // 5. Bici del usuario (la más reciente con CIT activo) -- ÚNICO tramo
    //    que toca `bicicletas`/`cits`, ambas con RLS: tiene que correr
    //    dentro de withTenant(), no en pool.query directo.
    const filasBici = await withTenant<{ id: string }>('rodaid', async (client) => {
      const biciRes = await client.query(
        `SELECT b.id FROM bicicletas b
         JOIN cits c ON c.bicicleta_id = b.id
         WHERE b.propietario_id = $1 AND c.estado = 'activo'
         ORDER BY c.sellado_en DESC LIMIT 1`,
        [conn.user_id]
      )
      return biciRes.rows
    })
    const bicicletaId = filasBici[0]?.id ?? null

    // 6. Insertar actividad en bike_activities con geometría PostGIS.
    //    ST_GeomFromText(NULL, ...) devuelve NULL (funcion strict de
    //    PostGIS) -- un unico placeholder posicional para wkt, sin la
    //    rama de indices de parametros que tenia el codigo original.
    await pool.query(
      `INSERT INTO bike_activities
        (user_id, bicicleta_id, activity_external_id, provider,
         distance_km, duration_seconds, elevation_gain_m, avg_speed_kmh, geom, created_at)
       VALUES ($1, $2, $3, 'strava', $4, $5, $6, $7, ST_GeomFromText($8, 4326), $9)
       ON CONFLICT (activity_external_id) DO NOTHING`,
      [
        conn.user_id,
        bicicletaId,
        String(actividad.id),
        actividad.distance / 1000,
        actividad.moving_time,
        actividad.total_elevation_gain,
        (actividad.average_speed * 3.6).toFixed(2),
        wkt,
        actividad.start_date,
      ]
    )

    // 7. Mantenimiento predictivo (si hay bicicleta vinculada).
    if (bicicletaId) {
      await actualizarOdometro(bicicletaId, actividad.distance / 1000)
    }

    console.info(
      `[Strava webhook] Actividad ${actividad.id} procesada para usuario ${conn.user_id}.` +
        ` Distancia: ${(actividad.distance / 1000).toFixed(2)} km.` +
        (wkt ? ` Ruta con ${coords.length} puntos GPS.` : ' Sin ruta GPS.')
    )
  } catch (err) {
    console.error('[Strava webhook] Error procesando actividad:', err)
  }
}
