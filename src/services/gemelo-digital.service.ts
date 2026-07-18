import { ApiError, getPool } from '@/lib/marketplace'
import type { ChecklistInspeccion } from '@/lib/puntos-inspeccion'

/**
 * RODAID — Gemelo Digital Interactivo (Garaje Digital).
 *
 * Combina DOS fuentes de datos independientes en una sola ilustracion de la
 * bici con "puntos de calor", una por zona:
 *
 *   - IoT (cadena, cubiertas, servicio): `bicisalud_resumen_publico`, datos
 *     de telemetria continua, se actualizan solos (Hito 17). "servicio" es
 *     deliberadamente NO espacial -- no corresponde a ninguna pieza fisica
 *     concreta, se muestra como badge aparte, no como zona del SVG.
 *   - Manual (horquilla, ruedas, frenos): la ULTIMA inspeccion fisica con
 *     modulo_componentes=TRUE Y resultado='APROBADA' de esta bici (Checklist
 *     de 20 puntos, "CIT Completo Plus") -- un snapshot de un evento puntual,
 *     NO se actualiza solo. Deliberadamente excluye inspecciones con
 *     resultado='DISCREPANCIA': mezclar datos de desgaste de una inspeccion
 *     formalmente rechazada seria engañoso.
 *
 * Las 5 zonas manuales base estan fijadas a los 5 puntos de "alto valor" del
 * checklist (lib/puntos-inspeccion.ts::PUNTOS_CON_COMPONENTE) -- P13/P14
 * (Transmision) quedan fuera de esta fase (zona gris, ver CLAUDE.md).
 *
 * El color de una zona manual sale de `checklist_detalle` (el resultado
 * ok/observacion/falla/no_aplica del punto), NO de si existe fila en
 * `componentes_tokenizados` -- esa tabla es enriquecimiento opcional
 * (marca/modelo/serial/foto) para el detalle, no un prerequisito para
 * mostrar el estado de la zona.
 *
 * zonas YA NO es un array fijo de 7 (ver zonasAplicables()): 3 zonas mas
 * (amortiguador_trasero/motor/bateria) son condicionales segun tipo/
 * suspension_trasera de la bici -- Checklist Premium, ver
 * lib/puntos-inspeccion.ts::PUNTOS_INSPECCION_PREMIUM. Las 7 zonas base
 * siguen siendo universales.
 */

export type ZonaId =
  | 'cadena'
  | 'cubiertas'
  | 'horquilla'
  | 'rueda_delantera'
  | 'rueda_trasera'
  | 'freno_delantero'
  | 'freno_trasero'
  // Condicionales -- solo aparecen si la bici las tiene (ver zonasAplicables()).
  | 'amortiguador_trasero'
  | 'motor'
  | 'bateria'

export type EstadoZona = 'ok' | 'media' | 'alta' | 'sin_datos'

export interface ComponenteZona {
  marca: string | null
  modelo: string | null
  numeroSerie: string | null
  tieneFoto: boolean
}

export interface ZonaGemeloDigital {
  zonaId: ZonaId
  fuente: 'iot' | 'manual' | 'sin_datos'
  estado: EstadoZona
  titulo: string
  mensaje: string | null
  /** ISO. Absoluta (fecha de la inspeccion) para manual; el frontend decide
   * si la muestra relativa (iot) o absoluta (manual) -- el dato es el mismo. */
  fecha: string | null
  /** Solo presente en zonas manuales con fila en componentes_tokenizados. */
  componente?: ComponenteZona
}

export interface GemeloDigital {
  tipo: string
  ilustracion: 'ruta' | 'mtb' | 'urbana' | 'generica'
  /** 7, 8, 9 o 10 entradas segun tipo/suspension_trasera de la bici (ver
   * zonasAplicables()) -- 'sin_datos' no oculta la zona, la pinta gris.
   * Ausencia de dato no es "sano". */
  zonas: ZonaGemeloDigital[]
  /** Badge no-espacial (IoT "servicio"). null si no hay hallazgo vigente. */
  servicioTecnico: { titulo: string; mensaje: string; fecha: string } | null
}

