'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  Bike,
  Download,
  Fingerprint,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { authedFetch } from '@/lib/session'
import { parseApiError } from '@/lib/api-errors'
import {
  descargarCertificado,
  etiquetaBici,
  fetchMisBicicletas,
  type BicicletaGaraje,
} from '@/lib/garaje'
import { SolicitarVerificacionModal } from './solicitar-verificacion-modal'

const TIPOS = ['Ruta', 'MTB', 'Urbana', 'Gravel', 'Eléctrica', 'BMX', 'Plegable']
const RODADOS = [12, 16, 20, 24, 26, 27.5, 29, 700]
const TALLES = ['S', 'M', 'L', 'XL']

/**
 * "Mi Garaje" — administra las bicicletas del usuario y su identidad (CIT).
 *
 * Es el destino del boton "Ir a Mi Garaje" del flujo de publicacion: desde aca
 * el usuario registra una bici y solicita su verificacion. Una vez verificada,
 * un acceso directo lo devuelve a publicar.
 */
export function Garaje() {
  const [bicis, setBicis] = useState<BicicletaGaraje[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [verificar, setVerificar] = useState<BicicletaGaraje | null>(null)
  const [agregando, setAgregando] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const cargar = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(false)
    try {
      const data = await fetchMisBicicletas(controller.signal)
      setBicis(data.bicicletas)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    cargar()
    return () => abortRef.current?.abort()
  }, [cargar])

  const lista = bicis ?? []
  const hayVerificada = lista.some((b) => b.citActivo)

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-clay">
            Tu garaje
          </span>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-ink">
            Mi Garaje
          </h1>
          <p className="mt-2 text-sm text-slate-warm">
            Registrá tus bicicletas y verificá su identidad para poder
            publicarlas.
          </p>
        </div>
        {!agregando && (
          <button
            onClick={() => setAgregando(true)}
            className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
          >
            <Plus className="size-4 text-lime" />
            Agregar bicicleta
          </button>
        )}
      </div>

      {hayVerificada && (
        <Link
          href="/publicar"
          className="mt-6 flex items-center justify-between gap-3 rounded-2xl border border-lime-deep/40 bg-lime/15 px-5 py-4 transition-colors hover:bg-lime/25"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-ink">
            <ShieldCheck className="size-4 text-lime-deep" />
            Tenés una bici verificada lista para publicar
          </span>
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-ink">
            Publicar
            <ArrowRight className="size-4" />
          </span>
        </Link>
      )}

      {agregando && (
        <AgregarBicicletaForm
          onCancel={() => setAgregando(false)}
          onCreada={() => {
            setAgregando(false)
            cargar()
          }}
        />
      )}

      <div className="mt-8">
        {loading && !bicis ? (
          <GarajeSkeleton />
        ) : error ? (
          <div className="rounded-3xl border border-clay/30 bg-clay/5 px-6 py-14 text-center">
            <h3 className="font-display text-xl font-bold text-ink">
              No pudimos cargar tu garaje
            </h3>
            <button
              onClick={cargar}
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
            >
              <RefreshCw className="size-4" />
              Reintentar
            </button>
          </div>
        ) : lista.length === 0 ? (
          <div className="flex flex-col items-center rounded-3xl border border-dashed border-ink/20 bg-white/50 px-6 py-16 text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-lime/20 text-ink">
              <Bike className="size-8" />
            </span>
            <h3 className="mt-5 font-display text-2xl font-bold text-ink">
              Tu garaje está vacío
            </h3>
            <p className="mt-2 max-w-sm text-sm text-slate-warm">
              Agregá tu primera bicicleta para verificar su identidad y
              publicarla.
            </p>
            <button
              onClick={() => setAgregando(true)}
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
            >
              <Plus className="size-4 text-lime" />
              Agregar bicicleta
            </button>
          </div>
        ) : (
          <ul className="space-y-3">
            {lista.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center gap-4 rounded-2xl border border-ink/12 bg-white p-4"
              >
                <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-paper-dim text-ink/30">
                  {b.fotoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={b.fotoUrl}
                      alt={etiquetaBici(b)}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Bike className="size-6" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display font-semibold text-ink">
                    {etiquetaBici(b)}
                  </p>
                  <p className="truncate text-xs text-slate-warm">
                    {[b.tipo, b.rodado ? `R${b.rodado}` : null, b.talleCuadro]
                      .filter(Boolean)
                      .join(' · ')}{' '}
                    · N° {b.numeroSerie}
                  </p>
                </div>
                <EstadoCit bici={b} onVerificar={() => setVerificar(b)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <SolicitarVerificacionModal
        bici={verificar}
        open={verificar !== null}
        onOpenChange={(o) => !o && setVerificar(null)}
        onVerificada={cargar}
      />
    </>
  )
}

function EstadoCit({
  bici,
  onVerificar,
}: {
  bici: BicicletaGaraje
  onVerificar: () => void
}) {
  if (bici.citActivo) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-lime/25 px-3 py-1.5 text-xs font-semibold text-ink">
          <ShieldCheck className="size-3.5" />
          CIT verificada
        </span>
        <DescargarCertificadoButton bici={bici} />
      </div>
    )
  }
  if (bici.citEstado === 'pendiente') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-paper-dim px-3 py-1.5 text-xs font-semibold text-slate-warm">
        En revisión
      </span>
    )
  }
  return (
    <button
      onClick={onVerificar}
      className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3.5 py-2 text-xs font-semibold text-ink transition-colors hover:border-ink/40"
    >
      <Fingerprint className="size-3.5" />
      Verificar
    </button>
  )
}

