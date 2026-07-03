'use client'

import { useState, useRef, useEffect } from 'react'
import { MessageCircle, X, Send, Headphones, Loader2 } from 'lucide-react'
import { authedFetch } from '@/lib/session'

interface Mensaje {
  id: string
  role: 'user' | 'support'
  texto: string
  timestamp: Date
}

const RESPUESTAS_AUTO: Record<string, string> = {
  default: 'Gracias por contactarnos. Tu mensaje fue recibido y un agente de RODAID te responderá a la brevedad. También podés escribirnos a federicodegeaceo@rodaid.net',
  cit: 'Para consultas sobre el CIT, podés verificar el estado de tu bicicleta en rodaid.net/verificar. Si necesitás renovar, contactá a tu taller aliado más cercano.',
  pago: 'Para consultas sobre pagos o el escrow RODAID PAY, te recomendamos ir a tu Garaje Digital y revisar el estado de la transacción. Si hay un problema, podés abrir una disputa desde el botón correspondiente.',
  hurto: 'Para denunciar una bicicleta hurtada, ingresá a tu cuenta y usá la opción "Denunciar robo" en el Garaje Digital. El trámite tiene un costo de $4.500 ARS.',
  aliado: 'Para sumarte como taller aliado, completá el formulario en rodaid.net/aliados. Te contactaremos dentro de las 48hs hábiles.',
}

function detectarRespuesta(texto: string): string {
  const t = texto.toLowerCase()
  if (t.includes('cit') || t.includes('certificado') || t.includes('verificar')) return RESPUESTAS_AUTO.cit
  if (t.includes('pago') || t.includes('escrow') || t.includes('mercadopago')) return RESPUESTAS_AUTO.pago
  if (t.includes('hurto') || t.includes('robo') || t.includes('robaron')) return RESPUESTAS_AUTO.hurto
  if (t.includes('aliado') || t.includes('taller') || t.includes('sumar')) return RESPUESTAS_AUTO.aliado
  return RESPUESTAS_AUTO.default
}

export function SoporteChat() {
  const [abierto, setAbierto] = useState(false)
  const [mensajes, setMensajes] = useState<Mensaje[]>([
    {
      id: '0',
      role: 'support',
      texto: '¡Hola! Soy el soporte de RODAID. ¿En qué te puedo ayudar hoy?',
      timestamp: new Date(),
    }
  ])
  const [entrada, setEntrada] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [notif, setNotif] = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (abierto) {
      setNotif(0)
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [mensajes, abierto])

  const enviar = async () => {
    const texto = entrada.trim()
    if (!texto || enviando) return
    setEntrada('')
    setEnviando(true)

    const msgUser: Mensaje = { id: Date.now().toString(), role: 'user', texto, timestamp: new Date() }
    setMensajes(prev => [...prev, msgUser])

    // Intentar notificar al admin via API
    try {
      await authedFetch('/api/v1/soporte/mensaje', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto, timestamp: new Date().toISOString() }),
      }).catch(() => undefined)
    } catch { /* silencioso */ }

    // Respuesta automática inteligente
    await new Promise(r => setTimeout(r, 1200))
    const respuesta = detectarRespuesta(texto)
    const msgSupport: Mensaje = {
      id: (Date.now() + 1).toString(),
      role: 'support',
      texto: respuesta,
      timestamp: new Date(),
    }
    setMensajes(prev => [...prev, msgSupport])
    if (!abierto) setNotif(n => n + 1)
    setEnviando(false)
  }

  const formatHora = (d: Date) =>
    d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })

  return (
    <>
      {/* Botón flotante */}
      <button
        type="button"
        onClick={() => setAbierto(v => !v)}
        className="fixed bottom-6 right-6 z-50 flex size-14 items-center justify-center rounded-full bg-[#0F1E35] shadow-lg transition-transform hover:-translate-y-1"
        aria-label="Soporte RODAID"
      >
        {abierto ? (
          <X className="size-6 text-white" />
        ) : (
          <>
            <MessageCircle className="size-6 text-white" />
            {notif > 0 && (
              <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-[#F47B20] text-[10px] font-bold text-white">
                {notif}
              </span>
            )}
          </>
        )}
      </button>

      {/* Panel de chat */}
      {abierto && (
        <div className="fixed bottom-24 right-6 z-50 flex w-80 flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl" style={{ maxHeight: '480px' }}>
          {/* Header */}
          <div className="flex items-center gap-3 rounded-t-2xl bg-[#0F1E35] px-4 py-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-[#2BBCB8]/20">
              <Headphones className="size-5 text-[#2BBCB8]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Soporte RODAID</p>
              <p className="text-xs text-white/60">Respondemos a la brevedad</p>
            </div>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="ml-auto text-white/60 hover:text-white"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Mensajes */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ minHeight: '280px', maxHeight: '320px' }}>
            {mensajes.map(m => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  m.role === 'user'
                    ? 'bg-[#0F1E35] text-white rounded-br-sm'
                    : 'bg-slate-100 text-slate-800 rounded-bl-sm'
                }`}>
                  <p className="leading-relaxed">{m.texto}</p>
                  <p className={`mt-1 text-[10px] ${m.role === 'user' ? 'text-white/50' : 'text-slate-400'}`}>
                    {formatHora(m.timestamp)}
                  </p>
                </div>
              </div>
            ))}
            {enviando && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2">
                  <Loader2 className="size-4 animate-spin text-slate-400" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-slate-100 p-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={entrada}
                onChange={e => setEntrada(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && enviar()}
                placeholder="Escribí tu consulta..."
                className="flex-1 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-800 outline-none focus:border-[#2BBCB8]"
              />
              <button
                type="button"
                onClick={enviar}
                disabled={!entrada.trim() || enviando}
                className="flex size-9 items-center justify-center rounded-full bg-[#0F1E35] text-white disabled:opacity-40"
              >
                <Send className="size-4" />
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-slate-400">
              También escribinos a federicodegeaceo@rodaid.net
            </p>
          </div>
        </div>
      )}
    </>
  )
}

export default SoporteChat
