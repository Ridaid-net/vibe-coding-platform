import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { getPool, ApiError, type DbClient } from '@/lib/marketplace'
import {
  cifrarIot,
  descifrarIot,
  iotCifradoConfigurado,
} from '@/src/services/cifrado.service'
import {
  clipCoordenada,
  zonaDeCelda,
} from '@/src/services/analytics.service'
import { normalizarSerie } from '@/src/services/ministerio.service'
import { emitirEvento } from '@/src/services/notification.service'

/**
 * RODAID — Hito 17: RODAID-IoT. Puente entre el hardware (GPS / acelerometro) y
 * el software. Concentra:
 *
 *   - VINCULO del dispositivo a una bici (y por ella, al CIT del usuario). Cada
 *     trama se valida contra el serial del cuadro congelado al vincular.
 *   - INGESTA de telemetria (endpoint HTTP optimizado, apto para alta
 *     concurrencia; un broker MQTT externo puede puentear sus tramas a este
 *     endpoint sin cambios). Cifra la posicion PRECISA de extremo a extremo,
 *     hace upsert del estado vivo (`telemetria_activa`) e inserta la traza
 *     historica con el geo RECORTADO a barrio.
 *   - GEOVALLAS: si la bici sale de una zona segura activa sin autorizacion,
 *     dispara una alerta push (Hito 10).
 *   - MODO BAJO CONSUMO: el backend devuelve al dispositivo la cadencia de
 *     reporte sugerida para que la bateria dure >= 6 meses.
 *   - PRIVACIDAD: el usuario es el UNICO que activa la transmision en tiempo real;
 *     la posicion precisa se cifra E2E y los datos historicos se anonimizan a los
 *     30 dias (`anonimizarHistorico`), igual que el mapa de calor.
 */

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface DispositivoRow {
  id: string
  bicicleta_id: string
  usuario_id: string
  serial_normalizado: string
  device_uid: string
  device_secret_hash: string
  nombre: string | null
  estado: 'activo' | 'revocado'
  transmision_activa: boolean
  modo_bajo_consumo: boolean
  intervalo_reporte_seg: number
  nivel_bateria: number | null
  ultima_trama_en: string | null
  created_at: string
  updated_at: string
}

export interface DispositivoPublico {
  id: string
  bicicletaId: string
  serial: string
  deviceUid: string
  nombre: string | null
  estado: 'activo' | 'revocado'
  transmisionActiva: boolean
  modoBajoConsumo: boolean
  intervaloReporteSeg: number
  nivelBateria: number | null
  ultimaTramaEn: string | null
  conectado: boolean
  bici: { marca: string | null; modelo: string | null; numeroSerie: string }
  creadoEn: string
}

/** Un dispositivo se considera "conectado" si reporto dentro de esta ventana. */
function ventanaConectadoMs(): number {
  const v = Number(process.env.RODAID_IOT_ONLINE_VENTANA_MIN)
  const min = Number.isFinite(v) && v > 0 ? v : 60
  return min * 60_000
}

