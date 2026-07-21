import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, jsonError, requireRole } from '@/lib/marketplace'
import { resolverAliadoDeUsuario } from '@/src/services/inspeccion.service'
import { iniciarCertificacionMostrador } from '@/src/services/certificacion-mostrador.service'

export const runtime = 'nodejs'

const RODADOS_VALIDOS = [12, 16, 20, 24, 26, 27.5, 29, 700] as const

const bodySchema = z.object({
  clienteNombre: z.string().trim().min(1, 'El nombre del cliente es obligatorio.').max(120),
  clienteEmail: z.string().trim().email('Ingresa un email valido.'),
  clienteTelefono: z.string().trim().max(40).nullable().optional(),
  bici: z.object({
    marca: z.string().trim().min(1, 'La marca es obligatoria.').max(80),
    modelo: z.string().trim().min(1, 'El modelo es obligatorio.').max(120),
    numeroSerie: z.string().trim().min(3, 'El numero de serie debe tener al menos 3 caracteres.').max(120),
    tipo: z.string().trim().min(1, 'El tipo es obligatorio.').max(40),
    anio: z.number().int().min(1950).max(2100).nullable().optional(),
    color: z.string().trim().max(40).nullable().optional(),
    rodado: z
      .number()
      .refine((v) => RODADOS_VALIDOS.includes(v as (typeof RODADOS_VALIDOS)[number]), {
        message: 'Rodado invalido.',
      })
      .nullable()
      .optional(),
    talleCuadro: z.enum(['S', 'M', 'L', 'XL']).nullable().optional(),
  }),
})

/**
 * POST /api/v1/taller/iniciar-certificacion — El Taller Aliado arranca el
 * tramite de CIT Express para un cliente de mostrador que llega sin cuenta
 * en RODAID (o con una ya existente, si el email coincide). Restringido a
 * aliados tipo='taller' -- mismo criterio de capacidad mecanica que ya rige
 * el sellado de inspecciones.
 */
export async function POST(req: Request) {
  try {
    const [user, body] = await Promise.all([
      requireRole('aliado', 'admin')(req),
      req.json().catch(() => ({})),
    ])

    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new ApiError(400, 'VALIDATION_ERROR', issue?.message ?? 'Datos invalidos.')
    }

    const aliado = await resolverAliadoDeUsuario(user.id)
    if (!aliado) {
      throw new ApiError(403, 'SIN_ALIADO', 'No tenes un Taller Aliado propio vinculado.')
    }
    if (aliado.tipo !== 'taller') {
      throw new ApiError(
        403,
        'TIPO_ALIADO_NO_HABILITADO',
        'Tu perfil de aliado no tiene capacidad mecánica registrada (tipo taller) -- no podés iniciar una certificación.'
      )
    }

    const resultado = await iniciarCertificacionMostrador(aliado.id, parsed.data)
    return NextResponse.json({ resultado }, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
