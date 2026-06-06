// ─── RODAID · Verificador Público — lógica de dominio ─────────────────────
//
// Tarea 6. Construye la respuesta pública de verificación a partir del
// registro crudo del CIT (provisto por la capa mockApi / Netlify Blobs).
//
// Responsabilidades:
//   1. Máquina de 6 estados canónicos con prioridades. BLOQUEADO (prioridad 5)
//      siempre gana sobre cualquier otro estado.
//   2. Anonimización de datos personales para la respuesta pública
//      (apellido del propietario y dígitos del DNI ocultos).
//   3. Estructura de blockchain resiliente: siempre devuelve la validación
//      simulada de la BFA, incluso si la fuente blockchain falla.

// ── Estados canónicos ──────────────────────────────────────────────────────

export type EstadoVerificacion =
  | 'ACTIVO'
  | 'EXPIRADO'
  | 'BLOQUEADO'
  | 'RECHAZADO'
  | 'PENDIENTE'
  | 'NO_ENCONTRADO'

// Prioridad de cada estado. El estado final es el de mayor prioridad entre los
// candidatos derivados del registro. BLOQUEADO = 5 → siempre gana.
export const PRIORIDAD_ESTADO: Record<EstadoVerificacion, number> = {
  BLOQUEADO: 5,
  RECHAZADO: 4,
  EXPIRADO: 3,
  PENDIENTE: 2,
  ACTIVO: 1,
  NO_ENCONTRADO: 0,
}

const LABEL_ESTADO: Record<EstadoVerificacion, string> = {
  ACTIVO: '✓ Certificado activo y vigente',
  EXPIRADO: '⚠ Certificado vencido — requiere re-inspección',
  BLOQUEADO: '✗ Certificado bloqueado — denuncia activa',
  RECHAZADO: '✗ Inspección rechazada',
  PENDIENTE: '⏳ Certificado en proceso de validación',
  NO_ENCONTRADO: '— Serial no registrado en RODAID',
}

const LABEL_MODO_SELLO: Record<string, string> = {
  GOB_MENDOZA: 'Gobierno de Mendoza — TSA oficial',
  RFC3161: 'RFC 3161 — TSA pública reconocida',
  STUB: 'RODAID — sello local (en desarrollo)',
}

export function estadoLabel(estado: EstadoVerificacion): string {
  return LABEL_ESTADO[estado] ?? estado
}

function modoSelloLabel(modo: string): string {
  return LABEL_MODO_SELLO[modo] ?? modo
}

// ── Máquina de estados ─────────────────────────────────────────────────────

interface EntradaEstado {
  estadoBase: string // estado almacenado en el CIT
  vencimiento: Date | null
  tieneDenunciaActiva: boolean
  bfaBloqueado: boolean
  puntos: number
}

/**
 * Resuelve el estado canónico final aplicando prioridades.
 *
 * Reglas (de mayor a menor prioridad):
 *   5 BLOQUEADO  — denuncia de robo activa, bloqueo en BFA, o estado bloqueado.
 *                  SIEMPRE gana, sin importar vigencia o vencimiento.
 *   4 RECHAZADO  — inspección rechazada (estado o < 15 puntos).
 *   3 EXPIRADO   — certificado activo cuya fecha de vencimiento ya pasó.
 *   2 PENDIENTE  — certificado en proceso de validación.
 *   1 ACTIVO     — certificado vigente.
 */
