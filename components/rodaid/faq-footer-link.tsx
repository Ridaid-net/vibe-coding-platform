'use client'

import { HelpCircle } from 'lucide-react'
import { EVENTO_ABRIR_FAQ } from './faq-widget'

/**
 * Enlace del Footer que abre el Asistente de Soporte (FAQ) flotante. El widget
 * se monta una sola vez en el layout raíz y escucha el evento `rodaid:abrir-faq`;
 * este enlace lo dispara, de modo que el usuario abre la ayuda sin perder la
 * página en la que está.
 */
export function FaqFooterLink() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(EVENTO_ABRIR_FAQ))}
      className="inline-flex items-center gap-1.5 transition-colors hover:text-lime"
    >
      <HelpCircle className="size-3.5" />
      ¿Dudas sobre RODAID?
    </button>
  )
}