const ZONAS_BASE: ZonaId[] = [
  'cadena',
  'cubiertas',
  'horquilla',
  'rueda_delantera',
  'rueda_trasera',
  'freno_delantero',
  'freno_trasero',
]

/**
 * Zonas relevantes para ESTA bici -- ya no un array fijo de 7. Solo 3 zonas
 * son condicionales (mismo criterio que puntosPremiumAplicables() en
 * lib/puntos-inspeccion.ts, coarse, no una matriz fina): amortiguador_trasero
 * si suspensionTrasera=true, motor/bateria si tipo='Eléctrica'. Las 7 zonas
 * base son universales -- toda bici tiene cadena/cubiertas/horquilla/ruedas/
 * frenos, aunque no tengan datos todavia ('sin_datos').
 */
function zonasAplicables(bici: { tipo: string; suspensionTrasera: boolean | null }): ZonaId[] {
  const zonas = [...ZONAS_BASE]
  if (bici.suspensionTrasera === true) zonas.push('amortiguador_trasero')
  if (bici.tipo === 'Eléctrica') zonas.push('motor', 'bateria')
  return zonas
}

const TITULO_ZONA: Record<ZonaId, string> = {
  cadena: 'Cadena',
  cubiertas: 'Cubiertas',
  horquilla: 'Horquilla',
  rueda_delantera: 'Rueda delantera',
  rueda_trasera: 'Rueda trasera',
  freno_delantero: 'Freno delantero',
  freno_trasero: 'Freno trasero',
  amortiguador_trasero: 'Amortiguador trasero',
  motor: 'Motor',
  bateria: 'Batería',
}

/** Los 7 valores reales de bicicletas.tipo (garaje.tsx) -- 3 tienen
 * ilustracion propia, el resto usa la silueta generica. */
const ILUSTRACION_POR_TIPO: Record<string, GemeloDigital['ilustracion']> = {
  Ruta: 'ruta',
  MTB: 'mtb',
  Urbana: 'urbana',
  Gravel: 'generica',
  Eléctrica: 'generica',
  BMX: 'generica',
  Plegable: 'generica',
}

/** P06/P08/P09/P11/P12 (base) + PR01/PR07/PR08 (premium) -> su zona en el
 * gemelo. checklist_detalle ya trae ambos namespaces mezclados en el mismo
 * objeto (ver inspeccion.service.ts), así que este mapa simplemente se
 * amplía -- no hace falta lógica nueva, la zona resultante ya sale filtrada
 * por zonasAplicables() antes de devolverse. */
const PUNTO_A_ZONA: Record<string, ZonaId> = {
  P06: 'horquilla',
  P08: 'rueda_delantera',
  P09: 'rueda_trasera',
  P11: 'freno_delantero',
  P12: 'freno_trasero',
  PR01: 'amortiguador_trasero',
  PR07: 'motor',
  PR08: 'bateria',
}

function mapSeveridadIot(severidad: string): EstadoZona {
  return severidad === 'alta' || severidad === 'critica' ? 'alta' : 'media'
}

function mapResultadoManual(resultado: string | undefined): EstadoZona {
  if (resultado === 'falla') return 'alta'
  if (resultado === 'observacion') return 'media'
  if (resultado === 'ok') return 'ok'
  return 'sin_datos' // no_aplica u otro valor inesperado
}

function zonaVacia(zonaId: ZonaId): ZonaGemeloDigital {
  return {
    zonaId,
    fuente: 'sin_datos',
    estado: 'sin_datos',
    titulo: TITULO_ZONA[zonaId],
    mensaje: null,
    fecha: null,
  }
}

interface BiciRow {
  tipo: string
  suspension_trasera: boolean | null
  propietario_id: string
}

interface BiciSaludRow {
  tipo: string
  severidad: string
  titulo: string
  mensaje: string
  created_at: string
}

interface InspeccionPlusRow {
  id: string
  checklist_detalle: ChecklistInspeccion | null
  created_at: string
}

interface ComponenteRow {
  punto_id: string
  marca: string | null
  modelo: string | null
  numero_serie: string | null
  foto_blob_key: string | null
}

