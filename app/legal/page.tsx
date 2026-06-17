'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

interface ConsultaResponse {
  respuesta?: string
  modelo?: string
  fromCache?: boolean
  context?: string
  error?: string
  message?: string
}

const PREGUNTAS_FRECUENTES = [
  '¿Cómo funciona el proceso de las 72 horas hábiles del CIT?',
  '¿Qué pasa si registro un rodado con datos falsos?',
  '¿Qué hacen con mis datos personales?',
  '¿RODAID me cubre si me roban la bicicleta?',
]

export default function LegalPage() {
  const [pregunta, setPregunta] = useState('')
  const [respuesta, setRespuesta] = useState<string | null>(null)
  const [meta, setMeta] = useState<ConsultaResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function consultar(texto: string) {
    const value = texto.trim()
    if (!value || loading) return

    setLoading(true)
    setError(null)
    setRespuesta(null)
    setMeta(null)

    try {
      const res = await fetch('/api/legal/consulta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pregunta: value,
          url: typeof window !== 'undefined' ? window.location.href : null,
        }),
      })

      const data = (await res.json()) as ConsultaResponse

      if (!res.ok || !data.respuesta) {
        setError(
          data.message ?? 'No se pudo procesar la consulta. Intente nuevamente.'
        )
        return
      }

      setRespuesta(data.respuesta)
      setMeta(data)
    } catch {
      setError('Error de conexión con el servicio de consultas.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2 border-b border-border pb-6">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          RODAID · En colaboración con el Ministerio de Seguridad de Mendoza
        </span>
        <h1 className="text-2xl font-semibold text-foreground">
          Asistente de Soporte y Consultoría Legal
        </h1>
        <p className="text-sm text-muted-foreground">
          Consultas sobre Términos y Condiciones, Protocolo del CIT, Protección
          de Datos y Régimen Sancionatorio. Las respuestas citan las cláusulas
          aplicables del corpus legal de RODAID.
        </p>
      </header>

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          consultar(pregunta)
        }}
      >
        <textarea
          value={pregunta}
          onChange={(event) => setPregunta(event.target.value)}
          placeholder="Escriba su consulta legal…"
          rows={4}
          maxLength={2000}
          className="w-full resize-y rounded-md border border-border bg-background p-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {pregunta.length}/2000
          </span>
          <Button type="submit" disabled={loading || !pregunta.trim()}>
            {loading ? 'Consultando…' : 'Consultar'}
          </Button>
        </div>
      </form>

      <section className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Preguntas frecuentes
        </span>
        <div className="flex flex-wrap gap-2">
          {PREGUNTAS_FRECUENTES.map((q) => (
            <Button
              key={q}
              type="button"
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => {
                setPregunta(q)
                consultar(q)
              }}
            >
              {q}
            </Button>
          ))}
        </div>
      </section>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {respuesta && (
        <article className="flex flex-col gap-3 rounded-md border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              Respuesta institucional
            </span>
            {meta?.fromCache && (
              <span className="rounded-sm bg-secondary px-2 py-0.5 text-secondary-foreground">
                respuesta en caché
              </span>
            )}
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {respuesta}
          </p>
        </article>
      )}

      <footer className="mt-auto border-t border-border pt-4 text-xs text-muted-foreground">
        RODAID es una herramienta de registro y prevención, no una compañía de
        seguros. La información se comparte exclusivamente con las fuerzas
        policiales para la prevención del delito (Ley 25.326).
      </footer>
    </main>
  )
}
