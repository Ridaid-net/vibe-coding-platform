'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { mutate } from 'swr'
import { toast } from 'sonner'
import { ShieldAlert, Store } from 'lucide-react'
import { useActivosGaraje } from '@/lib/garaje-digital'
import { precondicionFaltante, publicarPorSwipe } from '@/lib/swipe-to-sell'
import { DatosBancariosInline } from '@/components/rodaid/DatosBancariosInline'

/**
 * "Vender" — Swipe to Sell. Pantalla/sección NUEVA y separada de la tarjeta
 * densa de `GarajeDigital` (confirmado con Federico: no la reemplaza) --
 * una versión liviana de cada bici, dedicada solo a este flujo.
 *
 * `SwipeToSellCard` (y framer-motion) se cargan SOLO acá, vía next/dynamic
 * con ssr:false, para que Next.js los separe en su propio chunk -- no se
 * suman al bundle de ninguna otra ruta del sitio.
 */
const SwipeToSellCard = dynamic(
  () => import('@/components/rodaid/SwipeToSellCard').then((mod) => mod.SwipeToSellCard),
  { ssr: false }
)

const MENSAJE_PRECONDICION: Record<string, string> = {
  CIT_INACTIVO: 'Verificá tu CIT antes de poder venderla.',
  YA_PUBLICADA: 'Esta bici ya está publicada en el Marketplace.',
}

export function VenderSwipe() {
  const { data, isLoading } = useActivosGaraje()
  const [indice, setIndice] = useState(0)
  const [enviando, setEnviando] = useState(false)

  const candidatas = useMemo(
    () => (data?.activos ?? []).filter((a) => a.estado === 'verificado' && !a.tienePublicacionActiva),
    [data?.activos]
  )

  if (isLoading || !data) return null
  if (candidatas.length === 0) return null

  const actual = candidatas[Math.min(indice, candidatas.length - 1)]
  const faltante = precondicionFaltante(actual, data.tieneDatosBancarios)

  const avanzar = () => setIndice((i) => (i + 1 >= candidatas.length ? 0 : i + 1))

  const handleConfirmar = async (input: { titulo: string; descripcion: string; precioARS: number }) => {
    setEnviando(true)
    try {
      await publicarPorSwipe({
        bicicletaId: actual.id,
        titulo: input.titulo,
        descripcion: input.descripcion,
        precioARS: input.precioARS,
        fotoUrl: actual.fotoUrl,
      })
      toast.success('¡Publicada!', { description: `${actual.marca} ${actual.modelo} ya está en el Marketplace.` })
      await Promise.all([
        mutate('/api/usuario/bicicletas'),
        mutate('/api/marketplace/mis-publicaciones'),
      ])
      avanzar()
    } catch (err) {
      toast.error('No pudimos publicarla', { description: (err as Error).message })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="mt-12">
      <div className="flex items-center gap-2">
        <Store className="size-5 text-ink/60" />
        <h2 className="font-display text-2xl font-bold text-ink">Vender</h2>
        <span className="rounded-full bg-paper-dim px-2.5 py-0.5 text-xs font-semibold text-slate-warm">
          {candidatas.length}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-warm">
        Deslizá para publicar en el Marketplace — sin formulario, título/descripción/precio ya están listos.
      </p>

      <div className="mt-5 max-w-md">
        {faltante === 'CIT_INACTIVO' && (
          <div className="flex items-start gap-2 rounded-2xl border border-clay/30 bg-clay/5 px-4 py-3">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-clay" />
            <p className="text-sm text-clay">{MENSAJE_PRECONDICION.CIT_INACTIVO}</p>
          </div>
        )}
        {faltante === 'SIN_DATOS_BANCARIOS' && (
          <DatosBancariosInline onGuardado={() => mutate('/api/usuario/bicicletas')} />
        )}
        {faltante === 'YA_PUBLICADA' && (
          <div className="flex items-start gap-2 rounded-2xl border border-ink/10 bg-paper-dim/40 px-4 py-3">
            <p className="text-sm text-slate-warm">{MENSAJE_PRECONDICION.YA_PUBLICADA}</p>
          </div>
        )}
        {!faltante && (
          <SwipeToSellCard
            key={actual.id}
            activo={actual}
            tipoDeCambioBlueMep={data.tipoDeCambioBlueMep.valor}
            enviando={enviando}
            onConfirmar={handleConfirmar}
            onDescartar={avanzar}
          />
        )}
      </div>
    </section>
  )
}
