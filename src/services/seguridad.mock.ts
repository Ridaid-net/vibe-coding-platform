/**
 * RODAID — Mock de la base del Ministerio de Seguridad (Hito 5).
 *
 * Simula el cross-reference de identidad de una bicicleta contra el registro de
 * denuncias de robo/hurto. Esta misma logica la usan dos consumidores y por eso
 * vive en un modulo compartido:
 *
 *   1. El endpoint `POST /api/seguridad/cross-reference` (la consulta "remota").
 *   2. El fallback en proceso del worker, cuando no hay una URL base para hacer
 *      el fetch HTTP (entornos locales sin `URL`/`DEPLOY_PRIME_URL`).
 *
 * Es DETERMINISTICO a proposito: el mismo numero de serie produce siempre el
 * mismo veredicto. Asi el pipeline es reproducible y auditable. Una serie se
 * marca como denunciada si contiene un marcador de alerta (ROBAD, DENUNCIA,
 * HURTO, ALERTA) o si aparece en la denylist configurable por entorno
 * (`RODAID_SEGURIDAD_DENYLIST`, lista separada por comas de numeros de serie).
 */

export interface CrossReferenceInput {
  citId?: string | null
  codigoCit?: string | null
  bicicletaId?: string | null
  numeroSerie?: string | null
  marca?: string | null
  modelo?: string | null
}

export interface Denuncia {
  tipo: string
  jurisdiccion: string
  expediente: string
}

export interface CrossReferenceResultado {
  limpio: boolean
  riesgo: 'BAJO' | 'ALTO'
  denuncias: Denuncia[]
  fuente: string
  consultadoEn: string
  numeroSerie: string | null
}

const MARCADORES_ALERTA = ['ROBAD', 'DENUNCIA', 'HURTO', 'ALERTA']

function normalizarSerie(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function denylistDeEntorno(): Set<string> {
  const raw = process.env.RODAID_SEGURIDAD_DENYLIST ?? ''
  return new Set(
    raw
      .split(',')
      .map((item) => normalizarSerie(item))
      .filter(Boolean)
  )
}

/**
 * Evalua una bicicleta contra el registro de denuncias simulado.
 *
 * @param ahoraISO marca temporal a registrar como `consultadoEn`. Se inyecta
 *   (en lugar de leer el reloj aqui) para que el resultado sea reproducible y
 *   apto para hashear; el llamador decide la fecha.
 */
export function evaluarCrossReference(
  input: CrossReferenceInput,
  ahoraISO: string
): CrossReferenceResultado {
  const serie = normalizarSerie(input.numeroSerie)
  const enDenylist = serie.length > 0 && denylistDeEntorno().has(serie)
  const tieneMarcador = MARCADORES_ALERTA.some((m) => serie.includes(m))
  const denunciada = enDenylist || tieneMarcador

  const denuncias: Denuncia[] = denunciada
    ? [
        {
          tipo: 'ROBO',
          jurisdiccion: 'PBA',
          expediente: `DEN-${serie.slice(0, 8) || 'SN'}`,
        },
      ]
    : []

  return {
    limpio: !denunciada,
    riesgo: denunciada ? 'ALTO' : 'BAJO',
    denuncias,
    fuente: 'Ministerio de Seguridad (mock)',
    consultadoEn: ahoraISO,
    numeroSerie: input.numeroSerie ?? null,
  }
}
