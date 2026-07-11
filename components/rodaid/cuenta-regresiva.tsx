'use client'

import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'

/**
 * Cuenta regresiva genérica contra un timestamp ISO (ej. la ventana de 48hs
 * de una reserva CIT Completo). A diferencia de `PipelineEstado` en
 * garaje-digital.tsx (que solo recalcula el tiempo restante cuando el padre
 * vuelve a renderizar, ej. un refetch de SWR), este componente tickea solo
 * cada 30s con su propio `setInterval`.
 */
export function CuentaRegresiva({ venceEn }: { venceEn: string }) {
  const [ahora, setAhora] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const vence = new Date(venceEn).getTime()
  const restanteMs = vence - ahora

  if (restanteMs <= 0) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-clay">
        <Clock className="size-3.5" />
        Venció
      </p>
    )
  }

  const horas = Math.floor(restanteMs / 3_600_000)
  const min = Math.floor((restanteMs % 3_600_000) / 60_000)
  const texto = horas > 0 ? `${horas}h ${min}m restantes` : `${min}m restantes`

  return (
    <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-amber-700">
      <Clock className="size-3.5" />
      {texto}
    </p>
  )
}
