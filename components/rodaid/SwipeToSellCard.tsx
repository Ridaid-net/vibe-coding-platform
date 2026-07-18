'use client'

import { useState } from 'react'
import { LazyMotion, domMax, m, type PanInfo } from 'framer-motion'
import { Check, X } from 'lucide-react'
import type { ActivoGaraje } from '@/lib/garaje-digital'
import { generarDescripcion, generarTitulo, precioSugerido } from '@/lib/swipe-to-sell'

/**
 * Tarjeta de gesto de swipe (Garaje → Marketplace, sin formulario).
 *
 * Carga `LazyMotion` + `domMax` (el feature de framer-motion con soporte de
 * drag, ~30KB gzip real -- ver comparativo con Pointer Events manual) --
 * este componente SOLO se importa vía `next/dynamic({ ssr: false })` desde
 * `VenderSwipe.tsx`, para que Next.js lo separe en su propio chunk (code
 * splitting de ruta) y no sume peso al bundle global del sitio.
 *
 * Título fijo (plantilla). Descripción editable con un toque (confirmado
 * con Federico). Precio SIEMPRE editable (es plata) y SIEMPRE etiquetado
 * como estimación, nunca como análisis real.
 */

const UMBRAL_PX = 120
const UMBRAL_VELOCIDAD = 500

interface Props {
  activo: ActivoGaraje
  enviando?: boolean
  onConfirmar: (input: { titulo: string; descripcion: string; precioARS: number }) => void
  onDescartar: () => void
}

export function SwipeToSellCard({ activo, enviando = false, onConfirmar, onDescartar }: Props) {
  const [precio, setPrecio] = useState(() => precioSugerido(activo).monto)
  const [descripcion, setDescripcion] = useState(() => generarDescripcion(activo))
  const [editandoDescripcion, setEditandoDescripcion] = useState(false)
  const titulo = generarTitulo(activo)

  const handleDragEnd = (_event: unknown, info: PanInfo) => {
    if (info.offset.x > UMBRAL_PX || info.velocity.x > UMBRAL_VELOCIDAD) {
      onConfirmar({ titulo, descripcion, precioARS: precio })
      return
    }
    if (info.offset.x < -UMBRAL_PX || info.velocity.x < -UMBRAL_VELOCIDAD) {
      onDescartar()
    }
    // Si no cruza ningun umbral, dragSnapToOrigin anima la vuelta al centro.
  }

  return (
    <LazyMotion features={domMax} strict>
      <m.div
        drag={enviando ? false : 'x'}
        dragSnapToOrigin
        dragElastic={0.6}
        onDragEnd={handleDragEnd}
        whileDrag={{ scale: 1.02, rotate: 3 }}
        className="touch-pan-y cursor-grab select-none rounded-3xl border border-ink/10 bg-white p-5 shadow-sm active:cursor-grabbing"
      >
        {activo.fotoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={activo.fotoUrl} alt={titulo} className="h-40 w-full rounded-2xl object-cover" draggable={false} />
        )}

        <h3 className="mt-3 font-display text-lg font-bold text-ink">{titulo}</h3>

        {editandoDescripcion ? (
          <textarea
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            onBlur={() => setEditandoDescripcion(false)}
            rows={3}
            autoFocus
            className="mt-2 w-full rounded-xl border border-ink/15 px-3 py-2 text-sm outline-none focus:border-ink/40"
          />
        ) : (
          <p
            onClick={() => setEditandoDescripcion(true)}
            className="mt-2 cursor-text text-sm text-slate-warm"
          >
            {descripcion}{' '}
            <span className="text-ink/40 underline decoration-dotted underline-offset-2">
              (tocá para editar)
            </span>
          </p>
        )}

        <p className="mt-3 text-[11px] text-slate-warm">
          Precio sugerido — estimación automática, sin datos de mercado reales todavía. Ajustalo si no te parece justo.
        </p>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="text-sm font-semibold text-ink/60">$</span>
          <input
            type="number"
            value={precio}
            onChange={(e) => setPrecio(Number(e.target.value) || 0)}
            className="w-32 rounded-lg border border-ink/15 px-2 py-1 text-sm font-semibold text-ink outline-none focus:border-ink/40"
          />
        </div>

        <div className="mt-4 flex items-center justify-between text-xs font-semibold text-slate-warm">
          <span className="inline-flex items-center gap-1 text-clay">
            <X className="size-3.5" /> deslizá a la izquierda para descartar
          </span>
          <span className="inline-flex items-center gap-1 text-[#0a7d5a]">
            <Check className="size-3.5" /> deslizá a la derecha para publicar
          </span>
        </div>
      </m.div>
    </LazyMotion>
  )
}
