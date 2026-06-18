// ─── RODAID · Servicio de Hash SHA-256 ───────────────────
import crypto from 'crypto'
import { CITPayload } from '../types'

// Genera el hash SHA-256 canónico del payload del CIT
// El orden de los campos es fijo para garantizar reproducibilidad
export function hashCITPayload(payload: CITPayload): string {
  const canonical = JSON.stringify({
    numeroSerie:       payload.numeroSerie,
    marca:             payload.marca,
    modelo:            payload.modelo,
    anio:              payload.anio,
    tipo:              payload.tipo,
    propietarioDNI:    payload.propietarioDNI,
    propietarioNombre: payload.propietarioNombre,
    inspectorId:       payload.inspectorId,
    tallerAliadoId:    payload.tallerAliadoId,
    puntos:            payload.puntos,
    timestamp:         payload.timestamp,
    ley:               payload.ley,
  })
  return '0x' + crypto.createHash('sha256').update(canonical, 'utf8').digest('hex')
}

// Verifica que un hash corresponde a un payload
export function verifyHash(payload: CITPayload, hashEsperado: string): boolean {
  return hashCITPayload(payload) === hashEsperado
}

// Genera número de CIT: RCIT-YYYY-XXXXX
export function generarNumeroCIT(): string {
  const year = new Date().getFullYear()
  const seq  = Math.floor(Math.random() * 99999).toString().padStart(5, '0')
  return `RCIT-${year}-${seq}`
}
