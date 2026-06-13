'use server'

import { revalidatePath } from 'next/cache'
import { ApiError } from '@/lib/marketplace'
import type { ResultadosPuntos } from '@/lib/cit'
import {
  registrarInspeccion,
  type RegistrarInspeccionResultado,
} from '@/src/services/cit.service'

export interface RegistrarInspeccionActionInput {
  bicicletaId: string
  tallerId?: string | null
  inspectorNombre: string
  resultados: ResultadosPuntos
  observaciones?: Record<string, string>
  notas?: string | null
  djFirmada: boolean
}

export type RegistrarInspeccionActionResult =
  | { ok: true; resultado: RegistrarInspeccionResultado }
  | { ok: false; error: string }

/**
 * Server action que usa la pantalla del taller para registrar la inspeccion.
 * Devuelve el resultado del CIT (Aprobado / Rechazado) de forma serializable.
 */
export async function registrarInspeccionAction(
  input: RegistrarInspeccionActionInput
): Promise<RegistrarInspeccionActionResult> {
  try {
    const resultado = await registrarInspeccion({
      bicicletaId: input.bicicletaId,
      tallerId: input.tallerId ?? null,
      inspectorId: null,
      inspectorNombre: input.inspectorNombre,
      resultados: input.resultados,
      observaciones: input.observaciones,
      notas: input.notas ?? null,
      djFirmada: input.djFirmada,
    })
    revalidatePath('/inspector')
    return { ok: true, resultado }
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, error: error.message }
    }
    console.error('[inspector] registrarInspeccionAction error', error)
    return { ok: false, error: 'No se pudo registrar la inspeccion.' }
  }
}
