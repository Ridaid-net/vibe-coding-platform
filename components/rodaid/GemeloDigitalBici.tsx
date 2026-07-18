'use client'

import { useState } from 'react'
import { Radio, Wrench, X, MessageCircle, Tag } from 'lucide-react'
import type { EstadoZona, GemeloDigital, ZonaGemeloDigital, ZonaId } from '@/lib/garaje-digital'

/**
 * RODAID — Gemelo Digital Interactivo (Garaje Digital, "puntos de calor").
 *
 * Ilustracion 2D simple (SVG inline, sin dependencia nueva) de la bici, con
 * hasta 7 zonas clickeables coloreadas segun su estado. Geometria schematic
 * MVP (circulos + trazos), no arte final por tipo -- las 3 ilustraciones +
 * silueta generica comparten esta misma geometria por ahora; el prop
 * `ilustracion` ya queda disponible para cuando haya arte real distinto por
 * tipo, sin tocar el contrato de datos.
 *
 * IMPORTANTE (mismo criterio que Score de Confianza): 'sin_datos' es gris,
 * nunca verde -- ausencia de dato no es "sano". El verde solo aparece para
 * un resultado manual 'ok' genuino (un inspector lo confirmo), algo que el
 * IoT solo nunca puede producir (solo detecta problemas o no dice nada).
 */

const COLOR_POR_ESTADO: Record<EstadoZona, { fill: string; stroke: string; texto: string; chip: string }> = {
  ok: { fill: '#dcfce7', stroke: '#16a34a', texto: 'text-green-700', chip: 'bg-green-100 text-green-700' },
  media: { fill: '#fef3c7', stroke: '#d97706', texto: 'text-amber-700', chip: 'bg-amber-100 text-amber-700' },
  alta: { fill: '#fee2e2', stroke: '#dc2626', texto: 'text-red-700', chip: 'bg-red-100 text-red-700' },
  sin_datos: { fill: '#f1f5f9', stroke: '#94a3b8', texto: 'text-slate-500', chip: 'bg-slate-100 text-slate-500' },
}

const ETIQUETA_ESTADO: Record<EstadoZona, string> = {
  ok: 'OK',
  media: 'A revisar',
  alta: 'Atención',
  sin_datos: 'Sin datos',
}

/**
 * Layout schematic de las 7 zonas sobre un viewBox 400x220 (silueta lateral
 * simple). 'cubiertas' es UNA sola zona visual cubriendo ambas ruedas a la
 * vez -- el dato IoT no distingue delantera de trasera (un solo
 * acelerometro), asi que no se dibuja como dos hotspots independientes con
 * estados potencialmente distintos.
 */
const RUEDA_TRASERA = { cx: 80, cy: 170 }
const RUEDA_DELANTERA = { cx: 320, cy: 170 }

function ZonaGuardabarros({ zonaId, estado, onClick }: { zonaId: ZonaId; estado: EstadoZona; onClick: () => void }) {
  const c = COLOR_POR_ESTADO[estado]
  return (
    <g onClick={onClick} className="cursor-pointer">
      <circle
        cx={zonaId === 'rueda_trasera' ? RUEDA_TRASERA.cx : RUEDA_DELANTERA.cx}
        cy={170}
        r={28}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={3}
      />
    </g>
  )
}

