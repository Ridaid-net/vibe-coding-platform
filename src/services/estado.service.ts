// ─── RODAID · Estado Engine — Resolución de Estado Real ──
// Determina el estado real y completo de un CIT a partir de
// múltiples fuentes: DB, BFA on-chain, denuncias, pipeline.
//
// Estados posibles del verificador público:
//
//  ACTIVO          CIT válido, inspección aprobada, no vencido, no bloqueado
//  EN_VALIDACION   Bicicleta con CIT iniciado en pipeline de 72 horas
//  EXPIRADO        CIT superó fecha de vencimiento (1 año desde emisión)
//  BLOQUEADO       Denuncia de robo activa o bloqueado on-chain en BFA
//  RECHAZADO       Inspección no aprobó los 15 puntos mínimos
//  SIN_REGISTRO    Serial no encontrado en RODAID
//
// Jerarquía de prioridad (mayor número = mayor prioridad):
//   SIN_REGISTRO (0) < RECHAZADO (1) < EXPIRADO (2) <
//   EN_VALIDACION (3) < ACTIVO (4) < BLOQUEADO (5)
//
// BLOQUEADO siempre gana sobre cualquier otro estado positivo —
// una bicicleta con denuncia activa nunca puede mostrar ACTIVO.
//
// Fuentes consultadas para la resolución:
//   · cits.estado + pipeline_estado (DB)
//   · bfa_eventos (índice local BFA)
//   · bfaService.verificarIntegridad() (contrato en tiempo real)
//   · denuncias_robo WHERE estado='ACTIVA'
//   · fecha_vencimiento vs NOW()

import crypto   from 'crypto'
import { query, queryOne } from '../config/database'
import { log }  from '../middleware/logger'

// ══════════════════════════════════════════════════════════
// ESTADO CANÓNICO
// ══════════════════════════════════════════════════════════

export type EstadoCIT =
  | 'ACTIVO'
  | 'EN_VALIDACION'
  | 'EXPIRADO'
  | 'BLOQUEADO'
  | 'RECHAZADO'
  | 'SIN_REGISTRO'

/** Prioridad numérica: un estado con mayor prioridad anula al de menor */
const PRIORIDAD: Record<EstadoCIT, number> = {
  SIN_REGISTRO:  0,
  RECHAZADO:     1,
  EXPIRADO:      2,
  EN_VALIDACION: 3,
  ACTIVO:        4,
  BLOQUEADO:     5,   // siempre gana
}

export interface EstadoResuelto {
  estado:         EstadoCIT
  estadoLabel:    string       // "✓ Activo y vigente"
  descripcion:    string       // explicación para el usuario
  accion?:        string       // qué debería hacer el usuario/inspector
  color:          string       // 'green' | 'yellow' | 'orange' | 'red' | 'gray'
  icono:          string       // emoji para la UI
  httpCode:       number       // 200 | 404 | 403 | 410
  // Contexto temporal
  vigente:        boolean
  diasParaVencer: number | null
  diasEnEstado:   number | null
  // Fuentes que contribuyeron al estado
  fuentesPrincipales: string[]
  // Detalle adicional
  bloqueoMotivo?:    string
  bloqueoFecha?:     Date
  pipelineEstado?:   string
  pipelineInicio?:   Date
  pipelineVenceEn?:  Date
}

// ══════════════════════════════════════════════════════════
// TABLA DE ESTADOS
// ══════════════════════════════════════════════════════════

