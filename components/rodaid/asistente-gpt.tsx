'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bot, Loader2, Send, ShieldCheck, Sparkles, Zap } from 'lucide-react'
import { Streamdown } from 'streamdown'
import {
  consultarGptStream,
  type EstadoCuota,
  type TurnoChat,
} from '@/lib/asistente'

/**
 * RODAID-GPT (Hito 15) — interfaz de chat del asistente experto en seguridad y
 * gestión ciclista. Consume el endpoint seguro `/api/gpt/consulta` con streaming
 * SSE: la respuesta aparece token a token. Mantiene la identidad visual
 * "Bianco Sport" de RODAID.
 */

interface Mensaje {
  role: 'user' | 'assistant'
  content: string
  cacheHit?: boolean
  /** TEMPORAL (diagnostico 2026-07-16): piezas del contexto que usaron su valor de respaldo. */
  piezasConTimeout?: string[]
  /** TEMPORAL (diagnostico 2026-07-16): piezas del contexto que fallaron con un error. */
  piezasConError?: string[]
}

const SUGERENCIAS = [
  {
    icon: ShieldCheck,
    texto: '¿Qué tan segura es mi zona para andar en bici?',
  },
  {
    icon: Bot,
    texto: '¿Cómo está el estado del CIT de mi bicicleta?',
  },
  {
    icon: Sparkles,
    texto: '¿Qué me conviene hacer antes de vender mi rodado?',
  },
]

export function AsistenteGpt() {
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [entrada, setEntrada] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cuota, setCuota] = useState<EstadoCuota | null>(null)
  const finRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensajes, enviando])

  const enviar = async (texto: string) => {
    const pregunta = texto.trim()
    if (!pregunta || enviando) return
    setError(null)
    setEnviando(true)

    // Historial para el modelo (lo previo, sin la pregunta nueva).
    const historial: TurnoChat[] = mensajes.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    setEntrada('')
    setMensajes((prev) => [
      ...prev,
      { role: 'user', content: pregunta },
      { role: 'assistant', content: '' },
    ])

    let acumulado = ''
    try {
      await consultarGptStream(pregunta, historial, {
        onMeta: (meta) => {
          setCuota(meta.cuota)
          if (meta.cacheHit) {
            setMensajes((prev) => marcarUltimo(prev, { cacheHit: true }))
          }
          if (meta.piezasConTimeout?.length || meta.piezasConError?.length) {
            setMensajes((prev) =>
              marcarUltimo(prev, {
                piezasConTimeout: meta.piezasConTimeout,
                piezasConError: meta.piezasConError,
              })
            )
          }
        },
        onDelta: (delta) => {
          acumulado += delta
          setMensajes((prev) => marcarUltimo(prev, { content: acumulado }))
        },
        onError: (mensaje) => {
          setError(mensaje)
          // Quita el placeholder del asistente si nunca recibió texto.
          setMensajes((prev) =>
            acumulado ? prev : prev.filter((_, i) => i !== prev.length - 1)
          )
        },
      })
    } catch {
      setError('No pudimos contactar al asistente. Revisá tu conexión e intentá de nuevo.')
      setMensajes((prev) =>
        acumulado ? prev : prev.filter((_, i) => i !== prev.length - 1)
      )
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="rounded-3xl border border-ink/12 bg-white">
      {/* Encabezado */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/10 px-6 py-5">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-lime/25 text-lime-deep">
            <Bot className="size-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-ink">RODAID-GPT</h2>
            <p className="text-sm text-slate-warm">
              Tu asistente de seguridad y gestión ciclista
            </p>
          </div>
        </div>
        {cuota && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-paper-dim px-3 py-1 text-xs font-medium text-slate-warm">
            <Zap className="size-3.5" />
            {cuota.restantes}/{cuota.limite} consultas este mes
          </span>
        )}
      </header>

      {/* Conversación */}
      <div className="max-h-[60vh] min-h-[260px] space-y-5 overflow-y-auto px-6 py-6">
        {mensajes.length === 0 && (
          <div className="space-y-4">
            <p className="text-sm text-slate-warm">
              Preguntame sobre la seguridad de tu zona (uso el mapa de calor de
              RODAID) o sobre el estado de tu bicicleta y su CIT. Solo respondo
              con los datos de tu cuenta.
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGERENCIAS.map(({ icon: Icon, texto }) => (
                <button
                  key={texto}
                  onClick={() => enviar(texto)}
                  disabled={enviando}
                  className="inline-flex items-center gap-2 rounded-full border border-ink/12 bg-paper px-3.5 py-2 text-sm text-ink transition-colors hover:border-lime-deep/50 hover:bg-lime/10 disabled:opacity-50"
                >
                  <Icon className="size-4 text-lime-deep" />
                  {texto}
                </button>
              ))}
            </div>
          </div>
        )}

        {mensajes.map((m, i) => (
          <Burbuja key={i} mensaje={m} pensando={enviando && i === mensajes.length - 1 && m.role === 'assistant' && !m.content} />
        ))}

        {error && (
          <p className="rounded-2xl border border-clay/30 bg-clay/10 px-4 py-3 text-sm text-clay">
            {error}
          </p>
        )}
        <div ref={finRef} />
      </div>

      {/* Entrada */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          enviar(entrada)
        }}
        className="flex items-end gap-2 border-t border-ink/10 px-4 py-4 sm:px-6"
      >
        <textarea
          value={entrada}
          onChange={(e) => setEntrada(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              enviar(entrada)
            }
          }}
          rows={1}
          placeholder="Escribí tu consulta…"
          disabled={enviando}
          className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-ink/15 bg-paper px-4 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-slate-warm/70 focus:border-lime-deep/60 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={enviando || !entrada.trim()}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-ink text-paper transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40"
          aria-label="Enviar consulta"
        >
          {enviando ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <Send className="size-5" />
          )}
        </button>
      </form>
      <p className="px-6 pb-4 text-xs text-slate-warm/80">
        Tus datos personales se anonimizan antes de procesar la consulta. RODAID-GPT
        no brinda asesoramiento legal definitivo.
      </p>
    </section>
  )
}

