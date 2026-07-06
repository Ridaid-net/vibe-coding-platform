'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Bike,
  CheckCircle2,
  Clock,
  Fingerprint,
  HelpCircle,
  Link2,
  Loader2,
  Phone,
  QrCode,
  Search,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import {
  extraerTerminoDeQR,
  verificarSerial,
  type VeredictoColor,
  type VeredictoEstado,
  type VerificacionVeredicto,
} from '@/lib/verificar'

// El lector de QR carga html5-qrcode solo cuando se usa (sin SSR).
const QrScanner = dynamic(
  () => import('./qr-scanner').then((m) => m.QrScanner),
  { ssr: false }
)

interface EstadoConfig {
  light: VeredictoColor
  Icon: typeof ShieldCheck
  card: string
  badge: string
  iconWrap: string
}

const CONFIG: Record<VeredictoEstado, EstadoConfig> = {
  SEGURO: {
    light: 'verde',
    Icon: ShieldCheck,
    card: 'border-lime-deep/50 bg-lime/15',
    badge: 'bg-lime-deep/20 text-ink',
    iconWrap: 'bg-lime-deep/25 text-ink',
  },
  ROBADA: {
    light: 'rojo',
    Icon: ShieldAlert,
    card: 'border-clay/50 bg-clay/10',
    badge: 'bg-clay/20 text-clay',
    iconWrap: 'bg-clay/20 text-clay',
  },
  EN_VALIDACION: {
    light: 'amarillo',
    Icon: Clock,
    card: 'border-amber-400/60 bg-amber-50',
    badge: 'bg-amber-100 text-amber-700',
    iconWrap: 'bg-amber-100 text-amber-600',
  },
  SIN_VERIFICAR: {
    light: 'amarillo',
    Icon: HelpCircle,
    card: 'border-amber-400/50 bg-amber-50/70',
    badge: 'bg-amber-100 text-amber-700',
    iconWrap: 'bg-amber-100 text-amber-600',
  },
  NO_ENCONTRADA: {
    light: 'gris',
    Icon: Search,
    card: 'border-ink/15 bg-white',
    badge: 'bg-paper-dim text-slate-warm',
    iconWrap: 'bg-paper-dim text-slate-warm',
  },
}

/**
 * Verificador Publico (Hito 7): buscador central + lector de QR + veredicto
 * semaforico. Consulta el endpoint abierto sin autenticacion y nunca muestra
 * datos del propietario, solo el estado del bien.
 */
export function Verificador({ inicial }: { inicial?: string } = {}) {
  const [valor, setValor] = useState(inicial ?? '')
  const [cargando, setCargando] = useState(false)
  const [veredicto, setVeredicto] = useState<VerificacionVeredicto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scanner, setScanner] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const consultar = useCallback(async (termino: string) => {
    const limpio = termino.trim()
    if (limpio.length < 3) {
      setError('Ingresá un número de serie o código CIT (mínimo 3 caracteres).')
      return
    }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setCargando(true)
    setError(null)
    setVeredicto(null)
    try {
      const res = await verificarSerial(limpio, controller.signal)
      if (res.ok) {
        setVeredicto(res.veredicto)
      } else if (res.status === 429) {
        setError(
          `Demasiadas consultas. Esperá ${res.error.retryAfter ?? 30} segundos e intentá de nuevo.`
        )
      } else {
        setError(res.error.message)
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError('No pudimos completar la verificación. Probá de nuevo en unos segundos.')
    } finally {
      setCargando(false)
    }
  }, [])

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    consultar(valor)
  }

  // Si llega un termino inicial (p. ej. desde el QR /verificar/:serial), se
  // dispara la consulta automaticamente al montar.
  useEffect(() => {
    if (inicial && inicial.trim().length >= 3) {
      consultar(inicial)
    }
    // Solo en el primer render con el termino inicial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onScan = useCallback(
    (texto: string) => {
      setScanner(false)
      const termino = extraerTerminoDeQR(texto)
      setValor(termino)
      consultar(termino)
    },
    [consultar]
  )

  return (
    <div>
      <header className="text-center">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-clay">
          Verificador público
        </span>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">
          Verificá una bici antes de comprarla
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-slate-warm sm:text-base">
          Consultá el estado de identidad de cualquier bicicleta por su número de
          serie o código CIT. Es gratis, anónimo y no necesitás cuenta.
        </p>
      </header>

      <form onSubmit={onSubmit} className="mx-auto mt-8 max-w-xl">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-slate-warm" />
            <input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="N° de serie o código CIT…"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="w-full rounded-full border border-ink/15 bg-white py-3.5 pl-12 pr-4 text-sm text-ink outline-none transition-colors placeholder:text-slate-warm/60 focus:border-ink/40 focus:ring-4 focus:ring-lime/25"
            />
          </div>
          <button
            type="submit"
            disabled={cargando}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-ink px-6 py-3.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cargando ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Search className="size-4 text-lime" />
            )}
            Verificar
          </button>
        </div>

        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => setScanner((s) => !s)}
            className="inline-flex items-center gap-2 rounded-full border border-ink/15 bg-white px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-ink/40"
          >
            <QrCode className="size-4 text-clay" />
            {scanner ? 'Cerrar lector' : 'Escanear código QR del cuadro'}
          </button>
        </div>
      </form>

      {scanner && (
        <div className="mx-auto mt-5 max-w-xl">
          <QrScanner onResult={onScan} onClose={() => setScanner(false)} />
        </div>
      )}

      <div className="mx-auto mt-8 max-w-xl">
        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-clay/30 bg-clay/5 px-5 py-4 text-sm text-ink">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-clay" />
            <span>{error}</span>
          </div>
        )}

        {cargando && !veredicto && <VeredictoSkeleton />}

        {veredicto && !cargando && <VeredictoCard veredicto={veredicto} />}

        {!veredicto && !cargando && !error && <ComoFunciona />}
      </div>
    </div>
  )
}