export function resolverLabel(estado: EstadoCIT): {
  estadoLabel: string; descripcion: string; accion?: string
  color: string; icono: string; httpCode: number
} {
  const tabla: Record<EstadoCIT, ReturnType<typeof resolverLabel>> = {
    ACTIVO: {
      estadoLabel: '✓ Certificado activo y vigente',
      descripcion: 'El Certificado de Identidad Técnica está vigente. La bicicleta pasó la inspección de los 20 puntos técnicos y fue registrada en la Blockchain Federal Argentina.',
      color: 'green', icono: '✓', httpCode: 200,
    },
    EN_VALIDACION: {
      estadoLabel: '⏳ En proceso de validación (72 hs)',
      descripcion: 'El certificado fue iniciado y está siendo validado. El proceso dura hasta 72 horas. Durante este período se verifica la identidad técnica y se registra en BFA.',
      accion: 'La bicicleta puede ser inspeccionada pero el CIT aún no es definitivo. Completar la validación antes de cualquier transferencia.',
      color: 'yellow', icono: '⏳', httpCode: 200,
    },
    EXPIRADO: {
      estadoLabel: '⚠ Certificado vencido',
      descripcion: 'El Certificado de Identidad Técnica superó su período de validez de 1 año. Requiere una nueva inspección técnica para ser renovado.',
      accion: 'Solicitar re-inspección en un Taller Aliado RODAID para obtener un nuevo CIT.',
      color: 'orange', icono: '⚠', httpCode: 200,
    },
    BLOQUEADO: {
      estadoLabel: '✗ Certificado bloqueado',
      descripcion: 'El certificado está bloqueado. Existe una denuncia de robo activa o el certificado fue bloqueado por orden administrativa. No se puede transferir ni usar como respaldo.',
      accion: 'Si la bicicleta fue recuperada, contactar a RODAID para iniciar el proceso de desbloqueo con el número de expediente del Ministerio de Seguridad.',
      color: 'red', icono: '✗', httpCode: 200,
    },
    RECHAZADO: {
      estadoLabel: '✗ Inspección rechazada',
      descripcion: 'La inspección técnica no superó el mínimo de 15 puntos aprobados. El certificado no fue emitido en esta instancia.',
      accion: 'Subsanar los puntos observados y solicitar una nueva inspección técnica.',
      color: 'red', icono: '✗', httpCode: 200,
    },
    SIN_REGISTRO: {
      estadoLabel: '— Sin registro en RODAID',
      descripcion: 'El número de serie consultado no está registrado en RODAID. La bicicleta no tiene Certificado de Identidad Técnica emitido.',
      accion: 'Visitar un Taller Aliado RODAID para iniciar el proceso de certificación.',
      color: 'gray', icono: '—', httpCode: 404,
    },
  }
  return tabla[estado]
}

// ══════════════════════════════════════════════════════════
// RESOLUCIÓN COMPLETA DEL ESTADO
// ══════════════════════════════════════════════════════════

export interface EstadoInput {
  // Desde DB (cits)
  dbEstado:         string | null      // 'ACTIVO'|'PENDIENTE'|'BLOQUEADO'|'RECHAZADO'|'EXPIRADO'
  pipelineEstado:   string | null      // 'BORRADOR'|'PENDIENTE'|'VALIDANDO'|'ACTIVANDO'|'ACTIVO'|'RECHAZADO'|'CANCELADO'
  pipelineInicio:   Date | null
  fechaVencimiento: Date | null
  fechaEmision:     Date | null
  // Desde BFA on-chain
  bfaBloqueado:     boolean | null     // null = no se pudo consultar
  bfaBloqueadoOnChain: boolean | null
  bfaIndexado:      boolean
  // Desde denuncias
  denunciasActivas: number
  ultimaDenuncia?:  Date
  bloqueoMotivo?:   string
  // Contexto
  citId:            string
  serial:           string
}

