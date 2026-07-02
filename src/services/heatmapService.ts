/**
 * RODAID — Hito 17 BYOD: API de Mapa de Calor (PostGIS)
 *
 * FASE 4: Query de alta velocidad para renderizar el mapa de calor
 * de rutas por tenant usando ST_DumpPoints + ST_SnapToGrid.
 * Aislamiento absoluto de datos entre tenants.
 */

import { Router, Request, Response } from 'express'
import { getPool } from '@/lib/marketplace'

const router = Router()

/**
 * GET /api/v1/analytics/heatmap?tenantId=rodaid
 *
 * Devuelve los puntos más transitados del tenant agrupados en
 * cuadrículas de ~50 metros para el mapa de calor del frontend.
 *
 * El valor 0.0005 grados ≈ 50 metros en latitudes medias (Mendoza ~32°S).
 * Ajustar según zoom/precisión deseada.
 */
router.get('/', async (req: Request, res: Response) => {
  const { tenantId, bicicletaId, desde, hasta } = req.query as {
    tenantId?: string
    bicicletaId?: string
    desde?: string
    hasta?: string
  }

  if (!tenantId) {
    return res.status(400).json({ error: 'tenantId es requerido.' })
  }

  const pool = getPool()

  try {
    // Filtros opcionales
    const filtros: string[] = ['ba.tenant_id = $1']
    const params: unknown[] = [tenantId]
    let paramIdx = 2

    if (bicicletaId) {
      filtros.push(`ba.bicicleta_id = $${paramIdx++}`)
      params.push(bicicletaId)
    }
    if (desde) {
      filtros.push(`ba.created_at >= $${paramIdx++}`)
      params.push(desde)
    }
    if (hasta) {
      filtros.push(`ba.created_at <= $${paramIdx++}`)
      params.push(hasta)
    }

    const where = filtros.join(' AND ')

    /**
     * Query de clustering espacial con PostGIS:
     * 1. ST_DumpPoints descompone cada LineString (ruta) en puntos individuales
     * 2. ST_SnapToGrid agrupa puntos cercanos en celdas de ~50m
     * 3. COUNT(*) mide la intensidad (cuántas rutas pasaron por ese punto)
     * 4. ST_AsGeoJSON convierte la geometría a formato JSON para el frontend
     */
    const result = await pool.query(
      `
      SELECT
        ST_AsGeoJSON(ST_Centroid(ST_Collect(geom_dump.geom)))::json AS coordinate,
        COUNT(*) AS intensity
      FROM (
        SELECT (ST_DumpPoints(ba.geom)).geom
        FROM bike_activities ba
        WHERE ${where}
          AND ba.geom IS NOT NULL
      ) AS geom_dump
      GROUP BY ST_SnapToGrid(geom_dump.geom, 0.0005)
      ORDER BY intensity DESC
      LIMIT 5000
      `,
      params
    )

    return res.json({
      tenantId,
      total_puntos: result.rows.length,
      puntos: result.rows.map((r) => ({
        coordinate: r.coordinate,
        intensity: parseInt(r.intensity),
      })),
    })
  } catch (err) {
    console.error('[Heatmap] Error:', err)
    return res.status(500).json({ error: 'Error al generar el mapa de calor.' })
  }
})

/**
 * GET /api/v1/analytics/odometro/:bicicletaId
 * Devuelve el odómetro acumulado y próximas alertas de mantenimiento.
 */
router.get('/odometro/:bicicletaId', async (req: Request, res: Response) => {
  const { bicicletaId } = req.params
  const pool = getPool()

  const res2 = await pool.query(
    `SELECT km_totales, ultima_actividad, ultima_alerta_km
     FROM bici_odometro WHERE bicicleta_id = $1`,
    [bicicletaId]
  )

  const data = res2.rows[0]
  if (!data) return res.json({ km_totales: 0, proxima_revision_km: 500 })

  const kmTotales = parseFloat(data.km_totales)
  const proximoMultiplo = (Math.floor(kmTotales / 500) + 1) * 500

  return res.json({
    bicicletaId,
    km_totales: kmTotales,
    km_hasta_proxima_revision: proximoMultiplo - kmTotales,
    proxima_revision_km: proximoMultiplo,
    ultima_actividad: data.ultima_actividad,
  })
})

export { router as heatmapRouter }
