// ─── RODAID · Arbol de decision del CIT ──────────────────────────────────
//
// Logica pura (sin acceso a base de datos) que clasifica el ciclo de vida de
// un Certificado de Identidad Tecnologica segun su fecha de vencimiento. Es la
// pieza que, durante el barrido programado, detecta cuando un certificado
// "entra en la zona de proximo a vencer" (menos de 60 dias) y habilita el
// disparo de la alerta de vencimiento.
//
// Se mantiene desacoplada del envio de notificaciones para poder testearla y
// reutilizarla (por ejemplo, desde la UI del Garaje) sin efectos secundarios.

/** Umbral, en dias, a partir del cual un CIT se considera "proximo a vencer". */
export const DIAS_UMBRAL_VENCIMIENTO = 60

const MS_POR_DIA = 1000 * 60 * 60 * 24

/**
 * Zona del ciclo de vida del CIT segun su vencimiento.
 *   · SIN_VENCIMIENTO  → el CIT no tiene fecha de vencimiento (borrador, etc.)
 *   · VIGENTE          → vence en mas de DIAS_UMBRAL_VENCIMIENTO dias
 *   · PROXIMO_A_VENCER → vence dentro del umbral (todavia no vencio)
 *   · VENCIDO          → la fecha de vencimiento ya paso
 */
export type ZonaVencimientoCIT =
  | 'SIN_VENCIMIENTO'
  | 'VIGENTE'
  | 'PROXIMO_A_VENCER'
  | 'VENCIDO'

export interface EvaluacionVencimientoCIT {
  zona: ZonaVencimientoCIT
  /** Dias enteros restantes hasta el vencimiento (negativo si ya vencio). */
  diasRestantes: number | null
  /** True cuando corresponde disparar la alerta de "proximo a vencer". */
  requiereAlerta: boolean
}

/** Dias enteros (hacia arriba) entre `ahora` y la fecha de vencimiento. */
export function diasHastaVencimiento(
  fechaVencimiento: Date | string | null,
  ahora: number = Date.now()
): number | null {
  if (fechaVencimiento === null) {
    return null
  }
  const vence =
    fechaVencimiento instanceof Date
      ? fechaVencimiento.getTime()
      : new Date(fechaVencimiento).getTime()
  if (Number.isNaN(vence)) {
    return null
  }
  return Math.ceil((vence - ahora) / MS_POR_DIA)
}

/**
 * Evalua la zona de vencimiento de un CIT y decide si debe alertarse.
 *
 * La alerta de vencimiento aplica unicamente a certificados ACTIVOS que
 * todavia estan vigentes pero entraron en la franja de menos de 60 dias: un
 * borrador no tiene vencimiento y un CIT ya vencido se resuelve por otra via
 * (renovacion), no por una alerta de proximidad.
 */
export function evaluarVencimientoCIT(input: {
  estado: string
  fechaVencimiento: Date | string | null
  ahora?: number
}): EvaluacionVencimientoCIT {
  const diasRestantes = diasHastaVencimiento(input.fechaVencimiento, input.ahora)

  if (diasRestantes === null) {
    return { zona: 'SIN_VENCIMIENTO', diasRestantes: null, requiereAlerta: false }
  }

  if (diasRestantes < 0) {
    return { zona: 'VENCIDO', diasRestantes, requiereAlerta: false }
  }

  if (diasRestantes <= DIAS_UMBRAL_VENCIMIENTO) {
    // Solo los certificados activos disparan la alerta de proximidad.
    const requiereAlerta = input.estado === 'ACTIVO'
    return { zona: 'PROXIMO_A_VENCER', diasRestantes, requiereAlerta }
  }

  return { zona: 'VIGENTE', diasRestantes, requiereAlerta: false }
}
