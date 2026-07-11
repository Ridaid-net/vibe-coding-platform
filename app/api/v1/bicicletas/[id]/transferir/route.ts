/**
 * RODAID · Transferencia de dominio de bicicleta
 * POST /api/v1/bicicletas/[id]/transferir
 *
 * Transfiere la propiedad a otro usuario de RODAID. Exige un CIT vigente
 * (activo y no vencido) — server-side siempre, nunca confia en que el
 * frontend ya lo valido. El CIT NO se revoca: misma identidad tecnica de
 * siempre, el cambio de titularidad queda anclado como evento propio (mismo
 * mecanismo que usan las ventas del Marketplace, ver
 * transferencia-dominio.service.ts).
 */
export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool, requireUser } from '@/lib/marketplace'
import {
  transferirTitularidadBicicleta,
  anclarTransferenciaEnBFA,
  invalidarCachePorTransferencia,
} from '@/src/services/transferencia-dominio.service'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)
    const body = await req.json()
    const { emailDestino } = body

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

    // El CIT tiene que estar VIGENTE (activo y no vencido) para transferir --
    // server-side siempre, nunca confiar en que el frontend ya lo valido.
    const citResult = await pool.query(
      `SELECT id, fecha_vencimiento FROM cits
       WHERE bicicleta_id = $1 AND estado = 'ACTIVO' AND fecha_vencimiento > NOW()
       ORDER BY fecha_vencimiento DESC LIMIT 1`,
      [id]
    )
    const cit = citResult.rows[0]
    if (!cit) {
      return NextResponse.json(
        { error: 'Renová tu CIT antes de transferir la bici.' },
        { status: 409 }
      )
    }

    // Ejecutar transferencia (cliente dedicado para una transaccion real).
    const client = await pool.connect()
    let transferenciaId: string | null = null
    let numeroSerie: string | null = null
    try {
      await client.query('BEGIN')
      const resultado = await transferirTitularidadBicicleta(client, {
        citId: cit.id,
        bicicletaId: id,
        propietarioAnteriorId: user.id,
        propietarioNuevoId: destino.id,
        motivo: 'transferencia_manual',
        actorId: user.id,
        actorRol: 'ciclista',
      })
      transferenciaId = resultado.transferenciaId
      numeroSerie = resultado.numeroSerie
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    if (transferenciaId) {
      await Promise.allSettled([
        anclarTransferenciaEnBFA(transferenciaId),
        invalidarCachePorTransferencia(numeroSerie),
      ])
    }

    return NextResponse.json({
      ok: true,
      transferencia: {
        bicicleta: { id: bici.id, numero_serie: bici.numero_serie, marca: bici.marca, modelo: bici.modelo },
        propietario_anterior: (user as { id: string; email?: string }).email ?? user.id,
        propietario_nuevo: destino.email,
        cit_preservado: true,
        mensaje: `Bicicleta transferida a ${destino.email}. El CIT mantiene su identidad y quedó anclado el cambio de titularidad en la Blockchain Federal Argentina.`
      }
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