export function resolverEstado(e: EntradaEstado): EstadoVerificacion {
  const candidatos: EstadoVerificacion[] = []

  // 5 — BLOQUEADO siempre gana.
  if (e.bfaBloqueado || e.tieneDenunciaActiva || e.estadoBase === 'BLOQUEADO') {
    candidatos.push('BLOQUEADO')
  }

  // 4 — RECHAZADO.
  if (e.estadoBase === 'RECHAZADO' || (e.estadoBase !== 'PENDIENTE' && e.puntos > 0 && e.puntos < 15)) {
    candidatos.push('RECHAZADO')
  }

  // 3 — EXPIRADO (activo pero vencido).
  if (e.estadoBase === 'ACTIVO' && e.vencimiento && e.vencimiento.getTime() < Date.now()) {
    candidatos.push('EXPIRADO')
  }

  // 2 — PENDIENTE.
  if (e.estadoBase === 'PENDIENTE') {
    candidatos.push('PENDIENTE')
  }

  // 1 — ACTIVO.
  if (e.estadoBase === 'ACTIVO') {
    candidatos.push('ACTIVO')
  }

  if (candidatos.length === 0) return 'NO_ENCONTRADO'

  return candidatos.reduce((mejor, actual) =>
    PRIORIDAD_ESTADO[actual] > PRIORIDAD_ESTADO[mejor] ? actual : mejor
  )
}

// ── Anonimización de datos personales ──────────────────────────────────────

/** "Federico Alvarez Domínguez" → "Federico A.**" (último apellido oculto). */
export function ocultarApellido(nombre: string): string {
  const partes = String(nombre ?? '').trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return ''
  if (partes.length === 1) return partes[0]
  const primerNombre = partes[0]
  const inicialSegundo = (partes[1]?.charAt(0) ?? '') + '.'
  return `${primerNombre} ${inicialSegundo}**`
}

/** "30123456" → "30.123.***" (últimos 3 dígitos ocultos). */
export function ocultarDNI(dni: string): string {
  const solo = String(dni ?? '').replace(/\D/g, '')
  if (solo.length < 6) return '***'
  const visibles = solo.slice(0, -3)
  // Agrupar de a 3 desde la izquierda y añadir el grupo oculto al final.
  const grupos = (visibles.match(/.{1,3}/g) ?? [visibles])
  return grupos.join('.') + '.***'
}

// ── Tipos de la respuesta pública ──────────────────────────────────────────

export interface BloquesBFA {
  red: string
  indexado: boolean
  tokenId?: number
  txHash?: string
  estado: string
  bloqueado: boolean
  bloqueoMotivo?: string
  transferencias: number
  // Validación simulada estilo "verificarIntegridad" del contrato BFA.
  validacion: {
    valido: boolean
    contrato: string
    metodo: string
    consultadoEn: string
    disponible: boolean // false si la fuente BFA no respondió (resiliencia)
  }
}

export interface VerificacionPublica {
  consultadoEn: string
  duracionMs: number

  serial: string
  numeroCIT?: string
  hashSHA256?: string

  encontrado: boolean
  estado: EstadoVerificacion
  estadoLabel: string
  vigente: boolean | null

  bicicleta?: { marca: string; modelo: string; anio: number; tipo: string; color: string }

  inspeccion?: {
    resultado: 'APROBADO' | 'RECHAZADO'
    puntos: number
    maximo: number
    porcentaje: number
    fechaEmision: string
    fechaVencimiento: string
  }

  propietario?: { nombre: string; dni: string }

  inspector?: { nombre: string; apellido: string; taller: string; localidad: string }

  blockchain: BloquesBFA

  selloTemporal: {
    emitido: boolean
    codigoVerif?: string
    selladoEn?: string
    modo?: string
    modoLabel?: string
  }

  firmaDigital: {
    firmado: boolean
    firmadoEn?: string
    certSubject?: string
    validaHasta?: string
  }

  links: { verificarURL: string; qrPNG?: string }

  alertas: Array<{ tipo: string; mensaje: string; desde?: string }>
}

// ── BFA: estructura de validación resiliente ───────────────────────────────

const RED_BFA = 'Blockchain Federal Argentina (BFA)'
const CONTRATO_BFA = process.env.RODAID_BFA_CONTRACT ?? 'RodaidCIT@BFA-ONTI'

/**
 * Construye el bloque blockchain. NUNCA lanza: si el dato de BFA del registro
 * falta o es inconsistente, devuelve igualmente la estructura de validación
 * simulada marcando `disponible: false`. El verificador no debe romperse por
 * la capa blockchain.
 */
