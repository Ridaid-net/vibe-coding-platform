import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import {
  iniciarImpugnacion,
  type EvidenciaArchivo,
  type MedioPruebaImpugnacion,
} from '@/src/services/impugnaciones-denuncia.service'

export const runtime = 'nodejs'

const MEDIOS_VALIDOS = new Set<MedioPruebaImpugnacion>([
  'factura_compra',
  'recibo_escribano',
  'fotos_posesion',
  'otro_fehaciente',
  'testimonio_testigo',
])

/**
 * POST /api/v1/bicicletas/:id/impugnar-denuncia — Esquema 4: quien compró
 * esta bici (por fuera de la plataforma) impugna la denuncia activa que la
 * bloqueó, con evidencia de su propia compra. Plazo: 15 días hábiles desde
 * que la denuncia se activó.
 *
 * multipart/form-data: `motivo` (texto) + `medioPruebaPrincipal` (uno de
 * factura_compra/recibo_escribano/fotos_posesion/otro_fehaciente/testimonio_testigo)
 * + uno o más archivos bajo el campo `evidencia`.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)

    const contentType = req.headers.get('content-type') ?? ''
    if (!contentType.includes('multipart/form-data')) {
      throw new ApiError(400, 'INVALID_BODY', 'El cuerpo debe ser multipart/form-data.')
    }
    const form = await req.formData()
    const motivo = form.get('motivo')
    if (typeof motivo !== 'string' || !motivo.trim()) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Contanos por qué esta denuncia es falsa.')
    }
    const medioPruebaPrincipal = form.get('medioPruebaPrincipal')
    if (typeof medioPruebaPrincipal !== 'string' || !MEDIOS_VALIDOS.has(medioPruebaPrincipal as MedioPruebaImpugnacion)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Indicá el medio de prueba principal.')
    }

    const evidencia: EvidenciaArchivo[] = []
    for (const [key, value] of form.entries()) {
      if (key === 'evidencia' && value instanceof File && value.size > 0) {
        evidencia.push({
          bytes: Buffer.from(await value.arrayBuffer()),
          nombreArchivo: value.name,
          contentType: value.type || 'application/octet-stream',
        })
      }
    }

    const impugnacion = await iniciarImpugnacion({
      bicicletaId: id,
      impugnanteId: user.id,
      motivo: motivo.trim(),
      medioPruebaPrincipal: medioPruebaPrincipal as MedioPruebaImpugnacion,
      evidencia,
    })

    return NextResponse.json({ impugnacion }, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
