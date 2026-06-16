import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { ApiError, getPool, jsonError, requireUser } from '@/lib/marketplace'
import { getModo } from '@/src/services/mercadopago.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/bicicletas/[id]/verificar — Solicitar verificacion de identidad
 * (CIT) de una bicicleta.
 *
 * Reduce la friccion en el momento de la venta: en lugar de obligar al usuario
 * a un tramite externo, desde "Mi Garaje" (o el modal rapido del flujo de
 * publicacion) puede pedir la verificacion de su bici.
 *
 * Como el sistema de cuentas y el peritaje real son hitos posteriores, este
 * endpoint sigue el mismo criterio que la sesion de prueba del checkout: fuera
 * del modo LIVE de MercadoPago (STUB/SANDBOX) emite un CIT 'activo' al instante
 * para poder ejercitar el flujo de publicacion de punta a punta. En LIVE crea
 * un CIT 'pendiente' que queda a la espera del peritaje real.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const pool = getPool()
  const client = await pool.connect()

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
        ORDER BY creado_en DESC
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

    // 3. Emitir el CIT. En demo (no LIVE) se activa al instante; en LIVE queda
    //    pendiente del peritaje.
    const demo = getModo() !== 'LIVE'
    const estado = demo ? 'activo' : 'pendiente'
    const codigoCit = generarCodigoCit(bici.numero_serie)

    const insert = await client.query<{
      id: string
      estado: string
      codigo_cit: string
      fecha_vencimiento: string
    }>(
      `
        INSERT INTO cits (bicicleta_id, estado, codigo_cit, metadata_json)
        VALUES ($1, $2::cit_estado, $3, $4::jsonb)
        RETURNING id, estado, codigo_cit, fecha_vencimiento
      `,
      [
        bici.id,
        estado,
        codigoCit,
        JSON.stringify({ origen: demo ? 'demo-auto' : 'solicitud', solicitadoPor: user.id }),
      ]
    )

    await client.query('COMMIT')

    const cit = insert.rows[0]
    return NextResponse.json(
      {
        estado: cit.estado,
        codigoCit: cit.codigo_cit,
        yaVerificada: false,
        // En LIVE el CIT queda pendiente; el frontend muestra el aviso adecuado.
        pendienteRevision: cit.estado === 'pendiente',
      },
      { status: 201 }
    )
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    return jsonError(error)
  } finally {
    client.release()
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
