'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Bike,
  ImagePlus,
  Loader2,
  ShieldCheck,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { authedFetch } from '@/lib/session'
import { parseApiError } from '@/lib/api-errors'
import {
  validarPublicarForm,
  type PublicarFormErrors,
} from '@/lib/publicar-schema'
import { etiquetaBici, type BicicletaGaraje } from '@/lib/garaje'
import { RodaidPayBadge } from './rodaid-pay-badge'

interface Draft {
  titulo: string
  descripcion: string
  precioARS: string
  precioUSD: string
}

const draftKey = (biciId: string) => `rodaid.publicar.draft.${biciId}`

/**
 * PublicarForm — paso 2 del flujo de publicacion.
 *
 * Formulario con feedback inteligente: validacion en tiempo real con Zod en el
 * cliente (ahorra llamadas al backend), carga de foto multipart con estado de
 * carga visible, traduccion de los errores de negocio del backend (400/403/409)
 * a mensajes amigables via Toast, y boton de "Publicar" que se deshabilita al
 * instante para evitar peticiones duplicadas.
 *
 * Persistencia: lo que el usuario va cargando se guarda en localStorage por
 * bicicleta, de modo que si va a "Mi Garaje" a verificar y vuelve, no pierde lo
 * escrito.
 */
export function PublicarForm({
  bici,
  onVolver,
}: {
  bici: BicicletaGaraje
  onVolver: () => void
}) {
  const router = useRouter()

  const [titulo, setTitulo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [precioARS, setPrecioARS] = useState('')
  const [precioUSD, setPrecioUSD] = useState('')
  const [foto, setFoto] = useState<File | null>(null)
  const [fotoPreview, setFotoPreview] = useState<string | null>(null)

  const [errores, setErrores] = useState<PublicarFormErrors>({})
  const [enviando, setEnviando] = useState(false)
  const [hidratado, setHidratado] = useState(false)
  const fotoInputRef = useRef<HTMLInputElement | null>(null)

  // Restaura el borrador guardado para esta bici (si existe) al montar.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftKey(bici.id))
      if (raw) {
        const d = JSON.parse(raw) as Partial<Draft>
        setTitulo(d.titulo ?? '')
        setDescripcion(d.descripcion ?? '')
        setPrecioARS(d.precioARS ?? '')
        setPrecioUSD(d.precioUSD ?? '')
      }
    } catch {
      // Borrador corrupto: se ignora.
    }
    setHidratado(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bici.id])

  // Persiste el borrador ante cada cambio (la foto no es serializable).
  useEffect(() => {
    if (!hidratado) return
    const draft: Draft = { titulo, descripcion, precioARS, precioUSD }
    try {
      window.localStorage.setItem(draftKey(bici.id), JSON.stringify(draft))
    } catch {
      // Sin localStorage disponible: seguimos sin persistir.
    }
  }, [hidratado, bici.id, titulo, descripcion, precioARS, precioUSD])

  // Genera/limpia la previsualizacion de la foto seleccionada.
  useEffect(() => {
    if (!foto) {
      setFotoPreview(null)
      return
    }
    const url = URL.createObjectURL(foto)
    setFotoPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [foto])

  const valores = useMemo(
    () => ({
      titulo,
      descripcion,
      precioARS: precioARS.trim() === '' ? null : Number(precioARS),
      precioUSD: precioUSD.trim() === '' ? null : Number(precioUSD),
    }),
    [titulo, descripcion, precioARS, precioUSD]
  )

  // Validacion en tiempo real una vez que el usuario empezo a tocar campos.
  const revalidar = () => {
    setErrores(validarPublicarForm(valores))
  }

  const elegirFoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    if (file && file.size > 8 * 1024 * 1024) {
      toast.error('La foto es muy grande', {
        description: 'Elegí una imagen de hasta 8 MB.',
      })
      return
    }
    setFoto(file)
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Deshabilita de inmediato para evitar envios duplicados.
    if (enviando) return

    const erroresValidacion = validarPublicarForm(valores)
    setErrores(erroresValidacion)
    if (Object.keys(erroresValidacion).length > 0) {
      toast.error('Revisá los datos del formulario', {
        description: 'Hay campos que necesitan tu atención.',
      })
      return
    }

    setEnviando(true)
    try {
      const form = new FormData()
      form.set('bicicletaId', bici.id)
      form.set('titulo', titulo.trim())
      form.set('descripcion', descripcion.trim())
      form.set('precioARS', String(valores.precioARS))
      if (valores.precioUSD != null) {
        form.set('precioUSD', String(valores.precioUSD))
      }
      if (foto) {
        form.set('foto', foto)
      }

      const res = await authedFetch('/api/v1/marketplace/publicar', {
        method: 'POST',
        body: form,
      })

      if (!res.ok) {
        const info = await parseApiError(res)
        // El 400 suele ser de datos: lo reflejamos tambien junto al formulario.
        if (info.status === 400) {
          setErrores(validarPublicarForm(valores))
        }
        toast.error('No pudimos publicar tu bici', {
          description: info.message,
        })
        setEnviando(false)
        return
      }

      const data = (await res.json()) as { publicacion: { id: string } }

      // Publicada: limpiamos el borrador y llevamos a la publicacion nueva.
      try {
        window.localStorage.removeItem(draftKey(bici.id))
      } catch {
        // ignorar
      }
      toast.success('¡Tu bici está publicada!', {
        description: 'Ya aparece en el marketplace con protección RODAID PAY.',
      })
      router.push(`/marketplace/${data.publicacion.id}`)
    } catch {
      toast.error('No pudimos publicar tu bici', {
        description: 'Revisá tu conexión e intentá nuevamente.',
      })
      setEnviando(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onVolver}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-warm transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-4" />
        Cambiar de bicicleta
      </button>

      {/* Bici seleccionada */}
      <div className="mt-4 flex items-center gap-4 rounded-2xl border border-ink/12 bg-white p-4">
        <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-paper-dim text-ink/30">
          {bici.fotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={bici.fotoUrl}
              alt={etiquetaBici(bici)}
              className="h-full w-full object-cover"
            />
          ) : (
            <Bike className="size-6" />
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate font-display font-semibold text-ink">
            {etiquetaBici(bici)}
          </p>
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-lime/25 px-2 py-0.5 text-[11px] font-semibold text-ink">
            <ShieldCheck className="size-3" />
            CIT verificada
          </span>
        </div>
      </div>

      <h2 className="mt-8 font-display text-2xl font-bold tracking-tight text-ink">
        Datos de la publicación
      </h2>

      <form onSubmit={onSubmit} className="mt-5 space-y-5" noValidate>
        <Field
          label="Título"
          hint="Ej: Mountain bike Trek Marlin 7 rodado 29"
          error={errores.titulo}
        >
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            onBlur={revalidar}
            maxLength={120}
            placeholder="Título de la publicación"
            className={inputClass(!!errores.titulo)}
          />
        </Field>

        <Field
          label="Descripción"
          hint="Contá el estado, los componentes, el uso. Mínimo 20 caracteres."
          error={errores.descripcion}
        >
          <textarea
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            onBlur={revalidar}
            rows={5}
            maxLength={5000}
            placeholder="Describí tu bicicleta…"
            className={`${inputClass(!!errores.descripcion)} resize-y`}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Precio (ARS)" error={errores.precioARS}>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-slate-warm">
                $
              </span>
              <input
                value={precioARS}
                onChange={(e) =>
                  setPrecioARS(e.target.value.replace(/[^\d.]/g, ''))
                }
                onBlur={revalidar}
                inputMode="numeric"
                placeholder="0"
                className={`${inputClass(!!errores.precioARS)} pl-8`}
              />
            </div>
          </Field>

          <Field
            label="Precio (USD)"
            hint="Opcional"
            error={errores.precioUSD}
          >
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-slate-warm">
                US$
              </span>
              <input
                value={precioUSD}
                onChange={(e) =>
                  setPrecioUSD(e.target.value.replace(/[^\d.]/g, ''))
                }
                onBlur={revalidar}
                inputMode="numeric"
                placeholder="0"
                className={`${inputClass(!!errores.precioUSD)} pl-11`}
              />
            </div>
          </Field>
        </div>

        {/* Foto */}
        <Field label="Foto de la bici" hint="JPG, PNG, WEBP o AVIF (hasta 8 MB)">
          <input
            ref={fotoInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            onChange={elegirFoto}
            className="hidden"
          />
          {fotoPreview ? (
            <div className="relative overflow-hidden rounded-2xl border border-ink/12">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={fotoPreview}
                alt="Vista previa"
                className="aspect-[4/3] w-full object-cover"
              />
              <button
                type="button"
                onClick={() => {
                  setFoto(null)
                  if (fotoInputRef.current) fotoInputRef.current.value = ''
                }}
                className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-ink/80 px-3 py-1.5 text-xs font-semibold text-paper backdrop-blur-sm transition-colors hover:bg-ink"
              >
                <X className="size-3.5" />
                Quitar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fotoInputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-ink/25 bg-paper-dim/30 px-6 py-10 text-center transition-colors hover:border-ink/45"
            >
              <span className="flex size-12 items-center justify-center rounded-xl bg-lime/25 text-ink">
                <ImagePlus className="size-6" />
              </span>
              <span className="text-sm font-semibold text-ink">
                Subí una foto
              </span>
              <span className="text-xs text-slate-warm">
                Una buena foto vende más rápido
              </span>
            </button>
          )}
        </Field>

        <div className="rounded-2xl border border-ink/10 bg-paper-dim/40 p-4">
          <div className="flex items-center gap-2">
            <RodaidPayBadge />
          </div>
          <p className="mt-2 text-xs text-slate-warm">
            Publicar es gratis. Cobrás cuando se concreta la venta y el dinero
            del comprador queda retenido por RODAID PAY hasta la entrega.
          </p>
        </div>

        <button
          type="submit"
          disabled={enviando}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-6 py-4 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-60"
        >
          {enviando ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {foto ? 'Subiendo foto y publicando…' : 'Publicando…'}
            </>
          ) : (
            <>
              <ShieldCheck className="size-4 text-lime" />
              Publicar mi bici
            </>
          )}
        </button>
      </form>
    </div>
  )
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-ink">{label}</span>
        {hint && !error && (
          <span className="text-xs text-slate-warm">{hint}</span>
        )}
      </span>
      <div className="mt-1.5">{children}</div>
      {error && <p className="mt-1.5 text-xs font-medium text-clay">{error}</p>}
    </label>
  )
}

function inputClass(hasError: boolean): string {
  return `w-full rounded-xl border bg-white px-4 py-3 text-sm text-ink outline-none transition-colors placeholder:text-slate-warm/60 focus:ring-4 ${
    hasError
      ? 'border-clay/60 focus:border-clay focus:ring-clay/15'
      : 'border-ink/15 focus:border-ink/40 focus:ring-lime/25'
  }`
}
