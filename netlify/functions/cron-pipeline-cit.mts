// RODAID — Modulo 4 (CIT): worker programado del pipeline de validacion.
//
// Automatiza "el paso del tiempo" y las validaciones del Certificado de Identidad
// Tecnica. Las transiciones del CIT no dependen de una accion humana puntual:
// ocurren cuando se cumple una ventana temporal o cuando un cruce de datos
// resuelve. Este worker las materializa de forma idempotente en cada corrida.
//
// Maquina de estados que recorre el pipeline (sobre el esquema canonico `cits`):
//
//   PENDIENTE_VALIDACION ──(intake asentado +5 min)──▶ PROCESANDO_CRUCE
//   PROCESANDO_CRUCE ──(denuncia por robo)──────────▶ RECHAZADO
//   PROCESANDO_CRUCE ──(alerta de geocercado GPS)───▶ ANOMALIA_DETECTADA
//   PROCESANDO_CRUCE ──(ventana de 72 hs cumplida)──▶ ACTIVO  (vigencia 2 anios)
//   ACTIVO ──(vigencia de 2 anios expirada)─────────▶ VENCIDO
//
// Cada transicion deja un evento append-only en `cit_eventos` (actor "sistema")
// para que la auditoria del certificado refleje el cambio automatico.
//
// Inmutabilidad: el worker solo evoluciona el `estado` y, al activar, fija la
// vigencia. Nunca toca la huella, la firma ni los datos sellados, de modo que el
// trigger `cit_proteger_payload` no rechaza estos UPDATE. La acunacion en la
// Blockchain Federal Argentina (BFA) se confirma de forma asincrona fuera de este
// worker; aqui solo se reporta cuantos certificados quedan pendientes de anclaje.

import { getDatabase } from '@netlify/database'

// node-postgres-like client expuesto por @netlify/database.
type SqlClient = {
  query: <T = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ) => Promise<{ rows: T[]; rowCount: number | null }>
  release: () => void
}

// Minutos que el intake "reposa" antes de entrar al sistema de cruce de datos.
const MINUTOS_INGRESO_CRUCE = 5
// Vigencia del certificado una vez activado.
const VIGENCIA_ANIOS = 2

interface CruceRow {
  id: string
  bicicleta_serial: string
  alerta_gps: boolean
  vencio_ventana: boolean
}

/**
 * Mock temporal de la consulta a las fuerzas de seguridad (Ministerio). Mientras
 * no exista la integracion real, un numero de serie terminado en "999" simula una
 * denuncia por robo activa. Es un punto de extension aislado y deterministico.
 */
function tieneDenunciaPorRobo(serial: string): boolean {
  return serial.endsWith('999')
}

/** Inserta un evento de auditoria del ciclo de vida del CIT. */
async function registrarEvento(
  client: SqlClient,
  evento: {
    citId: string
    tipo: string
    estadoAnterior: string
    estadoNuevo: string
    motivo: string
  }
): Promise<void> {
  await client.query(
    `
      INSERT INTO cit_eventos
        (cit_id, tipo, estado_anterior, estado_nuevo, actor_rol, metadata)
      VALUES ($1, $2, $3::cit_estado, $4::cit_estado, 'sistema', jsonb_build_object('motivo', $5::text))
    `,
    [evento.citId, evento.tipo, evento.estadoAnterior, evento.estadoNuevo, evento.motivo]
  )
}

/**
 * PASO 1 — Ingreso al cruce: los intakes asentados hace mas de N minutos pasan de
 * PENDIENTE_VALIDACION a PROCESANDO_CRUCE. Set-based en una sola sentencia (CTE)
 * para que el conteo y los eventos sean exactamente consistentes con lo movido.
 */
async function ingresarAlCruce(client: SqlClient): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(
    `
      WITH movidos AS (
        UPDATE cits
        SET estado = 'PROCESANDO_CRUCE'
        WHERE estado = 'PENDIENTE_VALIDACION'
          AND sellado_en <= NOW() - ($1 || ' minutes')::interval
        RETURNING id
      ),
      auditoria AS (
        INSERT INTO cit_eventos
          (cit_id, tipo, estado_anterior, estado_nuevo, actor_rol, metadata)
        SELECT
          id, 'CIT_INGRESO_CRUCE',
          'PENDIENTE_VALIDACION'::cit_estado, 'PROCESANDO_CRUCE'::cit_estado,
          'sistema',
          jsonb_build_object('motivo', 'Ingreso automatico al sistema de cruce de datos.')
        FROM movidos
        RETURNING cit_id AS id
      )
      SELECT id FROM auditoria
    `,
    [String(MINUTOS_INGRESO_CRUCE)]
  )
  return rows.map((row) => row.id)
}

/**
 * PASO 2 — Resolucion del cruce. Cada certificado en PROCESANDO_CRUCE se evalua y
 * resuelve dentro de su propia transaccion (bloqueo FOR UPDATE), de modo que una
 * fila problematica no aborte el barrido completo. Resultado por fila:
 *   - denuncia por robo            -> RECHAZADO
 *   - alerta de geocercado GPS     -> ANOMALIA_DETECTADA
 *   - ventana de 72 hs cumplida    -> ACTIVO (fija fecha_emision + vencimiento)
 *   - en otro caso, sigue esperando en PROCESANDO_CRUCE.
 */
