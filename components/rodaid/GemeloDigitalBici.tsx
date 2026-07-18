'use client'

import { useId, useState } from 'react'
import { Radio, Wrench, X, MessageCircle, Tag } from 'lucide-react'
import type { EstadoZona, GemeloDigital, ZonaGemeloDigital, ZonaId } from '@/lib/garaje-digital'

/**
 * RODAID — Gemelo Digital Interactivo (Garaje Digital, "puntos de calor").
 *
 * Fase 2: geometria de cuadro diamante real (tubo superior/inferior/asiento,
 * vainas), manubrio+potencia y sillin+tija como elementos visuales propios
 * (no solo puntos), ruedas proporcionadas relativas al cuadro (ratio
 * wheelbase/diametro ~1.6, similar al de una bici real). Las 7 zonas base
 * estan ancladas a puntos anatomicos reales (la horquilla ES el trazo
 * cabeza-de-horquilla→eje delantero, la cadena ES el tramo plato→piñon, los
 * frenos estan en la posicion real de una pinza sobre la llanta).
 *
 * Zonas condicionales (amortiguador_trasero/motor/bateria) -- SOLO se
 * renderizan si `gemelo.zonas` las trae (zonasAplicables() en el servicio ya
 * decide esto, este componente no vuelve a evaluar tipo/suspension):
 *   - amortiguador_trasero: la geometria del triangulo trasero CAMBIA de
 *     verdad frente a una bici rigida -- pivote + basculante (en vez de
 *     vaina recta) + el amortiguador como tensor propio. No es solo pintar
 *     un circulo mas, es la unica zona que altera la estructura del cuadro.
 *   - motor: bloque en el eje pedalier (ubicacion real de un motor mid-drive).
 *   - bateria: tramo mas grueso sobre el tubo inferior (integracion real de
 *     bateria en e-bikes modernas).
 *
 * Fase 1 (single-shared-schematic, `ilustracion` sin usar visualmente
 * todavia) sigue vigente -- esto es geometria/proporcion + zonas
 * condicionales, no una re-skin por tipo de bici.
 *
 * Modo holografico (gemelo.tipo === 'Eléctrica'): mismo SVG, mismas 7+
 * zonas, ningun cambio de geometria -- solo tratamiento de linea/color
 * (fondo oscuro del contenedor + filtro de glow SVG feGaussianBlur+feMerge
 * sobre los trazos existentes, paleta navy/teal de RODAID en vez de gris
 * plano). 'sin_datos' deliberadamente SIN glow en este modo tambien (tono
 * apagado, sin filtro) -- la ausencia de dato no debe competir visualmente
 * con una zona que si tiene alerta real.
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

/** Variantes brillantes para el modo holográfico -- los tonos pastel del
 * modo claro se ven apagados/chalky sobre #060B14. `glow: false` en
 * sin_datos es a propósito (ver comentario de arriba). */
const COLOR_HOLO: Record<EstadoZona, { stroke: string; glow: boolean }> = {
  ok: { stroke: '#34f5b0', glow: true },
  media: { stroke: '#ffc233', glow: true },
  alta: { stroke: '#ff4d6d', glow: true },
  sin_datos: { stroke: '#4d6470', glow: false },
}
const FRAME_HOLO = '#1c5c59' // cuadro/cockpit estructural en modo holográfico -- "trazas de circuito"
const BB_CLUSTER_HOLO = '#0d2b29'

const ETIQUETA_ESTADO: Record<EstadoZona, string> = {
  ok: 'OK',
  media: 'A revisar',
  alta: 'Atención',
  sin_datos: 'Sin datos',
}

/** Resuelve stroke/fill/filter de una zona clickeable segun el modo. En
 * modo holografico el fill pasa a ser un tinte muy tenue del mismo stroke
 * (evita el look "chalky" de un pastel plano sobre fondo casi negro) y se
 * agrega el filtro de glow fuerte, salvo en sin_datos. */
function estiloZona(estado: EstadoZona, holografico: boolean, filtroId: string) {
  if (!holografico) {
    const c = COLOR_POR_ESTADO[estado]
    return { stroke: c.stroke, fill: c.fill, fillOpacity: undefined as number | undefined, filter: undefined as string | undefined }
  }
  const c = COLOR_HOLO[estado]
  return {
    stroke: c.stroke,
    fill: c.stroke,
    fillOpacity: 0.16,
    filter: c.glow ? `url(#glow-strong-${filtroId})` : undefined,
  }
}