export function GemeloDigitalBici({ gemelo }: { gemelo: GemeloDigital }) {
  const [seleccionada, setSeleccionada] = useState<ZonaId | null>(null)

  const zonaPorId = new Map(gemelo.zonas.map((z) => [z.zonaId, z]))
  const cadena = zonaPorId.get('cadena')!
  const cubiertas = zonaPorId.get('cubiertas')!
  const horquilla = zonaPorId.get('horquilla')!
  const ruedaDelantera = zonaPorId.get('rueda_delantera')!
  const ruedaTrasera = zonaPorId.get('rueda_trasera')!
  const frenoDelantero = zonaPorId.get('freno_delantero')!
  const frenoTrasero = zonaPorId.get('freno_trasero')!

  const zonaActiva = seleccionada ? zonaPorId.get(seleccionada) ?? null : null
  const abrir = (z: ZonaId) => setSeleccionada(z)

  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-sm font-semibold text-[#0F1E35]">Gemelo Digital</h3>
        <span className="text-[11px] text-slate-warm">Tocá una zona para ver el detalle</span>
      </div>

      <svg viewBox="0 0 400 220" className="w-full max-w-md mx-auto" role="img" aria-label="Diagrama de la bicicleta con puntos de calor">
        {/* Estructura no interactiva (marco, horquilla como trazo, cadena como banda) */}
        <g stroke="#cbd5e1" strokeWidth={4} fill="none" strokeLinecap="round">
          <path d="M 150 175 L 170 70 L 250 70" />
          <path d="M 170 70 L 80 170" />
          <path d="M 250 70 L 150 175" />
        </g>

        {/* Cubiertas: UNA zona logica, dibujada como anillo exterior de ambas ruedas */}
        <g onClick={() => abrir('cubiertas')} className="cursor-pointer">
          <circle cx={RUEDA_TRASERA.cx} cy={170} r={45} fill="none" stroke={COLOR_POR_ESTADO[cubiertas.estado].stroke} strokeWidth={6} />
          <circle cx={RUEDA_DELANTERA.cx} cy={170} r={45} fill="none" stroke={COLOR_POR_ESTADO[cubiertas.estado].stroke} strokeWidth={6} />
        </g>

        {/* Ruedas (aro/rayos) -- zona manual */}
        <ZonaGuardabarros zonaId="rueda_trasera" estado={ruedaTrasera.estado} onClick={() => abrir('rueda_trasera')} />
        <ZonaGuardabarros zonaId="rueda_delantera" estado={ruedaDelantera.estado} onClick={() => abrir('rueda_delantera')} />

        {/* Cadena */}
        <g onClick={() => abrir('cadena')} className="cursor-pointer">
          <rect x={150} y={175} width={120} height={12} rx={6} fill={COLOR_POR_ESTADO[cadena.estado].fill} stroke={COLOR_POR_ESTADO[cadena.estado].stroke} strokeWidth={2.5} />
        </g>

        {/* Horquilla */}
        <g onClick={() => abrir('horquilla')} className="cursor-pointer">
          <path d="M 300 80 L 322 165" stroke={COLOR_POR_ESTADO[horquilla.estado].stroke} strokeWidth={10} strokeLinecap="round" fill="none" />
          <path d="M 250 70 L 300 80" stroke="#cbd5e1" strokeWidth={4} strokeLinecap="round" fill="none" />
        </g>

        {/* Frenos */}
        <g onClick={() => abrir('freno_trasero')} className="cursor-pointer">
          <circle cx={88} cy={132} r={13} fill={COLOR_POR_ESTADO[frenoTrasero.estado].fill} stroke={COLOR_POR_ESTADO[frenoTrasero.estado].stroke} strokeWidth={2.5} />
        </g>
        <g onClick={() => abrir('freno_delantero')} className="cursor-pointer">
          <circle cx={314} cy={130} r={13} fill={COLOR_POR_ESTADO[frenoDelantero.estado].fill} stroke={COLOR_POR_ESTADO[frenoDelantero.estado].stroke} strokeWidth={2.5} />
        </g>
      </svg>

      {/* Leyenda */}
      <div className="mt-3 flex flex-wrap justify-center gap-3 text-[11px] text-slate-warm">
        {(['ok', 'media', 'alta', 'sin_datos'] as EstadoZona[]).map((e) => (
          <span key={e} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: COLOR_POR_ESTADO[e].stroke }} />
            {ETIQUETA_ESTADO[e]}
          </span>
        ))}
      </div>

      {gemelo.servicioTecnico && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50 px-3.5 py-2.5">
          <Wrench className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <div className="text-xs">
            <p className="font-semibold text-amber-800">{gemelo.servicioTecnico.titulo}</p>
            <p className="text-amber-700">{gemelo.servicioTecnico.mensaje}</p>
          </div>
        </div>
      )}

      {zonaActiva && (
        <DetalleZona zona={zonaActiva} onCerrar={() => setSeleccionada(null)} />
      )}
    </div>
  )
}

function DetalleZona({ zona, onCerrar }: { zona: ZonaGemeloDigital; onCerrar: () => void }) {
  const c = COLOR_POR_ESTADO[zona.estado]
  const necesitaTaller = zona.estado === 'media' || zona.estado === 'alta'

  const fechaFormateada = (() => {
    if (!zona.fecha) return null
    const d = new Date(zona.fecha)
    if (zona.fuente === 'manual') return `Verificado el ${d.toLocaleDateString('es-AR')}`
    const dias = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000))
    if (dias === 0) return 'Detectado hoy'
    if (dias === 1) return 'Detectado hace 1 día'
    return `Detectado hace ${dias} días`
  })()

  return (
    <div className="mt-4 rounded-2xl border border-ink/10 bg-paper-dim/40 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.chip}`}>
              {ETIQUETA_ESTADO[zona.estado]}
            </span>
            <h4 className="text-sm font-semibold text-[#0F1E35]">{zona.titulo}</h4>
          </div>
          {fechaFormateada && (
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-warm">
              {zona.fuente === 'iot' ? <Radio className="size-3" /> : <Wrench className="size-3" />}
              {fechaFormateada}
              {zona.fuente === 'manual' && ' · verificación física'}
              {zona.fuente === 'iot' && ' · sensor IoT'}
            </p>
          )}
        </div>
        <button type="button" onClick={onCerrar} className="text-slate-400 hover:text-slate-600">
          <X className="size-4" />
        </button>
      </div>

      {zona.mensaje && <p className="mt-2 text-xs text-ink/80">{zona.mensaje}</p>}

      {zona.componente && (zona.componente.marca || zona.componente.modelo || zona.componente.numeroSerie) && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-warm">
          <Tag className="size-3" />
          {[zona.componente.marca, zona.componente.modelo].filter(Boolean).join(' ')}
          {zona.componente.numeroSerie && ` · N° ${zona.componente.numeroSerie}`}
        </div>
      )}

      {zona.estado === 'sin_datos' && (
        <p className="mt-2 text-xs text-slate-warm">
          Todavía no hay datos de esta zona. Se completa con telemetría IoT o en la próxima inspección física.
        </p>
      )}

      {necesitaTaller && (
        <a
          href="https://wa.me/5492617542335"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#F47B20] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#F47B20]/80"
        >
          <MessageCircle className="size-3.5" />
          Buscá un taller aliado
        </a>
      )}
    </div>
  )
}
