/**
 * RODAID · Servicio centralizado de notificaciones internas
 * Usado por los servicios del backend para notificar a usuarios
 */
import { getPool } from '@/lib/marketplace'

export type NotifTipo =
  | 'CIT_APROBADO'
  | 'CIT_RECHAZADO'
  | 'CIT_POR_VENCER'
  | 'DENUNCIA_REGISTRADA'
  | 'BICI_RECUPERADA'
  | 'VENTA_CONFIRMADA'
  | 'COMPRA_COMPLETADA'

export async function crearNotificacion({
  usuarioId,
  tipo,
  titulo,
  cuerpo,
  ctaUrl,
}: {
  usuarioId: string
  tipo: NotifTipo
  titulo: string
  cuerpo: string
  ctaUrl?: string
}): Promise<void> {
  try {
    const pool = getPool()
    await pool.query(
      `INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, cta_url)
       VALUES ($1, $2::notif_tipo, $3, $4, $5)`,
      [usuarioId, tipo, titulo, cuerpo, ctaUrl ?? '/garaje']
    )
  } catch (err) {
    console.error('Error creando notificacion:', err)
  }
}