function toDispositivoPublico(
  d: DispositivoRow & {
    marca?: string | null
    modelo?: string | null
    numero_serie?: string | null
  }
): DispositivoPublico {
  const conectado =
    d.ultima_trama_en != null &&
    Date.now() - new Date(d.ultima_trama_en).getTime() < ventanaConectadoMs()
  return {
    id: d.id,
    bicicletaId: d.bicicleta_id,
    serial: d.serial_normalizado,
    deviceUid: d.device_uid,
    nombre: d.nombre,
    estado: d.estado,
    transmisionActiva: d.transmision_activa,
    modoBajoConsumo: d.modo_bajo_consumo,
    intervaloReporteSeg: d.intervalo_reporte_seg,
    nivelBateria: d.nivel_bateria,
    ultimaTramaEn: d.ultima_trama_en,
    conectado: d.transmision_activa && conectado,
    bici: {
      marca: d.marca ?? null,
      modelo: d.modelo ?? null,
      numeroSerie: d.numero_serie ?? d.serial_normalizado,
    },
    creadoEn: d.created_at,
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

// ── Vinculacion del dispositivo a una bici (CIT del usuario) ──────────────────

export interface VinculoResultado {
  dispositivo: DispositivoPublico
  /** Secreto del dispositivo en CLARO. Se muestra UNA sola vez. */
  deviceUid: string
  deviceSecret: string
}

/**
 * Vincula un dispositivo de telemetria a una bici del usuario. Valida que la bici
 * le pertenezca; congela el serial del cuadro (la trama se validara contra el).
 * Devuelve las credenciales del dispositivo (device_uid + secret) UNA sola vez;
 * en la base solo queda el hash del secreto.
 */
export async function vincularDispositivo(
  userId: string,
  input: { bicicletaId?: unknown; nombre?: unknown; modoBajoConsumo?: unknown }
): Promise<VinculoResultado> {
  const bicicletaId =
    typeof input.bicicletaId === 'string' ? input.bicicletaId.trim() : ''
  if (!bicicletaId) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Indicá la bicicleta a vincular.')
  }

  const pool = getPool()
  const bici = await pool.query<{ numero_serie: string }>(
    `SELECT numero_serie FROM bicicletas WHERE id = $1 AND propietario_id = $2`,
    [bicicletaId, userId]
  )
  if (bici.rowCount === 0) {
    throw new ApiError(404, 'BICI_NOT_FOUND', 'No encontramos esa bici en tu garaje.')
  }
  const serial = normalizarSerie(bici.rows[0].numero_serie)

  const deviceUid = `dev_${randomBytes(9).toString('base64url')}`
  const deviceSecret = `iotsk_${randomBytes(24).toString('base64url')}`
  const nombre =
    typeof input.nombre === 'string' && input.nombre.trim()
      ? input.nombre.trim().slice(0, 120)
      : 'Sensor de telemetría'
  const bajoConsumo = input.modoBajoConsumo !== false

  const res = await pool.query<DispositivoRow>(
    `
      INSERT INTO iot_dispositivos
        (bicicleta_id, usuario_id, serial_normalizado, device_uid,
         device_secret_hash, nombre, modo_bajo_consumo, intervalo_reporte_seg)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `,
    [
      bicicletaId,
      userId,
      serial,
      deviceUid,
      sha256(deviceSecret),
      nombre,
      bajoConsumo,
      intervaloPorModo(bajoConsumo),
    ]
  )

  const dispositivo = toDispositivoPublico({
    ...res.rows[0],
    numero_serie: bici.rows[0].numero_serie,
  })
  return { dispositivo, deviceUid, deviceSecret }
}

/** Cadencia de reporte por defecto segun el modo (bajo consumo = mas espaciado). */
function intervaloPorModo(bajoConsumo: boolean): number {
  return bajoConsumo ? 900 : 60
}

// ── Listado / gestion de dispositivos del usuario ─────────────────────────────

export async function listarDispositivos(
  userId: string
): Promise<DispositivoPublico[]> {
  const res = await getPool().query<
    DispositivoRow & { marca: string | null; modelo: string | null; numero_serie: string }
  >(
    `
      SELECT d.*, b.marca, b.modelo, b.numero_serie
      FROM iot_dispositivos d
      JOIN bicicletas b ON b.id = d.bicicleta_id
      WHERE d.usuario_id = $1 AND d.estado <> 'revocado'
      ORDER BY d.created_at DESC
    `,
    [userId]
  )
  return res.rows.map(toDispositivoPublico)
}

/**
 * Actualiza un dispositivo del usuario. SOLO el dueño puede tocar estos campos.
 * Activar la transmision en tiempo real es un opt-in EXPRESO del usuario.
 */
export async function actualizarDispositivo(
  userId: string,
  dispositivoId: string,
  cambios: {
    transmisionActiva?: unknown
    modoBajoConsumo?: unknown
    nombre?: unknown
    revocar?: unknown
  }
): Promise<DispositivoPublico> {
  const pool = getPool()
  const sets: string[] = []
  const valores: unknown[] = []
  let i = 1

  if (cambios.revocar === true) {
    sets.push(`estado = 'revocado'`, `transmision_activa = FALSE`)
  }
  if (typeof cambios.transmisionActiva === 'boolean') {
    sets.push(`transmision_activa = $${i++}`)
    valores.push(cambios.transmisionActiva)
  }
  if (typeof cambios.modoBajoConsumo === 'boolean') {
    sets.push(`modo_bajo_consumo = $${i++}`)
    valores.push(cambios.modoBajoConsumo)
    sets.push(`intervalo_reporte_seg = $${i++}`)
    valores.push(intervaloPorModo(cambios.modoBajoConsumo))
  }
  if (typeof cambios.nombre === 'string' && cambios.nombre.trim()) {
    sets.push(`nombre = $${i++}`)
    valores.push(cambios.nombre.trim().slice(0, 120))
  }
  if (sets.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'No hay cambios para aplicar.')
  }

  valores.push(dispositivoId, userId)
  const res = await pool.query<DispositivoRow>(
    `
      UPDATE iot_dispositivos
      SET ${sets.join(', ')}
      WHERE id = $${i++} AND usuario_id = $${i}
      RETURNING *
    `,
    valores
  )
  if (res.rowCount === 0) {
    throw new ApiError(404, 'DEVICE_NOT_FOUND', 'No encontramos ese dispositivo.')
  }

  // Si se apago la transmision, dejamos de exponer el estado vivo.
  if (
    cambios.transmisionActiva === false ||
    cambios.revocar === true
  ) {
    await pool
      .query(`DELETE FROM telemetria_activa WHERE dispositivo_id = $1`, [dispositivoId])
      .catch(() => undefined)
  }

  const bici = await pool.query<{ marca: string | null; modelo: string | null; numero_serie: string }>(
    `SELECT marca, modelo, numero_serie FROM bicicletas WHERE id = $1`,
    [res.rows[0].bicicleta_id]
  )
  return toDispositivoPublico({ ...res.rows[0], ...(bici.rows[0] ?? {}) })
}