export function construirBloqueBFA(
  bfa: Record<string, unknown> | null | undefined,
  fallbackTokenId?: number | null,
  fallbackTxHash?: string | null
): BloquesBFA {
  const consultadoEn = new Date().toISOString()
  try {
    const src = bfa ?? {}
    const indexado = Boolean(src.indexado)
    const bloqueado = Boolean(src.bloqueado)
    const tokenId =
      (typeof src.tokenId === 'number' ? src.tokenId : undefined) ??
      (typeof fallbackTokenId === 'number' ? fallbackTokenId : undefined)
    const txHashRaw =
      (typeof src.txHash === 'string' ? src.txHash : undefined) ??
      (typeof fallbackTxHash === 'string' ? fallbackTxHash : undefined)

    return {
      red: RED_BFA,
      indexado,
      tokenId,
      txHash: txHashRaw ? txHashRaw.slice(0, 18) : undefined,
      estado: indexado ? (bloqueado ? 'BLOQUEADO' : 'VIGENTE') : 'NO_INDEXADO',
      bloqueado,
      bloqueoMotivo: typeof src.bloqueoMotivo === 'string' ? src.bloqueoMotivo : undefined,
      transferencias: typeof src.transferencias === 'number' ? src.transferencias : 0,
      validacion: {
        valido: indexado && !bloqueado,
        contrato: CONTRATO_BFA,
        metodo: 'verificarIntegridad(hashSHA256)',
        consultadoEn,
        disponible: true,
      },
    }
  } catch {
    // Resiliencia total: estructura mínima válida con disponible=false.
    return {
      red: RED_BFA,
      indexado: false,
      estado: 'NO_DISPONIBLE',
      bloqueado: false,
      transferencias: 0,
      validacion: {
        valido: false,
        contrato: CONTRATO_BFA,
        metodo: 'verificarIntegridad(hashSHA256)',
        consultadoEn,
        disponible: false,
      },
    }
  }
}

// ── Ensamblado de la respuesta pública ─────────────────────────────────────

type RegistroCIT = {
  serial: string
  numeroCIT?: string
  hashSHA256?: string
  estado: string
  puntoDetalle?: Record<string, boolean>
  puntos?: number
  fechaEmision?: string | null
  fechaVencimiento?: string | null
  bicicleta?: { marca: string; modelo: string; anio: number; tipo: string; color: string }
  propietario?: { nombre: string; apellido: string; dni: string }
  inspector?: { nombre: string; apellido: string; taller: string; localidad: string }
  nftTokenId?: number | null
  bfaTxHash?: string | null
  codigoVerif?: string | null
  selloSelladoEn?: string | null
  selloModo?: string | null
  firmaFirmadoEn?: string | null
  firmaCertSubject?: string | null
  firmaValidaHasta?: string | null
  bfa?: Record<string, unknown> | null
  denuncias?: Array<{ estado: string; creadoEn?: string }>
}

const BASE_URL = process.env.RODAID_BASE_URL ?? 'https://rodaid.netlify.app'

/** Respuesta para un serial inexistente. La BFA igual devuelve su estructura. */
export function respuestaNoEncontrada(serial: string, t0: number): VerificacionPublica {
  return {
    consultadoEn: new Date().toISOString(),
    duracionMs: Date.now() - t0,
    serial,
    encontrado: false,
    estado: 'NO_ENCONTRADO',
    estadoLabel: estadoLabel('NO_ENCONTRADO'),
    vigente: false,
    blockchain: construirBloqueBFA(null),
    selloTemporal: { emitido: false },
    firmaDigital: { firmado: false },
    links: { verificarURL: `${BASE_URL}/verificar/${encodeURIComponent(serial)}` },
    alertas: [],
  }
}