/**
 * Geometria del cuadro diamante sobre un viewBox 400x240 (silueta lateral).
 * Puntos anatomicos: BB (eje pedalier), ST_TOP (union tubo superior/tubo de
 * asiento), HT_TOP/HT_BOTTOM (cabeza de direccion), ejes de rueda. Todo lo
 * demas (horquilla, vainas, cadena, frenos, pivote/basculante) se deriva de
 * estos puntos, no son coordenadas independientes.
 */
const REAR_AXLE = { x: 100, y: 165 }
const FRONT_AXLE = { x: 300, y: 165 }
const WHEEL_R = 62 // llanta/cubierta exterior
const RIM_R = 32 // llanta interior/buje -- zona clickeable de rueda
const BB = { x: 185, y: 158 } // eje pedalier
const ST_TOP = { x: 150, y: 75 } // union tubo superior + tubo de asiento
// Cabeza de direccion + horquilla en angulo real de MTB (65-69 grados desde
// la horizontal, mas acostado que ruta 72-74; referencia usada: 67).
// FRONT_AXLE (fijo, ancla el resto del cuadro/ruedas) y HT_TOP quedan sobre
// la misma recta: tubo de direccion HT_TOP->HT_BOTTOM ~68.2 grados, horquilla
// HT_BOTTOM->FRONT_AXLE ~66.7 grados -- practicamente colineales (sin quiebre
// visible), y el eje delantero queda proyectado ADELANTE de la cabeza de
// direccion, no apilado debajo (bug corregido: HT_TOP.x antes era mayor que
// HT_BOTTOM.x, la cabeza de direccion se inclinaba hacia atras al subir).
const HT_TOP = { x: 258, y: 65 } // cabeza de direccion, arriba
const HT_BOTTOM = { x: 272, y: 100 } // cabeza de direccion, abajo (corona de horquilla)
const SEATPOST_TOP = { x: 145, y: 55 }
const STEM_TOP = { x: 271, y: 48 }
const PEDAL = { x: 200, y: 172 }

// Cadena: tramo plato (BB) → piñon (buje trasero). El recorrido real de la
// cadena no cambia entre rigida/doble suspension (misma simplificacion en
// ambos casos), levemente por encima de la vaina para no superponerse 100%.
const CADENA_START = { x: 182, y: 150 }
const CADENA_END = { x: 103, y: 157 }

// Frenos: posicion real de una pinza sobre la llanta -- punto fijo, no
// depende de si la vaina trasera es recta (rigida) o un basculante (doble
// suspension): el freno se monta sobre la llanta en ambos casos.
const FRENO_TRASERO_POS = { x: 120, y: 129 }
const FRENO_DELANTERO_POS = { x: 282, y: 123 }

// Triangulo trasero de doble suspension: pivote principal + basculante
// (reemplaza la vaina inferior recta) + el amortiguador como tensor propio
// entre el tubo de asiento y el basculante.
const PIVOTE = { x: 170, y: 130 }
const AMORTIGUADOR_TOP = { x: 163, y: 100 } // sobre el tubo de asiento
const AMORTIGUADOR_BOTTOM = { x: 174, y: 133 } // sobre el basculante, junto al pivote

// Motor e-bike (mid-drive): housing sobre el eje pedalier.
const MOTOR_RECT = { x: BB.x - 20, y: BB.y - 16, width: 40, height: 32, rx: 12 }

// Bateria e-bike: tramo integrado sobre el tubo inferior (BB → cabeza de
// horquilla), del 10% al 80% del recorrido -- deja lugar visual al motor
// (cerca de BB) y a la cabeza de direccion.
function puntoEnSegmento(a: { x: number; y: number }, b: { x: number; y: number }, t: number) {
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }
}
const BATERIA_START = puntoEnSegmento(BB, HT_BOTTOM, 0.12)
const BATERIA_END = puntoEnSegmento(BB, HT_BOTTOM, 0.8)

