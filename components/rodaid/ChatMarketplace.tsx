'use client'
import { useState, useRef, useEffect } from 'react'
import { Send, Shield, Lock, MessageCircle, X, ChevronRight, CheckCircle } from 'lucide-react'

interface Mensaje {
  id: string
  role: 'comprador' | 'vendedor'
  texto: string
  timestamp: Date
  leido: boolean
}

interface ChatMarketplaceProps {
  publicacionId: string
  tituloPublicacion: string
  vendedorAlias: string
  citActivo: boolean
  esVendedor: boolean
}

const PATRONES_BLOQUEADOS = [
  /\b(CBU|CVU|alias|transferencia|deposito|efectivo|fuera de la plataforma)\b/gi,
  /\b\d{22}\b/g,
  /mercadopago\.com/gi,
  /whatsapp|wsp|whatapp/gi,
  /te mando|te paso|te envio|pago aparte/gi,
]

function filtrarMensaje(texto: string): { bloqueado: boolean; razon?: string } {
  for (const patron of PATRONES_BLOQUEADOS) {
    if (patron.test(texto)) {
      return { bloqueado: true, razon: 'Por seguridad, las transacciones deben realizarse dentro de RODAID PAY.' }
    }
  }
  return { bloqueado: false }
}

export function ChatMarketplace({
  publicacionId,
  tituloPublicacion,
  vendedorAlias,
  citActivo,
  esVendedor,
}: ChatMarketplaceProps) {
  const [abierto, setAbierto] = useState(false)
  const [mensajes, setMensajes] = useState<Mensaje[]>([
    {
      id: '0',
      role: 'vendedor',
      texto: 'Hola! Soy el vendedor. La bici tiene CIT activo y esta verificada por RODAID. Tenes alguna consulta?',
      timestamp: new Date(),
      leido: true,
    }
  ])
  const [entrada, setEntrada] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [noLeidos, setNoLeidos] = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (abierto) {
      setNoLeidos(0)
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    }
  }, [mensajes, abierto])

  const enviar = async () => {
    const texto = entrada.trim()
    if (!texto || enviando) return
    const { bloqueado, razon } = filtrarMensaje(texto)
    if (bloqueado) {
      setMensajes(prev => [...prev, {
        id: Date.now().toString(),
        role: esVendedor ? 'vendedor' : 'comprador',
        texto: `Mensaje bloqueado: ${razon}`,
        timestamp: new Date(),
        leido: true,
      }])
      setEntrada('')
      return
    }
    setEntrada('')
    setEnviando(true)
    const nuevo: Mensaje = {
      id: Date.now().toString(),
      role: esVendedor ? 'vendedor' : 'comprador',
      texto,
      timestamp: new Date(),
      leido: false,
    }
    setMensajes(prev => {
      const nuevos = [...prev, nuevo]
      if (nuevos.length === 4) {
        nuevos.push({
          id: 'rodaid-pay-reminder',
          role: 'vendedor',
          texto: 'Recordatorio RODAID: Para tu seguridad, realizá el pago exclusivamente a través de RODAID PAY.',
          timestamp: new Date(),
          leido: true,
        })
      }
      return nuevos
    })
    setEnviando(false)
  }

  const formatHora = (d: Date) =>
    d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })

  if (!citActivo) return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-center gap-2">
      <Lock className="size-4 text-slate-400" />
      <p className="text-xs text-slate-warm">El chat se activa solo con bicicletas con CIT verificado.</p>
    </div>
  )

  return (
    <>
      <button type="button" onClick={() => setAbierto(v => !v)}
        className="inline-flex items-center gap-2 rounded-full bg-[#0F1E35] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0F1E35]/80 relative">
        <MessageCircle className="size-4" />
        {esVendedor ? 'Ver mensajes' : `Consultar al vendedor`}
        {noLeidos > 0 && (
          <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-[#F47B20] text-[10px] font-bold">{noLeidos}</span>
        )}
      </button>

      {abierto && (
        <div className="fixed inset-x-4 bottom-24 z-50 mx-auto max-w-sm rounded-2xl border border-slate-200 bg-white shadow-2xl sm:inset-x-auto sm:right-6 sm:w-80">
          <div className="flex items-center gap-3 rounded-t-2xl bg-[#0F1E35] px-4 py-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-[#2BBCB8]/20">
              <Shield className="size-4 text-[#2BBCB8]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">{tituloPublicacion}</p>
              <p className="text-xs text-white/60 flex items-center gap-1">
                <Lock className="size-2.5" /> Chat cifrado · Solo partes verificadas
              </p>
            </div>
            <button type="button" onClick={() => setAbierto(false)} className="text-white/60 hover:text-white">
              <X className="size-4" />
            </button>
          </div>

          <div className="bg-amber-50 px-4 py-2 border-b border-amber-100">
            <p className="text-[11px] text-amber-700 flex items-center gap-1">
              <Shield className="size-3" /> Nunca compartas datos bancarios fuera de RODAID PAY
            </p>
          </div>

          <div className="flex flex-col overflow-y-auto p-4 space-y-3" style={{ minHeight: '240px', maxHeight: '300px' }}>
            {mensajes.map(m => (
              <div key={m.id} className={`flex ${m.role === (esVendedor ? 'vendedor' : 'comprador') ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  m.role === (esVendedor ? 'vendedor' : 'comprador')
                    ? 'bg-[#0F1E35] text-white rounded-br-sm'
                    : 'bg-slate-100 text-slate-800 rounded-bl-sm'
                }`}>
                  <p className="leading-relaxed">{m.texto}</p>
                  <div className={`flex items-center justify-end gap-1 mt-1 ${m.role === (esVendedor ? 'vendedor' : 'comprador') ? 'text-white/50' : 'text-slate-400'}`}>
                    <span className="text-[10px]">{formatHora(m.timestamp)}</span>
                    {m.leido && <CheckCircle className="size-2.5" />}
                  </div>
                </div>
              </div>
            ))}
            {enviando && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2">
                  <div className="flex gap-1">
                    <span className="size-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="size-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="size-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-slate-100 p-3">
            <div className="flex gap-2">
              <input type="text" value={entrada} onChange={e => setEntrada(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && enviar()}
                placeholder="Escribi tu consulta..."
                className="flex-1 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-800 outline-none focus:border-[#2BBCB8]" />
              <button type="button" onClick={enviar} disabled={!entrada.trim() || enviando}
                className="flex size-9 items-center justify-center rounded-full bg-[#0F1E35] text-white disabled:opacity-40">
                <Send className="size-4" />
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-slate-400 flex items-center justify-center gap-1">
              <Shield className="size-2.5" /> Transaccion protegida por RODAID PAY <ChevronRight className="size-2.5" />
            </p>
          </div>
        </div>
      )}
    </>
  )
}
