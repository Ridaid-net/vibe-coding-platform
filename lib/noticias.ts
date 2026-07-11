'use client'

import { useCallback, useEffect, useState } from 'react'

export interface Noticia {
  id: string
  titulo: string
  resumen: string
  url: string | null
  imagen_url: string | null
  video_url: string | null
  fuente: string
  tipo: 'noticia' | 'prensa' | 'evento'
  es_comunicado_prensa: boolean
}

interface UseNoticiasResult {
  noticias: Noticia[]
  cargando: boolean
  error: boolean
  reintentar: () => void
}

/**
 * Trae las noticias activas (opcionalmente solo comunicados de prensa) y
 * distingue "fetch fallo" de "no hay noticias" — antes ambos casos caian en el
 * mismo estado vacio silencioso. Expone `reintentar` para el boton de error.
 */
export function useNoticias(opts: { soloPrensa?: boolean } = {}): UseNoticiasResult {
  const [noticias, setNoticias] = useState<Noticia[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(false)
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    let cancelado = false
    setCargando(true)
    setError(false)
    const params = new URLSearchParams({ activas: 'true' })
    if (opts.soloPrensa) params.set('prensa', 'true')
    fetch(`/api/v1/admin/noticias?${params.toString()}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => {
        if (cancelado) return
        setNoticias(d.noticias ?? [])
        setCargando(false)
      })
      .catch(() => {
        if (cancelado) return
        setError(true)
        setCargando(false)
      })
    return () => {
      cancelado = true
    }
  }, [opts.soloPrensa, intento])

  const reintentar = useCallback(() => setIntento(i => i + 1), [])

  return { noticias, cargando, error, reintentar }
}
