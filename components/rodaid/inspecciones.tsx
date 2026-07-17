'use client'
import { ChecklistCIT } from '@/components/rodaid/ChecklistCIT'
import { ChecklistInspeccion } from '@/lib/puntos-inspeccion'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Bike,
  CheckCircle2,
  Fingerprint,
  Printer,
  Download,
  Loader2,
  Search,
  ShieldAlert,
  ShieldCheck,
  Stamp,
  Wallet,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  abrirCertificadoCit,
  aprobarInspeccion,
  buscarBici,
  descargarCertificadoCit,
  ensureInspectorSession,
  fetchContexto,
  guardarWallet,
  reportarDiscrepancia,
  verificarActa,
  type ActaInspeccion,
  type BusquedaInspeccion,
  type InspectorContextoCliente,
  type VerificacionRespuesta,
} from '@/lib/inspecciones'
import { useVerComoAliado } from '@/lib/admin-view-as'
import { AdminViewAsBanner } from '@/components/rodaid/AdminViewAsBanner'
import { SelectorVerComoAliado } from '@/components/rodaid/SelectorVerComoAliado'

const ROL_LABEL: Record<string, string> = {
  inspector: 'Inspector',
  aliado: 'Aliado',
  admin: 'Administrador',
}

/**
 * Panel de Inspecciones (Hito 11). Vista exclusiva para inspector / aliado /
 * admin: busca una bici por serie o CIT, muestra sus datos y permite Aprobar la
 * inspeccion fisica (acelerando el pipeline) o Reportar una discrepancia.
 *
 * Mantiene el lenguaje visual de "Mi Garaje", extendido para el rol inspector.
 */
export function Inspecciones() {
  return (
    <Suspense fallback={null}>
      <InspeccionesInner />
    </Suspense>
  )
}

function InspeccionesInner() {
  const verComoAliado = useVerComoAliado()
  const [ctx, setCtx] = useState<InspectorContextoCliente | null>(null)
  const [cargandoCtx, setCargandoCtx] = useState(true)
  const [errorCtx, setErrorCtx] = useState<string | null>(null)

  const cargarCtx = useCallback(async () => {
    setCargandoCtx(true)
    setErrorCtx(null)
    try {
      await ensureInspectorSession()
      setCtx(await fetchContexto(verComoAliado))
    } catch (err) {
      setErrorCtx((err as Error).message ?? 'No se pudo cargar el panel.')
    } finally {
      setCargandoCtx(false)
    }
  }, [verComoAliado])

  useEffect(() => {
    cargarCtx()
  }, [cargarCtx])

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-clay">
            Validación presencial
          </span>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-ink">
            Panel de Inspecciones
          </h1>
          <p className="mt-2 max-w-xl text-sm text-slate-warm">
            Buscá una bicicleta por número de serie o código CIT, verificá sus
            datos físicamente y aprobá la inspección o reportá una discrepancia.
          </p>
        </div>
        {ctx && (
          <div className="rounded-2xl border border-ink/12 bg-white px-4 py-3 text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-warm">
              {ROL_LABEL[ctx.rol] ?? ctx.rol}
            </p>
            <p className="font-display font-semibold text-ink">{ctx.nombre}</p>
            {ctx.aliado && (
              <p className="text-xs text-slate-warm">Taller: {ctx.aliado.nombre}</p>
            )}
          </div>
        )}
      </header>

      <div className="mt-4">
        <SelectorVerComoAliado />
        {ctx && <AdminViewAsBanner modo={ctx.modoVista} aliadoNombre={ctx.aliado?.nombre} />}
      </div>

      {cargandoCtx ? (
        <div className="mt-10 flex items-center gap-2 text-sm text-slate-warm">
          <Loader2 className="size-4 animate-spin" /> Cargando panel…
        </div>
      ) : errorCtx ? (
        <div className="mt-8 rounded-3xl border border-clay/30 bg-clay/5 px-6 py-12 text-center">
          <ShieldAlert className="mx-auto size-8 text-clay" />
          <h3 className="mt-3 font-display text-xl font-bold text-ink">
            No pudimos abrir el panel
          </h3>
          <p className="mt-1 text-sm text-slate-warm">{errorCtx}</p>
          <button
            onClick={cargarCtx}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
          >
            Reintentar
          </button>
        </div>
      ) : ctx ? (
        <>
          <WalletPanel ctx={ctx} onActualizado={setCtx} />
          <Buscador ctx={ctx} />
        </>
      ) : null}
    </>
  )
}