async function resolverCruces(
  client: SqlClient
): Promise<{ rechazados: string[]; anomalias: string[]; activados: string[] }> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM cits WHERE estado = 'PROCESANDO_CRUCE' ORDER BY sellado_en ASC`
  )

  const rechazados: string[] = []
  const anomalias: string[] = []
  const activados: string[] = []

  for (const { id } of rows) {
    try {
      await client.query('BEGIN')

      // Re-lee bajo bloqueo: la fila pudo cambiar entre el listado y el proceso.
      const bloqueada = await client.query<CruceRow>(
        `
          SELECT id, bicicleta_serial, alerta_gps,
                 (expira_en <= NOW()) AS vencio_ventana
          FROM cits
          WHERE id = $1 AND estado = 'PROCESANDO_CRUCE'
          FOR UPDATE
        `,
        [id]
      )
      const cit = bloqueada.rows[0]
      if (!cit) {
        await client.query('ROLLBACK')
        continue
      }

      if (tieneDenunciaPorRobo(cit.bicicleta_serial)) {
        await client.query(`UPDATE cits SET estado = 'RECHAZADO' WHERE id = $1`, [cit.id])
        await registrarEvento(client, {
          citId: cit.id,
          tipo: 'CIT_CRUCE_RECHAZADO',
          estadoAnterior: 'PROCESANDO_CRUCE',
          estadoNuevo: 'RECHAZADO',
          motivo: 'Cruce fallido: el numero de serie tiene un reporte de robo activo.',
        })
        await client.query('COMMIT')
        rechazados.push(cit.id)
        continue
      }

      if (cit.alerta_gps) {
        await client.query(`UPDATE cits SET estado = 'ANOMALIA_DETECTADA' WHERE id = $1`, [
          cit.id,
        ])
        await registrarEvento(client, {
          citId: cit.id,
          tipo: 'CIT_ANOMALIA_DETECTADA',
          estadoAnterior: 'PROCESANDO_CRUCE',
          estadoNuevo: 'ANOMALIA_DETECTADA',
          motivo: 'Coordenadas del intake fuera del rango del taller aliado emisor.',
        })
        await client.query('COMMIT')
        anomalias.push(cit.id)
        continue
      }

      if (cit.vencio_ventana) {
        // Al activarse se fija la vigencia. El CHECK `cits_activo_vigente` exige
        // que un CIT ACTIVO tenga fecha_emision Y fecha_vencimiento.
        await client.query(
          `
            UPDATE cits
            SET estado = 'ACTIVO',
                validado_en = NOW(),
                fecha_emision = NOW(),
                fecha_vencimiento = NOW() + ($2 || ' years')::interval
            WHERE id = $1
          `,
          [cit.id, String(VIGENCIA_ANIOS)]
        )
        await registrarEvento(client, {
          citId: cit.id,
          tipo: 'CIT_PIPELINE_ACTIVADO',
          estadoAnterior: 'PROCESANDO_CRUCE',
          estadoNuevo: 'ACTIVO',
          motivo: 'Cruce superado y ventana de 72 hs cumplida. Certificado vigente por 2 anios.',
        })
        await client.query('COMMIT')
        activados.push(cit.id)
        continue
      }

      // Sigue dentro de la ventana, sin novedades: permanece en cruce.
      await client.query('ROLLBACK')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      console.error('[cron-pipeline-cit] fallo al resolver el cruce del CIT', id, error)
    }
  }

  return { rechazados, anomalias, activados }
}

/**
 * PASO 3 — Vencimiento por vigencia: los certificados ACTIVO cuya vigencia de 2
 * anios expiro pasan a VENCIDO. Set-based (CTE) con su auditoria.
 */
async function vencerVigencias(client: SqlClient): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(
    `
      WITH vencidos AS (
        UPDATE cits
        SET estado = 'VENCIDO'
        WHERE estado = 'ACTIVO'
          AND fecha_vencimiento IS NOT NULL
          AND fecha_vencimiento <= NOW()
        RETURNING id
      ),
      auditoria AS (
        INSERT INTO cit_eventos
          (cit_id, tipo, estado_anterior, estado_nuevo, actor_rol, metadata)
        SELECT
          id, 'CIT_VIGENCIA_VENCIDA',
          'ACTIVO'::cit_estado, 'VENCIDO'::cit_estado,
          'sistema',
          jsonb_build_object('motivo', 'La vigencia de 2 anios del certificado expiro.')
        FROM vencidos
        RETURNING cit_id AS id
      )
      SELECT id FROM auditoria
    `
  )
  return rows.map((row) => row.id)
}

export default async (req: Request) => {
  // El cuerpo de una funcion programada trae { next_run: <ISO-8601> }.
  const proximaCorrida = await req
    .json()
    .then((cuerpo) => (cuerpo as { next_run?: string }).next_run)
    .catch(() => undefined)

  const client = (await getDatabase().pool.connect()) as unknown as SqlClient

  try {
    await client.query('BEGIN')
    const ingresados = await ingresarAlCruce(client)
    await client.query('COMMIT')

    const cruces = await resolverCruces(client)

    await client.query('BEGIN')
    const vencidos = await vencerVigencias(client)
    await client.query('COMMIT')

    const { rows: pendientesBfa } = await client.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM cits WHERE bfa_estado = 'PENDIENTE'`
    )

    const resumen = {
      ejecutadoEn: new Date().toISOString(),
      proximaCorrida: proximaCorrida ?? null,
      ingresadosACruce: ingresados.length,
      rechazadosPorRobo: cruces.rechazados.length,
      anomaliasGps: cruces.anomalias.length,
      activados: cruces.activados.length,
      vencidosPorVigencia: vencidos.length,
      bfaPendientesDeAnclaje: Number(pendientesBfa[0]?.total ?? 0),
    }

    console.log('[cron-pipeline-cit] barrido completado', JSON.stringify(resumen))
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error('[cron-pipeline-cit] el barrido del pipeline fallo', error)
    throw error
  } finally {
    client.release()
  }
}

// Barrido horario (UTC). Granularidad mas que suficiente para una ventana de
// 72 hs; el minuto 17 evita el congestionamiento del tope de hora.
export const config = {
  schedule: '17 * * * *',
}
