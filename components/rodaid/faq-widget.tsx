'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  HelpCircle,
  Loader2,
  Lock,
  MapPin,
  Scale,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import { Streamdown } from 'streamdown'
import { consultarFaqStream, contextoDePagina, type TurnoChat } from '@/lib/faq'

/**
 * Asistente de Soporte Técnico y Legal de RODAID — widget FLOTANTE del Footer.
 *
 * Se monta una sola vez (en el layout raíz) y vive como un botón flotante que
 * abre un panel de chat sin interrumpir la navegación. Se abre tanto desde su
 * propio botón como desde el enlace del Footer ("¿Dudas sobre RODAID?"), que
 * dispara el evento `rodaid:abrir-faq`.
 *
 * Pasa al backend el CONTEXTO DINÁMICO de la página (ruta y, si corresponde, el
 * número de serie/CIT) para que el asistente interprete mejor las consultas.
 * Consume el endpoint público `/api/faq/consulta` con streaming SSE.
 */

export const EVENTO_ABRIR_FAQ = 'rodaid:abrir-faq'

interface Mensaje {
  role: 'user' | 'assistant'
  content: string
  cacheHit?: boolean
}

const SUGERENCIAS = [
  { icon: ShieldCheck, texto: '¿Qué validez legal tiene el certificado de mi bici?' },
  { icon: Scale, texto: '¿Cómo se garantiza la validez del registro en RODAID?' },
  { icon: Lock, texto: '¿Cómo protegen mi seguridad y la de mis pagos?' },
  { icon: MapPin, texto: '¿Qué hacen con mis datos y mi ubicación?' },
]

export function FaqWidget() {
  const [abierto, setAbierto] = useState(false)
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [entrada, setEntrada] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const finRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const pathname = usePathname()

  // Apertura desde el enlace del Footer (evento global) + tecla Escape para cerrar.
  useEffect(() => {
    const abrir = () => setAbierto(true)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false)
    }
    window.addEventListener(EVENTO_ABRIR_FAQ, abrir)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener(EVENTO_ABRIR_FAQ, abrir)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    if (abierto) finRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensajes, enviando, abierto])

  useEffect(() => {
    if (abierto) setTimeout(() => inputRef.current?.focus(), 60)
  }, [abierto])

  const enviar = useCallback(
    async (texto: string) => {
      const pregunta = texto.trim()
      if (!pregunta || enviando) return
      setError(null)
      setEnviando(true)

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

      const pagina = contextoDePagina(pathname || '/')
      let acumulado = ''
      try {
        await consultarFaqStream(pregunta, historial, pagina, {
          onMeta: (meta) => {
            if (meta.cacheHit) setMensajes((prev) => marcarUltimo(prev, { cacheHit: true }))
          },
          onDelta: (delta) => {
            acumulado += delta
            setMensajes((prev) => marcarUltimo(prev, { content: acumulado }))
          },
          onError: (mensaje) => {
            setError(mensaje)
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
    },
    [enviando, mensajes, pathname]
  )

  return (
    <>
      {/* Botón flotante de activación */}
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-label="Abrir ayuda experta de RODAID"
        aria-expanded={abierto}
        className="fixed bottom-5 right-20 z-50 inline-flex items-center gap-2 rounded-full bg-ink px-4 py-3 text-sm font-semibold text-paper shadow-lg shadow-ink/25 transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-lime sm:bottom-6 sm:right-24"
      >
        {abierto ? <X className="size-5" /> : <HelpCircle className="size-5 text-lime" />}
        <span className="hidden sm:inline">{abierto ? 'Cerrar' : 'Ayuda Experta'}</span>
      </button>

      {/* Panel del asistente */}
      {abierto && (
        <div
          role="dialog"
          aria-label="Asistente de soporte de RODAID"
          className="fixed bottom-20 right-3 z-50 flex max-h-[min(78vh,640px)] w-[calc(100vw-1.5rem)] max-w-[420px] flex-col overflow-hidden rounded-3xl border border-ink/12 bg-white shadow-2xl shadow-ink/25 sm:bottom-24 sm:right-24"
        >
          {/* Encabezado */}
          <header className="flex items-center justify-between gap-3 border-b border-ink/10 bg-ink px-5 py-4 text-paper">
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-lime/20 text-lime">
                <ShieldCheck className="size-5" />
              </span>
              <div>
                <h2 className="text-sm font-semibold leading-tight">¿Dudas sobre RODAID?</h2>
                <p className="text-xs text-paper/60">Soporte técnico y legal · FAQ</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              aria-label="Cerrar"
              className="rounded-full p-1 text-paper/70 transition-colors hover:bg-paper/10 hover:text-paper"
            >
              <X className="size-5" />
            </button>
          </header>

          {/* Conversación */}
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {mensajes.length === 0 && (
              <div className="space-y-4">
                <p className="text-sm text-slate-warm">
                  Soy el asistente de soporte de RODAID. Preguntame por la validez legal
                  del CIT y los certificados, la seguridad de la plataforma, la
                  privacidad de tus datos o cómo funciona el ecosistema.
                </p>
                <div className="grid gap-2">
                  {SUGERENCIAS.map(({ icon: Icon, texto }) => (
                    <button
                      key={texto}
                      onClick={() => enviar(texto)}
                      disabled={enviando}
                      className="inline-flex items-center gap-2.5 rounded-2xl border border-ink/12 bg-paper px-3.5 py-2.5 text-left text-sm text-ink transition-colors hover:border-lime-deep/50 hover:bg-lime/10 disabled:opacity-50"
                    >
                      <Icon className="size-4 shrink-0 text-lime-deep" />
                      {texto}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mensajes.map((m, i) => (
              <Burbuja
                key={i}
                mensaje={m}
                pensando={
                  enviando &&
                  i === mensajes.length - 1 &&
                  m.role === 'assistant' &&
                  !m.content
                }
              />
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
            className="flex items-end gap-2 border-t border-ink/10 px-3 py-3"
          >
            <textarea
              ref={inputRef}
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
              className="max-h-28 min-h-[42px] flex-1 resize-none rounded-2xl border border-ink/15 bg-paper px-3.5 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-slate-warm/70 focus:border-lime-deep/60 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={enviando || !entrada.trim()}
              className="inline-flex size-[42px] shrink-0 items-center justify-center rounded-2xl bg-ink text-paper transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40"
              aria-label="Enviar consulta"
            >
              {enviando ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <Send className="size-5" />
              )}
            </button>
          </form>
          <p className="px-4 pb-3 text-[11px] leading-snug text-slate-warm/80">
            Respondo sobre el ecosistema RODAID. No brindo asesoramiento legal definitivo
            ni accedo a datos personales de tu cuenta.
          </p>
        </div>
      )}
    </>
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
            ? 'max-w-[85%] rounded-2xl rounded-br-md bg-ink px-3.5 py-2.5 text-sm text-paper'
            : 'max-w-[92%] rounded-2xl rounded-bl-md border border-ink/10 bg-paper px-3.5 py-3 text-sm text-ink'
        }
      >
        {esUsuario ? (
          <p className="whitespace-pre-wrap">{mensaje.content}</p>
        ) : pensando ? (
          <span className="inline-flex items-center gap-2 text-slate-warm">
            <Loader2 className="size-4 animate-spin" />
            Buscando en la base de conocimiento…
          </span>
        ) : (
          <div className="prose-rodaid">
            <Streamdown>{mensaje.content}</Streamdown>
            {mensaje.cacheHit && (
              <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-lime/20 px-2 py-0.5 text-[11px] font-medium text-lime-deep">
                <Sparkles className="size-3" /> respuesta frecuente
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
