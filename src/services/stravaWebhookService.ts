/**
 * RODAID — Hito 17 BYOD: Webhook de Ingesta Strava
 *
 * FASE 3: Recibe eventos de actividad de Strava, decodifica la
 * polilínea GPS, convierte a WKT y persiste en PostGIS.
 * FASE 4: Mantenimiento predictivo por odómetro acumulado.
 */


import { getPool } from '@/lib/marketplace'

const router = Router()

const STRAVA_CLIENT_ID     = process.env.STRAVA_CLIENT_ID     ?? ''
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET ?? ''
const STRAVA_VERIFY_TOKEN  = process.env.STRAVA_VERIFY_TOKEN  ?? 'rodaid-strava-webhook'

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
function coordsAWkt(coords: [number, number][]): string {
  if (coords.length < 2) return ''
  const puntos = coords.map(([lat, lng]) => `${lng} ${lat}`).join(', ')
  return `LINESTRING(${puntos})`
}

// ─── Helper: Renovar token Strava si expiró ───────────────────────────────────

async function getTokenValido(conn: {
  access_token: string
  refresh_token: string
  expires_at: Date
  id: string
}): Promise<string> {
  // Si el token expira en menos de 5 minutos, renovamos
  const expiraEn = new Date(conn.expires_at).getTime()
  if (expiraEn > Date.now() + 5 * 60 * 1000) {
    return conn.access_token
  }

  // Renovar token con refresh_token
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      refresh_token: conn.refresh_token,
      grant_type:    'refresh_token',
    }),
  })

  if (!res.ok) throw new Error(`Error renovando token Strava: ${res.status}`)

  const data = await res.json() as {
    access_token: string
    refresh_token: string
    expires_at: number
  }

  // Persistir token renovado
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

// ─── FASE 4: Mantenimiento Predictivo ────────────────────────────────────────

const UMBRAL_ALERTA_KM = 500 // Cada 500 km → alerta de mantenimiento

async function actualizarOdometro(
  bicicletaId: string,
  distanciaKm: number
): Promise<void> {
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

  // Verificar si cruzamos un múltiplo de 500 km
  const multiploActual = Math.floor(kmTotal / UMBRAL_ALERTA_KM)
  const multiploAnterior = Math.floor(kmUltimaAlerta / UMBRAL_ALERTA_KM)

  if (multiploActual > multiploAnterior) {
    const kmAlerta = multiploActual * UMBRAL_ALERTA_KM

    console.log(
      `[RODAID Predictivo] 🔧 Bici ${bicicletaId} alcanzó ${kmTotal.toFixed(0)} km totales.` +
      ` Alerta de mantenimiento preventivo: revisión de transmisión/cadena recomendada.`
    )

    // Actualizar última alerta y crear notificación
    await pool.query(
      `UPDATE bici_odometro SET ultima_alerta_km = $1 WHERE bicicleta_id = $2`,
      [kmAlerta, bicicletaId]
    )

    // TODO: Integrar con sistema de notificaciones RODAID (Hito 18)
    // await crearNotificacion({ tipo: 'MANTENIMIENTO_PREDICTIVO', bicicletaId, kmTotal })
  }
}

// ─── RUTA 1: Verificación del webhook (GET) ───────────────────────────────────

router.get('/', (req: Request, res: Response) => {
  const { 'hub.challenge': challenge, 'hub.verify_token': token } = req.query as {
    'hub.challenge'?: string
    'hub.verify_token'?: string
  }

  if (token !== STRAVA_VERIFY_TOKEN) {
    return res.status(403).json({ error: 'Token de verificación inválido.' })
  }

  return res.json({ 'hub.challenge': challenge })
})