/** Ensambla la respuesta pública completa a partir de un registro de CIT. */
export function armarVerificacion(registro: RegistroCIT, t0: number): VerificacionPublica {
  const ahora = new Date()
  const vencimiento = registro.fechaVencimiento ? new Date(registro.fechaVencimiento) : null

  const puntoDetalle = registro.puntoDetalle ?? {}
  const puntosAprobados = Object.values(puntoDetalle).filter(Boolean).length
  const totalPuntos = typeof registro.puntos === 'number' ? registro.puntos : puntosAprobados

  const tieneDenunciaActiva = (registro.denuncias ?? []).some((d) => d.estado === 'ACTIVA')
  const bfaBloqueado = Boolean(registro.bfa?.bloqueado)

  const estado = resolverEstado({
    estadoBase: registro.estado,
    vencimiento,
    tieneDenunciaActiva,
    bfaBloqueado,
    puntos: totalPuntos,
  })

  const vigente = estado === 'ACTIVO'

  // Alertas activas.
  const alertas: VerificacionPublica['alertas'] = []
  const primeraDenuncia = (registro.denuncias ?? []).find((d) => d.estado === 'ACTIVA')
  if (primeraDenuncia) {
    alertas.push({
      tipo: 'DENUNCIA_ROBO',
      mensaje: 'Esta bicicleta tiene una denuncia de robo activa en RODAID',
      desde: primeraDenuncia.creadoEn,
    })
  }
  if (estado === 'EXPIRADO' && vencimiento) {
    alertas.push({
      tipo: 'CIT_EXPIRADO',
      mensaje: `El certificado venció el ${vencimiento.toLocaleDateString('es-AR')}`,
    })
  }
  if (bfaBloqueado) {
    alertas.push({
      tipo: 'BLOQUEADO_BFA',
      mensaje: `Bloqueado en BFA: ${String(registro.bfa?.bloqueoMotivo ?? 'motivo no especificado')}`,
    })
  }

  const hashPrefix = registro.hashSHA256 ? registro.hashSHA256.slice(0, 16) + '...' : undefined

  return {
    consultadoEn: ahora.toISOString(),
    duracionMs: Date.now() - t0,

    serial: registro.serial,
    numeroCIT: registro.numeroCIT,
    hashSHA256: hashPrefix,

    encontrado: true,
    estado,
    estadoLabel: estadoLabel(estado),
    vigente,

    bicicleta: registro.bicicleta,

    inspeccion:
      registro.estado === 'PENDIENTE'
        ? undefined
        : {
            resultado: totalPuntos >= 15 ? 'APROBADO' : 'RECHAZADO',
            puntos: totalPuntos,
            maximo: 20,
            porcentaje: Math.round((totalPuntos / 20) * 100),
            fechaEmision: registro.fechaEmision ?? '',
            fechaVencimiento: registro.fechaVencimiento ?? '',
          },

    propietario: registro.propietario
      ? {
          nombre: ocultarApellido(
            `${registro.propietario.nombre} ${registro.propietario.apellido}`.trim()
          ),
          dni: ocultarDNI(registro.propietario.dni),
        }
      : undefined,

    inspector:
      registro.inspector && registro.inspector.nombre ? registro.inspector : undefined,

    blockchain: construirBloqueBFA(registro.bfa, registro.nftTokenId, registro.bfaTxHash),

    selloTemporal: {
      emitido: Boolean(registro.codigoVerif),
      codigoVerif: registro.codigoVerif ?? undefined,
      selladoEn: registro.selloSelladoEn ?? undefined,
      modo: registro.selloModo ?? undefined,
      modoLabel: registro.selloModo ? modoSelloLabel(registro.selloModo) : undefined,
    },

    firmaDigital: {
      firmado: Boolean(registro.firmaFirmadoEn),
      firmadoEn: registro.firmaFirmadoEn ?? undefined,
      certSubject: registro.firmaCertSubject ?? undefined,
      validaHasta: registro.firmaValidaHasta ?? undefined,
    },

    links: {
      verificarURL: `${BASE_URL}/verificar/${encodeURIComponent(registro.serial)}`,
      qrPNG: `/api/v1/qr/${encodeURIComponent(registro.serial)}`,
    },

    alertas,
  }
}
