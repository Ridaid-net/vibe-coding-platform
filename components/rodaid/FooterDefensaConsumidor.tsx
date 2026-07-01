'use client'

import { useState } from 'react'
import { Shield, MessageCircle, Phone, Mail, ExternalLink, ChevronDown, X, AlertTriangle, Headphones } from 'lucide-react'

const CONTACTOS = {
  whatsapp: { numero: '5492617542335', display: '261 754-2335', url: 'https://wa.me/5492617542335' },
  linea: '148',
  ventanilla: 'https://ventanilla.consumidor.gob.ar/',
  correos: [
    { label: 'Mesa de entradas DDC', email: 'mesaentradasddc@mendoza.gov.ar' },
    { label: 'Línea 148 digital', email: '148@mendoza.gov.ar' },
  ],
} as const

function logAccesoDefensa(canal: string, inspeccionId?: string) {
  // ↓ PUNTO DE INTEGRACIÓN — logEvent('ACCESO_DEFENSA_CONSUMIDOR', { usuarioId, inspeccionId, canal })
  console.info('[RODAID Audit]', 'ACCESO_DEFENSA_CONSUMIDOR', { canal, inspeccionId })
}

function CanalesOficiales({ inspeccionId, onClose }: { inspeccionId?: string; onClose: () => void }) {
  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Shield className="size-5 shrink-0 text-[#0F1E35]" />
          <h4 className="font-display text-sm font-bold text-[#0F1E35]">Defensa del Consumidor — Mendoza</h4>
        </div>
        <button onClick={onClose} aria-label="Cerrar" className="rounded-full p-1 text-slate-400 hover:bg-slate-100">
          <X className="size-4" />
        </button>
      </div>
      <p className="mb-4 text-xs text-slate-500">Como usuario/a tenés derecho a acudir a los organismos oficiales de Mendoza para consultas, asesoramiento o denuncias formales.</p>
      <a href={CONTACTOS.whatsapp.url} target="_blank" rel="noopener noreferrer"
        onClick={() => logAccesoDefensa('WHATSAPP_MENDOZA', inspeccionId)}
        className="mb-2 flex items-center gap-3 rounded-xl border border-[#2BBCB8]/30 bg-[#2BBCB8]/5 px-4 py-3 text-sm font-semibold text-[#0F1E35] hover:bg-[#2BBCB8]/10">
        <MessageCircle className="size-4 shrink-0 text-[#2BBCB8]" />
        WhatsApp oficial: {CONTACTOS.whatsapp.display}
        <ExternalLink className="ml-auto size-3.5 text-slate-400" />
      </a>
      <a href={CONTACTOS.ventanilla} target="_blank" rel="noopener noreferrer"
        onClick={() => logAccesoDefensa('VENTANILLA_FEDERAL', inspeccionId)}
        className="mb-2 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-[#0F1E35] hover:bg-slate-100">
        <ExternalLink className="size-4 shrink-0 text-[#F47B20]" />
        Realizar denuncia online — ventanilla.consumidor.gob.ar
        <ExternalLink className="ml-auto size-3.5 text-slate-400" />
      </a>
      <div className="mb-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <Phone className="size-4 shrink-0 text-slate-500" />
        <span className="text-sm text-slate-700">Atención gratuita: <strong className="text-[#0F1E35]">Línea {CONTACTOS.linea}</strong></span>
      </div>
      <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-slate-500">
          <Mail className="size-3.5" /> Correo electrónico
        </div>
        {CONTACTOS.correos.map((c) => (
          <a key={c.email} href={`mailto:${c.email}`}
            onClick={() => logAccesoDefensa('EMAIL_DDC', inspeccionId)}
            className="block text-xs text-[#0F1E35] hover:underline">{c.email}</a>
        ))}
      </div>
      <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <p className="text-xs text-amber-800">
          <strong>Nota:</strong> Los canales de Defensa al Consumidor atienden <em>reclamos administrativos</em>. Si la situación involucra un posible <em>delito penal</em> (fraude, estafa), la vía correcta es el Ministerio Público Fiscal (MPF) de Mendoza.
        </p>
      </div>
    </div>
  )
}

export function FooterDefensaConsumidor({ onAbrirTicket, inspeccionId }: { onAbrirTicket?: () => void; inspeccionId?: string }) {
  const [mostrarCanales, setMostrarCanales] = useState(false)

  return (
    <section aria-label="Centro de Transparencia y Reclamos" className="border-t border-slate-200 bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-1 flex items-center gap-2">
          <Shield className="size-5 text-[#0F1E35]" />
          <h3 className="font-display text-base font-bold text-[#0F1E35]">Centro de Transparencia y Reclamos</h3>
        </div>
        <p className="mb-5 text-xs text-slate-500">En RODAID garantizamos tus derechos como consumidor/a (Ley 24.240). Ante cualquier inconveniente, te recomendamos empezar por nuestro soporte interno.</p>
        <div className="mb-3 rounded-2xl border border-[#0F1E35]/10 bg-white p-4 shadow-sm">
          <div className="mb-1 flex items-center gap-2">
            <Headphones className="size-4 text-[#F47B20]" />
            <span className="text-sm font-bold text-[#0F1E35]">¿Necesitás ayuda técnica?</span>
          </div>
          <p className="mb-3 text-xs text-slate-600">Si tuviste un inconveniente con el taller o con tu certificado, podemos resolverlo nosotros primero.</p>
          <button type="button"
            onClick={() => { logAccesoDefensa('TICKET_INTERNO', inspeccionId); onAbrirTicket?.() }}
            className="inline-flex items-center gap-2 rounded-full bg-[#0F1E35] px-5 py-2 text-xs font-semibold text-white hover:bg-[#0F1E35]/80">
            <Headphones className="size-3.5" /> Abrir Ticket de Soporte RODAID
          </button>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-1 flex items-center gap-2">
            <Shield className="size-4 text-[#2BBCB8]" />
            <span className="text-sm font-bold text-[#0F1E35]">¿Querés realizar un reclamo formal ante el Estado?</span>
          </div>
          <p className="mb-3 text-xs text-slate-600">Como usuario/a tenés derecho a acudir a los organismos oficiales de Mendoza.</p>
          <button type="button" onClick={() => { setMostrarCanales(v => !v); if (!mostrarCanales) logAccesoDefensa('SECCION_EXPANDIDA', inspeccionId) }}
            className="inline-flex items-center gap-2 rounded-full border border-[#2BBCB8] px-5 py-2 text-xs font-semibold text-[#2BBCB8] hover:bg-[#2BBCB8]/5">
            Ver Canales de Defensa al Consumidor
            <ChevronDown className={`size-3.5 transition-transform ${mostrarCanales ? 'rotate-180' : ''}`} />
          </button>
          {mostrarCanales && <CanalesOficiales inspeccionId={inspeccionId} onClose={() => setMostrarCanales(false)} />}
        </div>
        <p className="mt-4 text-center text-[10px] text-slate-400">
          Garantía legal 3 meses (Ley 24.240, Art. 11) · Precios informados antes del pago (Art. 4) · Respuesta en hasta 10 días hábiles
        </p>
      </div>
    </section>
  )
}

export default FooterDefensaConsumidor
