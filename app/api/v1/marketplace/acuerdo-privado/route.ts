import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import { crearAcuerdoPrivado } from '@/src/services/acuerdo-privado.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/marketplace/acuerdo-privado — Segundo punto de entrada a CIT
 * Completo/Transferencia (ver acuerdo-privado.service.ts): el VENDEDOR crea
 * la publicacion sintetica para una venta ya acordada por fuera de RODAID,
 * eligiendo el Taller Aliado que va a certificarla e identificando al
 * comprador por email (cuenta nueva si no existe, mismo patron que
 * "Iniciar Certificacion" del Taller).
 */
const schema = z.object({
  bicicletaId: z.string({ required_error: 'bicicletaId es obligatorio.' }).uuid(),
  aliadoId: z.string({ required_error: 'aliadoId es obligatorio.' }).uuid(),
  titulo: z.string({ required_error: 'titulo es obligatorio.' }).trim().min(5).max(120),
  descripcion: z.string({ required_error: 'descripcion es obligatoria.' }).trim().min(20).max(5000),
  precioARS: z
    .number({ required_error: 'precioARS es obligatorio.' })
    .positive('precioARS debe ser mayor a cero.')
    .max(1_000_000_000),
  precioUSD: z.number().positive().max(100_000_000).nullable().optional(),
  compradorNombre: z.string({ required_error: 'compradorNombre es obligatorio.' }).trim().min(2).max(120),
  compradorEmail: z.string({ required_error: 'compradorEmail es obligatorio.' }).trim().email(),
})

export async function POST(req: Request) {
  try {
    const [user, body] = await Promise.all([requireUser(req), req.json().catch(() => ({}))])
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        parsed.error.errors[0]?.message ?? 'Datos invalidos.'
      )
    }
    const data = parsed.data

    const resultado = await crearAcuerdoPrivado({
      vendedorId: user.id,
      bicicletaId: data.bicicletaId,
      aliadoId: data.aliadoId,
      titulo: data.titulo,
      descripcion: data.descripcion,
      precioARS: data.precioARS,
      precioUSD: data.precioUSD ?? null,
      compradorNombre: data.compradorNombre,
      compradorEmail: data.compradorEmail,
    })

    return NextResponse.json(resultado, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
