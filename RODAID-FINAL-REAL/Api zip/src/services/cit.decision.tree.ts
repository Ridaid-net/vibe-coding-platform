// ─── RODAID · Árbol de Decisión del CIT ──────────────────
//
// Estado-máquina que determina en qué "zona" está cada CIT
// según sus días restantes, y dispara las notificaciones
// correspondientes de manera idempotente.
//
// ══ ZONAS DE VENCIMIENTO ══════════════════════════════════
//
//   VERDE    > 60 días  → CIT saludable, sin alerta
//   AMARILLA   31–60 d  → Primera alerta (UMBRAL_60)
//   NARANJA    16–30 d  → Segunda alerta (UMBRAL_30)
//   ROJA        8–15 d  → Alerta urgente (UMBRAL_15)
//   CRITICA      1–7 d  → Alerta crítica (UMBRAL_7 + UMBRAL_1)
//   VENCIDO     <= 0 d  → CIT vencido
//
// ══ ÁRBOL DE DECISIÓN ════════════════════════════════════
//
//   diasRestantes > 60   → VERDE          (sin acción)
//        55 < d <= 60    → AMARILLA       → notif UMBRAL_60
//        25 < d <= 30    → NARANJA        → notif UMBRAL_30
//         8 < d <= 15    → ROJA           → notif UMBRAL_15 + push urgente
//              d <= 7    → CRITICA        → notif UMBRAL_7  + push + email
//              d == 1    → CRITICA        → notif UMBRAL_1  + push + email
//              d <= 0    → VENCIDO        → marcar CIT, push final
//
// ══ IDEMPOTENCIA ══════════════════════════════════════════
//
//   Cada (cit_id, tipo, umbral_dias) tiene un UNIQUE en notif_envios.
//   Si el cron corre dos veces el mismo día, el segundo intento
//   hace ON CONFLICT DO NOTHING y retorna sin duplicar la notificación.
//
// ══ USO ═══════════════════════════════════════════════════
//
//   // En el scheduler diario:
//   import { procesarArbolDecisionCITs } from './cit.decision.tree'
//   await procesarArbolDecisionCITs()
//
//   // En el endpoint POST /cit/:id (cuando se crea/actualiza un CIT):
//   import { evaluarZonaCIT } from './cit.decision.tree'
//   await evaluarZonaCIT(citId)

import { query, queryOne, transaction } from '../config/database'
import { log }                          from '../middleware/logger'
import {
  notificarCITPorVencer,
  notificarCITAprobado,
  notificarCITRechazado,
} from './notif.service'
import { despacharCITEmitido }          from './notif.dispatcher'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export type ZonaCIT = 'VERDE' | 'AMARILLA' | 'NARANJA' | 'ROJA' | 'CRITICA' | 'VENCIDO' | null

export interface CITNodo {
  id:              string
  numeroCIT:       string
  propietarioId:   string
  bicicletaMarca:  string
  bicicletaModelo: string
  bicicletaSerial: string
  fechaVencimiento:Date | null
  zonaActual:      ZonaCIT
  diasRestantes:   number | null
}

export interface ResultadoArbol {
  total:     number   // CITs evaluados
  cambios:   number   // CITs que cambiaron de zona
  enviadas:  number   // notificaciones disparadas
  errores:   number
  detalles:  Array<{
    numeroCIT: string
    zonaAnterior: ZonaCIT
    zonaNueva: ZonaCIT
    notifEnviada: boolean
  }>
}

// ══════════════════════════════════════════════════════════
// LÓGICA CENTRAL — calcular zona
// ══════════════════════════════════════════════════════════

export function calcularZona(diasRestantes: number | null): ZonaCIT {
  if (diasRestantes === null) return null
  if (diasRestantes <= 0)   return 'VENCIDO'
  if (diasRestantes <= 7)   return 'CRITICA'
  if (diasRestantes <= 15)  return 'ROJA'
  if (diasRestantes <= 30)  return 'NARANJA'
  if (diasRestantes <= 60)  return 'AMARILLA'
  return 'VERDE'
}

