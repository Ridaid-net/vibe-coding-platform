'use client'

import { authedFetch } from '@/lib/session'

/**
 * Cliente de "Iniciar Certificación" (Panel del Taller Aliado): arranca un
 * CIT Express para un cliente de mostrador sin cuenta en RODAID. Habla con
 * POST /api/v1/taller/iniciar-certificacion.
 */

export interface IniciarCertificacionInput {
  clienteNombre: string
  clienteEmail: string
  clienteTelefono?: string
  bici: {
    marca: string
    modelo: string
    numeroSerie: string
    tipo: string
    anio?: number | null
    color?: string | null
    rodado?: number | null
    talleCuadro?: string | null
  }
}

export interface CertificacionMostradorResultado {
  usuarioId: string
  bicicletaId: string
  cuentaNueva: boolean
  initPoint: string
  montoARS: number
}

export async function iniciarCertificacion(
  input: IniciarCertificacionInput
): Promise<CertificacionMostradorResultado> {
  const res = await authedFetch('/api/v1/taller/iniciar-certificacion', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const detalle = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(detalle?.message ?? `HTTP ${res.status}`)
  }
  const data = (await res.json()) as { resultado: CertificacionMostradorResultado }
  return data.resultado
}
