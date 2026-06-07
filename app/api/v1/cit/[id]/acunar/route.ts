import { NextResponse } from 'next/server'
import { jsonError, optionalText, requireAdmin } from '@/lib/marketplace'
import {
  acunarCITEnBFA,
  registrarAcunacionBFA,
} from '@/src/services/cit.service'

export const runtime = 'nodejs'

interface AcunarBody {
  txHash?: unknown
  tx_hash?: unknown
  stampId?: unknown
  stamp_id?: unknown
  objetoId?: unknown
  objeto_id?: unknown
  propietarioWallet?: unknown
  propietario_wallet?: unknown
}

/**
 * POST /api/v1/cit/:id/acunar — acunacion del NFT en la Blockchain Federal
 * Argentina. Endpoint de sistema (requiere credenciales de administrador). Es la
 * superficie REST del mint administrativo (POST /admin/cit/:id/mint).
 *
 *   sin txHash  -> acunacion automatica (acunarCITEnBFA): construye el NFT desde la
 *                  huella sellada y lo ancla via el gateway de BFA. Acepta
 *                  `propietarioWallet` (transfer directo) o, en su ausencia, aplica
 *                  el Modelo Custodial RODAID. Si no hay gateway configurado, deja el
 *                  NFT preparado (EN_PROCESO) sin inventar una transaccion.
 *   con txHash  -> registra una confirmacion on-chain provista de forma externa.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    requireAdmin(req)
    const body = (await req.json().catch(() => ({}))) as AcunarBody
    const txHash = optionalText(body.txHash ?? body.tx_hash)

    if (!txHash) {
      const resultado = await acunarCITEnBFA({
        citId: id,
        propietarioWallet: optionalText(
          body.propietarioWallet ?? body.propietario_wallet
        ),
        actorId: null,
        actorRol: 'sistema',
      })
      return NextResponse.json(resultado)
    }

    const cit = await registrarAcunacionBFA({
      citId: id,
      txHash,
      stampId: optionalText(body.stampId ?? body.stamp_id),
      objetoId: optionalText(body.objetoId ?? body.objeto_id),
      actorId: null,
      actorRol: 'sistema',
    })
    return NextResponse.json({ cit })
  } catch (error) {
    return jsonError(error)
  }
}
