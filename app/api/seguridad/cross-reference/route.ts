import { NextResponse } from 'next/server'
import {
  evaluarCrossReference,
  type CrossReferenceInput,
} from '@/src/services/seguridad.mock'

export const runtime = 'nodejs'

/**
 * POST /api/seguridad/cross-reference — Mock de la base del Ministerio de
 * Seguridad (Hito 5).
 *
 * Simula la consulta de cross-reference que ejecuta el worker de validacion:
 * recibe los datos identificatorios de la bicicleta y responde si el numero de
 * serie tiene denuncias asociadas. El veredicto es deterministico (ver
 * `seguridad.mock.ts`). Es un endpoint de sistema, no expone datos sensibles.
 */
export async function POST(req: Request) {
  let body: CrossReferenceInput = {}
  try {
    body = (await req.json()) as CrossReferenceInput
  } catch {
    // Cuerpo vacio o invalido: se evalua igual (resultara "limpio").
  }

  const resultado = evaluarCrossReference(body, new Date().toISOString())
  return NextResponse.json(resultado)
}
