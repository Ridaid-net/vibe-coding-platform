// ─── RODAID · Tipos globales ──────────────────────────────

import { Request } from 'express'

// ── JWT Payload ───────────────────────────────────────────

export interface JWTPayload {
  sub:             string        // usuario.id
  email:           string
  rol:             'CICLISTA' | 'INSPECTOR' | 'ALIADO' | 'ADMIN'
  inspectorId?:    string        // solo si rol=INSPECTOR
  tallerAliadoId?: string        // presente en INSPECTOR y ALIADO
  tallerNombre?:   string        // nombre legible del taller
  iat?:            number
  exp?:            number
}

export interface InspectorProfileLight {
  id: string; usuarioId: string; tallerId: string
  tallerNombre: string; tallerLocalidad: string; activo: boolean; fechaAlta: Date
}

export interface AuthRequest extends Request {
  validacionAlertas?: string[]
  user?:             JWTPayload
  inspectorProfile?: InspectorProfileLight
}

// ── CIT ───────────────────────────────────────────────────

export interface PuntosInspeccion {
  serial: boolean
  cuadro: boolean
  horquilla: boolean
  manubrio: boolean
  freno_delantero: boolean
  freno_trasero: boolean
  cables: boolean
  cambio_delantero: boolean
  cambio_trasero: boolean
  cassette: boolean
  cadena: boolean
  bielas: boolean
  pedales: boolean
  rueda_delantera: boolean
  rueda_trasera: boolean
  cubiertas: boolean
  asiento: boolean
  luces: boolean
  accesorios: boolean
  prueba_funcional: boolean
}

export interface CITPayload {
  numeroSerie: string
  marca: string
  modelo: string
  anio: number
  tipo: string
  propietarioDNI: string
  propietarioNombre: string
  inspectorId: string
  tallerAliadoId: string
  puntos: PuntosInspeccion
  fotosUrls: string[]
  timestamp: string  // ISO 8601
  ley: '9556'
}

export interface CITResponse {
  citId: string
  numeroCIT: string
  hashSHA256: string
  estado: 'PENDIENTE' | 'ACTIVO' | 'RECHAZADO'
  venceEn: string
  mxmExpedienteId?: string
}

// ── BFA ───────────────────────────────────────────────────

export interface BFAMintResult {
  txHash: string
  tokenId: number
  blockNumber: number
  gasUsed: string
}

// ── MxM ──────────────────────────────────────────────────

export interface MxMTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: 'Bearer'
}

export interface MxMIdentidad {
  sub?:     string   // OpenID Connect subject
  cuil:     string
  dni:      string
  nombre:   string
  apellido: string
  email?:   string   // email en MxM (puede diferir del email RODAID)
  nivel:    1 | 2   // 1=básico, 2=verificado con DNI (RENAPER)
}

export interface MxMPagoRequest {
  concepto: 'TASA_CIT'
  montoARS: number
  citId: string
  descripcion: string
  usuarioCuil: string
}

// ── Marketplace ───────────────────────────────────────────

export interface PublicacionCreate {
  bicicletaId: string
  titulo: string
  descripcion?: string
  precioARS: number
}

// ── API Response wrapper ──────────────────────────────────

export interface ApiResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: unknown
  }
  meta?: {
    page?: number
    limit?: number
    total?: number
  }
}

// ── Notificaciones ────────────────────────────────────────

export interface NotificacionPayload {
  usuarioId: string
  tipo: string
  titulo: string
  cuerpo: string
  datos?: Record<string, unknown>
}

// ── Payload de alertas canónico (cross-reference + verificarAlertas) ──────────
export interface AlertasPayload {
  // Campos principales — MinSeg los consume directamente
  alerta_activa:   boolean          // true → rodado con alerta vigente
  tipo_alerta?:    'ROBO' | 'RECUPERADA' | 'INVALIDO' | 'BLOQUEADO_ADMIN'
  expediente?:     string           // número de expediente RODAID
  expediente_mxm?: string           // número de expediente MxM
  fuente?:         'RODAID' | 'MINSEG' | 'POLICIAL'

  // Detalle de la denuncia
  numero_denuncia?:   string
  fecha_denuncia?:    string         // ISO 8601
  fecha_robo?:        string         // ISO 8601 — fecha declarada del robo
  descripcion?:       string

  // Estado del CIT
  bloqueado:          boolean
  motivo_bloqueo?:    'DENUNCIA_ROBO' | 'ADMIN' | 'MINSEG' | 'FIRMA_REVOCADA'

  // Alertas MinSeg entrantes (vía webhook)
  alertas_minseg?:    AlertaMinSegItem[]

  // BFA
  bfa_bloqueado?:     boolean
  bfa_lock_tx_hash?:  string
}

export interface AlertaMinSegItem {
  tipo:          string
  descripcion?:  string
  fecha_alerta:  string
  accion_tomada: string
}
