// ─── RODAID · Ministerio de Seguridad Mendoza — Integración ──
// Interoperabilidad con la base de datos policial de rodados.
// Marco legal: Ley Provincial N° 9556 · TAD EX-2026-26089745
//
// Flujo de integración (bidireccional):
//
//  CONSULTA (antes de emitir un CIT):
//    consultarSerial(serial)
//      → GET /api/v1/rodados/serial/{serial}
//      → Respuesta: { alerta, tipo, expediente, descripcion }
//
//  DENUNCIA (cuando el ciclista reporta robo en RODAID):
//    reportarDenuncia(denuncia)
//      → POST /api/v1/rodados/denuncias
//      → Recibe: expediente Min.Seg asignado
//
//  RECUPERACIÓN (cuando el ciclista marca bicicleta recuperada):
//    reportarRecuperacion(expediente)
//      → PUT /api/v1/rodados/denuncias/{expediente}/recuperado
//
//  SYNC (periódico — importar nuevas denuncias de Min.Seg):
//    sincronizarDenuncias(desde)
//      → GET /api/v1/rodados/denuncias?desde={iso}&fuente=RODAID_EXCLUDE
//      → Importa denuncias de otras fuentes (comisarías, web Min.Seg)
//
// Patrón de resiliencia: Circuit Breaker + Retry + Fallback
//   - Si Min.Seg. no responde: ALERTA (no bloquea) + registro en minseg_sync
//   - Circuit breaker: abre si >3 fallos en 60 segundos
//   - Retry automático: las denuncias no notificadas se reintentan cada 15 min

import { query, queryOne }  from '../config/database'
import { log }              from '../middleware/logger'
import { env }              from '../config/env'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export interface ConsultaResult {
  alerta:       boolean
  tipo?:        'ROBO' | 'HURTO' | 'EXTRAVIADO' | string
  expediente?:  string
  descripcion?: string
  fechaDenuncia?: string
  fuente:       'MINSEG' | 'STUB' | 'CACHE' | 'ERROR'
  stub:         boolean
}

export interface DenunciaMinSegInput {
  denunciaRodaidId:  string
  numeroCIT:         string
  serial:            string
  marca:             string
  modelo:            string
  anio:              number
  color:             string
  propietarioDNI:    string
  propietarioNombre: string
  descripcion:       string
  fechaDenuncia:     string   // ISO 8601
}

export interface DenunciaMinSegResult {
  expediente:    string | null   // expediente asignado por Min.Seg
  registrado:    boolean
  stub:          boolean
  error?:        string
}

export interface RecuperacionResult {
  actualizado: boolean
  stub:        boolean
  error?:      string
}

export interface SyncResult {
  importadas:  number
  actualizadas: number
  desde:       string
  hasta:       string
  stub:        boolean
}

// ══════════════════════════════════════════════════════════
// CIRCUIT BREAKER
// ══════════════════════════════════════════════════════════

class CircuitBreaker {
  private fallos     = 0
  private ultimoFallo: number | null = null
  private readonly maxFallos  = 3
  private readonly ventanaMs  = 60_000  // 60 segundos
  private readonly cooldownMs = 120_000 // 2 minutos antes de reintentar

  get abierto(): boolean {
    if (this.fallos < this.maxFallos) return false
    if (this.ultimoFallo && Date.now() - this.ultimoFallo > this.cooldownMs) {
      // Cooldown terminó → semi-cerrado (probar una llamada)
      this.fallos = 0
      return false
    }
    return true
  }

  registrarFallo(): void {
    const ahora = Date.now()
    if (this.ultimoFallo && ahora - this.ultimoFallo > this.ventanaMs) {
      this.fallos = 0  // ventana expiró
    }
    this.fallos++
    this.ultimoFallo = ahora
    if (this.fallos >= this.maxFallos) {
      log.minseg.warn({ fallos: this.fallos }, '⚡ Circuit breaker ABIERTO — Min.Seg temporalmente deshabilitado')
    }
  }

  registrarExito(): void {
    this.fallos = 0
  }
}

const breaker = new CircuitBreaker()