export function GemeloDigitalBici({ gemelo }: { gemelo: GemeloDigital }) {
  const [seleccionada, setSeleccionada] = useState<ZonaId | null>(null)
  const filtroId = useId()
  // Modo holografico: SOLO e-bikes. Mismo SVG/zonas, cero cambio de
  // geometria -- ver comentario del encabezado del archivo.
  const holo = gemelo.tipo === 'Eléctrica'

  const zonaPorId = new Map(gemelo.zonas.map((z) => [z.zonaId, z]))
  const cadena = zonaPorId.get('cadena')!
  const cubiertas = zonaPorId.get('cubiertas')!
  const horquilla = zonaPorId.get('horquilla')!
  const ruedaDelantera = zonaPorId.get('rueda_delantera')!
  const ruedaTrasera = zonaPorId.get('rueda_trasera')!
  const frenoDelantero = zonaPorId.get('freno_delantero')!
  const frenoTrasero = zonaPorId.get('freno_trasero')!
  // Condicionales -- undefined si zonasAplicables() no las incluyo para
  // esta bici (rigida / no electrica). Este componente no vuelve a decidir
  // tipo/suspension, solo reacciona a si el dato vino o no.
  const amortiguadorTrasero = zonaPorId.get('amortiguador_trasero')
  const motor = zonaPorId.get('motor')
  const bateria = zonaPorId.get('bateria')

  const zonaActiva = seleccionada ? zonaPorId.get(seleccionada) ?? null : null
  const abrir = (z: ZonaId) => setSeleccionada(z)

  const frameColor = holo ? FRAME_HOLO : '#cbd5e1'
  const frameColorDark = holo ? FRAME_HOLO : '#94a3b8'
  const bbClusterColor = holo ? BB_CLUSTER_HOLO : '#64748b'
  const glowSoft = holo ? `url(#glow-soft-${filtroId})` : undefined

  return (
    <div className={`rounded-2xl border p-5 transition-colors ${holo ? 'border-[#1c5c59]/60 bg-[#060B14]' : 'border-ink/10 bg-white'}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className={`font-display text-sm font-semibold ${holo ? 'text-[#e8f3f2]' : 'text-[#0F1E35]'}`}>Gemelo Digital</h3>
        <span className={`text-[11px] ${holo ? 'text-[#6f8d8a]' : 'text-slate-warm'}`}>Tocá una zona para ver el detalle</span>
      </div>

      <svg viewBox="0 0 400 240" className="w-full max-w-md mx-auto" role="img" aria-label="Diagrama de la bicicleta con puntos de calor">
        {holo && (
          <defs>
            <filter id={`glow-soft-${filtroId}`} x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="1.6" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id={`glow-strong-${filtroId}`} x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="3.2" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
        )}

        {/* Cuadro diamante (estructural, no interactivo) */}
        <g stroke={frameColor} strokeWidth={6} fill="none" strokeLinecap="round" strokeLinejoin="round" filter={glowSoft}>
          <path d={`M ${ST_TOP.x} ${ST_TOP.y} L ${HT_TOP.x} ${HT_TOP.y}`} />
          <path d={`M ${BB.x} ${BB.y} L ${HT_BOTTOM.x} ${HT_BOTTOM.y}`} />
          <path d={`M ${BB.x} ${BB.y} L ${ST_TOP.x} ${ST_TOP.y}`} />
        </g>
        <path
          d={`M ${HT_TOP.x} ${HT_TOP.y} L ${HT_BOTTOM.x} ${HT_BOTTOM.y}`}
          stroke={frameColorDark}
          strokeWidth={8}
          strokeLinecap="round"
          filter={glowSoft}
        />

        {/* Triangulo trasero: vaina recta (rigida) o pivote+basculante (doble
            suspension) -- la vaina superior (tubo de asiento → eje trasero)
            no cambia entre los dos casos. */}
        <g stroke={frameColor} strokeWidth={4} fill="none" strokeLinecap="round" filter={glowSoft}>
          <path d={`M ${ST_TOP.x} ${ST_TOP.y} L ${REAR_AXLE.x} ${REAR_AXLE.y}`} />
          {amortiguadorTrasero ? (
            <>
              <path d={`M ${BB.x} ${BB.y} L ${PIVOTE.x} ${PIVOTE.y}`} />
              <path d={`M ${PIVOTE.x} ${PIVOTE.y} L ${REAR_AXLE.x} ${REAR_AXLE.y}`} strokeWidth={5} />
            </>
          ) : (
            <path d={`M ${BB.x} ${BB.y} L ${REAR_AXLE.x} ${REAR_AXLE.y}`} />
          )}
        </g>
        {amortiguadorTrasero && <circle cx={PIVOTE.x} cy={PIVOTE.y} r={4} fill={frameColorDark} filter={glowSoft} />}

        {/* Cockpit: manubrio, potencia, sillin, tija (decorativo, no interactivo) */}
        <g stroke={frameColorDark} strokeWidth={4} fill="none" strokeLinecap="round" filter={glowSoft}>
          <path d={`M ${ST_TOP.x} ${ST_TOP.y} L ${SEATPOST_TOP.x} ${SEATPOST_TOP.y}`} />
          <path d={`M ${HT_TOP.x} ${HT_TOP.y} L ${STEM_TOP.x} ${STEM_TOP.y}`} />
          <path d="M 255 46 Q 271 38 287 46" />
        </g>
        <ellipse cx={138} cy={53} rx={15} ry={5} fill={frameColorDark} filter={glowSoft} />

        {/* Motor (e-bike, mid-drive) -- clickeable, sobre el eje pedalier.
            Se dibuja ANTES del plato/biela/pedal para que esos elementos
            lean "montados sobre" el motor, como en una bici real. */}
        {motor && (() => {
          const est = estiloZona(motor.estado, holo, filtroId)
          return (
            <g onClick={() => abrir('motor')} className="cursor-pointer">
              <rect
                x={MOTOR_RECT.x} y={MOTOR_RECT.y} width={MOTOR_RECT.width} height={MOTOR_RECT.height} rx={MOTOR_RECT.rx}
                fill={est.fill} fillOpacity={est.fillOpacity} stroke={est.stroke} strokeWidth={3} filter={est.filter}
              />
            </g>
          )
        })()}

        {/* Plato + eje pedalier + biela + pedal (decorativo) */}
        <circle cx={BB.x} cy={BB.y} r={13} fill="none" stroke={frameColorDark} strokeWidth={2.5} filter={glowSoft} />
        <path d={`M ${BB.x} ${BB.y} L ${PEDAL.x} ${PEDAL.y}`} stroke={frameColorDark} strokeWidth={3} strokeLinecap="round" filter={glowSoft} />
        <circle cx={PEDAL.x} cy={PEDAL.y} r={5} fill={frameColorDark} filter={glowSoft} />
        <circle cx={BB.x} cy={BB.y} r={7} fill={bbClusterColor} filter={glowSoft} />

        {/* Cadena -- tramo plato→piñon */}
        {(() => {
          const est = estiloZona(cadena.estado, holo, filtroId)
          return (
            <g onClick={() => abrir('cadena')} className="cursor-pointer">
              <path
                d={`M ${CADENA_START.x} ${CADENA_START.y} L ${CADENA_END.x} ${CADENA_END.y}`}
                stroke={est.stroke} strokeWidth={5} strokeLinecap="round" filter={est.filter}
              />
            </g>
          )
        })()}

        {/* Bateria (e-bike) -- clickeable, tramo integrado sobre el tubo
            inferior. Se dibuja despues del tubo inferior gris para que se
            lea como "esta parte del tubo ES la bateria". */}
        {bateria && (() => {
          const est = estiloZona(bateria.estado, holo, filtroId)
          return (
            <g onClick={() => abrir('bateria')} className="cursor-pointer">
              <path
                d={`M ${BATERIA_START.x} ${BATERIA_START.y} L ${BATERIA_END.x} ${BATERIA_END.y}`}
                stroke={est.stroke} strokeWidth={14} strokeLinecap="round" filter={est.filter}
              />
            </g>
          )
        })()}

        {/* Cubiertas: UNA zona logica sobre el anillo exterior de ambas ruedas */}
        {(() => {
          const est = estiloZona(cubiertas.estado, holo, filtroId)
          return (
            <g onClick={() => abrir('cubiertas')} className="cursor-pointer">
              <circle cx={REAR_AXLE.x} cy={REAR_AXLE.y} r={WHEEL_R} fill="none" stroke={est.stroke} strokeWidth={7} filter={est.filter} />
              <circle cx={FRONT_AXLE.x} cy={FRONT_AXLE.y} r={WHEEL_R} fill="none" stroke={est.stroke} strokeWidth={7} filter={est.filter} />
            </g>
          )
        })()}

        {/* Horquilla -- cabeza de direccion → eje delantero, el trazo ES la horquilla */}
        {(() => {
          const est = estiloZona(horquilla.estado, holo, filtroId)
          return (
            <g onClick={() => abrir('horquilla')} className="cursor-pointer">
              <path
                d={`M ${HT_BOTTOM.x} ${HT_BOTTOM.y} L ${FRONT_AXLE.x} ${FRONT_AXLE.y}`}
                stroke={est.stroke} strokeWidth={8} strokeLinecap="round" filter={est.filter}
              />
            </g>
          )
        })()}

        {/* Ruedas (buje/llanta interior) -- zona manual */}
        {(() => {
          const est = estiloZona(ruedaTrasera.estado, holo, filtroId)
          return (
            <g onClick={() => abrir('rueda_trasera')} className="cursor-pointer">
              <circle cx={REAR_AXLE.x} cy={REAR_AXLE.y} r={RIM_R} fill={est.fill} fillOpacity={est.fillOpacity} stroke={est.stroke} strokeWidth={3} filter={est.filter} />
            </g>
          )
        })()}
        {(() => {
          const est = estiloZona(ruedaDelantera.estado, holo, filtroId)
          return (
            <g onClick={() => abrir('rueda_delantera')} className="cursor-pointer">
              <circle cx={FRONT_AXLE.x} cy={FRONT_AXLE.y} r={RIM_R} fill={est.fill} fillOpacity={est.fillOpacity} stroke={est.stroke} strokeWidth={3} filter={est.filter} />
            </g>
          )
        })()}

        {/* Frenos -- posicion real de pinza sobre la llanta */}
        {(() => {
          const est = estiloZona(frenoTrasero.estado, holo, filtroId)
          return (
            <g onClick={() => abrir('freno_trasero')} className="cursor-pointer">
              <circle cx={FRENO_TRASERO_POS.x} cy={FRENO_TRASERO_POS.y} r={10} fill={est.fill} fillOpacity={est.fillOpacity} stroke={est.stroke} strokeWidth={2.5} filter={est.filter} />
            </g>
          )
        })()}
        {(() => {
          const est = estiloZona(frenoDelantero.estado, holo, filtroId)
          return (
            <g onClick={() => abrir('freno_delantero')} className="cursor-pointer">
              <circle cx={FRENO_DELANTERO_POS.x} cy={FRENO_DELANTERO_POS.y} r={10} fill={est.fill} fillOpacity={est.fillOpacity} stroke={est.stroke} strokeWidth={2.5} filter={est.filter} />
            </g>
          )
        })()}

        {/* Amortiguador trasero (doble suspension) -- clickeable, el tensor
            entre el tubo de asiento y el basculante. Se dibuja al final para
            quedar por encima del basculante gris. */}
        {amortiguadorTrasero && (() => {
          const est = estiloZona(amortiguadorTrasero.estado, holo, filtroId)
          return (
            <g onClick={() => abrir('amortiguador_trasero')} className="cursor-pointer">
              <path
                d={`M ${AMORTIGUADOR_TOP.x} ${AMORTIGUADOR_TOP.y} L ${AMORTIGUADOR_BOTTOM.x} ${AMORTIGUADOR_BOTTOM.y}`}
                stroke={est.stroke} strokeWidth={7} strokeLinecap="round" filter={est.filter}
              />
            </g>
          )
        })()}
      </svg>

      {/* Leyenda */}
      <div className={`mt-3 flex flex-wrap justify-center gap-3 text-[11px] ${holo ? 'text-[#6f8d8a]' : 'text-slate-warm'}`}>
        {(['ok', 'media', 'alta', 'sin_datos'] as EstadoZona[]).map((e) => (
          <span key={e} className="inline-flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: holo ? COLOR_HOLO[e].stroke : COLOR_POR_ESTADO[e].stroke }}
            />
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
