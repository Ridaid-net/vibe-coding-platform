import { getPool } from '@/lib/marketplace'

/**
 * RODAID — Score de Confianza de la Bici (Garaje Digital).
 *
 * Indicador 0-100 calculado sobre datos ya existentes: CIT, historial de
 * inspecciones en talleres aliados, BiciSalud y antiguedad en la plataforma.
 * Deliberadamente NO incluye Strava/Garmin -- ver CLAUDE.md, seccion "Score
 * de Confianza de la Bici", para el motivo (no hay forma confiable hoy de
 * saber si UNA bici especifica esta vinculada, ni desde cuando).
 *
 * Se calcula ON-DEMAND, sin cache ni columna persistida (ver la misma
 * seccion de CLAUDE.md para el razonamiento). `calcularScoresConfianza()`
 * recibe un lote de bicis para poder calcularse una sola vez por pantalla
 * (Garaje, marketplace) -- nunca N+1.
 */

export const PUNTOS_CIT_COMPLETO = 35
export const PUNTOS_CIT_EXPRESS = 15

const PUNTOS_TALLERES_TOPE = 25
const PUNTOS_TALLER_EVENTO_RECIENTE = 6 // evento <= 12 meses
const PUNTOS_TALLER_EVENTO_MEDIO = 3 // evento 12-36 meses
const PUNTOS_TALLER_EVENTO_VIEJO = 1 // evento > 36 meses

const PUNTOS_BICISALUD_BASE = 25
// Ni premia (25, el maximo) ni castiga (0) la ausencia de un dispositivo IoT
// vinculado -- decision explicita de Federico, no tener sensor no es lo mismo
// que estar sana.
const PUNTOS_BICISALUD_SIN_DATOS = 13
const DEDUCCION_BICISALUD_ALTA = 8
const DEDUCCION_BICISALUD_CRITICA = 12

const PUNTOS_ANTIGUEDAD_TOPE = 15
const ANTIGUEDAD_TOPE_DIAS = 365

const UMBRAL_BRONCE = 40
const UMBRAL_ORO = 75

export interface ScoreConfianza {
  total: number
  badge: 'oro' | 'bronce' | null
  factores: {
    cit: number
    talleres: number
    biciSalud: number
    antiguedad: number
  }
}

/**
 * Insumo que el llamador (garaje.service.ts, que ya sabe interpretar el CIT
 * de cada bici) le pasa a este servicio. `factorCit` ya viene resuelto
 * (0 | 15 | 35) para no duplicar aca la logica de esCitCompleto().
 *
 * `bicicletaCreadoEn` es `bicicletas.created_at`, no `cits.created_at`: a
 * diferencia del CIT (que se resellar/recrea en transferencias), la fila de
 * la bici se crea una sola vez -- mide antiguedad real en la plataforma, sin
 * resetear.
 */
export interface InsumoScoreCit {
  factorCit: number
  bicicletaCreadoEn: string | null
}

function calcularFactorAntiguedad(bicicletaCreadoEn: string | null): number {
  if (!bicicletaCreadoEn) return 0
  const dias = (Date.now() - new Date(bicicletaCreadoEn).getTime()) / 86_400_000
  if (dias <= 0) return 0
  return Math.min(
    PUNTOS_ANTIGUEDAD_TOPE,
    Math.round((PUNTOS_ANTIGUEDAD_TOPE * dias) / ANTIGUEDAD_TOPE_DIAS)
  )
}

function calcularBadge(total: number): ScoreConfianza['badge'] {
  if (total >= UMBRAL_ORO) return 'oro'
  if (total >= UMBRAL_BRONCE) return 'bronce'
  return null
}

interface TallerAgregadoRow {
  bicicleta_id: string
  puntos: string
}

interface BiciSaludAgregadoRow {
  bicicleta_id: string
  deduccion: string
}

/**
 * Calcula el Score de Confianza para un lote de bicis. Tres queries batched
 * en paralelo (nunca N+1): historial de talleres, deducciones de BiciSalud,
 * y existencia de algun dispositivo IoT vinculado (para la regla de
 * neutralidad del factor BiciSalud).
 */
export async function calcularScoresConfianza(
  insumosPorBici: Map<string, InsumoScoreCit>
): Promise<Map<string, ScoreConfianza>> {
  const ids = [...insumosPorBici.keys()]
  const resultado = new Map<string, ScoreConfianza>()
  if (ids.length === 0) return resultado

  const pool = getPool()

  const [talleresRes, biciSaludRes, dispositivosRes] = await Promise.all([
    pool.query<TallerAgregadoRow>(
      `
        SELECT bicicleta_id,
          SUM(
            CASE
              WHEN created_at > NOW() - INTERVAL '12 months' THEN ${PUNTOS_TALLER_EVENTO_RECIENTE}
              WHEN created_at > NOW() - INTERVAL '36 months' THEN ${PUNTOS_TALLER_EVENTO_MEDIO}
              ELSE ${PUNTOS_TALLER_EVENTO_VIEJO}
            END
          ) AS puntos
        FROM inspecciones_fisicas
        WHERE bicicleta_id = ANY($1::uuid[]) AND resultado = 'APROBADA'
        GROUP BY bicicleta_id
      `,
      [ids]
    ),
    pool.query<BiciSaludAgregadoRow>(
      `
        SELECT bicicleta_id,
          SUM(
            CASE severidad
              WHEN 'critica' THEN ${DEDUCCION_BICISALUD_CRITICA}
              WHEN 'alta' THEN ${DEDUCCION_BICISALUD_ALTA}
              ELSE 0
            END
          ) AS deduccion
        FROM bicisalud_resumen_publico
        WHERE bicicleta_id = ANY($1::uuid[]) AND severidad IN ('alta', 'critica')
        GROUP BY bicicleta_id
      `,
      [ids]
    ),
    pool.query<{ bicicleta_id: string }>(
      `SELECT DISTINCT bicicleta_id FROM iot_dispositivos WHERE bicicleta_id = ANY($1::uuid[])`,
      [ids]
    ),
  ])

  const talleresPorBici = new Map<string, number>(
    talleresRes.rows.map((r: TallerAgregadoRow) => [r.bicicleta_id, Number(r.puntos)])
  )
  const deduccionPorBici = new Map<string, number>(
    biciSaludRes.rows.map((r: BiciSaludAgregadoRow) => [r.bicicleta_id, Number(r.deduccion)])
  )
  const tieneDispositivo = new Set(
    dispositivosRes.rows.map((r: { bicicleta_id: string }) => r.bicicleta_id)
  )

  for (const [bicicletaId, insumo] of insumosPorBici) {
    const cit = insumo.factorCit

    const talleres = Math.min(
      PUNTOS_TALLERES_TOPE,
      talleresPorBici.get(bicicletaId) ?? 0
    )

    const biciSalud = tieneDispositivo.has(bicicletaId)
      ? Math.max(0, PUNTOS_BICISALUD_BASE - (deduccionPorBici.get(bicicletaId) ?? 0))
      : PUNTOS_BICISALUD_SIN_DATOS

    const antiguedad = calcularFactorAntiguedad(insumo.bicicletaCreadoEn)

    const total = cit + talleres + biciSalud + antiguedad

    resultado.set(bicicletaId, {
      total,
      badge: calcularBadge(total),
      factores: { cit, talleres, biciSalud, antiguedad },
    })
  }

  return resultado
}
