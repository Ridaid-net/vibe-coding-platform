'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Award,
  Calendar,
  Loader2,
  Phone,
  ShieldAlert,
  ShieldCheck,
  Wrench,
} from 'lucide-react'
import {
  consultarHistorialPublico,
  type HistorialPublico,
  type VeredictoColor,
  type VeredictoEstado,
} from '@/lib/historial'

/**
 * Historial Clinico publico de una bici (Hito compartir/Garaje Digital).
 * Destino del link/QR que el dueño activa desde su Garaje. Sin autenticacion,
 * sin datos personales del dueño -- solo lo que ya esta pensado para ser
 * publico (identidad del CIT, BiciSalud, Score de Confianza total+badge,
 * resumen de inspecciones).
 */

interface EstadoConfig {
  light: VeredictoColor
  card: string
  badge: string
}

const CONFIG: Record<VeredictoEstado, EstadoConfig> = {
  SEGURO: { light: 'verde', card: 'border-lime-deep/50 bg-lime/15', badge: 'bg-lime-deep/20 text-ink' },
  ROBADA: { light: 'rojo', card: 'border-clay/50 bg-clay/10', badge: 'bg-clay/20 text-clay' },
  EN_VALIDACION: { light: 'amarillo', card: 'border-amber-400/60 bg-amber-50', badge: 'bg-amber-100 text-amber-700' },
  SIN_VERIFICAR: { light: 'amarillo', card: 'border-amber-400/50 bg-amber-50/70', badge: 'bg-amber-100 text-amber-700' },
  NO_ENCONTRADA: { light: 'gris', card: 'border-ink/15 bg-white', badge: 'bg-paper-dim text-slate-warm' },
}

const SCORE_MEDALLA: Record<'oro' | 'bronce', { label: string; clase: string }> = {
  oro: { label: 'Oro', clase: 'bg-amber-100 text-amber-800 border-amber-300/70' },
  bronce: { label: 'Bronce', clase: 'bg-orange-100 text-orange-800 border-orange-300/60' },
}

