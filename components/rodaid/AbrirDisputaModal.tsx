'use client'

import { useRef, useState } from 'react'
import { AlertTriangle, Loader2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { abrirDisputaCitCompleto } from '@/lib/disputas-cit-completo'

interface Props {
  transaccionId: string
  tituloBici: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDisputaAbierta: () => void
}

/**
 * Esquema 1 Caso B: el comprador reclama que el vendedor no completa una
 * venta ya paga (seña o saldo). Reembolsa de inmediato -- no hace falta que
 * un admin intervenga para que el comprador recupere su dinero.
 */
export function AbrirDisputaModal({ transaccionId, tituloBici, open, onOpenChange, onDisputaAbierta }: Props) {
  const [motivo, setMotivo] = useState('')
  const [archivos, setArchivos] = useState<File[]>([])
  const [enviando, setEnviando] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const cerrar = (o: boolean) => {
    if (!enviando) {
      onOpenChange(o)
      if (!o) {
        setMotivo('')
        setArchivos([])
      }
    }
  }

  const agregarArchivos = (files: FileList | null) => {
    if (!files) return
    setArchivos((prev) => [...prev, ...Array.from(files)])
  }

  const quitarArchivo = (idx: number) => {
    setArchivos((prev) => prev.filter((_, i) => i !== idx))
  }

  const enviar = async () => {
    if (!motivo.trim()) {
      toast.error('Contanos qué pasó', { description: 'El motivo es obligatorio.' })
      return
    }
    if (archivos.length === 0) {
      toast.error('Subí al menos un archivo de evidencia', {
        description: 'Capturas de chat, comprobantes de pago, mails — lo que tengas.',
      })
      return
    }
    setEnviando(true)
    try {
      await abrirDisputaCitCompleto(transaccionId, motivo.trim(), archivos)
      toast.success('Reclamo registrado', {
        description: 'Te devolvimos tu dinero. La venta quedó cancelada.',
      })
      onDisputaAbierta()
      cerrar(false)
    } catch (err) {
      toast.error('No pudimos registrar el reclamo', { description: (err as Error).message })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={cerrar}>
      <DialogContent className="rounded-2xl border border-ink/10 bg-paper">
        <DialogHeader>
          <span className="flex size-11 items-center justify-center rounded-xl bg-clay/10 text-clay">
            <AlertTriangle className="size-5" />
          </span>
          <DialogTitle className="mt-2 font-display text-ink">Reclamar por &quot;{tituloBici}&quot;</DialogTitle>
          <DialogDescription>
            Ya pagaste y el vendedor no está completando la venta. Te devolvemos tu dinero de inmediato — el
            reclamo queda registrado contra la reputación del vendedor.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-3">
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            placeholder="Contanos qué pasó (el vendedor no responde, dijo que ya no la vende, etc.)"
            className="w-full rounded-xl border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-clay/50"
          />

          <div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3.5 py-2 text-xs font-semibold text-ink hover:border-ink/40"
            >
              <Upload className="size-3.5" /> Subir evidencia
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => agregarArchivos(e.target.files)}
            />
            {archivos.length > 0 && (
              <ul className="mt-2 space-y-1">
                {archivos.map((a, i) => (
                  <li
                    key={`${a.name}-${i}`}
                    className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-ink"
                  >
                    <span className="truncate">{a.name}</span>
                    <button type="button" onClick={() => quitarArchivo(i)} className="ml-2 shrink-0 text-slate-warm hover:text-clay">
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="button"
            onClick={enviar}
            disabled={enviando}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-clay px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-clay/90 disabled:opacity-50"
          >
            {enviando ? <Loader2 className="size-4 animate-spin" /> : <AlertTriangle className="size-4" />}
            {enviando ? 'Enviando…' : 'Reclamar y recuperar mi dinero'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
