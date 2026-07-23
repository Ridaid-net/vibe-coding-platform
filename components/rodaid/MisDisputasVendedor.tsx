'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import {
  agregarEvidenciaDisputa,
  ESTADO_DISPUTA_LABEL,
  listarMisDisputasComoVendedor,
  type DisputaCitCompleto,
} from '@/lib/disputas-cit-completo'

/**
 * Esquema 1 Caso B: disputas donde el usuario es el vendedor. Solo se
 * renderiza algo si tiene al menos una -- la mayoría de los vendedores nunca
 * ve esta sección. Mientras el caso sigue EN_REVISION_HUMANA, puede subir
 * contra-evidencia antes de que un admin decida.
 */
export function MisDisputasVendedor() {
  const [disputas, setDisputas] = useState<DisputaCitCompleto[] | null>(null)

  useEffect(() => {
    listarMisDisputasComoVendedor()
      .then(setDisputas)
      .catch(() => setDisputas([]))
  }, [])

  if (!disputas || disputas.length === 0) return null

  return (
    <section className="mt-12">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-5 text-clay" />
        <h2 className="font-display text-2xl font-bold text-ink">Disputas sobre mis ventas</h2>
      </div>
      <ul className="mt-6 space-y-3">
        {disputas.map((d) => (
          <DisputaItem key={d.id} disputa={d} />
        ))}
      </ul>
    </section>
  )
}

function DisputaItem({ disputa }: { disputa: DisputaCitCompleto }) {
  const estado = ESTADO_DISPUTA_LABEL[disputa.estado]
  const [subiendo, setSubiendo] = useState(false)
  const [subida, setSubida] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const subirEvidencia = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setSubiendo(true)
    try {
      await agregarEvidenciaDisputa(disputa.id, Array.from(files))
      toast.success('Evidencia agregada', { description: 'Un admin de RODAID la va a tener en cuenta al revisar el caso.' })
      setSubida(true)
    } catch (err) {
      toast.error('No pudimos subir la evidencia', { description: (err as Error).message })
    } finally {
      setSubiendo(false)
    }
  }

  return (
    <li className="rounded-2xl border border-ink/12 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${estado.clase}`}>{estado.label}</span>
        <span className="text-[11px] text-slate-warm">
          {new Date(disputa.abiertaEn).toLocaleDateString('es-AR')}
        </span>
      </div>
      <p className="mt-2 text-sm text-ink">{disputa.motivo}</p>

      {disputa.estado === 'EN_REVISION_HUMANA' && !subida && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={subiendo}
            className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3.5 py-2 text-xs font-semibold text-ink hover:border-ink/40 disabled:opacity-50"
          >
            {subiendo ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            Subir mi evidencia
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => subirEvidencia(e.target.files)}
          />
        </div>
      )}
      {disputa.estado === 'EN_REVISION_HUMANA' && subida && (
        <p className="mt-2 text-[11px] font-semibold text-[#0a7d5a]">Evidencia subida — esperando revisión.</p>
      )}
      {disputa.resolucionNota && (
        <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-warm">{disputa.resolucionNota}</p>
      )}
    </li>
  )
}
