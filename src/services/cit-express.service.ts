import { ejecutarCrossReference } from '@/src/services/validation.service'
import { type CrossReferenceResultado } from '@/src/services/seguridad.mock'

/**
 * RODAID — Fase 2: CIT Express, clasificacion por nivel.
 *
 * clasificarNivelCIT() decide en que nivel entra una bici a CIT Express:
 *
 *   AMARILLO -> serie legible y el cross-reference contra la base de robadas
 *               del Ministerio dio limpio. Autoregistro + declaracion jurada
 *               (DNI + firma digital, timestamp, IP) — eso lo captura el
 *               endpoint que llama a esta funcion, no esta.
 *   ROJO     -> serie adulterada/ilegible, cross-reference con denuncia activa,
 *               O el cross-reference no se pudo verificar (ver nota de
 *               seguridad abajo). Bloquea el autoregistro: requiere turno en
 *               Taller Aliado.
 *
 * TODO(VERDE): el nivel VERDE (factura de compra digital adjunta -> self-service
 * sin declaracion jurada) esta DESHABILITADO DELIBERADAMENTE. No existe en este
 * repo ningun modulo de validacion real de una factura (AFIP/CAE u otro) — sin
 * eso, cualquier string no vacio como "factura adjunta" saltearia Amarillo/la
 * declaracion jurada por completo. Decision tomada el 2026-07-08 tras detectar
 * ese hueco de fraude durante el diseño de esta funcion. AMARILLO es el techo
 * hasta que se defina e implemente esa validacion en una fase futura (no
 * definida todavia ni en el prompt de pricing original ni en este plan).
 */

// ── Legibilidad del numero de serie ──────────────────────────────────────────

/**
 * NOTA: esto es un chequeo de FORMATO (regex) sobre el numero de serie ya
 * transcripto, no un OCR real sobre la foto del cuadro. No hay ningun motor de
 * OCR/reconocimiento de imagen en este repo todavia — cuando exista, este
 * chequeo pasa a ser un piso adicional, no un reemplazo (la foto puede seguir
 * validandose aparte).
 */
function serieEsLegible(numeroSerie: string): boolean {
  const serie = (numeroSerie ?? '').trim()
  if (serie.length < 4) return false
  // Patron de adulteracion tipico: caracteres repetidos en exceso (lijado /
  // reestampado), o solo separadores sin contenido alfanumerico real.
  const alfanumerico = serie.replace(/[^A-Za-z0-9]/g, '')
  if (alfanumerico.length < 4) return false
  const repetidoExcesivo = /(.)\1{4,}/.test(alfanumerico)
  return !repetidoExcesivo
}

// ── Cross-reference con fail-closed deliberado ───────────────────────────────

/**
 * Tiempo maximo que se espera al cross-reference antes de darlo por no
 * disponible. Hoy `ejecutarCrossReference` es 100% mock/determinístico (ver
 * seguridad.mock.ts) y nunca tira ni cuelga de verdad, asi que este timeout no
 * se dispara en la practica; existe para el dia que se conecte una API real.
 */
const CROSS_REFERENCE_TIMEOUT_MS = 5000

interface CrossReferenceEvaluado {
  /** true si el chequeo realmente corrio (no fallo ni excedio el timeout). */
  verificado: boolean
  limpio: boolean | null
  resultado: CrossReferenceResultado | null
}

/**
 * DECISION DE SEGURIDAD DELIBERADA (no el default mas simple): si el
 * cross-reference contra la base de robadas falla o tarda, esta funcion
 * NUNCA asume "limpio" — devuelve `verificado: false` y el llamador
 * (clasificarNivelCIT) lo trata como ROJO. Preferimos mandar de mas gente a
 * un Taller Aliado a verificacion presencial antes que dejar pasar al
 * autoregistro una bici que no pudimos chequear de verdad.
 *
 * TODO(Ministerio real): cuando `ejecutarCrossReference` deje de ser un mock
 * en proceso y pase a llamar a una API externa de verdad, reevaluar si
 * conviene agregar reintentos con timeout corto antes de resolver a ROJO —
 * para no penalizar a un usuario legitimo por una falla transitoria de red.
 * Hoy ese escenario es teorico (el mock nunca falla), asi que no se justifica
 * la complejidad extra todavia.
 */
async function evaluarCrossReferenceConFailClosed(input: {
  citId?: string | null
  codigoCit?: string | null
  bicicletaId?: string | null
  numeroSerie: string
  marca?: string | null
  modelo?: string | null
}): Promise<CrossReferenceEvaluado> {
  const ahoraISO = new Date().toISOString()
  const timeout = new Promise<'timeout'>((resolve) =>
    setTimeout(() => resolve('timeout'), CROSS_REFERENCE_TIMEOUT_MS)
  )

  try {
    const carrera = await Promise.race([
      ejecutarCrossReference(input, ahoraISO),
      timeout,
    ])
    if (carrera === 'timeout') {
      return { verificado: false, limpio: null, resultado: null }
    }
    return { verificado: true, limpio: carrera.resultado.limpio, resultado: carrera.resultado }
  } catch {
    // Fail-closed: cualquier error inesperado se trata igual que un timeout.
    return { verificado: false, limpio: null, resultado: null }
  }
}

// ── Clasificacion ─────────────────────────────────────────────────────────────

/** VERDE deliberadamente ausente — ver TODO al inicio del archivo. */
export type NivelCitExpress = 'AMARILLO' | 'ROJO'

export interface ClasificarNivelInput {
  numeroSerie: string
  marca?: string | null
  modelo?: string | null
  bicicletaId?: string | null
  citId?: string | null
}

export interface ResultadoClasificacionCIT {
  nivel: NivelCitExpress
  motivo: string
  serieLegible: boolean
  crossReference: CrossReferenceEvaluado
}

export async function clasificarNivelCIT(
  input: ClasificarNivelInput
): Promise<ResultadoClasificacionCIT> {
  const serieLegible = serieEsLegible(input.numeroSerie)
  if (!serieLegible) {
    return {
      nivel: 'ROJO',
      motivo: 'El numero de serie es ilegible o presenta un patron de adulteracion.',
      serieLegible: false,
      crossReference: { verificado: false, limpio: null, resultado: null },
    }
  }

  const crossReference = await evaluarCrossReferenceConFailClosed({
    citId: input.citId,
    bicicletaId: input.bicicletaId,
    numeroSerie: input.numeroSerie,
    marca: input.marca,
    modelo: input.modelo,
  })

  if (!crossReference.verificado) {
    return {
      nivel: 'ROJO',
      motivo:
        'No se pudo verificar la bici contra la base de robadas del Ministerio de Seguridad (fail-closed deliberado).',
      serieLegible: true,
      crossReference,
    }
  }

  if (!crossReference.limpio) {
    return {
      nivel: 'ROJO',
      motivo: 'La bici figura con una denuncia activa en la base de robadas.',
      serieLegible: true,
      crossReference,
    }
  }

  return {
    nivel: 'AMARILLO',
    motivo: 'Serie legible y sin denuncias activas. VERDE no disponible (ver TODO de archivo).',
    serieLegible: true,
    crossReference,
  }
}
