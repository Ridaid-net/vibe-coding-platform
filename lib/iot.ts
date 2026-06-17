'use client'

import useSWR from 'swr'
import { authedFetch } from '@/lib/session'

/**
 * Cliente de RODAID-IoT (Hito 17). Tipos espejo del backend
 * (`src/services/iot.service.ts` / `iot-mantenimiento.service.ts`), fetchers
 * autenticados, hooks de SWR (con polling de la ubicacion en tiempo real solo
 * mientras el sensor transmite) y las acciones de gestion.
 */

// ── Tipos (espejo del servicio) ───────────────────────────────────────────────

export interface DispositivoIot {
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

export interface VinculoResultado {
  dispositivo: DispositivoIot
  deviceUid: string
  deviceSecret: string
}

export interface UbicacionTiempoReal {
  dispositivoId: string
  bicicletaId: string
  serial: string
  transmisionActiva: boolean
  conectado: boolean
  posicion: { lat: number; lng: number; precision: number | null } | null
  nivelBateria: number | null
  velocidadKmh: number | null
  acelerometro: Record<string, unknown>
  ts: string | null
}

export interface GeovallaIot {
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

export interface AlertaIot {
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

export interface DiagnosticoComponente {
  componente: 'cadena' | 'cubiertas' | 'servicio'
  probabilidad: number
  severidad: 'baja' | 'media' | 'alta'
  recomendacion: string
}

export interface AnalisisMantenimiento {
  bicicletaId: string
  generadoEn: string
  tieneDatos: boolean
  muestrasAnalizadas: number
  features: Record<string, number>
  diagnosticos: DiagnosticoComponente[]
  alertasCreadas: number
  nota: string | null
}

// ── Fetcher autenticado ────────────────────────────────────────────────────

async function authedJson<T>(url: string): Promise<T> {
  const res = await authedFetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

// ── Hooks SWR ────────────────────────────────────────────────────────────────

export function useDispositivosIot() {
  return useSWR<{ dispositivos: DispositivoIot[] }>(
    '/api/v1/iot/dispositivos',
    authedJson,
    { revalidateOnFocus: true, keepPreviousData: true }
  )
}

/**
 * Ubicacion en tiempo real de una bici. SOLO trae datos si el sensor transmite.
 * Polling cada `intervaloMs` mientras `activo` sea true (la capa esta visible).
 */
export function useUbicacionTiempoReal(
  bicicletaId: string | null,
  activo: boolean,
  intervaloMs = 15000
) {
  return useSWR<{ ubicacion: UbicacionTiempoReal | null }>(
    bicicletaId && activo
      ? `/api/v1/iot/bicicletas/${encodeURIComponent(bicicletaId)}/telemetria`
      : null,
    authedJson,
    { refreshInterval: activo ? intervaloMs : 0, keepPreviousData: true }
  )
}

export function useGeovallas(bicicletaId: string | null) {
  return useSWR<{ geovallas: GeovallaIot[] }>(
    bicicletaId
      ? `/api/v1/iot/geovallas?bicicletaId=${encodeURIComponent(bicicletaId)}`
      : '/api/v1/iot/geovallas',
    authedJson,
    { revalidateOnFocus: true, keepPreviousData: true }
  )
}

export function useAlertasIot() {
  return useSWR<{ alertas: AlertaIot[] }>('/api/v1/iot/alertas', authedJson, {
    refreshInterval: 30000,
    keepPreviousData: true,
  })
}

// ── Acciones ──────────────────────────────────────────────────────────────────

async function mutarJson<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await authedFetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = (await res.json().catch(() => null)) as
    | (T & { message?: string; error?: string })
    | null
  if (!res.ok) {
    throw new Error(data?.message ?? 'No pudimos completar la acción.')
  }
  return data as T
}

export function vincularDispositivo(input: {
  bicicletaId: string
  nombre?: string
  modoBajoConsumo?: boolean
}): Promise<VinculoResultado> {
  return mutarJson<VinculoResultado>('/api/v1/iot/dispositivos', 'POST', input)
}

export function actualizarDispositivo(
  id: string,
  cambios: {
    transmisionActiva?: boolean
    modoBajoConsumo?: boolean
    nombre?: string
    revocar?: boolean
  }
): Promise<{ dispositivo: DispositivoIot }> {
  return mutarJson(`/api/v1/iot/dispositivos/${encodeURIComponent(id)}`, 'PATCH', cambios)
}

export function crearGeovalla(input: {
  bicicletaId: string
  nombre: string
  centerLat: number
  centerLng: number
  radioM: number
}): Promise<{ geovalla: GeovallaIot }> {
  return mutarJson('/api/v1/iot/geovallas', 'POST', input)
}

export function actualizarGeovalla(
  id: string,
  cambios: { activa?: boolean; autorizadaSalida?: boolean; nombre?: string }
): Promise<{ geovalla: GeovallaIot }> {
  return mutarJson(`/api/v1/iot/geovallas/${encodeURIComponent(id)}`, 'PATCH', cambios)
}

export function eliminarGeovalla(id: string): Promise<{ ok: boolean }> {
  return mutarJson(`/api/v1/iot/geovallas/${encodeURIComponent(id)}`, 'DELETE')
}

export function analizarMantenimiento(
  bicicletaId: string
): Promise<AnalisisMantenimiento> {
  return mutarJson('/api/v1/iot/mantenimiento/analizar', 'POST', { bicicletaId })
}

export function reportarRoboEnCurso(
  bicicletaId: string,
  autorizo: boolean
): Promise<{
  reportado: boolean
  expediente: string
  posicionCompartida: boolean
}> {
  return mutarJson('/api/v1/iot/robo-en-curso', 'POST', { bicicletaId, autorizo })
}

export function reconocerAlertaIot(alertaId: string): Promise<{ ok: boolean }> {
  return mutarJson('/api/v1/iot/alertas', 'PATCH', { alertaId })
}

// ── Presentacion ───────────────────────────────────────────────────────────────

export const SEVERIDAD_VISUAL: Record<string, string> = {
  baja: 'bg-paper-dim text-slate-warm',
  media: 'bg-amber-100 text-amber-700',
  alta: 'bg-clay/15 text-clay',
  critica: 'bg-clay/20 text-clay',
}

export const TIPO_ALERTA_LABEL: Record<string, string> = {
  geovalla_salida: 'Salió de zona segura',
  mantenimiento_cadena: 'Desgaste de cadena',
  mantenimiento_cubiertas: 'Presión de cubiertas',
  mantenimiento_servicio: 'Servicio técnico',
  robo_en_curso: 'Robo en curso',
  bateria_baja: 'Batería baja',
}
