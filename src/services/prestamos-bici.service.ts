import { ApiError, getPool } from '@/lib/marketplace'
import { crearAlerta } from '@/src/services/iot.service'

/**
 * RODAID — Prestamo gratuito de bicis certificadas propias del Taller Aliado.
 *
 * NO es un alquiler pago -- no hay cobro ni medio de pago involucrado. Solo
 * bicis que el propio taller certifico como stock propio (CIT activo), y el
 * taller asigna el prestamo a quien decida sin exigir cuenta RODAID
 * verificada del prestatario. Sin historial de prestamos pasados a
 * proposito -- una sola fila por bici, se resetea en cada ciclo
 * disponible<->prestada (ver la migracion para el detalle de la decision).
 *
 * La alerta de horario vencido reusa iot_alertas (crearAlerta(), con
 * dedupe) via el worker periodico -- ver
 * netlify/functions/prestamo-vencimiento-worker.mts. Es SOLO interna al
 * taller: nunca dispara Modo Robo ni notifica a RODAID/autoridades.
 */

interface PrestamoRow {
  id: string
  bicicleta_id: string
  taller_id: string
  estado: string
  prestatario_nombre: string | null
  prestatario_contacto: string | null
  hora_inicio: string | null
  hora_esperada_devolucion: string | null
  hora_devolucion_real: string | null
  created_at: string
  updated_at: string
}

export interface PrestamoBici {
  id: string
  bicicletaId: string
  tallerId: string
  estado: 'disponible' | 'prestada'
  prestatarioNombre: string | null
  prestatarioContacto: string | null
  horaInicio: string | null
  horaEsperadaDevolucion: string | null
  horaDevolucionReal: string | null
  vencido: boolean
}

function mapPrestamo(row: PrestamoRow): PrestamoBici {
  const vencido =
    row.estado === 'prestada' &&
    row.hora_esperada_devolucion !== null &&
    new Date(row.hora_esperada_devolucion).getTime() < Date.now()
  return {
    id: row.id,
    bicicletaId: row.bicicleta_id,
    tallerId: row.taller_id,
    estado: row.estado as 'disponible' | 'prestada',
    prestatarioNombre: row.prestatario_nombre,
    prestatarioContacto: row.prestatario_contacto,
    horaInicio: row.hora_inicio,
    horaEsperadaDevolucion: row.hora_esperada_devolucion,
    horaDevolucionReal: row.hora_devolucion_real,
    vencido,
  }
}

/** Valida que la bici sea stock propio del taller (dueño) con CIT activo. */
async function validarBiciDelTaller(tallerId: string, bicicletaId: string): Promise<void> {
  const pool = getPool()
  const aliado = await pool.query<{ usuario_id: string | null }>(
    `SELECT usuario_id FROM aliados WHERE id = $1 LIMIT 1`,
    [tallerId]
  )
  const usuarioTaller = aliado.rows[0]?.usuario_id
  if (!usuarioTaller) {
    throw new ApiError(403, 'SIN_ALIADO', 'No tenes un Taller Aliado propio vinculado.')
  }

  const bici = await pool.query<{ propietario_id: string }>(
    `SELECT propietario_id FROM bicicletas WHERE id = $1 LIMIT 1`,
    [bicicletaId]
  )
  if (!bici.rows[0]) {
    throw new ApiError(404, 'BICICLETA_NOT_FOUND', 'La bicicleta indicada no existe.')
  }
  if (bici.rows[0].propietario_id !== usuarioTaller) {
    throw new ApiError(
      403,
      'NOT_OWNER',
      'Solo podes ofrecer en préstamo bicis que son stock propio de tu taller.'
    )
  }

  const cit = await pool.query(
    `SELECT 1 FROM cits WHERE bicicleta_id = $1 AND estado = 'activo' LIMIT 1`,
    [bicicletaId]
  )
  if (!cit.rowCount) {
    throw new ApiError(
      409,
      'CIT_NO_ACTIVO',
      'La bici debe tener un CIT activo (certificada por tu taller) para ofrecerla en préstamo.'
    )
  }
}

/** Marca (o reactiva) una bici del taller como disponible para préstamo. */
export async function marcarDisponible(
  tallerId: string,
  bicicletaId: string
): Promise<PrestamoBici> {
  await validarBiciDelTaller(tallerId, bicicletaId)

  const existente = await getPool().query<PrestamoRow>(
    `SELECT * FROM prestamos_bici WHERE bicicleta_id = $1`,
    [bicicletaId]
  )
  if (existente.rows[0]?.estado === 'prestada') {
    throw new ApiError(
      409,
      'PRESTAMO_EN_CURSO',
      'Esta bici está prestada -- cerrá el préstamo antes de volver a marcarla disponible.'
    )
  }

  const res = await getPool().query<PrestamoRow>(
    `
      INSERT INTO prestamos_bici (bicicleta_id, taller_id, estado)
      VALUES ($1, $2, 'disponible')
      ON CONFLICT (bicicleta_id) DO UPDATE
        SET estado = 'disponible', taller_id = $2, updated_at = NOW()
      RETURNING *
    `,
    [bicicletaId, tallerId]
  )
  return mapPrestamo(res.rows[0])
}

