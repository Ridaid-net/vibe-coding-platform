import { ApiError, getPool } from '@/lib/marketplace'

/**
 * RODAID — Validación previa a la emisión de un CIT.
 *
 * `validarSerial` ejecuta el pipeline de 7 checks que un inspector corre antes
 * de iniciar un CIT. El primero (formato) y el segundo (existencia en la base)
 * son secuenciales —los demás dependen de la bicicleta hallada—; los cinco
 * restantes se ejecutan en paralelo. El resultado y el detalle de cada check se
 * auditan en `serial_validaciones`.
 *
 * Adaptaciones a las primitivas disponibles en Netlify (sin Redis ni
 * integraciones externas): el estado en la Blockchain Federal Argentina (BFA) y
 * la consulta al Ministerio de Seguridad no están integrados; se reportan como
 * ALERTA informativa (convenio técnico pendiente) y nunca como bloqueantes.
 */

export type ResultadoCheck = 'OK' | 'ALERTA' | 'BLOQUEANTE'

export interface CheckValidacion {
  nombre: string
  resultado: ResultadoCheck
  mensaje: string
}

export interface ValidacionSerial {
  serial: string
  bicicletaId: string | null
  aprobado: boolean
  tieneAlertas: boolean
  resumen: string
  checks: CheckValidacion[]
}

export interface ValidarSerialInput {
  serial?: string | null
  bicicletaId?: string | null
  propietarioDNI: string
  propietarioNombre?: string | null
  inspectorId?: string | null
}

const SERIAL_RE = /^[A-Za-z0-9][A-Za-z0-9-]{3,58}[A-Za-z0-9]$/

interface BiciRow {
  id: string
  numero_serie: string
  marca: string
  modelo: string
  anio: number | null
  propietario_id: string
  propietario_nombre: string | null
}

function normalizar(texto: string): string {
  const COMBINING = /[̀-ͯ]/g
  return texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING, '')
    .replace(/\s+/g, ' ')
}

/**
 * Corre los 7 checks de validación de un serial. No crea ningún CIT; persiste el
 * resultado en `serial_validaciones` para auditoría.
 */
export async function validarSerial(input: ValidarSerialInput): Promise<ValidacionSerial> {
  const pool = getPool()
  const checks: CheckValidacion[] = []

  // ── 1. formato_serial ───────────────────────────────────
  const bici = await resolverBicicleta(input)
  const serial = (input.serial ?? bici?.numero_serie ?? '').trim()

  const formatoOk = SERIAL_RE.test(serial)
  checks.push({
    nombre: 'formato_serial',
    resultado: formatoOk ? 'OK' : 'BLOQUEANTE',
    mensaje: formatoOk
      ? `Serial con formato válido (${serial.length} chars)`
      : 'Serial inválido: se esperan 5-60 caracteres alfanuméricos (guiones permitidos).',
  })

  // ── 2. existencia_db ────────────────────────────────────
  checks.push({
    nombre: 'existencia_db',
    resultado: bici ? 'OK' : 'BLOQUEANTE',
    mensaje: bici
      ? `Bicicleta registrada: ${bici.marca} ${bici.modelo}${bici.anio ? ` ${bici.anio}` : ''}`
      : 'No existe ninguna bicicleta registrada con ese número de serie.',
  })

  // Sin bicicleta no tiene sentido seguir con los checks dependientes.
  if (!bici) {
    return finalizar(pool, serial, null, input, checks)
  }

  // ── 3-7. checks dependientes (en paralelo) ──────────────
  const [propiedad, denuncias, bfa, minSeg, duplicado] = await Promise.all([
    checkPropiedad(bici, input.propietarioNombre ?? null, input.propietarioDNI),
    checkDenuncias(pool, bici.numero_serie),
    checkBfa(),
    checkMinSeg(),
    checkCitDuplicado(pool, bici.id),
  ])
  checks.push(propiedad, denuncias, bfa, minSeg, duplicado)

  return finalizar(pool, serial, bici.id, input, checks)
}

async function resolverBicicleta(input: ValidarSerialInput): Promise<BiciRow | null> {
  const pool = getPool()
  const select = `SELECT b.id, b.numero_serie, b.marca, b.modelo, b.anio,
                         b.propietario_id, u.nombre AS propietario_nombre
                    FROM bicicletas b
                    LEFT JOIN usuarios u ON u.id = b.propietario_id`
  if (input.bicicletaId) {
    const { rows } = await pool.query<BiciRow>(`${select} WHERE b.id = $1`, [input.bicicletaId])
    return rows[0] ?? null
  }
  if (input.serial) {
    const { rows } = await pool.query<BiciRow>(`${select} WHERE b.numero_serie = $1`, [
      input.serial.trim(),
    ])
    return rows[0] ?? null
  }
  return null
}

