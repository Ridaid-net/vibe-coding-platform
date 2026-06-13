'use client'

// Hook de carga del Garaje Digital. Usa el cliente de API tipado
// (`garajeApi.getResumen`) para consumir GET /api/v1/garaje/resumen y
// expone los estados loading / error / empty / data que renderiza la UI.

import { useCallback, useEffect, useState } from 'react'
import { garajeApi, type ApiClientError, type GarajeResumen } from '@/lib/garaje-api'

interface GarajeState {
  data: GarajeResumen | null
  loading: boolean
  error: ApiClientError | null
  intentos: number
}

export function useGaraje() {
  const [state, setState] = useState<GarajeState>({
    data: null,
    loading: true,
    error: null,
    intentos: 0,
  })

  const fetchGaraje = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const data = await garajeApi.getResumen()
      setState({ data, loading: false, error: null, intentos: 0 })
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err as ApiClientError,
        intentos: s.intentos + 1,
      }))
    }
  }, [])

  useEffect(() => {
    fetchGaraje()
  }, [fetchGaraje])

  return { ...state, refresh: fetchGaraje }
}
