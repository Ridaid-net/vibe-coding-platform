import {
  getParametroPricing,
  getParametrosPricing,
} from '@/src/services/parametros-pricing.service'
import { arsAUsd } from '@/src/services/cotizacion.service'

/**
 * RODAID — Fase 1: Motor de pricing de CIT Completo.
 *
 * calcularEconomiaTransaccionCIT() es la fuente unica de verdad del desglose
 * economico de una transaccion de CIT Completo (certificacion de 20 puntos +
 * venta en el Marketplace). La consumen tanto el panel del Taller Aliado
 * (cuanto va a cobrar) como el checkout del comprador (que esta pagando y por
 * que). Los montos nunca se hardcodean: se leen de `parametros_pricing_cit`
 * (Fase 0), asi que un ajuste de tarifas no requiere deploy.
 *
 * NOTA sobre `comisionPasarelaPct`: es una ESTIMACION de trabajo (0.055), no la
 * tasa contractual confirmada con la cuenta real de MercadoPago de RODAID.
 * Verificar antes de confiar en estos numeros para producción.
 */

const CLAVES_CIT_COMPLETO = [
  'cit_completo_precio_publicado_ars',
  'cit_completo_costo_variable_ars',
  'cit_completo_fee_verificacion_ars',
  'cit_completo_fee_logistica_ars',
  'cit_completo_fee_exito_pct',
  'cit_completo_fee_exito_split_rodaid_pct',
  'cit_completo_comision_pasarela_pct',
] as const

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export interface EconomiaCitCompleto {
  valorVentaARS: number

  /**
   * Se cobra SIEMPRE al confirmarse la reserva, financiado por la sena del
   * comprador, sin importar si la venta despues se ejecuta o no.
   */
  certificacion: {
    precioPublicadoARS: number
    costoVariableARS: number
    /** 100% Taller Aliado. */
    feeVerificacionARS: number
    /** Residual (precio publicado - costo variable - fee verificacion). Incluye el margen neto de RODAID y la comision de la pasarela absorbida en ESTE cobro. */
    margenRodaidARS: number
  }

  /** Se cobra SOLO si la venta se ejecuta. */
  ejecucion: {
    /** Lo que efectivamente se le paga al Taller Aliado por la logistica, a valor de costo (sin margen RODAID). */
    feeLogisticaPagadoTallerARS: number
    /** Lo que RODAID le cobra al comprador por la logistica: ajustado hacia arriba para que la comision de MercadoPago sobre ESTE cobro no salga del margen de RODAID. */
    feeLogisticaCobradoCompradorARS: number
    /** feeLogisticaCobradoCompradorARS - feeLogisticaPagadoTallerARS: va integro a MercadoPago, no es ingreso de RODAID. */
    feeLogisticaComisionPasarelaARS: number
    feeExitoTotalARS: number
    feeExitoRodaidARS: number
    feeExitoTallerARS: number
  }

  /** Totales agregados asumiendo que la venta SI se ejecuta. */
  totales: {
    ingresoRodaid: number
    montoTaller: number
    costoVariable: number
  }
}

/**
 * Calcula el desglose economico completo de una transaccion de CIT Completo
 * para una bici de `valorVentaARS`. Funcion pura salvo por la lectura (cacheada)
 * de los parametros de pricing vigentes.
 */
export async function calcularEconomiaTransaccionCIT(
  valorVentaARS: number
): Promise<EconomiaCitCompleto> {
  if (!Number.isFinite(valorVentaARS) || valorVentaARS <= 0) {
    throw new Error('valorVentaARS debe ser un numero positivo.')
  }

  const p = await getParametrosPricing(CLAVES_CIT_COMPLETO)

  const precioPublicadoARS = p.cit_completo_precio_publicado_ars
  const costoVariableARS = p.cit_completo_costo_variable_ars
  const feeVerificacionARS = p.cit_completo_fee_verificacion_ars
  const feeLogisticaPagadoTallerARS = p.cit_completo_fee_logistica_ars
  const feeExitoPct = p.cit_completo_fee_exito_pct
  const splitRodaidPct = p.cit_completo_fee_exito_split_rodaid_pct
  const comisionPasarelaPct = p.cit_completo_comision_pasarela_pct

  const margenRodaidARS = round2(
    precioPublicadoARS - costoVariableARS - feeVerificacionARS
  )

  // El comprador paga lo suficiente como para que, tras la comision de la
  // pasarela sobre ESTE cobro puntual, al Taller le siga llegando el monto
  // integro de costo (feeLogisticaPagadoTallerARS).
  const feeLogisticaCobradoCompradorARS = round2(
    feeLogisticaPagadoTallerARS / (1 - comisionPasarelaPct)
  )
  const feeLogisticaComisionPasarelaARS = round2(
    feeLogisticaCobradoCompradorARS - feeLogisticaPagadoTallerARS
  )

  const feeExitoTotalARS = round2(valorVentaARS * feeExitoPct)
  const feeExitoRodaidARS = round2(feeExitoTotalARS * splitRodaidPct)
  const feeExitoTallerARS = round2(feeExitoTotalARS - feeExitoRodaidARS)

  return {
    valorVentaARS,
    certificacion: {
      precioPublicadoARS,
      costoVariableARS,
      feeVerificacionARS,
      margenRodaidARS,
    },
    ejecucion: {
      feeLogisticaPagadoTallerARS,
      feeLogisticaCobradoCompradorARS,
      feeLogisticaComisionPasarelaARS,
      feeExitoTotalARS,
      feeExitoRodaidARS,
      feeExitoTallerARS,
    },
    totales: {
      // La comision de pasarela de la logistica NO es ingreso de RODAID: pasa
      // directo a MercadoPago. Por eso el total de RODAID no suma
      // feeLogisticaComisionPasarelaARS.
      ingresoRodaid: round2(margenRodaidARS + feeExitoRodaidARS),
      montoTaller: round2(
        feeVerificacionARS + feeLogisticaPagadoTallerARS + feeExitoTallerARS
      ),
      costoVariable: costoVariableARS,
    },
  }
}

// ── Segmentacion: sugerencia Express vs Completo por umbral premium ─────────

export interface SugerenciaProductoCIT {
  sugerido: 'EXPRESS' | 'COMPLETO'
  umbralUsd: number
  valorBiciUsd: number
  motivo: string | null
}

/**
 * Sugerencia informativa (NO bloqueante) para el flujo de publicacion: por
 * debajo del umbral premium, el combo de fees de CIT Completo representa una
 * porcion alta del valor de la bici y conviene CIT Express en su lugar.
 */
export async function sugerirProductoCIT(
  valorBiciARS: number
): Promise<SugerenciaProductoCIT> {
  const [umbralUsd, valorBiciUsd] = await Promise.all([
    getParametroPricing('cit_completo_umbral_premium_usd'),
    arsAUsd(valorBiciARS),
  ])

  if (valorBiciUsd < umbralUsd) {
    return {
      sugerido: 'EXPRESS',
      umbralUsd,
      valorBiciUsd,
      motivo:
        'El costo de certificacion de CIT Completo representa una porcion alta del valor de esta bici. Para bicis de este rango, CIT Express suele ser mas conveniente.',
    }
  }

  return { sugerido: 'COMPLETO', umbralUsd, valorBiciUsd, motivo: null }
}