export function HistorialPublicoView({ token }: { token: string }) {
  const [cargando, setCargando] = useState(true)
  const [historial, setHistorial] = useState<HistorialPublico | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setCargando(true)
    setError(null)
    consultarHistorialPublico(token, controller.signal)
      .then((res) => {
        if (res.ok) {
          setHistorial(res.historial)
        } else if (res.status === 404) {
          setError('Este link no existe o el dueño desactivó el historial público de esta bici.')
        } else if (res.status === 429) {
          setError(`Demasiadas consultas. Esperá ${res.error.retryAfter ?? 30} segundos e intentá de nuevo.`)
        } else {
          setError(res.error.message)
        }
      })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return
        setError('No pudimos cargar este historial. Probá de nuevo en unos segundos.')
      })
      .finally(() => setCargando(false))
    return () => controller.abort()
  }, [token])

  if (cargando) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-3xl border border-ink/10 bg-white p-10 text-sm text-slate-warm">
        <Loader2 className="size-4 animate-spin" />
        Cargando historial…
      </div>
    )
  }

  if (error || !historial) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-clay/30 bg-clay/5 px-5 py-4 text-sm text-ink">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-clay" />
        <span>{error ?? 'No pudimos cargar este historial.'}</span>
      </div>
    )
  }

  const { veredicto } = historial
  const cfg = CONFIG[veredicto.estado]
  const bici = veredicto.bicicleta

  return (
    <div className="space-y-5">
      <div className={`rounded-3xl border p-6 ${cfg.card}`}>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${cfg.badge}`}>
          {veredicto.estado === 'SEGURO' ? <ShieldCheck className="size-3.5" /> : <ShieldAlert className="size-3.5" />}
          {veredicto.estado.replace('_', ' ')}
        </span>
        <h1 className="mt-3 font-display text-2xl font-bold text-ink">{veredicto.titulo}</h1>
        <p className="mt-1.5 text-sm text-ink/80">{veredicto.mensaje}</p>

        {veredicto.alertaRobo && (
          <div className="mt-5 rounded-2xl border border-clay/40 bg-white/70 p-4">
            <span className="flex items-center gap-2 text-sm font-bold text-clay">
              <Phone className="size-4" />
              {veredicto.alertaRobo.mensaje}
            </span>
            <p className="mt-1.5 text-sm text-ink/80">{veredicto.alertaRobo.contacto}</p>
          </div>
        )}

        {bici && (
          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl bg-white/60 p-4 sm:grid-cols-3">
            <Dato etiqueta="Marca" valor={bici.marca} />
            <Dato etiqueta="Modelo" valor={bici.modelo} />
            <Dato etiqueta="Tipo" valor={bici.tipo} />
            {bici.anio !== null && <Dato etiqueta="Año" valor={String(bici.anio)} />}
            {bici.color && <Dato etiqueta="Color" valor={bici.color} />}
            {veredicto.codigoCit && <Dato etiqueta="CIT" valor={veredicto.codigoCit} mono />}
            {historial.cit?.fechaEmision && (
              <Dato etiqueta="Emitido" valor={new Date(historial.cit.fechaEmision).toLocaleDateString('es-AR')} />
            )}
          </dl>
        )}
      </div>

      {/* Las secciones siguientes solo existen cuando el backend las manda --
          nunca se agregan si la bici figura ROBADA o no se encontró. */}
      {historial.scoreConfianza && (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-ink/10 bg-white p-5">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            <ShieldCheck className="size-4 text-ink/50" />
            Score de Confianza
          </span>
          <span className="flex items-center gap-2">
            {historial.scoreConfianza.badge && (
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${SCORE_MEDALLA[historial.scoreConfianza.badge].clase}`}>
                <Award className="size-3.5" />
                {SCORE_MEDALLA[historial.scoreConfianza.badge].label}
              </span>
            )}
            <span className="text-lg font-bold text-ink">
              {historial.scoreConfianza.total}
              <span className="text-xs font-medium text-slate-warm">/100</span>
            </span>
          </span>
        </div>
      )}

      {historial.inspecciones && historial.inspecciones.total > 0 && (
        <div className="rounded-2xl border border-ink/10 bg-white p-5">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            <Wrench className="size-4 text-ink/50" />
            Inspecciones en talleres aliados
          </span>
          <p className="mt-2 text-sm text-ink/80">
            {historial.inspecciones.total} inspección{historial.inspecciones.total > 1 ? 'es' : ''} aprobada
            {historial.inspecciones.total > 1 ? 's' : ''}
            {historial.inspecciones.tallerNombre ? ` · última en ${historial.inspecciones.tallerNombre}` : ''}
          </p>
          {historial.inspecciones.fechas.length > 0 && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-warm">
              <Calendar className="size-3.5" />
              Última: {new Date(historial.inspecciones.fechas[0]!).toLocaleDateString('es-AR')}
            </p>
          )}
        </div>
      )}

      {historial.biciSalud && historial.biciSalud.length > 0 && (
        <div className="rounded-2xl border border-ink/10 bg-white p-5">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            <Activity className="size-4 text-ink/50" />
            BiciSalud
          </span>
          <ul className="mt-3 space-y-2">
            {historial.biciSalud.map((item, i) => (
              <li key={i} className="rounded-xl bg-paper-dim/60 px-3.5 py-2.5 text-xs">
                <span
                  className={`mr-2 inline-flex items-center rounded-full px-2 py-0.5 font-semibold uppercase ${
                    item.severidad === 'critica' || item.severidad === 'alta'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-paper text-slate-warm'
                  }`}
                >
                  {item.severidad}
                </span>
                {item.titulo}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border border-lime-deep/30 bg-lime/10 p-5 text-center">
        <p className="text-sm text-ink">
          Este historial es verificable en <strong>RODAID</strong>, la plataforma de identidad y
          trazabilidad de bicicletas de Mendoza.
        </p>
        <Link
          href="/"
          className="mt-3 inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
        >
          Conocé RODAID
        </Link>
      </div>
    </div>
  )
}

function Dato({ etiqueta, valor, mono }: { etiqueta: string; valor: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-slate-warm">{etiqueta}</dt>
      <dd className={`mt-0.5 text-sm font-semibold text-ink ${mono ? 'font-mono' : ''}`}>{valor}</dd>
    </div>
  )
}