/** Entrega la bici a un prestatario (texto libre, sin cuenta RODAID). */
export async function iniciarPrestamo(
  tallerId: string,
  input: {
    bicicletaId: string
    prestatarioNombre: string
    prestatarioContacto?: string | null
    horaEsperadaDevolucion: string
  }
): Promise<PrestamoBici> {
  await validarBiciDelTaller(tallerId, input.bicicletaId)

  const res = await getPool().query<PrestamoRow>(
    `
      UPDATE prestamos_bici
      SET estado = 'prestada',
          prestatario_nombre = $3,
          prestatario_contacto = $4,
          hora_inicio = NOW(),
          hora_esperada_devolucion = $5,
          hora_devolucion_real = NULL,
          updated_at = NOW()
      WHERE bicicleta_id = $1 AND taller_id = $2 AND estado = 'disponible'
      RETURNING *
    `,
    [
      input.bicicletaId,
      tallerId,
      input.prestatarioNombre,
      input.prestatarioContacto ?? null,
      input.horaEsperadaDevolucion,
    ]
  )
  if (!res.rows[0]) {
    throw new ApiError(
      409,
      'NO_DISPONIBLE',
      'Esta bici no está marcada como disponible para préstamo.'
    )
  }
  return mapPrestamo(res.rows[0])
}

/** Registra la devolución y deja la bici lista para el próximo préstamo. */
export async function cerrarPrestamo(
  tallerId: string,
  bicicletaId: string
): Promise<PrestamoBici> {
  const res = await getPool().query<PrestamoRow>(
    `
      UPDATE prestamos_bici
      SET estado = 'disponible', hora_devolucion_real = NOW(), updated_at = NOW()
      WHERE bicicleta_id = $1 AND taller_id = $2 AND estado = 'prestada'
      RETURNING *
    `,
    [bicicletaId, tallerId]
  )
  if (!res.rows[0]) {
    throw new ApiError(
      409,
      'NO_PRESTADA',
      'Esta bici no tiene un préstamo en curso.'
    )
  }
  return mapPrestamo(res.rows[0])
}

/** Listado de bicis en préstamo/disponibles del taller. */
export async function listarPrestamosPorTaller(tallerId: string): Promise<PrestamoBici[]> {
  const res = await getPool().query<PrestamoRow>(
    `SELECT * FROM prestamos_bici WHERE taller_id = $1 ORDER BY updated_at DESC`,
    [tallerId]
  )
  return res.rows.map(mapPrestamo)
}

/**
 * Barrido periódico (worker): encuentra préstamos vencidos y dispara una
 * alerta SOLO interna (iot_alertas, visible en el panel del taller) --
 * nunca Modo Robo, nunca notifica a RODAID o autoridades. Dedupeada por
 * dedupeKey (id del préstamo + el vencimiento exacto), para que no se
 * repita en cada corrida del cron mientras siga vencido.
 */
export async function procesarPrestamosVencidos(): Promise<{ procesados: number }> {
  const pool = getPool()
  const vencidos = await pool.query<
    PrestamoRow & { propietario_id: string; marca: string; modelo: string }
  >(
    `
      SELECT p.*, b.propietario_id, b.marca, b.modelo
      FROM prestamos_bici p
      JOIN bicicletas b ON b.id = p.bicicleta_id
      WHERE p.estado = 'prestada'
        AND p.hora_esperada_devolucion IS NOT NULL
        AND p.hora_esperada_devolucion < NOW()
    `
  )

  let procesados = 0
  for (const row of vencidos.rows) {
    const creada = await crearAlerta({
      dispositivoId: null,
      bicicletaId: row.bicicleta_id,
      usuarioId: row.propietario_id,
      tipo: 'prestamo_vencido',
      severidad: 'media',
      titulo: 'Préstamo vencido',
      mensaje: `${row.marca} ${row.modelo} no volvió en el horario esperado del préstamo${
        row.prestatario_nombre ? ` (prestada a ${row.prestatario_nombre})` : ''
      }.`,
      dedupeKey: `prestamo:${row.id}:${row.hora_esperada_devolucion}`,
      ventanaHoras: 24 * 14,
      metadata: {
        prestamoId: row.id,
        prestatarioNombre: row.prestatario_nombre,
        prestatarioContacto: row.prestatario_contacto,
        horaEsperadaDevolucion: row.hora_esperada_devolucion,
      },
    })
    if (creada) procesados += 1
  }
  return { procesados }
}
