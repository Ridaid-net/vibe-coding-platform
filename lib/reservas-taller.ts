import useSWR from 'swr'
import { authedFetch } from '@/lib/session'

/**
 * Cliente de las Solicitudes de Reserva de CIT (Garaje Digital -> Taller
 * Aliado). Reserva simple, sin horario ni pago: el taller ve el lead en su
 * panel y lo marca como contactado/cerrado tras coordinar por fuera del
 * sistema.
 */

export interface SolicitudReservaTaller {
  id: string
  bicicletaId: string
  bicicletaMarca: string
  bicicletaModelo: string
  aliadoId: string
  usuarioNombre: string | null
  usuarioEmail: string
  nota: string | null
  estado: 'pendiente' | 'contactado' | 'cerrada'
  createdAt: string
}

export interface SolicitudesReservaTallerResponse {
  solicitudes: SolicitudReservaTaller[]
  modoVista: 'propio' | 'ver_como' | 'vista_previa'
}

async function leer<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detalle = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(detalle?.message ?? `HTTP ${res.status}`)
  }
  return res.json()
}

async function fetchSolicitudesReservaTaller(url: string): Promise<SolicitudesReservaTallerResponse> {
  return leer(await authedFetch(url))
}

/** Solicitudes de reserva del Taller Aliado logueado (o del elegido en Admin View-As). */
export function useSolicitudesReservaTaller(verComoAliado?: string | null) {
  const qs = verComoAliado ? `?verComoAliado=${encodeURIComponent(verComoAliado)}` : ''
  return useSWR<SolicitudesReservaTallerResponse>(
    `/api/v1/taller/reservas${qs}`,
    fetchSolicitudesReservaTaller,
    { revalidateOnFocus: true, keepPreviousData: true }
  )
}

/** El taller marca una solicitud como contactada o cerrada. */
export async function marcarSolicitudReserva(
  id: string,
  estado: 'contactado' | 'cerrada'
): Promise<void> {
  await leer(
    await authedFetch(`/api/v1/taller/reservas/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ estado }),
    })
  )
}