// Umbrales de notificación para cada zona (días exactos antes del vencimiento)
const UMBRALES: Record<string, number[]> = {
  AMARILLA: [60],
  NARANJA:  [30],
  ROJA:     [15],
  CRITICA:  [7, 1],
  VENCIDO:  [0],
}

// ══════════════════════════════════════════════════════════
// EVALUAR UN CIT INDIVIDUAL
// ══════════════════════════════════════════════════════════

export async function evaluarZonaCIT(citId: string): Promise<{
  zonaNueva: ZonaCIT; cambiaron: boolean; notifEnviada: boolean
}> {
  const cit = await queryOne<{
    id: string; numero_cit: string; propietario_id: string;
    estado: string; fecha_vencimiento: Date | null;
    zona_vencimiento: ZonaCIT;
    marca: string; modelo: string; numero_serie: string;
  }>(
    `SELECT c.id::text, c.numero_cit, c.propietario_id::text,
            c.estado, c.fecha_vencimiento, c.zona_vencimiento,
            b.marca, b.modelo, b.numero_serie
     FROM cits c JOIN bicicletas b ON b.id = c.bicicleta_id
     WHERE c.id = $1::uuid AND c.estado = 'ACTIVO'`,
    [citId]
  )

  if (!cit || !cit.fecha_vencimiento) {
    return { zonaNueva: null, cambiaron: false, notifEnviada: false }
  }

  const ahora = Date.now()
  const venc  = new Date(cit.fecha_vencimiento).getTime()
  const diasRestantes = Math.floor((venc - ahora) / (1000 * 60 * 60 * 24))
  const zonaNueva = calcularZona(diasRestantes)
  const zonaAnterior = cit.zona_vencimiento
  const cambiaron = zonaNueva !== zonaAnterior

  // Actualizar zona en DB
  if (cambiaron) {
    await query(
      `UPDATE cits SET zona_vencimiento=$1, zona_actualizada_en=NOW()
       WHERE id=$2::uuid`,
      [zonaNueva, citId]
    )
  }

  // ¿Hay que notificar en esta zona?
  let notifEnviada = false
  const umbrales = UMBRALES[zonaNueva ?? ''] ?? []

  for (const umbral of umbrales) {
    // Verificar si el CIT está exactamente en la ventana del umbral
    // (diasRestantes dentro del umbral ± 1 para capturar el día exacto)
    const enVentana = Math.abs(diasRestantes - umbral) <= 1

    if (!enVentana && zonaNueva !== 'VENCIDO') continue

    // Idempotencia: INSERT ... ON CONFLICT DO NOTHING
    const resultado = await query<{ id: string }>(
      `INSERT INTO notif_envios (cit_id, usuario_id, tipo, umbral_dias, canal)
       VALUES ($1::uuid, $2::uuid, 'CIT_POR_VENCER', $3, 'MULTI')
       ON CONFLICT (cit_id, tipo, umbral_dias) DO NOTHING
       RETURNING id::text`,
      [cit.id, cit.propietario_id, umbral]
    )

    // Si no hubo inserción → ya se envió → skip
    if (!resultado || resultado.length === 0) continue

    const insertId = resultado[0].id

    try {
      // Disparar la notificación real
      const notifResult = await notificarCITPorVencer({
        usuarioId:     cit.propietario_id,
        numeroCIT:     cit.numero_cit,
        serial:        cit.numero_serie,
        venceEn:       cit.fecha_vencimiento.toISOString(),
        diasRestantes,
      })

      // Marcar como enviada con referencia al notif_id
      await query(
        `UPDATE notif_envios SET enviado=TRUE, notif_id=$1::uuid
         WHERE id=$2::uuid`,
        [notifResult.notifId, insertId]
      )

      notifEnviada = true
      log.mensajeria.info({
        numeroCIT: cit.numero_cit, diasRestantes, umbral, zona: zonaNueva,
      }, `✓ Notificación CIT_POR_VENCER enviada`)

    } catch (err) {
      await query(
        `UPDATE notif_envios SET enviado=FALSE, error=$1 WHERE id=$2::uuid`,
        [(err as Error).message, insertId]
      )
      log.mensajeria.warn({
        numeroCIT: cit.numero_cit, err: (err as Error).message,
      }, 'Notif CIT_POR_VENCER falló')
    }
  }

  // Zona VENCIDO: marcar el CIT como EXPIRADO
  if (zonaNueva === 'VENCIDO') {
    await query(
      `UPDATE cits SET estado='EXPIRADO', zona_vencimiento='VENCIDO',
                       zona_actualizada_en=NOW()
       WHERE id=$1::uuid AND estado='ACTIVO'`,
      [citId]
    )
  }

  return { zonaNueva, cambiaron, notifEnviada }
}