/**
 * Boton de descarga del Certificado Digital de Propiedad y Verificacion (PDF
 * firmado). Disponible para las bicis con un CIT verificado y vigente; se baja
 * desde "Mi Garaje" con la sesion del usuario.
 */
function DescargarCertificadoButton({ bici }: { bici: BicicletaGaraje }) {
  const [descargando, setDescargando] = useState(false)

  const onClick = async () => {
    if (descargando) return
    setDescargando(true)
    try {
      await descargarCertificado(bici)
      toast.success('Certificado generado', {
        description: 'Se descargó el PDF firmado de tu bici.',
      })
    } catch (err) {
      toast.error('No pudimos generar el certificado', {
        description:
          (err as Error).message ?? 'Probá de nuevo en unos instantes.',
      })
    } finally {
      setDescargando(false)
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={descargando}
      className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-xs font-semibold text-paper transition-colors hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-60"
    >
      {descargando ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Download className="size-3.5 text-lime" />
      )}
      {descargando ? 'Generando…' : 'Certificado'}
    </button>
  )
}

export function AgregarBicicletaForm({
  onCancel,
  onCreada,
}: {
  onCancel: () => void
  onCreada: () => void
}) {
  const [marca, setMarca] = useState('')
  const [modelo, setModelo] = useState('')
  const [numeroSerie, setNumeroSerie] = useState('')
  const [tipo, setTipo] = useState('')
  const [anio, setAnio] = useState('')
  const [color, setColor] = useState('')
  const [rodado, setRodado] = useState('')
  const [talleCuadro, setTalleCuadro] = useState('')
  const [enviando, setEnviando] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (enviando) return

    if (!marca.trim() || !modelo.trim() || !numeroSerie.trim() || !tipo.trim()) {
      toast.error('Faltan datos', {
        description: 'Completá marca, modelo, número de serie y tipo.',
      })
      return
    }

    setEnviando(true)
    try {
      const res = await authedFetch('/api/v1/bicicletas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          marca: marca.trim(),
          modelo: modelo.trim(),
          numeroSerie: numeroSerie.trim(),
          tipo: tipo.trim(),
          anio: anio.trim() === '' ? null : Number(anio),
          color: color.trim() || null,
          rodado: rodado === '' ? null : Number(rodado),
          talleCuadro: talleCuadro || null,
        }),
      })
      if (!res.ok) {
        const info = await parseApiError(res)
        toast.error('No pudimos agregar la bicicleta', {
          description: info.message,
        })
        setEnviando(false)
        return
      }
      toast.success('Bicicleta agregada', {
        description: 'Ahora verificá su identidad para poder publicarla.',
      })
      onCreada()
    } catch {
      toast.error('No pudimos agregar la bicicleta', {
        description: 'Revisá tu conexión e intentá nuevamente.',
      })
      setEnviando(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-6 rounded-2xl border border-ink/12 bg-white p-5"
      noValidate
    >
      <h2 className="font-display text-lg font-bold text-ink">
        Agregar bicicleta
      </h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Campo label="Marca">
          <input
            value={marca}
            onChange={(e) => setMarca(e.target.value)}
            placeholder="Trek, Specialized…"
            className={inputClass}
          />
        </Campo>
        <Campo label="Modelo">
          <input
            value={modelo}
            onChange={(e) => setModelo(e.target.value)}
            placeholder="Marlin 7"
            className={inputClass}
          />
        </Campo>
        <Campo label="Número de serie">
          <input
            value={numeroSerie}
            onChange={(e) => setNumeroSerie(e.target.value)}
            placeholder="Ej: WTU123456K"
            className={inputClass}
          />
        </Campo>
        <Campo label="Tipo">
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            className={inputClass}
          >
            <option value="">Elegí un tipo</option>
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Rodado">
          <select
            value={rodado}
            onChange={(e) => setRodado(e.target.value)}
            className={inputClass}
          >
            <option value="">—</option>
            {RODADOS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Talle de cuadro">
          <select
            value={talleCuadro}
            onChange={(e) => setTalleCuadro(e.target.value)}
            className={inputClass}
          >
            <option value="">—</option>
            {TALLES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Año">
          <input
            value={anio}
            onChange={(e) => setAnio(e.target.value.replace(/[^\d]/g, ''))}
            inputMode="numeric"
            placeholder="2023"
            className={inputClass}
          />
        </Campo>
        <Campo label="Color">
          <input
            value={color}
            onChange={(e) => setColor(e.target.value)}
            placeholder="Negro mate"
            className={inputClass}
          />
        </Campo>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={enviando}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-60"
        >
          {enviando ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Guardando…
            </>
          ) : (
            'Guardar bicicleta'
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={enviando}
          className="inline-flex items-center justify-center rounded-full border border-ink/15 bg-white px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-ink/40 disabled:opacity-60"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}

function Campo({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  )
}

const inputClass =
  'w-full rounded-xl border border-ink/15 bg-white px-4 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-slate-warm/60 focus:border-ink/40 focus:ring-4 focus:ring-lime/25'

function GarajeSkeleton() {
  return (
    <ul className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <li
          key={i}
          className="flex items-center gap-4 rounded-2xl border border-ink/10 bg-white p-4"
        >
          <div className="size-14 animate-pulse rounded-xl bg-paper-dim" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/2 animate-pulse rounded bg-paper-dim" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-paper-dim" />
          </div>
        </li>
      ))}
    </ul>
  )
}
