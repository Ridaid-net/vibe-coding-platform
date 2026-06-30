import { NextResponse } from 'next/server'
import { ApiError, getPool, jsonError, requireAdmin } from '@/lib/marketplace'
import { fijarDenunciaBFA } from '@/src/services/blockchain.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/admin/blockchain/denuncia — Marcar/levantar robo en la BFA.
 *
 * Ante una denuncia de robo, el admin de RODAID congela el NFT del CIT en la
 * BFA (lock) para que la bici no pueda transferirse on-chain; también puede
 * levantar la marca (unlock). Refleja el estado en `cits` (bloqueado/activo).
 *
 * Body: { bicicletaId?: string, serial?: string|number, bloquear: boolean }
 *  - Se identifica la bici por `bicicletaId` o por `serial` (número de serie).
 */
export async function POST(req: Request) {
  try {
    requireAdmin(req)
    const body = (await req.json().catch(() => ({}))) as {
      bicicletaId?: string
      serial?: string | number
      bloquear?: boolean
    }

    const bloquear = body.bloquear !== false // default: bloquear
    const pool = getPool()

    // Resolver el número de serie (tokenId on-chain) desde la bici o el serial.
    let numeroSerie: string
    if (typeof body.serial === 'string' || typeof body.serial === 'number') {
      numeroSerie = String(body.serial)
    } else if (body.bicicletaId) {
      const res = await pool.query<{ numero_serie: string }>(
        `SELECT numero_serie FROM bicicletas WHERE id = $1`,
        [body.bicicletaId]
      )
      if (!res.rows[0]) {
        throw new ApiError(404, 'BICICLETA_NOT_FOUND', 'La bicicleta indicada no existe.')
      }
      numeroSerie = res.rows[0].numero_serie
    } else {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Indicá bicicletaId o serial.')
    }

    // Acción on-chain (lock/unlock del NFT).
    const resultado = await fijarDenunciaBFA(numeroSerie, bloquear)

    // Reflejar el estado en la base: el CIT activo de esa bici pasa a
    // 'bloqueado' (robo) o vuelve a 'activo' al levantar la denuncia.
    await pool.query(
      `
        UPDATE cits c
        SET estado = $2::cit_estado, actualizado_en = NOW()
        FROM bicicletas b
        WHERE c.bicicleta_id = b.id
          AND b.numero_serie = $1
          AND c.estado = $3::cit_estado
      `,
      [numeroSerie, bloquear ? 'bloqueado' : 'activo', bloquear ? 'activo' : 'bloqueado']
    )

    return NextResponse.json(resultado, { status: resultado.ok ? 200 : 502 })
  } catch (error) {
    return jsonError(error)
  }
}