// ─── RUTA 2: Ingesta de eventos (POST) ───────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  const { object_type, aspect_type, object_id, owner_id } = req.body as {
    object_type?: string
    aspect_type?: string
    object_id?: number
    owner_id?: number
  }

  // Responder inmediatamente (Strava espera < 2s o reintenta)
  res.status(200).json({ recibido: true })

  // Solo procesar creaciones de actividades
  if (object_type !== 'activity' || aspect_type !== 'create') return
  if (!object_id || !owner_id) return

  const pool = getPool()

  try {
    // 1. Buscar la conexión OAuth del atleta
    const connRes = await pool.query<{
      id: string
      user_id: string
      tenant_id: string
      access_token: string
      refresh_token: string
      expires_at: Date
    }>(
      `SELECT id, user_id, tenant_id, access_token, refresh_token, expires_at
       FROM oauth_connections
       WHERE provider = 'strava' AND provider_user_id = $1`,
      [String(owner_id)]
    )

    const conn = connRes.rows[0]
    if (!conn) {
      console.warn(`[Strava Webhook] Atleta ${owner_id} no encontrado en RODAID.`)
      return
    }

    // 2. Obtener token válido (renovar si expiró)
    const accessToken = await getTokenValido(conn)

    // 3. Obtener datos de la actividad desde la API de Strava
    const actRes = await fetch(
      `https://www.strava.com/api/v3/activities/${object_id}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )

    if (!actRes.ok) {
      console.error(`[Strava Webhook] Error al obtener actividad ${object_id}: ${actRes.status}`)
      return
    }

    const actividad = await actRes.json() as {
      id: number
      distance: number        // metros
      moving_time: number     // segundos
      total_elevation_gain: number
      average_speed: number   // m/s
      start_date: string
      map: { summary_polyline: string }
    }

    // 4. Decodificar polilínea y convertir a WKT
    const polyline = actividad.map?.summary_polyline
    const coords = polyline ? decodificarPolyline(polyline) : []
    const wkt = coords.length >= 2 ? coordsAWkt(coords) : null

    // 5. Buscar bicicleta del usuario (la más reciente con CIT activo)
    const biciRes = await pool.query<{ id: string }>(
      `SELECT b.id FROM bicicletas b
       JOIN cits c ON c.bicicleta_id = b.id
       WHERE b.propietario_id = $1 AND c.estado = 'activo'
       ORDER BY c.sellado_en DESC LIMIT 1`,
      [conn.user_id]
    )
    const bicicletaId = biciRes.rows[0]?.id ?? null

    // 6. Insertar actividad en bike_activities con geometría PostGIS
    await pool.query(
      `INSERT INTO bike_activities
        (tenant_id, user_id, bicicleta_id, activity_external_id, provider,
         distance_km, duration_seconds, elevation_gain_m, avg_speed_kmh, geom, created_at)
       VALUES ($1, $2, $3, $4, 'strava', $5, $6, $7, $8,
         ${wkt ? 'ST_GeomFromText($9, 4326)' : 'NULL'},
         $${wkt ? 10 : 9})
       ON CONFLICT (activity_external_id) DO NOTHING`,
      wkt
        ? [
            conn.tenant_id,
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
        : [
            conn.tenant_id,
            conn.user_id,
            bicicletaId,
            String(actividad.id),
            actividad.distance / 1000,
            actividad.moving_time,
            actividad.total_elevation_gain,
            (actividad.average_speed * 3.6).toFixed(2),
            actividad.start_date,
          ]
    )

    // 7. Mantenimiento predictivo (si hay bicicleta vinculada)
    if (bicicletaId) {
      await actualizarOdometro(bicicletaId, actividad.distance / 1000)
    }

    console.info(
      `[Strava Webhook] ✓ Actividad ${actividad.id} procesada para usuario ${conn.user_id}.` +
      ` Distancia: ${(actividad.distance / 1000).toFixed(2)} km.` +
      (wkt ? ` Ruta con ${coords.length} puntos GPS.` : ' Sin ruta GPS.')
    )
  } catch (err) {
    console.error('[Strava Webhook] Error procesando actividad:', err)
  }
})

export { router as stravaWebhookRouter }
