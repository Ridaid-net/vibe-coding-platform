/**
 * RODAID — Validacion de CBU/alias para datos bancarios de payout.
 *
 * El CBU (Clave Bancaria Uniforme, Argentina) tiene 22 digitos con DOS
 * digitos verificadores reales (no solo longitud): algoritmo publico del
 * BCRA, verificado contra la especificacion real antes de implementarlo
 * (un error aca rechazaria/aceptaria CBUs invalidos en un flujo de plata).
 *
 * Bloque 1 (digitos 1-8, entidad+sucursal): el digito 8 verifica los
 * primeros 7 con los pesos PESOS_BLOQUE_1.
 * Bloque 2 (digitos 9-22, cuenta): el digito 22 (ultimo) verifica los
 * digitos 9-21 (los primeros 13 del bloque) con los pesos PESOS_BLOQUE_2.
 */

const PESOS_BLOQUE_1 = [7, 1, 3, 9, 7, 1, 3]
const PESOS_BLOQUE_2 = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3]

function digitoVerificador(digitos: number[], pesos: number[]): number {
  const suma = digitos.reduce((acc, d, i) => acc + d * pesos[i], 0)
  return (10 - (suma % 10)) % 10
}

/** Valida el CBU completo: formato (22 digitos) + los dos digitos verificadores reales. */
export function validarCBU(cbu: string): boolean {
  if (!/^\d{22}$/.test(cbu)) return false
  const d = cbu.split('').map(Number)
  const dv1 = digitoVerificador(d.slice(0, 7), PESOS_BLOQUE_1)
  const dv2 = digitoVerificador(d.slice(8, 21), PESOS_BLOQUE_2)
  return dv1 === d[7] && dv2 === d[21]
}

/** Chequeo de formato del alias CBU/MercadoPago: 6-20 caracteres alfanumericos, puntos o guiones. */
export function validarAlias(alias: string): boolean {
  return /^[a-zA-Z0-9.-]{6,20}$/.test(alias)
}