export function resolverEstado(input: EstadoInput): EstadoResuelto {
  const ahora          = new Date()
  const fuentesPrincipales: string[] = []

  // ── Paso 1: Estado base desde DB ──────────────────────────
  let estadoBase: EstadoCIT = 'SIN_REGISTRO'

  if (input.dbEstado === 'ACTIVO') {
    estadoBase = 'ACTIVO'
    fuentesPrincipales.push('Certificado activo en RODAID')
  } else if (input.dbEstado === 'PENDIENTE') {
    // PENDIENTE puede estar en diferentes sub-estados del pipeline
    const pipeline = input.pipelineEstado ?? 'BORRADOR'
    if (['PENDIENTE', 'VALIDANDO', 'ACTIVANDO', 'BORRADOR'].includes(pipeline)) {
      estadoBase = 'EN_VALIDACION'
      fuentesPrincipales.push(`Pipeline de validación (${pipeline})`)
    } else if (pipeline === 'RECHAZADO' || pipeline === 'CANCELADO') {
      estadoBase = 'RECHAZADO'
    } else {
      estadoBase = 'EN_VALIDACION'
    }
  } else if (input.dbEstado === 'RECHAZADO') {
    estadoBase = 'RECHAZADO'
    fuentesPrincipales.push('Inspección rechazada')
  } else if (input.dbEstado === 'EXPIRADO') {
    estadoBase = 'EXPIRADO'
  } else if (input.dbEstado === 'BLOQUEADO') {
    estadoBase = 'BLOQUEADO'
    fuentesPrincipales.push('Bloqueado en RODAID')
  }

  // ── Paso 2: Chequeo de vencimiento ────────────────────────
  if (estadoBase === 'ACTIVO' && input.fechaVencimiento) {
    if (input.fechaVencimiento < ahora) {
      estadoBase = 'EXPIRADO'
      fuentesPrincipales.push(`Vencido el ${input.fechaVencimiento.toLocaleDateString('es-AR')}`)
    }
  }

  // ── Paso 3: Denuncias activas → BLOQUEADO (máxima prioridad) ─
  if (input.denunciasActivas > 0) {
    if (PRIORIDAD['BLOQUEADO'] > PRIORIDAD[estadoBase]) {
      estadoBase = 'BLOQUEADO'
      fuentesPrincipales.push(`${input.denunciasActivas} denuncia(s) de robo activa(s)`)
    }
  }

  // ── Paso 4: BFA on-chain bloqueado → BLOQUEADO ────────────
  if ((input.bfaBloqueado || input.bfaBloqueadoOnChain) && estadoBase !== 'BLOQUEADO') {
    estadoBase = 'BLOQUEADO'
    fuentesPrincipales.push('Bloqueado en Blockchain Federal Argentina')
  }

  // ── Paso 5: Calcular métricas temporales ──────────────────
  let diasParaVencer: number | null = null
  let diasEnEstado:   number | null = null
  let pipelineVenceEn: Date | null  = null

  if (estadoBase === 'ACTIVO' && input.fechaVencimiento) {
    const diff = input.fechaVencimiento.getTime() - ahora.getTime()
    diasParaVencer = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)))
    if (diasParaVencer <= 30) {
      fuentesPrincipales.push(`Vence en ${diasParaVencer} días`)
    }
  }

  if (estadoBase === 'EN_VALIDACION' && input.pipelineInicio) {
    diasEnEstado = Math.floor(
      (ahora.getTime() - input.pipelineInicio.getTime()) / (1000 * 60 * 60 * 24)
    )
    pipelineVenceEn = new Date(input.pipelineInicio.getTime() + 72 * 60 * 60 * 1000)
    const horasRestantes = Math.max(0,
      Math.floor((pipelineVenceEn.getTime() - ahora.getTime()) / (1000 * 60 * 60))
    )
    fuentesPrincipales.push(`${horasRestantes} horas restantes de validación`)
  }

  if (input.fechaEmision) {
    diasEnEstado = Math.floor(
      (ahora.getTime() - input.fechaEmision.getTime()) / (1000 * 60 * 60 * 24)
    )
  }

  const vigente = estadoBase === 'ACTIVO' ||
                  (estadoBase === 'EN_VALIDACION' && !!(input.pipelineInicio))

  // ── Paso 6: Detalles de bloqueo ───────────────────────────
  let bloqueoFecha: Date | undefined
  let bloqueoMotivo: string | undefined

  if (estadoBase === 'BLOQUEADO') {
    bloqueoFecha  = input.ultimaDenuncia ?? undefined
    bloqueoMotivo = input.bloqueoMotivo
      ?? (input.denunciasActivas > 0 ? `${input.denunciasActivas} denuncia(s) de robo activa(s) en RODAID` : 'Bloqueado por orden administrativa')
  }

  const labels = resolverLabel(estadoBase)

  log.estado.debug({
    citId:   input.citId,
    serial:  input.serial.slice(0, 12),
    estado:  estadoBase,
    fuentes: fuentesPrincipales,
  }, `Estado resuelto: ${estadoBase}`)

  return {
    estado:            estadoBase,
    ...labels,
    vigente,
    diasParaVencer,
    diasEnEstado,
    fuentesPrincipales,
    bloqueoMotivo,
    bloqueoFecha,
    pipelineEstado:    input.pipelineEstado ?? undefined,
    pipelineInicio:    input.pipelineInicio ?? undefined,
    pipelineVenceEn:   pipelineVenceEn ?? undefined,
  }
}