// ══════════════════════════════════════════════════════════
// HTTP CLIENT con retry
// ══════════════════════════════════════════════════════════

async function minSegFetch(
  path:    string,
  opts:    RequestInit = {},
  intento: number = 1
): Promise<Response> {
  const url = `${env.MINSEG_API_URL}${path}`
  const headers = {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${env.MINSEG_API_KEY}`,
    'X-Source':      'RODAID-v2',
    'X-Version':     '2.0.0',
    ...((opts.headers as Record<string, string>) ?? {}),
  }

  const res = await fetch(url, {
    ...opts,
    headers,
    signal: AbortSignal.timeout(8_000),
  })

  // Retry en 429 (rate limit) y 5xx con backoff
  if ((res.status === 429 || res.status >= 500) && intento < 3) {
    const delay = Math.pow(2, intento) * 1_000
    await new Promise(r => setTimeout(r, delay))
    return minSegFetch(path, opts, intento + 1)
  }

  return res
}

// ── Log de auditoría en DB ────────────────────────────────
async function logSync(
  tipo:           string,
  serie:          string | null,
  request:        object | null,
  response:       object | null,
  httpStatus:     number | null,
  resultado:      string,
  errorMensaje?:  string
): Promise<void> {
  await query(
    `INSERT INTO minseg_sync
       (tipo, numero_serie, request_payload, response_payload, http_status, resultado, error_mensaje)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tipo, serie, request ? JSON.stringify(request) : null,
     response ? JSON.stringify(response) : null,
     httpStatus, resultado, errorMensaje ?? null]
  ).catch(() => {})
}

// ══════════════════════════════════════════════════════════
// 1. CONSULTA DE SERIAL
// ══════════════════════════════════════════════════════════

export async function consultarSerial(serial: string): Promise<ConsultaResult> {
  // Sin credenciales → stub
  if (!env.MINSEG_API_URL || !env.MINSEG_API_KEY) {
    return {
      alerta: false, fuente: 'STUB', stub: true,
    }
  }

  // Circuit breaker abierto → fallback sin bloquear
  if (breaker.abierto) {
    log.minseg.warn({ serial }, '⚡ Circuit breaker abierto — consulta MinSeg omitida')
    await logSync('CONSULTA', serial, null, null, null, 'ERROR', 'circuit_breaker_open')
    return { alerta: false, fuente: 'ERROR', stub: false,
             descripcion: 'Ministerio de Seguridad temporalmente no disponible' }
  }

  try {
    const res = await minSegFetch(`/api/v1/rodados/serial/${encodeURIComponent(serial)}`)
    const body = await res.json() as {
      alerta?: boolean; tipo?: string; expediente?: string
      descripcion?: string; fecha_denuncia?: string
    }

    await logSync('CONSULTA', serial, { serial }, body, res.status,
      res.ok ? (body.alerta ? 'ALERTA' : 'OK') : 'ERROR')

    if (!res.ok) {
      if (res.status === 404) {
        // 404 = no encontrado = sin alertas
        breaker.registrarExito()
        return { alerta: false, fuente: 'MINSEG', stub: false }
      }
      throw new Error(`HTTP ${res.status}`)
    }

    breaker.registrarExito()

    return {
      alerta:        !!body.alerta,
      tipo:          body.tipo,
      expediente:    body.expediente,
      descripcion:   body.descripcion,
      fechaDenuncia: body.fecha_denuncia,
      fuente:        'MINSEG',
      stub:          false,
    }

  } catch (err) {
    const errMsg = (err as Error).message
    breaker.registrarFallo()
    log.minseg.warn({ serial, errMsg }, '✗ MinSeg consulta falló')
    await logSync('CONSULTA', serial, { serial }, null, null, 'ERROR', errMsg)

    // Fallo de red/timeout → no bloquear el CIT, retornar ALERTA suave
    return {
      alerta:      false,
      fuente:      'ERROR',
      stub:        false,
      descripcion: `No disponible: ${errMsg.slice(0, 60)}`,
    }
  }
}

// ══════════════════════════════════════════════════════════
// 2. REPORTAR DENUNCIA
// ══════════════════════════════════════════════════════════