// ── Autenticacion del dispositivo (ingesta) ───────────────────────────────────

/**
 * Autentica una trama: localiza el dispositivo por `device_uid` (una sola lectura
 * indexada — apta para alta concurrencia) y verifica el secreto en tiempo
 * constante. Rechaza dispositivos revocados.
 */
export async function autenticarDispositivo(
  deviceUid: string,
  deviceSecret: string
): Promise<DispositivoRow> {
  if (!deviceUid || !deviceSecret) {
    throw new ApiError(401, 'DEVICE_AUTH', 'Credenciales del dispositivo requeridas.')
  }
  const res = await getPool().query<DispositivoRow>(
    `SELECT * FROM iot_dispositivos WHERE device_uid = $1`,
    [deviceUid]
  )
  const d = res.rows[0]
  if (!d || d.estado === 'revocado') {
    throw new ApiError(401, 'DEVICE_AUTH', 'Dispositivo no autorizado.')
  }
  const provisto = Buffer.from(sha256(deviceSecret))
  const esperado = Buffer.from(d.device_secret_hash)
  if (provisto.length !== esperado.length || !timingSafeEqual(provisto, esperado)) {
    throw new ApiError(401, 'DEVICE_AUTH', 'Secreto del dispositivo inválido.')
  }
  return d
}

// ── Ingesta de telemetria ─────────────────────────────────────────────────────

export interface TramaTelemetria {
  /** Serial del cuadro declarado por el dispositivo (se valida contra el vinculo). */
  serial?: string | null
  lat?: number | null
  lng?: number | null
  /** Precision del fix GPS en metros (opcional). */
  precision?: number | null
  nivelBateria?: number | null
  velocidadKmh?: number | null
  acelerometro?: Record<string, unknown> | null
  /** Marca temporal del dispositivo (ISO). Si falta, se usa la de recepcion. */
  ts?: string | null
}

export interface IngestaResultado {
  aceptada: boolean
  alertas: number
  /** Directiva de bajo consumo que el dispositivo debe respetar. */
  directiva: {
    intervaloReporteSeg: number
    modoBajoConsumo: boolean
    /** Si la bateria esta critica, se sugiere espaciar aun mas el reporte. */
    bateriaBaja: boolean
  }
}

function clampBateria(v: unknown): number | null {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(100, Math.round(n)))
}

function coordValida(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const la = Number(lat)
  const ln = Number(lng)
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null
  return { lat: la, lng: ln }
}

/** Umbral de bateria (%) por debajo del cual se prioriza el ahorro de energia. */
function bateriaBajaUmbral(): number {
  const v = Number(process.env.RODAID_IOT_BATERIA_BAJA_PCT)
  return Number.isFinite(v) && v > 0 ? v : 15
}

/**
 * Procesa una trama de telemetria de un dispositivo ya autenticado:
 *   1. Valida que el serial declarado coincida con el del vinculo (el dispositivo
 *      esta atado al CIT del usuario).
 *   2. Exige que el usuario haya ACTIVADO la transmision (opt-in) para guardar
 *      posicion; si no, solo se acusa recibo y se devuelve la directiva.
 *   3. Cifra la posicion PRECISA (E2E), hace upsert del estado vivo y registra la
 *      traza historica con el geo recortado a barrio.
 *   4. Evalua las geovallas y dispara alertas push si la bici salio de una zona
 *      segura sin autorizacion.
 *   5. Devuelve la directiva de bajo consumo (cadencia de reporte).
 */
