/**
 * RODAID — Hito 15: capa de ANONIMIZACION del asistente RODAID-GPT.
 *
 * Restriccion de privacidad del hito: antes de enviar CUALQUIER texto al LLM
 * (Claude Sonnet), el sistema debe reemplazar los datos personales del usuario
 * —nombre completo, DNI, email, telefono— por identificadores genericos
 * ("Usuario A", "[DNI]", ...). El modelo razona sobre los datos de la bici y la
 * zona, nunca sobre la identidad civil de la persona.
 *
 * Dos superficies se anonimizan:
 *   1. El CONTEXTO que arma el backend (que ya se construye sin PII por diseno,
 *      pero se pasa igual por aca como defensa en profundidad).
 *   2. La PREGUNTA libre del usuario y su historial, donde podria, sin querer,
 *      tipear su nombre o DNI.
 *
 * El reemplazo es DETERMINISTA y se basa en el perfil real del usuario (los
 * valores exactos a ocultar) mas un par de patrones genericos conservadores
 * (formato de DNI con puntos y emails) para atrapar lo que el perfil no conozca.
 */

/** Alias generico con el que el modelo se refiere al usuario. */
export const ALIAS_USUARIO = 'Usuario A'

export interface PerfilSensible {
  nombre?: string | null
  apellido?: string | null
  dni?: string | null
  email?: string | null
  telefono?: string | null
}

interface Regla {
  buscar: RegExp
  reemplazo: string
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Construye las reglas de anonimizacion a partir del perfil del usuario. Las
 * reglas se ordenan de la cadena mas larga a la mas corta para que el nombre
 * completo se reemplace antes que cada token suelto.
 */
export function construirReglas(perfil: PerfilSensible): Regla[] {
  const reglas: Regla[] = []

  const nombreCompleto = [perfil.nombre, perfil.apellido]
    .map((v) => (v ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .trim()

  // 1) Email exacto del usuario (y, por las dudas, cualquier email).
  if (perfil.email && perfil.email.includes('@')) {
    reglas.push({
      buscar: new RegExp(escapeRegExp(perfil.email.trim()), 'gi'),
      reemplazo: '[EMAIL]',
    })
  }

  // 2) DNI exacto del usuario (con o sin puntos).
  if (perfil.dni) {
    const soloDigitos = perfil.dni.replace(/\D/g, '')
    if (soloDigitos.length >= 7) {
      // Acepta el numero con puntos opcionales entre los grupos.
      const conPuntos = soloDigitos
        .split('')
        .join('\\.?')
      reglas.push({ buscar: new RegExp(conPuntos, 'g'), reemplazo: '[DNI]' })
    }
  }

  // 3) Telefono exacto del usuario (tolerante a separadores).
  if (perfil.telefono) {
    const soloDigitos = perfil.telefono.replace(/\D/g, '')
    if (soloDigitos.length >= 7) {
      const flexible = soloDigitos.split('').join('[\\s.\\-]?')
      reglas.push({
        buscar: new RegExp(`\\+?${flexible}`, 'g'),
        reemplazo: '[TELEFONO]',
      })
    }
  }

  // 4) Nombre completo, luego cada token (nombre y apellido por separado).
  const tokens = new Set<string>()
  if (nombreCompleto) tokens.add(nombreCompleto)
  for (const parte of [perfil.nombre, perfil.apellido]) {
    const t = (parte ?? '').trim()
    // Tokens de 3+ caracteres para no pisar palabras comunes ("de", "la", ...).
    if (t.length >= 3) tokens.add(t)
  }
  // De mas largo a mas corto: el nombre completo primero.
  const ordenados = [...tokens].sort((a, b) => b.length - a.length)
  for (const t of ordenados) {
    reglas.push({
      // \b...\b respeta limites de palabra; 'iu' para acentos y mayusculas.
      buscar: new RegExp(`\\b${escapeRegExp(t)}\\b`, 'giu'),
      reemplazo: ALIAS_USUARIO,
    })
  }

  return reglas
}

/**
 * Patrones GENERICOS que se aplican siempre, conozcamos o no el perfil. Son
 * deliberadamente conservadores para no destruir datos del dominio (un numero de
 * serie no es un DNI): solo atrapan el formato clasico de DNI argentino con
 * puntos (NN.NNN.NNN) y cualquier email.
 */
const PATRONES_GENERICOS: Regla[] = [
  { buscar: /\b\d{1,2}\.\d{3}\.\d{3}\b/g, reemplazo: '[DNI]' },
  {
    buscar: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    reemplazo: '[EMAIL]',
  },
]

/**
 * Anonimiza un texto aplicando las reglas del perfil y los patrones genericos.
 * Es idempotente y seguro sobre texto vacio/nulo.
 */
export function anonimizar(
  texto: string | null | undefined,
  reglas: Regla[]
): string {
  if (!texto) return ''
  let salida = texto
  for (const { buscar, reemplazo } of reglas) {
    salida = salida.replace(buscar, reemplazo)
  }
  for (const { buscar, reemplazo } of PATRONES_GENERICOS) {
    salida = salida.replace(buscar, reemplazo)
  }
  return salida
}

/**
 * Atajo: arma las reglas del perfil y anonimiza el texto en un solo paso.
 * Pensado para la pregunta libre del usuario.
 */
export function anonimizarConPerfil(
  texto: string | null | undefined,
  perfil: PerfilSensible
): string {
  return anonimizar(texto, construirReglas(perfil))
}
