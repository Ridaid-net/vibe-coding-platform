'use client'

import { AlertTriangle, Mail } from 'lucide-react'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type EstadoTransaccion =
  | 'DEPOSITO_PENDIENTE'
  | 'FONDOS_RETENIDOS'
  | 'EN_ESPERA_DE_LIBERACION'
  | 'DISPUTA_ACTIVA'
  | 'EN_CAMINO'
  | 'COMPLETADA'
  | 'REEMBOLSADA'

export interface Disputa {
  id: string
  transaccionId: string
  estado: 'ABIERTA' | 'EN_REVISION' | 'RESUELTA'
  evidenciaComprador: string[]
  resolucion: 'FAVOR_COMPRADOR' | 'FAVOR_VENDEDOR' | null
}

interface Props {
  transaccionId: string
  estadoTransaccion: EstadoTransaccion
  disputaActiva?: Disputa | null
  onDisputaAbierta?: () => void
}

const EMAIL_SOPORTE = 'federicodegeaceo@rodaid.net'

/**
 * Honestidad de estado (2026-07-12): este componente llamaba a
 * POST /api/v1/disputas/abrir, un endpoint que nunca existio -- cualquier
 * intento real de "Confirmar Disputa" tiraba un 404 silencioso, mostrado
 * como si fuera un glitch transitorio. Mismo criterio que el fix del badge
 * BFA del mismo dia: mientras el mecanismo real de disputas de CIT Completo
 * no este construido (ver Esquemas 1-4 en CLAUDE.md), no se ofrece un boton
 * que promete algo que no pasa -- se deriva a contacto directo.
 */
export function BotonDisputa({ estadoTransaccion }: Props) {
  if (estadoTransaccion !== 'EN_ESPERA_DE_LIBERACION' && estadoTransaccion !== 'DISPUTA_ACTIVA') {
    return null
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5">
      <p className="flex items-center gap-2 text-xs font-semibold text-amber-800">
        <AlertTriangle className="size-4" />
        ¿Problema con esta compra?
      </p>
      <p className="mt-1 text-xs leading-relaxed text-amber-700">
        Disculpá las molestias — el sitio está en desarrollo y el mecanismo de disputas para este tipo de operación todavía no está terminado. Para cualquier reclamo urgente, escribinos directamente y lo resolvemos con vos.
      </p>
      <a
        href={`mailto:${EMAIL_SOPORTE}`}
        className="mt-2.5 inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-white px-4 py-2 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100"
      >
        <Mail className="size-3.5" />
        {EMAIL_SOPORTE}
      </a>
    </div>
  )
}

export default BotonDisputa