export async function ingestarTelemetria(
  device: DispositivoRow,
  trama: TramaTelemetria
): Promise<IngestaResultado> {
  // 1) Validacion del serial contra el vinculo (atado al CIT del usuario).
  if (trama.serial != null && trama.serial !== '') {
    if (normalizarSerie(trama.serial) !== device.serial_normalizado) {
      throw new ApiError(
        409,
        'SERIAL_MISMATCH',
        'El serial de la trama no coincide con el del dispositivo.'
      )
    }
  }

  const pool = getPool()
  const bateria = clampBateria(trama.nivelBateria)
  const ts = parseTs(trama.ts)
  const acelerometro =
    trama.acelerometro && typeof trama.acelerometro === 'object'
      ? trama.acelerometro
      : {}
  const velocidad = Number.isFinite(Number(trama.velocidadKmh))
    ? Number(trama.velocidadKmh)
    : null

  // Siempre actualizamos la salud del dispositivo (bateria / ultima trama),
  // incluso si la transmision de posicion no esta activa.
  await pool.query(
    `UPDATE iot_dispositivos
       SET nivel_bateria = COALESCE($2, nivel_bateria), ultima_trama_en = $3
     WHERE id = $1`,
    [device.id, bateria, ts]
  )

  const bateriaBaja = bateria != null && bateria <= bateriaBajaUmbral()
  const directiva = {
    intervaloReporteSeg: bateriaBaja
      ? device.intervalo_reporte_seg * 2
      : device.intervalo_reporte_seg,
    modoBajoConsumo: device.modo_bajo_consumo,
    bateriaBaja,
  }

  // 2) Opt-in: sin transmision activa, no se guarda posicion.
  if (!device.transmision_activa) {
    return { aceptada: true, alertas: 0, directiva }
  }

  const coord = coordValida(trama.lat, trama.lng)
  if (!coord) {
    // Trama de estado sin posicion: aceptada, pero sin geolocalizar.
    return { aceptada: true, alertas: 0, directiva }
  }

  // 3) Cifrado E2E de la posicion precisa + geo recortado a barrio.
  const posicionCifrada = cifrarIot(
    JSON.stringify({ lat: coord.lat, lng: coord.lng, acc: trama.precision ?? null })
  )
  const clip = clipCoordenada(coord.lat, coord.lng)
  const zona = zonaDeCelda(clip.celda)

  await pool.query(
    `
      INSERT INTO telemetria_activa
        (dispositivo_id, bicicleta_id, usuario_id, serial, posicion_cifrada,
         geo_celda, geo_lat, geo_lon, geo_zona, geo_ciudad,
         nivel_bateria, velocidad_kmh, acelerometro_data, ts, actualizado_en)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, NOW())
      ON CONFLICT (dispositivo_id) DO UPDATE SET
        posicion_cifrada = EXCLUDED.posicion_cifrada,
        geo_celda = EXCLUDED.geo_celda,
        geo_lat = EXCLUDED.geo_lat,
        geo_lon = EXCLUDED.geo_lon,
        geo_zona = EXCLUDED.geo_zona,
        geo_ciudad = EXCLUDED.geo_ciudad,
        nivel_bateria = EXCLUDED.nivel_bateria,
        velocidad_kmh = EXCLUDED.velocidad_kmh,
        acelerometro_data = EXCLUDED.acelerometro_data,
        ts = EXCLUDED.ts,
        actualizado_en = NOW()
    `,
    [
      device.id,
      device.bicicleta_id,
      device.usuario_id,
      device.serial_normalizado,
      posicionCifrada,
      clip.celda,
      clip.lat,
      clip.lon,
      zona,
      'Mendoza',
      bateria,
      velocidad,
      JSON.stringify(acelerometro),
      ts,
    ]
  )

  await pool.query(
    `
      INSERT INTO telemetria_historica
        (dispositivo_id, bicicleta_id, usuario_id, posicion_cifrada,
         geo_celda, geo_lat, geo_lon, geo_zona, geo_ciudad,
         nivel_bateria, velocidad_kmh, acelerometro_data, ts)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
    `,
    [
      device.id,
      device.bicicleta_id,
      device.usuario_id,
      posicionCifrada,
      clip.celda,
      clip.lat,
      clip.lon,
      zona,
      'Mendoza',
      bateria,
      velocidad,
      JSON.stringify(acelerometro),
      ts,
    ]
  )

  // 4) Geovallas: alertar si salio de una zona segura sin autorizacion.
  const alertas = await evaluarGeovallas(device, coord, clip.celda)

  // Bateria critica: avisar al dueño (dedupe diario).
  if (bateriaBaja) {
    await crearAlerta({
      dispositivoId: device.id,
      bicicletaId: device.bicicleta_id,
      usuarioId: device.usuario_id,
      tipo: 'bateria_baja',
      severidad: 'media',
      titulo: 'Batería del sensor baja',
      mensaje: `El sensor de tu bici está al ${bateria}%. Cargalo para no perder el seguimiento.`,
      dedupeKey: `bateria:${device.id}`,
      ventanaHoras: 24,
      notificar: true,
    }).catch(() => undefined)
  }

  return { aceptada: true, alertas, directiva }
}

function parseTs(value: string | null | undefined): string {
  if (typeof value === 'string') {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) {
      // No aceptar marcas absurdamente futuras: cap a "ahora".
      return d.getTime() > Date.now() ? new Date().toISOString() : d.toISOString()
    }
  }
  return new Date().toISOString()
}