function Semaforo({ activo }: { activo: VeredictoColor }) {
  const luces: { color: VeredictoColor; on: string; off: string }[] = [
    { color: 'rojo', on: 'bg-clay shadow-[0_0_16px_2px] shadow-clay/50', off: 'bg-clay/15' },
    { color: 'amarillo', on: 'bg-amber-400 shadow-[0_0_16px_2px] shadow-amber-400/50', off: 'bg-amber-400/15' },
    { color: 'verde', on: 'bg-lime-deep shadow-[0_0_16px_2px] shadow-lime-deep/50', off: 'bg-lime-deep/15' },
  ]
  return (
    <div className="flex flex-col items-center gap-2 rounded-full border border-ink/10 bg-ink/90 p-2.5">
      {luces.map((l) => (
        <span
          key={l.color}
          className={`size-4 rounded-full transition-all ${
            activo === l.color ? l.on : 'bg-white/10'
          }`}
        />
      ))}
    </div>
  )
}

function VeredictoCard({ veredicto }: { veredicto: VerificacionVeredicto }) {
  const cfg = CONFIG[veredicto.estado]
  const { Icon } = cfg
  const bici = veredicto.bicicleta

  return (
    <div className={`rounded-3xl border p-6 ${cfg.card} rd-rise`}>
      <div className="flex items-start gap-4">
        <Semaforo activo={cfg.light} />
        <div className="min-w-0 flex-1">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${cfg.badge}`}
          >
            <span className={`flex size-5 items-center justify-center rounded-full ${cfg.iconWrap}`}>
              <Icon className="size-3.5" />
            </span>
            {veredicto.estado.replace('_', ' ')}
          </span>
          <h2 className="mt-3 font-display text-2xl font-bold text-ink">
            {veredicto.titulo}
          </h2>
          <p className="mt-1.5 text-sm text-ink/80">{veredicto.mensaje}</p>
        </div>
      </div>

      {/* Alerta de robo + contacto con autoridades. */}
      {veredicto.alertaRobo && (
        <div className="mt-5 rounded-2xl border border-clay/40 bg-white/70 p-4">
          <span className="flex items-center gap-2 text-sm font-bold text-clay">
            <Phone className="size-4" />
            {veredicto.alertaRobo.mensaje}
          </span>
          <p className="mt-1.5 text-sm text-ink/80">{veredicto.alertaRobo.contacto}</p>
        </div>
      )}

      {/* Datos NO sensibles del bien. Nunca datos del propietario. */}
      {bici && (
        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl bg-white/60 p-4 sm:grid-cols-3">
          <Dato etiqueta="Marca" valor={bici.marca} />
          <Dato etiqueta="Modelo" valor={bici.modelo} />
          <Dato etiqueta="Tipo" valor={bici.tipo} />
          {bici.anio !== null && <Dato etiqueta="Año" valor={String(bici.anio)} />}
          {bici.color && <Dato etiqueta="Color" valor={bici.color} />}
          <Dato etiqueta="N° de serie" valor={bici.numeroSerie} mono />
        </dl>
      )}

      {/* Coincidencia del hash con la BFA (blockchain). */}
      {veredicto.bfa && (veredicto.estado === 'SEGURO' || veredicto.estado === 'ROBADA') && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-ink/10 bg-white/60 px-4 py-3 text-xs">
          <span className="flex items-center gap-1.5 font-semibold text-ink">
            <Fingerprint className="size-4 text-ink/60" />
            Registro en la BFA
          </span>
          {veredicto.bfa.coincide ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-lime-deep">
              <CheckCircle2 className="size-4" />
              Huella verificada en blockchain
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-warm">
              <Clock className="size-4" />
              Anclaje en proceso ({veredicto.bfa.estado})
            </span>
          )}
          {veredicto.codigoCit && (
            <span className="inline-flex items-center gap-1.5 text-slate-warm">
              <Link2 className="size-3.5" />
              <span className="font-mono">{veredicto.codigoCit}</span>
            </span>
          )}
        </div>
      )}
    </div>
      {veredicto.bicicleta?.numeroSerie && (
        <div className="mt-4">
          <a href={"/api/v1/gov/certificado?serie=" + veredicto.bicicleta.numeroSerie} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full border border-[#2BBCB8] px-4 py-2 text-xs font-semibold text-[#2BBCB8] hover:bg-[#2BBCB8]/10">📄 Certificado oficial</a>
        </div>
      )}
  )
}

function Dato({
  etiqueta,
  valor,
  mono,
}: {
  etiqueta: string
  valor: string
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-warm">
        {etiqueta}
      </dt>
      <dd className={`truncate text-sm font-semibold text-ink ${mono ? 'font-mono' : ''}`}>
        {valor}
      </dd>
    </div>
  )
}

function ComoFunciona() {
  const items = [
    {
      Icon: ShieldCheck,
      color: 'text-lime-deep',
      titulo: 'Verde · Segura',
      texto: 'Identidad (CIT) activa, sin denuncias.',
    },
    {
      Icon: Clock,
      color: 'text-amber-500',
      titulo: 'Amarillo · En validación',
      texto: 'Identidad pendiente o vencida.',
    },
    {
      Icon: ShieldAlert,
      color: 'text-clay',
      titulo: 'Rojo · Robada',
      texto: 'Reportada como robada. No la compres.',
    },
  ]
  return (
    <div className="rounded-3xl border border-dashed border-ink/15 bg-white/50 p-6">
      <span className="flex items-center justify-center gap-2 text-sm font-semibold text-ink">
        <Bike className="size-4 text-clay" />
        Qué significan los colores
      </span>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {items.map((i) => (
          <div
            key={i.titulo}
            className="rounded-2xl border border-ink/10 bg-paper px-4 py-4 text-center"
          >
            <i.Icon className={`mx-auto size-6 ${i.color}`} />
            <p className="mt-2 text-sm font-bold text-ink">{i.titulo}</p>
            <p className="mt-1 text-xs text-slate-warm">{i.texto}</p>
          </div>
        ))}
      </div>
      <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-xs text-slate-warm">
        Tus consultas son anónimas.
        <ArrowRight className="size-3.5" />
        Protegemos tu privacidad y la del propietario.
      </p>
    </div>
  )
}

function VeredictoSkeleton() {
  return (
    <div className="rounded-3xl border border-ink/10 bg-white p-6">
      <div className="flex items-start gap-4">
        <div className="h-24 w-12 animate-pulse rounded-full bg-paper-dim" />
        <div className="flex-1 space-y-3">
          <div className="h-5 w-32 animate-pulse rounded-full bg-paper-dim" />
          <div className="h-7 w-3/4 animate-pulse rounded bg-paper-dim" />
          <div className="h-4 w-full animate-pulse rounded bg-paper-dim" />
        </div>
      </div>
    </div>
  )
}
