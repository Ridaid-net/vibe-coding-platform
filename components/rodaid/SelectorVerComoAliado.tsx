'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { authedFetch, getSession } from '@/lib/session'
import { Eye } from 'lucide-react'

interface AliadoOpcion {
  id: string
  nombre: string
  tipo: string
}

/**
 * Dropdown de "ver como", solo para admins. Al elegir un aliado agrega
 * ?verComoAliado=<id> a la URL actual -- cualquier panel que lea
 * useVerComoAliado() reacciona solo, sin coordinacion adicional.
 */
export function SelectorVerComoAliado() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [esAdmin, setEsAdmin] = useState(false)
  const [aliados, setAliados] = useState<AliadoOpcion[]>([])
  const actual = searchParams.get('verComoAliado') ?? ''

  useEffect(() => {
    setEsAdmin(getSession()?.rol === 'admin')
  }, [])

  useEffect(() => {
    if (!esAdmin) return
    authedFetch('/api/v1/admin/aliados?estado=aprobado')
      .then((r) => (r.ok ? r.json() : { aliados: [] }))
      .then((data: { aliados?: AliadoOpcion[] }) => setAliados(data.aliados ?? []))
      .catch(() => undefined)
  }, [esAdmin])

  const cambiar = (aliadoId: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (aliadoId) params.set('verComoAliado', aliadoId)
    else params.delete('verComoAliado')
    router.push(`${pathname}?${params.toString()}`)
  }

  if (!esAdmin || aliados.length === 0) return null

  return (
    <div className="mb-4 flex items-center gap-2 rounded-2xl border border-ink/10 bg-white px-4 py-2.5">
      <Eye className="size-4 shrink-0 text-slate-warm" />
      <label className="text-xs font-semibold text-slate-warm shrink-0">Ver como (admin):</label>
      <select
        value={actual}
        onChange={(e) => cambiar(e.target.value)}
        className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-[#2BBCB8]"
      >
        <option value="">Vista previa (datos de ejemplo)</option>
        {aliados.map((a) => (
          <option key={a.id} value={a.id}>{a.nombre} ({a.tipo})</option>
        ))}
      </select>
    </div>
  )
}

export default SelectorVerComoAliado
