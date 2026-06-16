'use client'

import { useEffect, useState } from 'react'
import { BicycleSelector } from './bicycle-selector'
import { PublicarForm } from './publicar-form'
import { fetchMisBicicletas, type BicicletaGaraje } from '@/lib/garaje'

const SELECCION_KEY = 'rodaid.publicar.seleccion'

/**
 * Orquesta el flujo de publicacion: primero el BicycleSelector, luego el
 * PublicarForm para la bici elegida.
 *
 * Persistencia: la bici seleccionada se recuerda en localStorage, de modo que
 * si el usuario sale a "Mi Garaje" a verificar una bici y vuelve, retoma donde
 * estaba (y el formulario, a su vez, recupera su propio borrador por bici).
 */
export function PublicarFlow() {
  const [bici, setBici] = useState<BicicletaGaraje | null>(null)
  const [restaurando, setRestaurando] = useState(true)

  // Al volver a la pantalla, intentamos recuperar la bici que el usuario habia
  // elegido. La revalidamos contra el backend: solo la retomamos si sigue
  // verificada y sin publicacion activa.
  useEffect(() => {
    let cancelado = false
    const guardada = (() => {
      try {
        return window.localStorage.getItem(SELECCION_KEY)
      } catch {
        return null
      }
    })()

    if (!guardada) {
      setRestaurando(false)
      return
    }

    fetchMisBicicletas()
      .then((data) => {
        if (cancelado) return
        const match = data.bicicletas.find(
          (b) => b.id === guardada && b.citActivo && !b.tienePublicacionActiva
        )
        if (match) setBici(match)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelado) setRestaurando(false)
      })

    return () => {
      cancelado = true
    }
  }, [])

  const seleccionar = (b: BicicletaGaraje) => {
    setBici(b)
    try {
      window.localStorage.setItem(SELECCION_KEY, b.id)
    } catch {
      // ignorar
    }
  }

  const volver = () => {
    setBici(null)
    try {
      window.localStorage.removeItem(SELECCION_KEY)
    } catch {
      // ignorar
    }
  }

  if (restaurando) {
    return (
      <div className="space-y-3">
        <div className="h-8 w-2/3 animate-pulse rounded bg-paper-dim" />
        <div className="h-24 w-full animate-pulse rounded-2xl bg-paper-dim" />
        <div className="h-24 w-full animate-pulse rounded-2xl bg-paper-dim" />
      </div>
    )
  }

  return bici ? (
    <PublicarForm bici={bici} onVolver={volver} />
  ) : (
    <BicycleSelector onSelect={seleccionar} />
  )
}
