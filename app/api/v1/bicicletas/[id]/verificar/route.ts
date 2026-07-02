import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { ApiError, getPool, jsonError, requireUser } from '@/lib/marketplace'
import { getModo } from '@/src/services/mercadopago.service'
import {
  encolarValidacion,
  procesarJob,
} from '@/src/services/validation.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/bicicletas/[id]/verificar — Solicitar la verificacion de
 * identidad (CIT) de una bicicleta e iniciar el Pipeline de Validacion de 72hs.
 *
 * Flujo (Hito 5):
 *   1. Crea el CIT en estado 'pendiente'.
 *   2. ENCOLA el cit_id en `cola_validaciones` (worker espera 72hs y corre el
 *      cross-reference contra el Ministerio de Seguridad).
 *   3. La decision (activo / bloqueado) la toma el worker, no este endpoint.
 *
 * Para no romper el flujo de demo de los hitos anteriores (publicar de punta a
 * punta sin esperar 72hs), fuera del modo LIVE de MercadoPago el pipeline se
 * ejecuta INLINE al instante (misma logica, ventana ignorada): el CIT queda
 * 'activo' o 'bloqueado' en la misma solicitud. En LIVE queda 'pendiente' a la
 * espera del worker programado.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const pool = getPool()
  const client = await pool.connect()

  let citId: string
  let codigoCit: string
  try {
    const { id } = await params
    const user = await requireUser(req)

    await client.query('BEGIN')

    // 1. La bicicleta debe existir y pertenecer al usuario autenticado.
    const biciResult = await client.query<{
      id: string
      propietario_id: string
      numero_serie: string
    }>(
      `SELECT id, propietario_id, numero_serie FROM bicicletas WHERE id = $1 FOR UPDATE`,
      [id]
    )
    const bici = biciResult.rows[0]
    if (!bici) {
      throw new ApiError(404, 'BICICLETA_NOT_FOUND', 'La bicicleta indicada no existe.')
    }
    if (bici.propietario_id !== user.id) {
      throw new ApiError(403, 'NOT_OWNER', 'No sos el propietario de esta bicicleta.')
    }

    // 2. Si ya hay un CIT activo y vigente, no hay nada que hacer.
    const activoResult = await client.query<{
      id: string
      codigo_cit: string
      fecha_vencimiento: string
    }>(
      `
        SELECT id, codigo_cit, fecha_vencimiento
        FROM cits
        WHERE bicicleta_id = $1
          AND estado = 'activo'
          AND fecha_vencimiento > NOW()
        ORDER BY acunado_en DESC
        LIMIT 1
      `,
      [bici.id]
    )
    if (activoResult.rows[0]) {
      await client.query('COMMIT')
      return NextResponse.json({
        estado: 'activo',
        codigoCit: activoResult.rows[0].codigo_cit,
        yaVerificada: true,
      })
    }

    // 3. Emitir el CIT en estado 'pendiente': el pipeline decide su destino.
    codigoCit = generarCodigoCit(bici.numero_serie)
    const insert = await client.query<{ id: string; codigo_cit: string }>(
      `
        INSERT INTO cits (bicicleta_id, ciclista_id, aliado_id, bicicleta_serial, estado, codigo_cit, metadata_json, huella_sha256, firma_hmac, algoritmo, snapshot_canonico, sellado_en, expira_en, inspeccion)
        VALUES ($1, $4, $4, $5, 'pendiente'::cit_estado, $2, $3::jsonb, $6, $7, 'SHA256', $8::jsonb, NOW(), NOW() + INTERVAL '1 year', '[]'::jsonb)
        RETURNING id, codigo_cit
      `,
      [
        bici.id,
        codigoCit,
        JSON.stringify({ origen: 'solicitud', solicitadoPor: user.id }),
        user.id,
        bici.numero_serie,
        require("node:crypto").createHash("sha256").update(bici.numero_serie).digest("hex"),
        require("node:crypto").createHmac("sha256", process.env.JWT_SECRET ?? "rodaid").update(bici.numero_serie).digest("hex"),
        JSON.stringify({ bicicleta_id: bici.id, numero_serie: bici.numero_serie, solicitado_en: new Date().toISOString() }),
      ]
    )

    await client.query('COMMIT')
    citId = insert.rows[0].id
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    client.release()
    return jsonError(error)
  }
  client.release()

  // 4. Encolar el cit_id recien solicitado en el pipeline de validacion.
  try {
    const job = await encolarValidacion(citId)

    // 5. En demo (no LIVE) ejecutar el pipeline al instante para no frenar el
    //    flujo de publicacion; en LIVE queda pendiente del worker de 72hs.
    if (getModo() !== 'LIVE' || process.env.RODAID_CIT_DEMO_MODE === 'true') {
      const resultado = await procesarJob(job.id, { ignorarVentana: true })
      if (resultado.estado === 'APROBADO') {
        return NextResponse.json(
          { estado: 'activo', codigoCit, yaVerificada: false, hashSha256: resultado.hash ?? null },
          { status: 201 }
        )
      }
      if (resultado.estado === 'BLOQUEADO') {
        return NextResponse.json(
          { estado: 'bloqueado', codigoCit, yaVerificada: false, bloqueada: true },
          { status: 201 }
        )
      }
    }

    // LIVE (o demo que no llego a decidir): el CIT queda pendiente del worker.
    return NextResponse.json(
      { estado: 'pendiente', codigoCit, yaVerificada: false, pendienteRevision: true },
      { status: 201 }
    )
  } catch (error) {
    return jsonError(error)
  }
}

/** Genera un codigo CIT legible y razonablemente unico. */
function generarCodigoCit(numeroSerie: string): string {
  const base = numeroSerie
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6)
    .padEnd(6, 'X')
  const sufijo = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()
  return `CIT-${base}-${sufijo}`
}
