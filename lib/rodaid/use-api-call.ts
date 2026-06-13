'use client'

// ─── RODAID · Hooks de llamada a la API ──────────────────────────────────
//
// Reemplazan los `setTimeout` + `Math.random()` del demo por llamadas reales
// con estado de carga, error tipado y reintento con backoff exponencial.
//
//   const { loading, error, retrying, retryIn, ejecutar, limpiar } = useApiCall()
//   const registrar = () => ejecutar(() => marketplace.publicar(form), {
//     onSuccess: (res) => { setResult(res); setStep(5) },
//   })
//
//   const { data, loading, error, recargar } = useFetch(() => marketplace.buscar())
//   if (loading) return <SkeletonMisPublicaciones />

import { useCallback, useEffect, useRef, useState } from 'react'
import { delay, parseApiError, RodaidError } from '@/lib/rodaid/errors'

export interface ApiCallState {
  loading: boolean
  error: RodaidError | null
  retrying: boolean
  retryIn: number | null
  intentos: number
}

export interface EjecutarOpts<T> {
  onSuccess?: (result: T) => void
  onError?: (error: RodaidError) => void
  maxRetries?: number
  resetDelay?: number
}

const ESTADO_INICIAL: ApiCallState = {
  loading: false,
  error: null,
  retrying: false,
  retryIn: null,
  intentos: 0,
}

export function useApiCall() {
  const [state, setState] = useState<ApiCallState>(ESTADO_INICIAL)
  const montado = useRef(true)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
      if (countdownRef.current) clearInterval(countdownRef.current)
      if (resetRef.current) clearTimeout(resetRef.current)
    }
  }, [])

  const setSafe = useCallback((updater: (s: ApiCallState) => ApiCallState) => {
    if (montado.current) setState(updater)
  }, [])

  const ejecutar = useCallback(
    async <T>(fn: () => Promise<T>, opts: EjecutarOpts<T> = {}): Promise<T | undefined> => {
      const { onSuccess, onError, maxRetries = 2, resetDelay = 8_000 } = opts
      setSafe(() => ({ ...ESTADO_INICIAL, loading: true }))

      let intentos = 0
      const intentar = async (): Promise<T | undefined> => {
        try {
          const result = await fn()
          setSafe(() => ({ ...ESTADO_INICIAL, intentos }))
          onSuccess?.(result)
          return result
        } catch (rawErr) {
          const err = rawErr instanceof RodaidError ? rawErr : await parseApiError(rawErr)
          err.retryCount = intentos
          intentos++

          if (err.puedeReintentar && intentos <= maxRetries) {
            const ms = Math.min(err.retryMs * 2 ** (intentos - 1), 30_000)
            let segundos = Math.ceil(ms / 1000)
            setSafe((s) => ({ ...s, loading: false, error: err, retrying: true, retryIn: segundos, intentos }))

            if (countdownRef.current) clearInterval(countdownRef.current)
            countdownRef.current = setInterval(() => {
              segundos -= 1
              setSafe((s) => ({ ...s, retryIn: segundos > 0 ? segundos : null }))
            }, 1_000)

            await delay(ms)
            if (countdownRef.current) clearInterval(countdownRef.current)
            setSafe((s) => ({ ...s, loading: true, retrying: false, retryIn: null }))
            return intentar()
          }

          setSafe(() => ({ ...ESTADO_INICIAL, error: err, intentos }))
          onError?.(err)

          if (!err.esAuth && resetDelay > 0) {
            if (resetRef.current) clearTimeout(resetRef.current)
            resetRef.current = setTimeout(() => setSafe((s) => ({ ...s, error: null })), resetDelay)
          }
          return undefined
        }
      }

      return intentar()
    },
    [setSafe]
  )

  const limpiar = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current)
    if (resetRef.current) clearTimeout(resetRef.current)
    setSafe(() => ESTADO_INICIAL)
  }, [setSafe])

  return { ...state, ejecutar, limpiar }
}

export interface FetchState<T> {
  data: T | null
  loading: boolean
  error: RodaidError | null
  recargar: () => void
}

// Hook de lectura para mostrar skeletons mientras llega la respuesta real.
export function useFetch<T>(fn: () => Promise<T>, deps: unknown[] = []): FetchState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<RodaidError | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const cargar = useCallback(() => {
    let activo = true
    setLoading(true)
    fnRef
      .current()
      .then((res) => {
        if (!activo) return
        setData(res)
        setError(null)
      })
      .catch(async (rawErr) => {
        if (!activo) return
        setError(rawErr instanceof RodaidError ? rawErr : await parseApiError(rawErr))
      })
      .finally(() => {
        if (activo) setLoading(false)
      })
    return () => {
      activo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    const cleanup = cargar()
    return cleanup
  }, [cargar])

  return { data, loading, error, recargar: cargar }
}