export async function reportarDenuncia(input: DenunciaMinSegInput): Promise<DenunciaMinSegResult> {
  if (!env.MINSEG_API_URL || !env.MINSEG_API_KEY) {
    // Stub: generar expediente simulado para desarrollo
    const expStub = `STUB-EXP-${Date.now().toString(36).toUpperCase()}`
    log.minseg.warn({ serial: input.serial, expStub }, '⚠️  MinSeg STUB — denuncia simulada')
    return { expediente: expStub, registrado: true, stub: true }
  }

  if (breaker.abierto) {
    return { expediente: null, registrado: false, stub: false,
             error: 'circuit_breaker_open — se reintentará automáticamente' }
  }

  const payload = {
    numero_serie:       input.serial,
    marca:              input.marca,
    modelo:             input.modelo,
    anio:               input.anio,
    color:              input.color,
    tipo_rodado:        'bicicleta',
    propietario_dni:    input.propietarioDNI,
    propietario_nombre: input.propietarioNombre,
    descripcion:        input.descripcion,
    fecha_denuncia:     input.fechaDenuncia,
    fuente:             'RODAID',
    fuente_id:          input.denunciaRodaidId,
    cit_numero:         input.numeroCIT,
  }

  try {
    const res = await minSegFetch('/api/v1/rodados/denuncias', {
      method: 'POST',
      body:   JSON.stringify(payload),
    })

    const body = await res.json() as { expediente?: string; id?: string; error?: string }
    const expediente = body.expediente ?? body.id ?? null

    await logSync('DENUNCIA', input.serial, payload, body, res.status,
      res.ok ? 'OK' : 'ERROR', !res.ok ? body.error : undefined)

    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)

    breaker.registrarExito()

    log.minseg.info({ serial: input.serial, expediente }, '✓ Denuncia registrada en Min.Seg.')
    return { expediente, registrado: true, stub: false }

  } catch (err) {
    const errMsg = (err as Error).message
    breaker.registrarFallo()
    log.minseg.warn({ serial: input.serial, errMsg }, '✗ MinSeg denuncia falló')
    await logSync('DENUNCIA', input.serial, payload, null, null, 'ERROR', errMsg)
    return { expediente: null, registrado: false, stub: false, error: errMsg }
  }
}

// ══════════════════════════════════════════════════════════
// 3. REPORTAR RECUPERACIÓN
// ══════════════════════════════════════════════════════════

export async function reportarRecuperacion(
  expedienteMinSeg: string,
  serial:           string,
  fechaRecuperacion: string
): Promise<RecuperacionResult> {
  if (!env.MINSEG_API_URL || !env.MINSEG_API_KEY) {
    log.minseg.warn({ expediente: expedienteMinSeg }, '⚠️  MinSeg STUB — recuperación simulada')
    return { actualizado: true, stub: true }
  }

  if (breaker.abierto) {
    return { actualizado: false, stub: false, error: 'circuit_breaker_open' }
  }

  const payload = { fecha_recuperacion: fechaRecuperacion, fuente: 'RODAID' }

  try {
    const res = await minSegFetch(
      `/api/v1/rodados/denuncias/${encodeURIComponent(expedienteMinSeg)}/recuperado`,
      { method: 'PUT', body: JSON.stringify(payload) }
    )

    const body = await res.json() as { ok?: boolean; error?: string }
    await logSync('RECUPERACION', serial, payload, body, res.status,
      res.ok ? 'OK' : 'ERROR', !res.ok ? body.error : undefined)

    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)

    breaker.registrarExito()
    log.minseg.info({ expedienteMinSeg, serial }, '✓ Recuperación notificada a Min.Seg.')
    return { actualizado: true, stub: false }

  } catch (err) {
    const errMsg = (err as Error).message
    breaker.registrarFallo()
    await logSync('RECUPERACION', serial, payload, null, null, 'ERROR', errMsg)
    return { actualizado: false, stub: false, error: errMsg }
  }
}