function marcarUltimo(prev: Mensaje[], patch: Partial<Mensaje>): Mensaje[] {
  if (prev.length === 0) return prev
  const copia = prev.slice()
  copia[copia.length - 1] = { ...copia[copia.length - 1], ...patch }
  return copia
}

function Burbuja({ mensaje, pensando }: { mensaje: Mensaje; pensando: boolean }) {
  const esUsuario = mensaje.role === 'user'
  return (
    <div className={esUsuario ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={
          esUsuario
            ? 'max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-sm text-paper'
            : 'max-w-[90%] rounded-2xl rounded-bl-md border border-ink/10 bg-paper px-4 py-3 text-sm text-ink'
        }
      >
        {esUsuario ? (
          <p className="whitespace-pre-wrap">{mensaje.content}</p>
        ) : pensando ? (
          <span className="inline-flex items-center gap-2 text-slate-warm">
            <Loader2 className="size-4 animate-spin" />
            Consultando tus datos…
          </span>
        ) : (
          <div className="prose-rodaid">
            <Streamdown>{mensaje.content}</Streamdown>
            {mensaje.cacheHit && (
              <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-lime/20 px-2 py-0.5 text-[11px] font-medium text-lime-deep">
                <Zap className="size-3" /> respuesta en caché
              </span>
            )}
            {(mensaje.piezasConTimeout?.length || mensaje.piezasConError?.length) && (
              <span className="mt-2 flex items-start gap-1 rounded-xl bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-800">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                <span>
                  [DEBUG TEMPORAL] contexto parcial —
                  {mensaje.piezasConTimeout?.length
                    ? ` timeout: ${mensaje.piezasConTimeout.join(', ')}.`
                    : ''}
                  {mensaje.piezasConError?.length
                    ? ` error: ${mensaje.piezasConError.join(', ')}.`
                    : ''}
                </span>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