// ══════════════════════════════════════════════════════════
// LOOKUP DIRECTO POR SERIAL (sin pasar por el verificador)
// ══════════════════════════════════════════════════════════

export async function resolverEstadoPorSerial(serial: string): Promise<EstadoResuelto> {
  const row = await queryOne<{
    citId: string; dbEstado: string; pipelineEstado: string | null
    pipelineInicio: Date | null; fechaVencimiento: Date | null; fechaEmision: Date | null
    nftTokenId: number | null; bfaTxHash: string | null; bloqueoMotivo: string | null
  }>(
    `SELECT c.id AS "citId", c.estado::text AS "dbEstado",
            c.pipeline_estado AS "pipelineEstado",
            c.pipeline_inicio AS "pipelineInicio",
            c.fecha_vencimiento AS "fechaVencimiento",
            c.fecha_emision AS "fechaEmision",
            c.nft_token_id AS "nftTokenId",
            c.bfa_tx_hash AS "bfaTxHash",
            NULL AS "bloqueoMotivo"
     FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id
     WHERE b.numero_serie=$1
       AND c.estado IN ('ACTIVO','PENDIENTE','RECHAZADO','BLOQUEADO','EXPIRADO')
     ORDER BY c.creado_en DESC LIMIT 1`,
    [serial]
  )

  if (!row) {
    return resolverEstado({
      dbEstado: null, pipelineEstado: null, pipelineInicio: null,
      fechaVencimiento: null, fechaEmision: null,
      bfaBloqueado: null, bfaBloqueadoOnChain: null, bfaIndexado: false,
      denunciasActivas: 0, citId: '', serial,
    })
  }

  // Consultar denuncias y BFA en paralelo
  const [denuncias, bfaIndex] = await Promise.all([
    query<{ estado: string; creado_en: Date }>(
      `SELECT estado, creado_en FROM denuncias_robo WHERE numero_serie=$1 AND estado='ACTIVA' LIMIT 1`,
      [serial]
    ),
    (async () => {
      try {
        const { verificarPorSerial } = await import('./bfa.indexer')
        return verificarPorSerial(serial)
      } catch { return null }
    })(),
  ])

  return resolverEstado({
    dbEstado:         row.dbEstado,
    pipelineEstado:   row.pipelineEstado,
    pipelineInicio:   row.pipelineInicio,
    fechaVencimiento: row.fechaVencimiento,
    fechaEmision:     row.fechaEmision,
    bfaBloqueado:     bfaIndex?.bfa.bloqueado ?? null,
    bfaBloqueadoOnChain: bfaIndex?.bfa.bloqueado ?? null,
    bfaIndexado:      bfaIndex?.encontrado ?? false,
    denunciasActivas: denuncias.length,
    ultimaDenuncia:   denuncias[0]?.creado_en,
    bloqueoMotivo:    row.bloqueoMotivo ?? undefined,
    citId:            row.citId,
    serial,
  })
}

// ══════════════════════════════════════════════════════════
// BADGE HTML para respuestas del verificador
// ══════════════════════════════════════════════════════════

/** Genera el objeto badge para UI (mobile + web) */
export function estadoBadge(estado: EstadoResuelto): {
  texto:      string
  color:      string
  bgColor:    string
  borderColor: string
  icono:      string
} {
  const colores: Record<string, { color: string; bgColor: string; borderColor: string }> = {
    green:  { color: '#166534', bgColor: '#DCFCE7', borderColor: '#86EFAC' },
    yellow: { color: '#854F0B', bgColor: '#FEFCE8', borderColor: '#FDE047' },
    orange: { color: '#9A3412', bgColor: '#FFEDD5', borderColor: '#FED7AA' },
    red:    { color: '#991B1B', bgColor: '#FEE2E2', borderColor: '#FCA5A5' },
    gray:   { color: '#374151', bgColor: '#F3F4F6', borderColor: '#D1D5DB' },
  }

  const c = colores[estado.color] ?? colores['gray']
  return {
    texto:       estado.estadoLabel,
    icono:       estado.icono,
    ...c,
  }
}