// ══════════════════════════════════════════════════════════
// 4. SINCRONIZACIÓN BIDIRECCIONAL
// Importa denuncias registradas en Min.Seg (comisarías, web)
// que no entran por RODAID — enriquece nuestra DB local
// ══════════════════════════════════════════════════════════

export async function sincronizarDenuncias(desde: Date): Promise<SyncResult> {
  if (!env.MINSEG_API_URL || !env.MINSEG_API_KEY) {
    log.minseg.warn('⚠️  MinSeg STUB — sync simulado')
    return { importadas: 0, actualizadas: 0,
             desde: desde.toISOString(), hasta: new Date().toISOString(), stub: true }
  }

  if (breaker.abierto) {
    return { importadas: 0, actualizadas: 0,
             desde: desde.toISOString(), hasta: new Date().toISOString(), stub: false }
  }

  try {
    const params = new URLSearchParams({
      desde:  desde.toISOString(),
      hasta:  new Date().toISOString(),
      tipo:   'bicicleta',
      fuente: 'EXCLUDE_RODAID',  // no reimportar las que ya mandamos nosotros
    })

    const res = await minSegFetch(`/api/v1/rodados/denuncias?${params}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const body = await res.json() as {
      items: Array<{
        expediente: string; numero_serie: string; tipo: string
        fecha_denuncia: string; descripcion: string
      }>
      total: number
    }

    let importadas = 0; let actualizadas = 0

    for (const item of body.items ?? []) {
      // Buscar si la bicicleta está en nuestra DB
      const bici = await queryOne<{ id: string; propietario_id: string }>(
        `SELECT id, propietario_id FROM bicicletas WHERE numero_serie=$1`, [item.numero_serie]
      )
      if (!bici) continue  // no es una bici registrada en RODAID

      // Chequear si ya tenemos esta denuncia
      const existe = await queryOne(
        `SELECT id FROM denuncias_robo
         WHERE numero_serie=$1 AND min_seg_expediente=$2`,
        [item.numero_serie, item.expediente]
      )

      if (existe) { actualizadas++; continue }

      // Insertar denuncia importada desde Min.Seg
      await query(
        `INSERT INTO denuncias_robo
           (numero_serie, citado_cit_id, denunciante_id, descripcion,
            min_seg_expediente, estado, minseg_notificado, minseg_notificado_en, creado_en)
         VALUES ($1, NULL, $2, $3, $4, 'ACTIVA', TRUE, NOW(), $5)
         ON CONFLICT (min_seg_expediente) DO NOTHING`,
        [
          item.numero_serie,
          bici.propietario_id,
          `[MINSEG] ${item.descripcion}`,
          item.expediente,
          item.fecha_denuncia,
        ]
      )

      // Bloquear CIT activo si existe
      await query(
        `UPDATE cits SET estado='BLOQUEADO', actualizado_en=NOW()
         WHERE bicicleta_id=$1 AND estado='ACTIVO'`,
        [bici.id]
      )

      importadas++
    }

    await logSync('SYNC', null,
      { desde: desde.toISOString(), total: body.total },
      { importadas, actualizadas },
      res.status, 'OK')

    breaker.registrarExito()
    log.minseg.info({ importadas, actualizadas, total: body.total }, '✓ Sync Min.Seg. completado')

    return {
      importadas, actualizadas,
      desde: desde.toISOString(), hasta: new Date().toISOString(),
      stub: false,
    }

  } catch (err) {
    const errMsg = (err as Error).message
    breaker.registrarFallo()
    log.minseg.warn({ errMsg }, '✗ MinSeg sync falló')
    await logSync('SYNC', null, { desde: desde.toISOString() }, null, null, 'ERROR', errMsg)
    return { importadas: 0, actualizadas: 0,
             desde: desde.toISOString(), hasta: new Date().toISOString(), stub: false }
  }
}

// ══════════════════════════════════════════════════════════
// 5. REINTENTOS — Denuncias no notificadas
// Llamado por cron cada 15 min para reintentar las que fallaron
// ══════════════════════════════════════════════════════════

export async function reintentarDenunciasNoNotificadas(): Promise<{ procesadas: number; exitosas: number }> {
  const pendientes = await query<{
    id: string; numero_serie: string; descripcion: string
    min_seg_expediente: string | null; creado_en: Date
    citado_cit_id: string | null; denunciante_id: string
  }>(
    `SELECT d.id, d.numero_serie, d.descripcion,
            d.min_seg_expediente, d.creado_en,
            d.cit_id AS citado_cit_id, d.denunciante_id
     FROM denuncias_robo d
     WHERE d.minseg_notificado = FALSE
       AND d.estado = 'ACTIVA'
       AND (d.minseg_reintento_en IS NULL OR d.minseg_reintento_en < NOW())
     ORDER BY d.creado_en ASC
     LIMIT 20`,
    []
  )

  let procesadas = 0; let exitosas = 0

  for (const denuncia of pendientes) {
    procesadas++

    // Obtener datos completos para la notificación
    const cit = denuncia.citado_cit_id
      ? await queryOne<{
          numero_cit: string; numero_serie: string
          propietario_dni: string; propietario_nombre: string
          marca: string; modelo: string; anio: number; color: string
        }>(
          `SELECT c.numero_cit, b.numero_serie, u.dni AS propietario_dni,
                  u.nombre||' '||u.apellido AS propietario_nombre,
                  b.marca, b.modelo, b.anio, b.color
           FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id JOIN usuarios u ON u.id=c.propietario_id
           WHERE c.id=$1`,
          [denuncia.citado_cit_id]
        )
      : null

    const result = await reportarDenuncia({
      denunciaRodaidId:  denuncia.id,
      numeroCIT:         cit?.numero_cit ?? 'SIN-CIT',
      serial:            denuncia.numero_serie,
      marca:             cit?.marca ?? 'desconocida',
      modelo:            cit?.modelo ?? 'desconocido',
      anio:              cit?.anio ?? 0,
      color:             cit?.color ?? 'desconocido',
      propietarioDNI:    cit?.propietario_dni ?? 'N/D',
      propietarioNombre: cit?.propietario_nombre ?? 'N/D',
      descripcion:       denuncia.descripcion,
      fechaDenuncia:     denuncia.creado_en.toISOString(),
    })

    if (result.registrado) {
      exitosas++
      await query(
        `UPDATE denuncias_robo
         SET minseg_notificado=TRUE, minseg_notificado_en=NOW(),
             min_seg_expediente=COALESCE(min_seg_expediente, $2)
         WHERE id=$1`,
        [denuncia.id, result.expediente]
      )
    } else if (!result.stub) {
      // Programar reintento en 15 minutos
      await query(
        `UPDATE denuncias_robo SET minseg_reintento_en=NOW()+INTERVAL '15 minutes' WHERE id=$1`,
        [denuncia.id]
      )
    }
  }

  if (procesadas > 0) {
    log.minseg.info({ procesadas, exitosas }, `✓ Reintentos Min.Seg.: ${exitosas}/${procesadas}`)
  }

  return { procesadas, exitosas }
}

// ══════════════════════════════════════════════════════════
// 6. ESTADO DEL CIRCUIT BREAKER
// ══════════════════════════════════════════════════════════

export function getMinSegStatus(): {
  circuitBreakerAbierto: boolean
  apiConfigurada: boolean
  stub: boolean
} {
  return {
    circuitBreakerAbierto: breaker.abierto,
    apiConfigurada:        !!(env.MINSEG_API_URL && env.MINSEG_API_KEY),
    stub:                  !(env.MINSEG_API_URL && env.MINSEG_API_KEY),
  }
}

// ══════════════════════════════════════════════════════════
// 7. CONSULTA DE HISTORIAL (admin)
// ══════════════════════════════════════════════════════════

export async function getMinSegHistory(serial?: string, limit = 20) {
  const where = serial ? `WHERE numero_serie=$1` : ``
  const params = serial ? [serial, limit] : [limit]
  return query(
    `SELECT tipo, numero_serie, resultado, http_status, error_mensaje, procesado_en
     FROM minseg_sync ${where}
     ORDER BY procesado_en DESC LIMIT $${serial ? '2' : '1'}`,
    params
  )
}