export async function obtenerGemeloDigital(
  bicicletaId: string,
  usuarioId: string
): Promise<GemeloDigital> {
  const pool = getPool()

  const biciRes = await pool.query<BiciRow>(
    `SELECT tipo, suspension_trasera, propietario_id FROM bicicletas WHERE id = $1`,
    [bicicletaId]
  )
  const bici = biciRes.rows[0]
  if (!bici) {
    throw new ApiError(404, 'BICICLETA_NOT_FOUND', 'No encontramos esa bicicleta.')
  }
  if (bici.propietario_id !== usuarioId) {
    throw new ApiError(403, 'NOT_OWNER', 'No sos el propietario de esta bicicleta.')
  }

  const zonasDeEstaBici = zonasAplicables({ tipo: bici.tipo, suspensionTrasera: bici.suspension_trasera })
  const zonas = new Map<ZonaId, ZonaGemeloDigital>(
    zonasDeEstaBici.map((z) => [z, zonaVacia(z)])
  )
  let servicioTecnico: GemeloDigital['servicioTecnico'] = null

  // ── Fuente 1: IoT (bicisalud_resumen_publico) ──────────────────────────
  const iotRes = await pool.query<BiciSaludRow>(
    `SELECT tipo, severidad, titulo, mensaje, created_at
     FROM bicisalud_resumen_publico WHERE bicicleta_id = $1`,
    [bicicletaId]
  )
  for (const r of iotRes.rows) {
    if (r.tipo === 'mantenimiento_cadena') {
      zonas.set('cadena', {
        zonaId: 'cadena',
        fuente: 'iot',
        estado: mapSeveridadIot(r.severidad),
        titulo: r.titulo,
        mensaje: r.mensaje,
        fecha: r.created_at,
      })
    } else if (r.tipo === 'mantenimiento_cubiertas') {
      zonas.set('cubiertas', {
        zonaId: 'cubiertas',
        fuente: 'iot',
        estado: mapSeveridadIot(r.severidad),
        titulo: r.titulo,
        mensaje: r.mensaje,
        fecha: r.created_at,
      })
    } else if (r.tipo === 'mantenimiento_servicio') {
      servicioTecnico = { titulo: r.titulo, mensaje: r.mensaje, fecha: r.created_at }
    }
  }

  // ── Fuente 2: manual (ultima inspeccion Plus APROBADA) ─────────────────
  const inspRes = await pool.query<InspeccionPlusRow>(
    `SELECT id, checklist_detalle, created_at
     FROM inspecciones_fisicas
     WHERE bicicleta_id = $1 AND modulo_componentes = TRUE AND resultado = 'APROBADA'
     ORDER BY created_at DESC
     LIMIT 1`,
    [bicicletaId]
  )
  const inspeccion = inspRes.rows[0]
  if (inspeccion?.checklist_detalle) {
    const componentesRes = await pool.query<ComponenteRow>(
      `SELECT punto_id, marca, modelo, numero_serie, foto_blob_key
       FROM componentes_tokenizados WHERE inspeccion_id = $1`,
      [inspeccion.id]
    )
    const componentePorPunto = new Map<string, ComponenteRow>(
      componentesRes.rows.map((r: ComponenteRow) => [r.punto_id, r])
    )

    for (const [puntoId, zonaId] of Object.entries(PUNTO_A_ZONA)) {
      const punto = inspeccion.checklist_detalle[puntoId]
      if (!punto) continue
      const comp = componentePorPunto.get(puntoId)
      zonas.set(zonaId, {
        zonaId,
        fuente: 'manual',
        estado: mapResultadoManual(punto.resultado),
        titulo: TITULO_ZONA[zonaId],
        mensaje: punto.nota ?? null,
        fecha: inspeccion.created_at,
        componente: comp
          ? {
              marca: comp.marca,
              modelo: comp.modelo,
              numeroSerie: comp.numero_serie,
              tieneFoto: comp.foto_blob_key !== null,
            }
          : undefined,
      })
    }
  }

  return {
    tipo: bici.tipo,
    ilustracion: ILUSTRACION_POR_TIPO[bici.tipo] ?? 'generica',
    zonas: zonasDeEstaBici.map((z) => zonas.get(z)!),
    servicioTecnico,
  }
}