// ── Geovallas ──────────────────────────────────────────────────────────────

interface GeovallaRow {
  id: string
  bicicleta_id: string
  usuario_id: string
  nombre: string
  center_lat: string
  center_lng: string
  radio_m: number
  activa: boolean
  autorizada_salida: boolean
  created_at: string
  updated_at: string
}

export interface GeovallaPublica {
  id: string
  bicicletaId: string
  nombre: string
  centerLat: number
  centerLng: number
  radioM: number
  activa: boolean
  autorizadaSalida: boolean
  creadoEn: string
}

function toGeovallaPublica(r: GeovallaRow): GeovallaPublica {
  return {
    id: r.id,
    bicicletaId: r.bicicleta_id,
    nombre: r.nombre,
    centerLat: Number(r.center_lat),
    centerLng: Number(r.center_lng),
    radioM: r.radio_m,
    activa: r.activa,
    autorizadaSalida: r.autorizada_salida,
    creadoEn: r.created_at,
  }
}

/** Distancia en metros entre dos coordenadas (haversine). */
function distanciaMetros(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Evalua la posicion contra las geovallas ACTIVAS de la bici. Por cada zona de la
 * que la bici esta FUERA y que NO tiene autorizacion de salida, dispara una alerta
 * de salida (con dedupe). Devuelve cuantas alertas se crearon.
 */
async function evaluarGeovallas(
  device: DispositivoRow,
  coord: { lat: number; lng: number },
  celda: string
): Promise<number> {
  const res = await getPool().query<GeovallaRow>(
    `SELECT * FROM iot_geovallas
     WHERE bicicleta_id = $1 AND activa = TRUE AND autorizada_salida = FALSE`,
    [device.bicicleta_id]
  )
  let creadas = 0
  for (const g of res.rows) {
    const dist = distanciaMetros(
      coord.lat,
      coord.lng,
      Number(g.center_lat),
      Number(g.center_lng)
    )
    if (dist > g.radio_m) {
      const creada = await crearAlerta({
        dispositivoId: device.id,
        bicicletaId: device.bicicleta_id,
        usuarioId: device.usuario_id,
        tipo: 'geovalla_salida',
        severidad: 'alta',
        titulo: 'Tu bici salió de la zona segura',
        mensaje: `La bici salió de "${g.nombre}" (a ~${Math.round(dist)} m del centro). Revisá su ubicación en tiempo real.`,
        dedupeKey: `geovalla:${g.id}:${celda}`,
        ventanaHoras: 6,
        notificar: true,
        evento: 'iot.geovalla_salida',
        eventoData: { zonaSegura: g.nombre },
        metadata: { geovallaId: g.id, distanciaM: Math.round(dist) },
      })
      if (creada) creadas += 1
    }
  }
  return creadas
}

export async function listarGeovallas(
  userId: string,
  bicicletaId?: string
): Promise<GeovallaPublica[]> {
  const params: unknown[] = [userId]
  let where = `usuario_id = $1`
  if (bicicletaId) {
    params.push(bicicletaId)
    where += ` AND bicicleta_id = $2`
  }
  const res = await getPool().query<GeovallaRow>(
    `SELECT * FROM iot_geovallas WHERE ${where} ORDER BY created_at DESC`,
    params
  )
  return res.rows.map(toGeovallaPublica)
}

export async function crearGeovalla(
  userId: string,
  input: {
    bicicletaId?: unknown
    nombre?: unknown
    centerLat?: unknown
    centerLng?: unknown
    radioM?: unknown
  }
): Promise<GeovallaPublica> {
  const bicicletaId =
    typeof input.bicicletaId === 'string' ? input.bicicletaId.trim() : ''
  const coord = coordValida(input.centerLat, input.centerLng)
  const radio = Number(input.radioM)
  if (!bicicletaId) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Indicá la bicicleta de la geovalla.')
  }
  if (!coord) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'El centro de la zona segura no es válido.')
  }
  if (!Number.isFinite(radio) || radio < 25 || radio > 100_000) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'El radio debe estar entre 25 m y 100 km.')
  }

  const pool = getPool()
  const bici = await pool.query(
    `SELECT 1 FROM bicicletas WHERE id = $1 AND propietario_id = $2`,
    [bicicletaId, userId]
  )
  if (bici.rowCount === 0) {
    throw new ApiError(404, 'BICI_NOT_FOUND', 'No encontramos esa bici en tu garaje.')
  }
  const nombre =
    typeof input.nombre === 'string' && input.nombre.trim()
      ? input.nombre.trim().slice(0, 120)
      : 'Zona segura'

  const res = await pool.query<GeovallaRow>(
    `
      INSERT INTO iot_geovallas
        (bicicleta_id, usuario_id, nombre, center_lat, center_lng, radio_m)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `,
    [bicicletaId, userId, nombre, coord.lat, coord.lng, Math.round(radio)]
  )
  return toGeovallaPublica(res.rows[0])
}

