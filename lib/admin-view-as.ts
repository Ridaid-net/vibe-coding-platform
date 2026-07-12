'use client'

import { useSearchParams } from 'next/navigation'

/** Lee el parametro "ver como" (?verComoAliado=<id>) de la URL actual. */
export function useVerComoAliado(): string | null {
  const params = useSearchParams()
  return params.get('verComoAliado')
}