// ══════════════════════════════════════════════════════════
// JOB PRINCIPAL — procesar todos los CITs activos
// ══════════════════════════════════════════════════════════

export async function procesarArbolDecisionCITs(): Promise<ResultadoArbol> {
  const t0 = Date.now()
  log.bfa.info('Árbol de decisión CIT — iniciando evaluación')

  // Traer todos los CITs ACTIVOS que tienen fecha de vencimiento
  const cits = await query<{
    id: string; numero_cit: string; propietario_id: string;
    fecha_vencimiento: Date; zona_vencimiento: ZonaCIT;
    marca: string; modelo: string; numero_serie: string;
  }>(
    `SELECT c.id::text, c.numero_cit, c.propietario_id::text,
            c.fecha_vencimiento, c.zona_vencimiento,
            b.marca, b.modelo, b.numero_serie
     FROM cits c
     JOIN bicicletas b ON b.id = c.bicicleta_id
     WHERE c.estado = 'ACTIVO'
       AND c.fecha_vencimiento IS NOT NULL
     ORDER BY c.fecha_vencimiento ASC`,
    []
  )

  const resultado: ResultadoArbol = {
    total: cits.length, cambios: 0, enviadas: 0, errores: 0, detalles: [],
  }

  for (const cit of cits) {
    const ahora = Date.now()
    const venc  = new Date(cit.fecha_vencimiento).getTime()
    const diasRestantes = Math.floor((venc - ahora) / (1000 * 60 * 60 * 24))
    const zonaNueva = calcularZona(diasRestantes)
    const zonaAnterior = cit.zona_vencimiento

    try {
      const { cambiaron, notifEnviada } = await evaluarZonaCIT(cit.id)
      if (cambiaron)    resultado.cambios++
      if (notifEnviada) resultado.enviadas++
      resultado.detalles.push({
        numeroCIT: cit.numero_cit,
        zonaAnterior,
        zonaNueva,
        notifEnviada,
      })
    } catch (err) {
      resultado.errores++
      resultado.detalles.push({
        numeroCIT: cit.numero_cit, zonaAnterior, zonaNueva, notifEnviada: false,
      })
      log.bfa.error({ cit: cit.numero_cit, err: (err as Error).message }, 'Error en árbol de decisión')
    }
  }

  const ms = Date.now() - t0
  log.bfa.info({ ...resultado, ms }, '✓ Árbol de decisión CIT completado')
  return resultado
}

// ══════════════════════════════════════════════════════════
// TRIGGER: CIT APROBADO — llamar desde POST /cit/finalizar
// ══════════════════════════════════════════════════════════

export async function triggerCITAprobado(opts: {
  citId:      string
  usuarioId:  string
  numeroCIT:  string
  serial:     string
  marca:      string
  modelo:     string
  txHash:     string
}): Promise<void> {
  // 1. Disparar notificación (fire-and-forget)
  despacharCITEmitido({
    usuarioId:  opts.usuarioId,
    numeroCIT:  opts.numeroCIT,
    serial:     opts.serial,
    marca:      opts.marca,
    modelo:     opts.modelo,
    txHash:     opts.txHash,
  })

  // 2. Registrar en notif_envios para auditoría
  await query(
    `INSERT INTO notif_envios (cit_id, usuario_id, tipo, canal, enviado)
     VALUES ($1::uuid, $2::uuid, 'CIT_APROBADO', 'MULTI', TRUE)
     ON CONFLICT DO NOTHING`,
    [opts.citId, opts.usuarioId]
  ).catch(err =>
    log.mensajeria.warn({ err: (err as Error).message }, 'notif_envios CIT_APROBADO falló')
  )

  // 3. Calcular zona inicial del nuevo CIT
  await evaluarZonaCIT(opts.citId).catch(() => {})
}