// ── Identidad digital (wallet) ───────────────────────────────────────────────

function WalletPanel({
  ctx,
  onActualizado,
}: {
  ctx: InspectorContextoCliente
  onActualizado: (c: InspectorContextoCliente) => void
}) {
  const [wallet, setWallet] = useState(ctx.walletAddress ?? '')
  const [editar, setEditar] = useState(!ctx.walletAddress)
  const [guardando, setGuardando] = useState(false)

  const guardar = async () => {
    if (guardando) return
    setGuardando(true)
    try {
      const actualizado = await guardarWallet(wallet.trim())
      onActualizado(actualizado)
      setEditar(false)
      toast.success('Identidad digital configurada')
    } catch (err) {
      toast.error('No pudimos guardar la wallet', {
        description: (err as Error).message,
      })
    } finally {
      setGuardando(false)
    }
  }

  if (ctx.walletAddress && !editar) {
    return (
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-lime-deep/40 bg-lime/15 px-5 py-3.5">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Wallet className="size-4 text-lime-deep" />
          Identidad digital vinculada
          <code className="rounded bg-white/70 px-2 py-0.5 font-mono text-xs text-ink/80">
            {ctx.walletAddress.slice(0, 10)}…{ctx.walletAddress.slice(-6)}
          </code>
        </span>
        <button
          onClick={() => setEditar(true)}
          className="text-xs font-semibold text-ink/70 underline-offset-2 hover:underline"
        >
          Cambiar
        </button>
      </div>
    )
  }

  return (
    <div className="mt-6 rounded-2xl border border-clay/30 bg-clay/5 p-5">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink">
        <Wallet className="size-5 text-clay" />
        Configurá tu identidad digital
      </h2>
      <p className="mt-1 text-sm text-slate-warm">
        Para firmar aprobaciones necesitás una <strong>wallet_address</strong>. Tu
        firma quedará vinculada a esta identidad en cada acta.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <input
          value={wallet}
          onChange={(e) => setWallet(e.target.value)}
          placeholder="0x… (40 caracteres hexadecimales)"
          className="min-w-[18rem] flex-1 rounded-xl border border-ink/15 bg-white px-4 py-2.5 font-mono text-sm text-ink outline-none transition-colors placeholder:text-slate-warm/60 focus:border-ink/40 focus:ring-4 focus:ring-lime/25"
        />
        <button
          onClick={guardar}
          disabled={guardando}
          className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft disabled:opacity-60"
        >
          {guardando ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4 text-lime" />}
          Guardar
        </button>
      </div>
    </div>
  )
}

// ── Buscador + resultado ─────────────────────────────────────────────────────

function Buscador({ ctx }: { ctx: InspectorContextoCliente }) {
  const verComoAliado = useVerComoAliado()
  const [q, setQ] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [resultado, setResultado] = useState<BusquedaInspeccion | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const buscar = useCallback(async (termino: string) => {
    const limpio = termino.trim()
    if (!limpio) return
    setBuscando(true)
    try {
      setResultado(await buscarBici(limpio, verComoAliado))
    } catch (err) {
      toast.error('No pudimos buscar la bici', {
        description: (err as Error).message,
      })
    } finally {
      setBuscando(false)
    }
  }, [verComoAliado])

  useEffect(() => () => abortRef.current?.abort(), [])

  return (
    <div className="mt-8">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          buscar(q)
        }}
        className="flex flex-wrap gap-3"
      >
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-warm" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Número de serie o código CIT (CIT-…)"
            className="w-full rounded-full border border-ink/15 bg-white py-3 pl-11 pr-4 text-sm text-ink outline-none transition-colors placeholder:text-slate-warm/60 focus:border-ink/40 focus:ring-4 focus:ring-lime/25"
          />
        </div>
        <button
          type="submit"
          disabled={buscando}
          className="inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft disabled:opacity-60"
        >
          {buscando ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4 text-lime" />}
          Buscar
        </button>
      </form>

      {resultado && (
        <ResultadoInspeccion
          ctx={ctx}
          resultado={resultado}
          onRefrescar={() => buscar(q)}
        />
      )}
    </div>
  )
}

