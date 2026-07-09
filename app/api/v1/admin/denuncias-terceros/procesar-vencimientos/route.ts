import { NextResponse } from 'next/server'
import { jsonError, requireAdmin } from '@/lib/marketplace'
import { procesarVencimientosDenunciaTercero } from '@/src/services/denuncia-tercero.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/admin/denuncias-terceros/procesar-vencimientos — barrido de
 * los timeouts de 3hs (Policia / propietario) de la denuncia de terceros
 * (Fase 7, caso 3). Pensado para ejecutarse como tarea programada (requiere
 * x-admin-token). Mientras iniciarDenunciaTercero() siga bloqueado, este
 * barrido corre pero no encuentra nada que procesar.
 */
export async function POST(req: Request) {
  try {
    requireAdmin(req)
    const resultado = await procesarVencimientosDenunciaTercero()
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