export async function actualizarGeovalla(
  userId: string,
  geovallaId: string,
  cambios: { activa?: unknown; autorizadaSalida?: unknown; nombre?: unknown }
): Promise<GeovallaPublica> {
  const sets: string[] = []
  const valores: unknown[] = []
  let i = 1
  if (typeof cambios.activa === 'boolean') {
    sets.push(`activa = $${i++}`)
    valores.push(cambios.activa)
  }
  if (typeof cambios.autorizadaSalida === 'boolean') {
    sets.push(`autorizada_salida = $${i++}`)
    valores.push(cambios.autorizadaSalida)
  }
  if (typeof cambios.nombre === 'string' && cambios.nombre.trim()) {
    sets.push(`nombre = $${i++}`)
    valores.push(cambios.nombre.trim().slice(0, 120))
  }
  if (sets.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'No hay cambios para aplicar.')
  }
  valores.push(geovallaId, userId)
  const res = await getPool().query<GeovallaRow>(
    `UPDATE iot_geovallas SET ${sets.join(', ')}
     WHERE id = $${i++} AND usuario_id = $${i} RETURNING *`,
    valores
  )
  if (res.rowCount === 0) {
    throw new ApiError(404, 'GEOVALLA_NOT_FOUND', 'No encontramos esa geovalla.')
  }
  return toGeovallaPublica(res.rows[0])
}

export async function eliminarGeovalla(
  userId: string,
  geovallaId: string
): Promise<void> {
  const res = await getPool().query(
    `DELETE FROM iot_geovallas WHERE id = $1 AND usuario_id = $2`,
    [geovallaId, userId]
  )
  if (res.rowCount === 0) {
    throw new ApiError(404, 'GEOVALLA_NOT_FOUND', 'No encontramos esa geovalla.')
  }
}

// ── Alertas (dedupe + push) ───────────────────────────────────────────────────

export interface CrearAlertaInput {
  dispositivoId: string | null
  bicicletaId: string
  usuarioId: string
  tipo: string
  severidad: 'baja' | 'media' | 'alta' | 'critica'
  titulo: string
  mensaje: string
  dedupeKey?: string | null
  ventanaHoras?: number
  notificar?: boolean
  evento?: 'iot.geovalla_salida' | 'iot.mantenimiento' | 'iot.robo_en_curso'
  eventoData?: Record<string, unknown>
  metadata?: Record<string, unknown>
  client?: DbClient
}

/**
 * Crea una alerta con DEDUPE: si ya existe una alerta equivalente (mismo
 * `dedupeKey`) dentro de la ventana, no se vuelve a crear (devuelve false) para no
 * spamear al usuario. Si se crea y `notificar` es true, dispara el push (Hito 10).
 */
export async function crearAlerta(input: CrearAlertaInput): Promise<boolean> {
  const db = input.client ?? getPool()
  const ventana = input.ventanaHoras ?? 6

  if (input.dedupeKey) {
    const existe = await db.query(
      `SELECT 1 FROM iot_alertas
       WHERE dedupe_key = $1 AND created_at >= NOW() - ($2 || ' hours')::interval
       LIMIT 1`,
      [input.dedupeKey, String(ventana)]
    )
    if ((existe.rowCount ?? 0) > 0) return false
  }

  await db.query(
    `
      INSERT INTO iot_alertas
        (dispositivo_id, bicicleta_id, usuario_id, tipo, severidad, titulo,
         mensaje, dedupe_key, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
    `,
    [
      input.dispositivoId,
      input.bicicletaId,
      input.usuarioId,
      input.tipo,
      input.severidad,
      input.titulo.slice(0, 160),
      input.mensaje.slice(0, 500),
      input.dedupeKey ?? null,
      JSON.stringify(input.metadata ?? {}),
    ]
  )

  if (input.notificar && input.evento) {
    // Best-effort, desacoplado: nunca frena la ingesta.
    void emitirEvento({
      tipo: input.evento,
      usuarioId: input.usuarioId,
      data: { ...(input.eventoData ?? {}), resumen: input.mensaje },
    }).catch(() => undefined)
  }
  return true
}

interface AlertaRow {
  id: string
  dispositivo_id: string | null
  bicicleta_id: string
  tipo: string
  severidad: string
  titulo: string
  mensaje: string
  metadata: Record<string, unknown>
  reconocida: boolean
  created_at: string
}

export interface AlertaPublica {
  id: string
  bicicletaId: string
  tipo: string
  severidad: string
  titulo: string
  mensaje: string
  metadata: Record<string, unknown>
  reconocida: boolean
  creadoEn: string
}

