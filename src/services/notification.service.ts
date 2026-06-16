/**
 * RODAID — Servicio basico de notificaciones (Hito 5).
 *
 * Simula el aviso al usuario sobre el resultado final de la validacion de su
 * CIT. En esta etapa es una notificacion por consola (y email simulado): deja
 * el rastro en los logs del worker y devuelve un acuse para auditar en
 * `log_validaciones`. Cuando exista un proveedor real (email/push), basta con
 * reemplazar el cuerpo de `enviarNotificacion` sin tocar el pipeline.
 */

export type CanalNotificacion = 'consola' | 'email'

export interface NotificacionValidacion {
  /** Email/identificador del destinatario (propietario de la bici). */
  destinatario: string | null
  citId: string
  codigoCit: string
  resultado: 'APROBADO' | 'BLOQUEADO'
  motivo?: string | null
}

export interface AcuseNotificacion {
  enviada: boolean
  canal: CanalNotificacion
  asunto: string
}

function construirAsunto(n: NotificacionValidacion): string {
  return n.resultado === 'APROBADO'
    ? `Tu bici fue verificada — CIT ${n.codigoCit} aprobado`
    : `Verificacion no aprobada — CIT ${n.codigoCit} bloqueado`
}

function construirCuerpo(n: NotificacionValidacion): string {
  if (n.resultado === 'APROBADO') {
    return (
      `Tu Cedula de Identidad de la bici (${n.codigoCit}) supero el control de ` +
      `72hs contra el registro del Ministerio de Seguridad. Ya podes publicarla ` +
      `en el marketplace con identidad verificada.`
    )
  }
  return (
    `La verificacion de tu CIT ${n.codigoCit} no fue aprobada` +
    (n.motivo ? `: ${n.motivo}.` : '.') +
    ` Si creés que es un error, comunicate con soporte de RODAID.`
  )
}

/**
 * Envia la notificacion del resultado de la validacion. Best-effort: nunca
 * lanza; devuelve un acuse para registrar en la auditoria.
 */
export async function enviarNotificacion(
  n: NotificacionValidacion
): Promise<AcuseNotificacion> {
  const canal: CanalNotificacion = n.destinatario ? 'email' : 'consola'
  const asunto = construirAsunto(n)
  try {
    // Simulacion: en lugar de integrar un proveedor, se escribe en consola.
    console.info(
      `[notificacion:${canal}] -> ${n.destinatario ?? 'consola'} | ${asunto}\n` +
        construirCuerpo(n)
    )
    return { enviada: true, canal, asunto }
  } catch (error) {
    console.error('[notificacion] fallo al enviar', error)
    return { enviada: false, canal, asunto }
  }
}