function ResultadoInspeccion({
  ctx,
  resultado,
  onRefrescar,
}: {
  ctx: InspectorContextoCliente
  resultado: BusquedaInspeccion
  onRefrescar: () => void
}) {
  if (!resultado.encontrada) {
    return (
      <div className="mt-6 rounded-3xl border border-ink/15 bg-white px-6 py-12 text-center">
        <Bike className="mx-auto size-8 text-ink/30" />
        <h3 className="mt-3 font-display text-lg font-bold text-ink">
          Sin coincidencias
        </h3>
        <p className="mt-1 text-sm text-slate-warm">{resultado.aviso}</p>
      </div>
    )
  }

  if (!resultado.autorizado || !resultado.bicicleta) {
    return (
      <div className="mt-6 rounded-3xl border border-amber-300/60 bg-amber-50 px-6 py-10 text-center">
        <ShieldAlert className="mx-auto size-8 text-amber-500" />
        <h3 className="mt-3 font-display text-lg font-bold text-ink">
          Fuera de tu alcance
        </h3>
        <p className="mt-1 text-sm text-slate-warm">{resultado.aviso}</p>
      </div>
    )
  }

  const b = resultado.bicicleta
  const cit = resultado.cit

  return (
    <div className="mt-6 overflow-hidden rounded-3xl border border-ink/12 bg-white">
      <div className="flex flex-wrap items-center gap-4 border-b border-ink/10 bg-paper-dim/40 px-6 py-4">
        <span className="flex size-12 items-center justify-center rounded-xl bg-lime/20 text-ink">
          <Bike className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-bold text-ink">
            {b.marca} {b.modelo}
          </p>
          <p className="text-xs text-slate-warm">
            N° {b.numeroSerie}
            {cit ? ` · ${cit.codigoCit}` : ''}
          </p>
        </div>
        {cit && <EstadoBadge estado={cit.estado} />}
        {cit && (
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={() =>
                abrirCertificadoCit(cit.id).catch((err) =>
                  toast.error('No pudimos abrir el certificado', { description: (err as Error).message })
                )
              }
              className="inline-flex items-center gap-1.5 rounded-full border border-[#2BBCB8] px-3 py-1.5 text-xs font-semibold text-[#2BBCB8] hover:bg-[#2BBCB8]/10"
            >
              <Printer className="size-3.5" />Imprimir CIT
            </button>
            <button
              type="button"
              onClick={() =>
                descargarCertificadoCit(cit.id, b.numeroSerie).catch((err) =>
                  toast.error('No pudimos descargar el certificado', { description: (err as Error).message })
                )
              }
              className="inline-flex items-center gap-1.5 rounded-full border border-[#F47B20] px-3 py-1.5 text-xs font-semibold text-[#F47B20] hover:bg-[#F47B20]/10"
            >
              <Download className="size-3.5" />Descargar
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-6 px-6 py-5 sm:grid-cols-2">
        <Datos b={b} />
        <div className="space-y-4">
          {cit ? (
            <>
              <PipelineInfo resultado={resultado} />
              <Acciones
                ctx={ctx}
                cit={cit}
                onRefrescar={onRefrescar}
              />
            </>
          ) : (
            <div className="rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-slate-warm">
              {resultado.aviso}
            </div>
          )}
        </div>
      </div>

      {resultado.actas.length > 0 && <Historial actas={resultado.actas} />}
    </div>
  )
}

function Datos({ b }: { b: NonNullable<BusquedaInspeccion['bicicleta']> }) {
  const filas: Array<[string, string]> = [
    ['Tipo', b.tipo],
    ['Rodado', b.rodado ? `R${b.rodado}` : '—'],
    ['Talle', b.talleCuadro ?? '—'],
    ['Año', b.anio ? String(b.anio) : '—'],
    ['Color', b.color ?? '—'],
  ]
  if (b.titular) filas.push(['Titular', b.titular])
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
      {filas.map(([k, v]) => (
        <div key={k}>
          <dt className="text-[0.7rem] font-semibold uppercase tracking-wide text-slate-warm">
            {k}
          </dt>
          <dd className="font-display font-semibold text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

// ── Criticidad de auditoría (Hito 22) ───────────────────────────────────────────
type Criticidad = 'ALTA' | 'MEDIA' | 'BAJA'

function calcularCriticidad(resultado: BusquedaInspeccion): Criticidad {
  const estado = resultado.cit?.estado ?? ''
  if (['ANOMALIA_DETECTADA', 'RECHAZADO', 'bloqueado'].includes(estado)) return 'ALTA'
  if (['PROCESANDO_CRUCE', 'VENCIDO'].includes(estado)) return 'MEDIA'
  return 'BAJA'
}

const CRITICIDAD_CONFIG: Record<Criticidad, { label: string; cls: string; icon: string }> = {
  ALTA:  { label: 'Prioridad ALTA',  cls: 'bg-red-50 text-red-700 border-red-200',       icon: '⚠️' },
  MEDIA: { label: 'Prioridad MEDIA', cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: '🔶' },
  BAJA:  { label: 'Prioridad BAJA',  cls: 'bg-lime/20 text-ink border-lime/30',          icon: '✅' },
}

function CriticidadBadge({ resultado }: { resultado: BusquedaInspeccion }) {
  const c = calcularCriticidad(resultado)
  const cfg = CRITICIDAD_CONFIG[c]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cfg.cls}`}>
      {cfg.icon} {cfg.label}
    </span>
  )
}

function PipelineInfo({ resultado }: { resultado: BusquedaInspeccion }) {
  const cit = resultado.cit!
  const job = resultado.pipeline
  return (
    <div className="rounded-2xl border border-ink/10 bg-paper-dim/30 px-4 py-3 text-sm space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold text-ink">
          <Zap className="size-4 text-lime-deep" />
          Pipeline de validación
        </p>
        <CriticidadBadge resultado={resultado} />
      </div>
      <p className="text-slate-warm">
        Estado del CIT: <strong className="text-ink">{cit.estado}</strong>
        {job?.estado ? ` · cola: ${job.estado}` : ''}
      </p>
      {cit.yaInspeccionada && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-lime-deep">
          <CheckCircle2 className="size-3.5" /> Ya tiene un acta de inspección física.
        </p>
      )}
    </div>
  )
}

function Acciones({
  ctx,
  cit,
  onRefrescar,
}: {
  ctx: InspectorContextoCliente
  cit: NonNullable<BusquedaInspeccion['cit']>
  onRefrescar: () => void
}) {
  const [notas, setNotas] = useState('')
  const [motivo, setMotivo] = useState('')
  const [modo, setModo] = useState<'idle' | 'checklist' | 'discrepancia'>('idle')
  const [enviando, setEnviando] = useState<null | 'aprobar' | 'discrepancia'>(null)

  const sinWallet = !ctx.walletAddress
  const bloqueado = cit.estado === 'bloqueado'
  const yaResuelta = cit.estado === 'rechazado'
  const modoVistaActivo = ctx.modoVista !== 'propio'

  /** Aprobación rápida: solo veredicto + notas libres, sin checklist. */
  const aprobarRapido = async () => {
    if (enviando) return
    setEnviando('aprobar')
    try {
      const r = await aprobarInspeccion(cit.id, notas.trim() || undefined)
      if (r.bloqueadaPorSeguridad) {
        toast.warning('Aprobada, pero bloqueada por seguridad', {
          description:
            'El cross-reference detectó una denuncia. La bici quedó BLOQUEADA.',
        })
      } else {
        toast.success('Inspección aprobada y firmada', {
          description: `Acta firmada (${r.firma.algoritmo}). Pipeline acelerado. CIT: ${r.citEstado}.`,
        })
      }
      setNotas('')
      onRefrescar()
    } catch (err) {
      toast.error('No pudimos aprobar', { description: (err as Error).message })
    } finally {
      setEnviando(null)
    }
  }

  /** Checklist completo de 20 puntos ("CIT Completo Plus"). */
  const aprobarConChecklist = async (
    checklist: ChecklistInspeccion,
    fotosPorPunto: Record<string, File>,
    notasChecklist: string
  ) => {
    if (enviando) return
    setEnviando('aprobar')
    try {
      const r = await aprobarInspeccion(
        cit.id,
        notasChecklist.trim() || undefined,
        checklist,
        fotosPorPunto
      )
      if (r.bloqueadaPorSeguridad) {
        toast.warning('Aprobada, pero bloqueada por seguridad', {
          description:
            'El cross-reference detectó una denuncia. La bici quedó BLOQUEADA.',
        })
      } else {
        toast.success('Inspección aprobada y firmada', {
          description: `Acta firmada (${r.firma.algoritmo}). Pipeline acelerado. CIT: ${r.citEstado}.`,
        })
      }
      setModo('idle')
      onRefrescar()
    } catch (err) {
      toast.error('No pudimos aprobar', { description: (err as Error).message })
    } finally {
      setEnviando(null)
    }
  }

  const discrepar = async () => {
    if (enviando) return
    if (!motivo.trim()) {
      toast.error('Indicá el motivo de la discrepancia')
      return
    }
    setEnviando('discrepancia')
    try {
      await reportarDiscrepancia(cit.id, motivo.trim())
      toast.success('Discrepancia registrada', {
        description: 'La verificación quedó frenada (CIT rechazado).',
      })
      setMotivo('')
      setModo('idle')
      onRefrescar()
    } catch (err) {
      toast.error('No pudimos registrar la discrepancia', {
        description: (err as Error).message,
      })
    } finally {
      setEnviando(null)
    }
  }

  if (bloqueado) {
    return (
      <div className="rounded-2xl border border-clay/30 bg-clay/5 px-4 py-3 text-sm font-semibold text-clay">
        Esta bici figura bloqueada (reportada como robada). No se puede inspeccionar.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {modoVistaActivo && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
          Estás en modo vista previa / ver-como: no podés aprobar ni rechazar inspecciones desde acá.
        </p>
      )}
      {sinWallet && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
          Configurá tu wallet arriba para poder firmar.
        </p>
      )}
      {yaResuelta && (
        <p className="rounded-xl bg-paper-dim px-3 py-2 text-xs font-semibold text-slate-warm">
          El CIT está rechazado por una discrepancia previa.
        </p>
      )}

      {modo === 'idle' ? (
        <>
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={2}
            placeholder="Notas de la inspección (opcional)"
            className="w-full rounded-xl border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-slate-warm/60 focus:border-ink/40 focus:ring-4 focus:ring-lime/25"
          />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={aprobarRapido}
              disabled={sinWallet || enviando !== null || modoVistaActivo}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-50"
            >
              {enviando === 'aprobar' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ShieldCheck className="size-4 text-lime" />
              )}
              Aprobar inspección física
            </button>
            <button
              onClick={() => setModo('discrepancia')}
              disabled={sinWallet || enviando !== null || modoVistaActivo}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-clay/40 bg-white px-4 py-2.5 text-sm font-semibold text-clay transition-colors hover:bg-clay/5 disabled:opacity-50"
            >
              <AlertTriangle className="size-4" />
              Reportar discrepancia
            </button>
          </div>
          <button
            onClick={() => setModo('checklist')}
            disabled={sinWallet || enviando !== null || modoVistaActivo}
            className="text-xs font-semibold text-[#2BBCB8] underline decoration-dotted underline-offset-2 hover:text-[#2BBCB8]/80 disabled:opacity-50"
          >
            Usar checklist completo de 20 puntos (CIT Completo Plus) →
          </button>
        </>
      ) : modo === 'checklist' ? (
        <>
          {(sinWallet || modoVistaActivo) ? (
            <p className="rounded-xl bg-paper-dim px-3 py-2 text-xs font-semibold text-slate-warm">
              Completá el checklist una vez que puedas firmar (wallet configurada, fuera de modo vista previa).
            </p>
          ) : (
            <ChecklistCIT onSubmit={aprobarConChecklist} enviando={enviando === 'aprobar'} />
          )}
          <button
            onClick={() => setModo('idle')}
            disabled={enviando !== null}
            className="text-xs font-semibold text-slate-warm underline decoration-dotted underline-offset-2 hover:text-ink disabled:opacity-50"
          >
            ← Volver a aprobación rápida
          </button>
        </>
      ) : (
        <div className="rounded-2xl border border-clay/30 bg-clay/5 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-clay">
            <AlertTriangle className="size-4" /> Reportar discrepancia
          </p>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            placeholder="Describí la discrepancia detectada (número de serie alterado, datos que no coinciden, etc.)"
            className="mt-2 w-full rounded-xl border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-slate-warm/60 focus:border-clay/50 focus:ring-4 focus:ring-clay/15"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={discrepar}
              disabled={enviando !== null}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-clay px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-clay/90 disabled:opacity-50"
            >
              {enviando === 'discrepancia' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <AlertTriangle className="size-4" />
              )}
              Confirmar discrepancia
            </button>
            <button
              onClick={() => setModo('idle')}
              disabled={enviando !== null}
              className="rounded-full border border-ink/15 bg-white px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-ink/40 disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Historial({ actas }: { actas: BusquedaInspeccion['actas'] }) {
  return (
    <div className="border-t border-ink/10 px-6 py-4">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-warm">
        <Fingerprint className="size-3.5" /> Actas de inspección
      </p>
      <ul className="mt-3 space-y-2">
        {actas.map((a) => (
          <ActaItem key={a.id} acta={a} />
        ))}
      </ul>
    </div>
  )
}

function ActaItem({ acta: a }: { acta: ActaInspeccion }) {
  const [verif, setVerif] = useState<VerificacionRespuesta | null>(null)
  const [verificando, setVerificando] = useState(false)

  const verificar = async () => {
    if (verificando) return
    setVerificando(true)
    try {
      const r = await verificarActa(a.id)
      setVerif(r)
      if (r.valido) {
        toast.success('Firma válida', {
          description: `Acta firmada por ${r.commonName ?? 'la autoridad'} (serie ${r.certSerie ?? '—'}).`,
        })
      } else {
        toast.error('Firma inválida o no verificable', {
          description: 'El acta no tiene una firma digital válida.',
        })
      }
    } catch (err) {
      toast.error('No pudimos verificar el acta', {
        description: (err as Error).message,
      })
    } finally {
      setVerificando(false)
    }
  }

  return (
    <li className="rounded-xl border border-ink/10 bg-paper-dim/30 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
            a.resultado === 'APROBADA' ? 'bg-lime/30 text-ink' : 'bg-clay/15 text-clay'
          }`}
        >
          {a.resultado === 'APROBADA' ? (
            <ShieldCheck className="size-3" />
          ) : (
            <AlertTriangle className="size-3" />
          )}
          {a.resultado}
        </span>
        <span className="text-slate-warm">
          {new Date(a.createdAt).toLocaleString('es-AR')}
        </span>
        {a.aceleroPipeline && (
          <span className="inline-flex items-center gap-1 text-lime-deep">
            <Zap className="size-3" /> aceleró el pipeline
          </span>
        )}
        {a.firma && (
          <button
            onClick={verificar}
            disabled={verificando}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-ink/15 bg-white px-2.5 py-1 font-semibold text-ink/80 transition-colors hover:border-ink/40 disabled:opacity-50"
          >
            {verificando ? (
              <Loader2 className="size-3 animate-spin" />
            ) : verif ? (
              verif.valido ? (
                <ShieldCheck className="size-3 text-lime-deep" />
              ) : (
                <ShieldAlert className="size-3 text-clay" />
              )
            ) : (
              <Stamp className="size-3" />
            )}
            {verif ? (verif.valido ? 'Firma válida' : 'Firma inválida') : 'Verificar firma'}
          </button>
        )}
      </div>

      {a.firma ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[0.65rem] text-ink/60">
          <span>{a.firma.algoritmo}</span>
          {a.firma.certSerie && <span>cert {a.firma.certSerie.slice(0, 14)}…</span>}
          {a.firma.modo && (
            <span className="rounded bg-white/70 px-1.5 py-0.5 not-italic">
              {a.firma.modo === 'PKCS12' ? 'PKCS#12' : a.firma.modo}
            </span>
          )}
        </p>
      ) : (
        <p className="mt-1.5 font-mono text-[0.65rem] text-ink/50">
          firma {a.firmaHash.slice(0, 16)}…
        </p>
      )}
    </li>
  )
}

function EstadoBadge({ estado }: { estado: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    activo: { label: 'Verificada', cls: 'bg-lime/30 text-ink' },
    pendiente: { label: 'En validación', cls: 'bg-amber-100 text-amber-700' },
    bloqueado: { label: 'Bloqueada', cls: 'bg-clay/15 text-clay' },
    rechazado: { label: 'Rechazada', cls: 'bg-clay/15 text-clay' },
  }
  const v = map[estado] ?? { label: estado, cls: 'bg-paper-dim text-slate-warm' }
  return (
    <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${v.cls}`}>
      {v.label}
    </span>
  )
}