export async function listarAlertas(
  userId: string,
  limite = 50
): Promise<AlertaPublica[]> {
  const res = await getPool().query<AlertaRow>(
    `SELECT * FROM iot_alertas WHERE usuario_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [userId, Math.min(Math.max(1, limite), 200)]
  )
  return res.rows.map((r: AlertaRow) => ({
    id: r.id,
    bicicletaId: r.bicicleta_id,
    tipo: r.tipo,
    severidad: r.severidad,
    titulo: r.titulo,
    mensaje: r.mensaje,
    metadata: r.metadata ?? {},
    reconocida: r.reconocida,
    creadoEn: r.created_at,
  }))
}

export async function reconocerAlerta(
  userId: string,
  alertaId: string
): Promise<void> {
  const res = await getPool().query(
    `UPDATE iot_alertas SET reconocida = TRUE WHERE id = $1 AND usuario_id = $2`,
    [alertaId, userId]
  )
  if (res.rowCount === 0) {
    throw new ApiError(404, 'ALERTA_NOT_FOUND', 'No encontramos esa alerta.')
  }
}

// ── Estado vivo (solo propietario, solo si el sensor esta activo) ─────────────

export interface UbicacionTiempoReal {
  dispositivoId: string
  bicicletaId: string
  serial: string
  transmisionActiva: boolean
  conectado: boolean
  /** Posicion PRECISA descifrada — solo para el propietario. null si no hay fix. */
  posicion: { lat: number; lng: number; precision: number | null } | null
  nivelBateria: number | null
  velocidadKmh: number | null
  acelerometro: Record<string, unknown>
  ts: string | null
}

interface TelemetriaActivaRow {
  dispositivo_id: string
  bicicleta_id: string
  serial: string
  posicion_cifrada: string | null
  nivel_bateria: number | null
  velocidad_kmh: string | null
  acelerometro_data: Record<string, unknown>
  ts: string
  transmision_activa: boolean
  ultima_trama_en: string | null
}

/**
 * Devuelve la ubicacion en tiempo real de la bici del usuario. SOLO el propietario
 * (la query exige `usuario_id`) y SOLO si la transmision esta activa. Descifra la
 * posicion precisa (E2E) recien aca, para el dueño.
 */
export async function obtenerUbicacionTiempoReal(
  userId: string,
  bicicletaId: string
): Promise<UbicacionTiempoReal | null> {
  const res = await getPool().query<TelemetriaActivaRow>(
    `
      SELECT t.*, d.transmision_activa, d.ultima_trama_en
      FROM telemetria_activa t
      JOIN iot_dispositivos d ON d.id = t.dispositivo_id
      WHERE t.bicicleta_id = $1 AND t.usuario_id = $2 AND d.estado <> 'revocado'
      ORDER BY t.ts DESC
      LIMIT 1
    `,
    [bicicletaId, userId]
  )
  const row = res.rows[0]
  if (!row || !row.transmision_activa) return null

  let posicion: UbicacionTiempoReal['posicion'] = null
  if (row.posicion_cifrada) {
    try {
      const data = JSON.parse(descifrarIot(row.posicion_cifrada)) as {
        lat: number
        lng: number
        acc?: number | null
      }
      posicion = { lat: data.lat, lng: data.lng, precision: data.acc ?? null }
    } catch {
      posicion = null
    }
  }

  const conectado =
    row.ultima_trama_en != null &&
    Date.now() - new Date(row.ultima_trama_en).getTime() < ventanaConectadoMs()

  return {
    dispositivoId: row.dispositivo_id,
    bicicletaId: row.bicicleta_id,
    serial: row.serial,
    transmisionActiva: row.transmision_activa,
    conectado,
    posicion,
    nivelBateria: row.nivel_bateria,
    velocidadKmh: row.velocidad_kmh != null ? Number(row.velocidad_kmh) : null,
    acelerometro: row.acelerometro_data ?? {},
    ts: row.ts,
  }
}

// ── Robo en curso → Ministerio de Seguridad (Hito 12), con autorizacion expresa ─

export interface RoboEnCursoResultado {
  reportado: boolean
  expediente: string
  posicionCompartida: boolean
  notificado: boolean
}

/**
 * Reporta un "robo en curso" al Ministerio de Seguridad con la ubicacion en tiempo
 * real, SOLO si el usuario lo autoriza EXPRESAMENTE ante la emergencia. Asienta una
 * alerta, comparte la ultima posicion conocida con la autoridad (canal del Hito 12)
 * y notifica al dueño. La autorizacion expresa es condicion ineludible.
 */
export async function reportarRoboEnCurso(
  userId: string,
  bicicletaId: string,
  autorizo: boolean
): Promise<RoboEnCursoResultado> {
  if (autorizo !== true) {
    throw new ApiError(
      400,
      'AUTORIZACION_REQUERIDA',
      'Necesitamos tu autorización expresa para compartir tu ubicación con el Ministerio.'
    )
  }
  const pool = getPool()
  const bici = await pool.query<{ numero_serie: string }>(
    `SELECT numero_serie FROM bicicletas WHERE id = $1 AND propietario_id = $2`,
    [bicicletaId, userId]
  )
  if (bici.rowCount === 0) {
    throw new ApiError(404, 'BICI_NOT_FOUND', 'No encontramos esa bici en tu garaje.')
  }
  const serial = normalizarSerie(bici.rows[0].numero_serie)

  // Ultima posicion conocida (precisa) para compartir con la autoridad.
  const ubic = await obtenerUbicacionTiempoReal(userId, bicicletaId)
  const expediente = `ROBO-${serial.slice(0, 8) || 'SN'}-${Date.now().toString(36).toUpperCase()}`

  // Canal con el Ministerio (Hito 12): aviso de robo en curso con la posicion.
  // best-effort y asincrono respecto del flujo de negocio.
  void notificarMinisterioRoboEnCurso({
    serial,
    expediente,
    posicion: ubic?.posicion ?? null,
  }).catch((err) =>
    console.error('[iot] no se pudo notificar el robo en curso al Ministerio', err)
  )

  await crearAlerta({
    dispositivoId: ubic?.dispositivoId ?? null,
    bicicletaId,
    usuarioId: userId,
    tipo: 'robo_en_curso',
    severidad: 'critica',
    titulo: 'Reporte de robo en curso enviado',
    mensaje:
      'Compartiste la ubicación en tiempo real de tu bici con el Ministerio de Seguridad ante la emergencia.',
    dedupeKey: `robo:${bicicletaId}`,
    ventanaHoras: 1,
    notificar: true,
    evento: 'iot.robo_en_curso',
    metadata: { expediente, posicionCompartida: Boolean(ubic?.posicion) },
  })

  return {
    reportado: true,
    expediente,
    posicionCompartida: Boolean(ubic?.posicion),
    notificado: true,
  }
}

/**
 * Notifica al Ministerio de Seguridad un robo en curso con la ubicacion. En LIVE
 * usa el endpoint configurado del Ministerio; en preview/sin endpoint, deja el
 * aviso en el log (igual que el resto de los modos simulados del proyecto). La
 * ubicacion compartida es la autorizada expresamente por el dueño ante la
 * emergencia.
 */
async function notificarMinisterioRoboEnCurso(aviso: {
  serial: string
  expediente: string
  posicion: { lat: number; lng: number; precision: number | null } | null
}): Promise<void> {
  const base = process.env.RODAID_MINISTERIO_ROBO_URL
  const payload = {
    tipo: 'ROBO_EN_CURSO',
    serial: aviso.serial,
    expediente: aviso.expediente,
    ubicacion: aviso.posicion,
    reportadoEn: new Date().toISOString(),
  }
  if (!base) {
    console.info(
      `[iot] ROBO EN CURSO (simulado) — serial ${aviso.serial}, exp ${aviso.expediente}` +
        (aviso.posicion ? ` @ ${aviso.posicion.lat},${aviso.posicion.lng}` : ' (sin posición)')
    )
    return
  }
  const apiKey = process.env.RODAID_MINISTERIO_ROBO_API_KEY
  await fetch(base, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(payload),
  })
}

// ── Anonimizacion de la traza historica (>30 dias) ────────────────────────────

export interface AnonimizacionResultado {
  dias: number
  filasAnonimizadas: number
}

function diasRetencion(): number {
  const v = Number(process.env.RODAID_IOT_RETENCION_DIAS)
  return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 30
}

/**
 * Anonimiza la traza historica anterior a `dias` (por defecto 30): borra la
 * posicion PRECISA cifrada y deja solo el geo RECORTADO a barrio, exactamente como
 * el mapa de calor. Idempotente: solo toca filas aun no anonimizadas.
 */
export async function anonimizarHistorico(
  dias = diasRetencion()
): Promise<AnonimizacionResultado> {
  const res = await getPool().query(
    `
      UPDATE telemetria_historica
      SET posicion_cifrada = NULL, anonimizada = TRUE
      WHERE anonimizada = FALSE
        AND created_at < NOW() - ($1 || ' days')::interval
    `,
    [String(dias)]
  )
  return { dias, filasAnonimizadas: res.rowCount ?? 0 }
}

/** Indica si la telemetria opera con clave real (LIVE) o derivada (preview). */
export function iotCifradoEsLive(): boolean {
  return iotCifradoConfigurado()
}