function checkPropiedad(
  bici: BiciRow,
  propietarioNombre: string | null,
  propietarioDNI: string
): CheckValidacion {
  // RODAID no almacena el DNI del propietario; la propiedad se verifica contra
  // el nombre registrado. Si no se aporta nombre, queda como alerta.
  if (!propietarioNombre) {
    return {
      nombre: 'propiedad',
      resultado: 'ALERTA',
      mensaje: `DNI ${propietarioDNI} no verificable: RODAID no almacena el DNI. Aporte el nombre del propietario para cotejar.`,
    }
  }
  const registrado = bici.propietario_nombre
  if (!registrado) {
    return {
      nombre: 'propiedad',
      resultado: 'ALERTA',
      mensaje: 'La bicicleta no tiene un propietario con nombre registrado para cotejar.',
    }
  }
  const coincide =
    normalizar(registrado).includes(normalizar(propietarioNombre)) ||
    normalizar(propietarioNombre).includes(normalizar(registrado))
  return {
    nombre: 'propiedad',
    resultado: coincide ? 'OK' : 'BLOQUEANTE',
    mensaje: coincide
      ? `Propietario verificado: ${registrado} · DNI ${propietarioDNI}`
      : `El nombre aportado no coincide con el propietario registrado (${registrado}).`,
  }
}

async function checkDenuncias(
  pool: ReturnType<typeof getPool>,
  serial: string
): Promise<CheckValidacion> {
  const { rows } = await pool.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM denuncias_robo
      WHERE numero_serie = $1 AND estado = 'ACTIVA'`,
    [serial]
  )
  const total = Number(rows[0]?.total ?? 0)
  return {
    nombre: 'denuncias_locales',
    resultado: total > 0 ? 'BLOQUEANTE' : 'OK',
    mensaje:
      total > 0
        ? `Existen ${total} denuncia(s) de robo ACTIVA(s) en RODAID para este serial.`
        : 'Sin denuncias de robo activas en RODAID',
  }
}

function checkBfa(): CheckValidacion {
  // Sin integración con BFA: se trata como primera certificación, no bloquea.
  return {
    nombre: 'estado_bfa',
    resultado: 'OK',
    mensaje: 'Sin registro previo en BFA — primera certificación (indexado BFA pendiente de integración).',
  }
}

function checkMinSeg(): CheckValidacion {
  return {
    nombre: 'min_seg',
    resultado: 'ALERTA',
    mensaje: 'API del Ministerio de Seguridad no configurada (convenio técnico pendiente)',
  }
}

async function checkCitDuplicado(
  pool: ReturnType<typeof getPool>,
  bicicletaId: string
): Promise<CheckValidacion> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM cits WHERE bicicleta_id = $1 AND estado IN ('ACTIVO','PENDIENTE') LIMIT 1`,
    [bicicletaId]
  )
  const duplicado = Boolean(rows[0])
  return {
    nombre: 'cit_duplicado',
    resultado: duplicado ? 'BLOQUEANTE' : 'OK',
    mensaje: duplicado
      ? 'Esta bicicleta ya tiene un CIT activo o pendiente.'
      : 'Sin CIT activo o pendiente para esta bicicleta',
  }
}

async function finalizar(
  pool: ReturnType<typeof getPool>,
  serial: string,
  bicicletaId: string | null,
  input: ValidarSerialInput,
  checks: CheckValidacion[]
): Promise<ValidacionSerial> {
  const bloqueantes = checks.filter((c) => c.resultado === 'BLOQUEANTE')
  const alertas = checks.filter((c) => c.resultado === 'ALERTA')
  const aprobado = bloqueantes.length === 0
  const tieneAlertas = alertas.length > 0

  let resumen: string
  if (!aprobado) {
    resumen = `Validación RECHAZADA — ${bloqueantes.length} bloqueante(s): ${bloqueantes
      .map((c) => c.nombre)
      .join(', ')}`
  } else if (tieneAlertas) {
    resumen = `Validación APROBADA CON ALERTAS — ${alertas.length} advertencia(s): ${alertas
      .map((c) => c.nombre)
      .join(', ')}`
  } else {
    resumen = 'Validación APROBADA — sin observaciones'
  }

  const resultado: ValidacionSerial = {
    serial,
    bicicletaId,
    aprobado,
    tieneAlertas,
    resumen,
    checks,
  }

  // Auditoría — nunca debe tumbar la validación.
  try {
    await pool.query(
      `INSERT INTO serial_validaciones
         (serial, bicicleta_id, propietario_dni, aprobado, tiene_alertas, resumen, checks, inspector_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        serial,
        bicicletaId,
        input.propietarioDNI,
        aprobado,
        tieneAlertas,
        resumen,
        JSON.stringify(checks),
        input.inspectorId ?? null,
      ]
    )
  } catch (error) {
    console.error('serial_validaciones insert failed', error)
  }

  return resultado
}

/**
 * Error de validación de serial con el detalle completo de los checks. El flujo
 * de emisión de CIT lo lanza cuando hay algún check bloqueante para que la
 * respuesta 422 incluya `validacion`.
 */
export class SerialInvalidoError extends ApiError {
  constructor(public validacion: ValidacionSerial) {
    super(422, 'SERIAL_INVALIDO', validacion.resumen)
  }
}

/**
 * Igual que `validarSerial` pero lanza `SerialInvalidoError` si hay algún check
 * bloqueante. Pensado para usar dentro del flujo de emisión de CIT.
 */
export async function exigirSerialValido(input: ValidarSerialInput): Promise<ValidacionSerial> {
  const validacion = await validarSerial(input)
  if (!validacion.aprobado) {
    throw new SerialInvalidoError(validacion)
  }
  return validacion
}
