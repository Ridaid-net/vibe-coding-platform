'use client'

import { Eye } from 'lucide-react'

interface Props {
  modo: 'propio' | 'ver_como' | 'vista_previa'
  aliadoNombre?: string | null
}

export function AdminViewAsBanner({ modo, aliadoNombre }: Props) {
  if (modo === 'propio') return null

  return (
    <div className="mb-4 flex items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
      <Eye className="size-4 shrink-0" />
      {modo === 'vista_previa'
        ? 'Vista previa — estás viendo datos de ejemplo, no tu cuenta real.'
        : `Viendo como: ${aliadoNombre ?? 'Aliado'} (Taller Aliado real) — modo solo lectura, ningún cambio se va a guardar.`}
    </div>
  )
}

export default AdminViewAsBanner
