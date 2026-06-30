'use client'

import { Gavel } from 'lucide-react'
import { abrirConsultoriaLegal } from './consultoria-legal-widget'

/**
 * Disparadores del Asistente Oficial de Soporte y Consultoría Legal. El widget
 * se monta una sola vez en el layout raíz y escucha el evento global; estos
 * botones lo abren (opcionalmente con una consulta semilla) sin que el usuario
 * pierda la página en la que está.
 */

/** Variante de botón sólido (CTA), p. ej. para la página de Términos. */
export function ConsultoriaLegalBoton({
  seed,
  label = 'Abrir Consultoría Legal',
}: {
  seed?: string
  label?: string
}) {
  return (
    <button
      type="button"
      onClick={() => abrirConsultoriaLegal(seed)}
      className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
    >
      <Gavel className="size-4 text-lime" />
      {label}
    </button>
  )
}

/** Variante de enlace discreto, p. ej. para el Footer. */
export function ConsultoriaLegalEnlace() {
  return (
    <button
      type="button"
      onClick={() => abrirConsultoriaLegal()}
      className="inline-flex items-center gap-1.5 transition-colors hover:text-lime"
    >
      <Gavel className="size-3.5" />
      Consultoría Legal
    </button>
  )
}
