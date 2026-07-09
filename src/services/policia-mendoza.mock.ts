/**
 * RODAID — Mock de la consulta a la Policía de Mendoza (Fase 7: denuncia de
 * terceros).
 *
 * La Policía de Mendoza opera con radiocomunicación TETRA, no una API
 * consultable — no existe ningún canal real hoy para resolver esta consulta
 * de forma automática ni semi-automática. Este módulo es únicamente el punto
 * de extensión documentado para el día que ese canal exista (posible reunión
 * con el Ministerio de Seguridad el miércoles 2026-07-15) — HOY no hace nada
 * por sí solo y no se llama desde ningún lado del flujo real todavía (a
 * diferencia de `evaluarCrossReference` en `seguridad.mock.ts`, que sí se usa
 * activamente para el chequeo automático). La única forma de que
 * `denuncias_terceros.policia_confirmo` deje de ser NULL hoy es el endpoint
 * admin de simulación manual (ver `simularRespuestaPolicia` en
 * `denuncia-tercero.service.ts`).
 *
 * Además — y más importante — el flujo completo de denuncia de terceros está
 * deshabilitado deliberadamente en producción (ver el TODO fechado al inicio
 * de `denuncia-tercero.service.ts`), así que ni siquiera existe hoy una fila
 * de `denuncias_terceros` real sobre la cual esta consulta pudiera correr.
 */

export interface ConsultaPoliciaResultado {
  /** Siempre null hoy: no hay canal real para obtener una respuesta. */
  confirmado: boolean | null
  fuente: 'Policia de Mendoza (sin canal - mock)'
  consultadoEn: string
}

/**
 * Punto de extensión para el día que exista un canal real con la Policía de
 * Mendoza. Hoy siempre devuelve `confirmado: null` (silencio) — nunca hay que
 * confundir esto con una respuesta real de "no fue robada".
 */
export async function consultarPoliciaMendoza(
  numeroSerie: string
): Promise<ConsultaPoliciaResultado> {
  void numeroSerie
  return {
    confirmado: null,
    fuente: 'Policia de Mendoza (sin canal - mock)',
    consultadoEn: new Date().toISOString(),
  }
}
