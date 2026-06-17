'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  Clock,
  FileSignature,
  Gavel,
  Loader2,
  Lock,
  Scale,
  Send,
  Sparkles,
  X,
} from 'lucide-react'
import { Streamdown } from 'streamdown'
import { consultarLegalStream, contextoDePagina, type TurnoChat } from '@/lib/legal'

/**
 * Asistente Oficial de Soporte y Consultoría Legal de RODAID — panel flotante.
 *
 * Se monta una sola vez (en el layout raíz) pero, a diferencia del widget de FAQ,
 * NO tiene botón flotante propio: se abre EXCLUSIVAMENTE por evento global
 * (`rodaid:abrir-consultoria-legal`), disparado desde el Footer, la página de
 * Términos o el formulario de carga. El evento puede traer una consulta semilla
 * (`detail.seed`) que se pre-carga en el input (p. ej. sobre la Declaración
 * Jurada de Licitud cuando el usuario está cargando una bici).
 *
 * Pasa al backend el CONTEXTO DINÁMICO de la página (la URL y si está en el
 * formulario de carga) para que el asistente anticipe dudas. Consume el endpoint
 * público `/api/legal/consulta` con streaming SSE.
 */

export const EVENTO_ABRIR_LEGAL = 'rodaid:abrir-consultoria-legal'

/** Abre el asistente legal desde cualquier parte; opcionalmente con una semilla. */
export function abrirConsultoriaLegal(seed?: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(EVENTO_ABRIR_LEGAL, { detail: seed ? { seed } : undefined })
  )
}

interface Mensaje {
  role: 'user' | 'assistant'
  content: string
  cacheHit?: boolean
}

const SUGERENCIAS = [
  { icon: Clock, texto: '¿Por qué no tengo mi CIT de inmediato?' },
  { icon: FileSignature, texto: '¿Qué es la Declaración Jurada de Licitud?' },
  { icon: Lock, texto: '¿Cómo tratan mis datos personales?' },
  { icon: Scale, texto: '¿RODAID funciona como un seguro de mi bici?' },
]

export function ConsultoriaLegalWidget() {
  const [abierto, setAbierto] = useState(false)
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [entrada, setEntrada] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const finRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const pathname = usePathname()

  // Apertura por evento global (Footer / Términos / formulario de carga) + Escape.
  useEffect(() => {
    const abrir = (e: Event) => {
      setAbierto(true)
      const seed = (e as CustomEvent<{ seed?: string }>).detail?.seed
      if (seed) setEntrada(seed)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setAbierto(false)
    }
    window.addEventListener(EVENTO_ABRIR_LEGAL, abrir)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener(EVENTO_ABRIR_LEGAL, abrir)
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
        await consultarLegalStream(pregunta, historial, pagina, {
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

  if (!abierto) return null

  return (
    <div
      role="dialog"
      aria-label="Asistente Oficial de Soporte y Consultoría Legal de RODAID"
      className="fixed bottom-3 right-3 z-[60] flex max-h-[min(82vh,660px)] w-[calc(100vw-1.5rem)] max-w-[440px] flex-col overflow-hidden rounded-3xl border border-ink/12 bg-white shadow-2xl shadow-ink/25 sm:bottom-6 sm:right-6"
    >
      {/* Encabezado */}
      <header className="flex items-center justify-between gap-3 border-b border-ink/10 bg-ink px-5 py-4 text-paper">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-lime/20 text-lime">
            <Gavel className="size-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold leading-tight">Consultoría Legal RODAID</h2>
            <p className="text-xs text-paper/60">Términos · Protocolo CIT · Seguridad</p>
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
              Soy el asistente oficial de soporte y consultoría legal de RODAID.
              Respondo exclusivamente sobre los Términos y Condiciones, el Protocolo
              de Emisión del CIT y la normativa de seguridad. Consultame sobre la
              validación, tus derechos y obligaciones.
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
          placeholder="Escribí tu consulta legal…"
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
        Respondo sobre los protocolos y términos de uso de RODAID. No brindo
        asesoramiento legal definitivo que reemplace a un profesional.
      </p>
    </div>
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
            Consultando los Términos y el Protocolo del CIT…
          </span>
        ) : (
          <div className="prose-rodaid">
            <Streamdown>{mensaje.content}</Streamdown>
            {mensaje.cacheHit && (
              <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-lime/20 px-2 py-0.5 text-[11px] font-medium text-lime-deep">
                <Sparkles className="size-3" /> consulta frecuente
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
