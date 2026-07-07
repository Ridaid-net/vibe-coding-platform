/**
 * RODAID · Transferencia de dominio de bicicleta
 * POST /api/v1/bicicletas/[id]/transferir
 * Transfiere la propiedad a otro usuario y revoca el CIT activo
 */
export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool, requireUser } from '@/lib/marketplace'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)
    const body = await req.json()
    const { emailDestino, motivo } = body

    if (!emailDestino) {
      return NextResponse.json({ error: 'emailDestino es obligatorio.' }, { status: 400 })
    }

    const pool = getPool()

    // Verificar que la bici pertenece al usuario
    const biciResult = await pool.query(
      'SELECT id, numero_serie, marca, modelo, propietario_id FROM bicicletas WHERE id = $1',
      [id]
    )
    const bici = biciResult.rows[0]
    if (!bici) return NextResponse.json({ error: 'Bicicleta no encontrada.' }, { status: 404 })
    if (bici.propietario_id !== user.id) {
      return NextResponse.json({ error: 'No tenés permisos para transferir esta bicicleta.' }, { status: 403 })
    }

    // Buscar usuario destino
    const destResult = await pool.query(
      'SELECT id, email FROM usuarios WHERE lower(email) = lower($1) LIMIT 1',
      [emailDestino]
    )
    const destino = destResult.rows[0]
    if (!destino) {
      return NextResponse.json({ error: 'No se encontró un usuario con ese email en RODAID.' }, { status: 404 })
    }
    if (destino.id === user.id) {
      return NextResponse.json({ error: 'No podés transferirte la bicicleta a vos mismo.' }, { status: 400 })
    }

    // Verificar que no tenga denuncia activa
    const denunciaResult = await pool.query(
      "SELECT id FROM denuncias_mpf WHERE bicicleta_id = $1 AND estado = 'DENUNCIA_JUDICIAL_ACTIVA' LIMIT 1",
      [id]
    )
    if (denunciaResult.rows[0]) {
      return NextResponse.json({ error: 'No se puede transferir una bicicleta con denuncia activa.' }, { status: 409 })
    }

    // Ejecutar transferencia en transacción
    await pool.query('BEGIN')
    try {
      // Revocar CIT activo
      await pool.query(
        "UPDATE cits SET estado = 'revocado', updated_at = NOW() WHERE bicicleta_id = $1 AND estado = 'activo'",
        [id]
      )
      // Transferir propiedad
      await pool.query(
        'UPDATE bicicletas SET propietario_id = $1, updated_at = NOW() WHERE id = $2',
        [destino.id, id]
      )
      // Registrar en historial
      await pool.query(
        `INSERT INTO transferencias_dominio (bicicleta_id, propietario_anterior_id, propietario_nuevo_id, motivo)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [id, user.id, destino.id, motivo ?? 'Transferencia voluntaria']
      ).catch(() => undefined) // Si no existe la tabla, continúa
      await pool.query('COMMIT')
    } catch (err) {
      await pool.query('ROLLBACK')
      throw err
    }

    return NextResponse.json({
      ok: true,
      transferencia: {
        bicicleta: { id: bici.id, numero_serie: bici.numero_serie, marca: bici.marca, modelo: bici.modelo },
        propietario_anterior: (user as { id: string; email?: string }).email ?? user.id,
        propietario_nuevo: destino.email,
        cit_revocado: true,
        mensaje: `Bicicleta transferida a ${destino.email}. El CIT fue revocado — el nuevo propietario deberá certificarla nuevamente.`
      }
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