// ══════════════════════════════════════════════════════════
// TRIGGER: CIT RECHAZADO
// ══════════════════════════════════════════════════════════

export async function triggerCITRechazado(opts: {
  citId:     string
  usuarioId: string
  numeroCIT: string
  serial:    string
  motivo:    string
}): Promise<void> {
  try {
    const notifResult = await notificarCITRechazado({
      usuarioId:  opts.usuarioId,
      numeroCIT:  opts.numeroCIT,
      serial:     opts.serial,
      motivo:     opts.motivo,
    })

    await query(
      `INSERT INTO notif_envios (cit_id, usuario_id, tipo, canal, enviado, notif_id)
       VALUES ($1::uuid, $2::uuid, 'CIT_RECHAZADO', 'MULTI', TRUE, $3::uuid)
       ON CONFLICT DO NOTHING`,
      [opts.citId, opts.usuarioId, notifResult.notifId]
    )
  } catch (err) {
    log.mensajeria.warn({ err: (err as Error).message }, 'Trigger CIT_RECHAZADO falló')
  }
}

// ══════════════════════════════════════════════════════════
// TRIGGER: ALERTA DE ROBO
// ══════════════════════════════════════════════════════════

export async function triggerAlertaRobo(opts: {
  usuarioId:   string
  bicicletaId: string
  numeroCIT:   string
  serial:      string
  marca:       string
  modelo:      string
  denunciaId:  string
}): Promise<void> {
  // Importar dinámicamente para evitar dependencia circular
  const { notificarDenunciaRegistrada } = await import('./notif.service')
  const { enviarPushUsuario }           = await import('./fcm.service')

  await Promise.allSettled([
    // Notificación in-app + email
    notificarDenunciaRegistrada({
      usuarioId:        opts.usuarioId,
      numeroCIT:        opts.numeroCIT,
      serial:           opts.serial,
      minSegExpediente: opts.denunciaId,
      bfaTxHash:        null,
    }),

    // Push crítico con alta prioridad
    enviarPushUsuario(opts.usuarioId, {
      titulo:   `🚨 Robo registrado — ${opts.marca} ${opts.modelo}`,
      cuerpo:   `Alerta enviada a MinSeg. Serial: ${opts.serial}. CIT: ${opts.numeroCIT}`,
      clickUrl: `https://rodaid.net/denuncia/${opts.denunciaId}`,
      datos:    {
        tipo:        'ALERTA_ROBO',
        numeroCIT:   opts.numeroCIT,
        serial:      opts.serial,
        denunciaId:  opts.denunciaId,
        prioridad:   'ALTA',
      },
    }),
  ])

  log.mensajeria.info({
    serial: opts.serial, denunciaId: opts.denunciaId,
  }, '✓ Alerta de robo disparada')
}

// ══════════════════════════════════════════════════════════
// QUERY: obtener resumen de zonas para el dashboard admin
// ══════════════════════════════════════════════════════════

export async function getResumenZonas(): Promise<{
  verde:    number
  amarilla: number
  naranja:  number
  roja:     number
  critica:  number
  vencido:  number
  total:    number
}> {
  const rows = await query<{ zona_vencimiento: ZonaCIT; count: string }>(
    `SELECT COALESCE(zona_vencimiento, 'VERDE') AS zona_vencimiento,
            COUNT(*)::text AS count
     FROM cits
     WHERE estado IN ('ACTIVO', 'EXPIRADO')
       AND fecha_vencimiento IS NOT NULL
     GROUP BY zona_vencimiento`,
    []
  )

  const m: Record<string, number> = {}
  let total = 0
  for (const r of rows) {
    m[(r.zona_vencimiento ?? 'VERDE').toUpperCase()] = parseInt(r.count)
    total += parseInt(r.count)
  }

  return {
    verde:    m.VERDE    ?? 0,
    amarilla: m.AMARILLA ?? 0,
    naranja:  m.NARANJA  ?? 0,
    roja:     m.ROJA     ?? 0,
    critica:  m.CRITICA  ?? 0,
    vencido:  m.VENCIDO  ?? 0,
    total,
  }
}
