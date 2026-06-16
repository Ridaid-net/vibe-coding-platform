'use client'

import { useState } from 'react'
import { Fingerprint, Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { authedFetch } from '@/lib/session'
import { parseApiError } from '@/lib/api-errors'
import { etiquetaBici, type BicicletaGaraje } from '@/lib/garaje'

/**
 * Modal rapido de "Solicitar verificación" (CIT).
 *
 * Diseno: la friccion en el momento de la venta es enemiga de la conversion,
 * por eso ofrecemos la verificacion en el lugar — sin mandar al usuario a una
 * pestana nueva. En entornos de demo la verificacion se concede al instante;
 * en produccion real queda pendiente del peritaje y se le avisa.
 */
export function SolicitarVerificacionModal({
  bici,
  open,
  onOpenChange,
  onVerificada,
}: {
  bici: BicicletaGaraje | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onVerificada: () => void
}) {
  const [enviando, setEnviando] = useState(false)

  const solicitar = async () => {
    if (!bici || enviando) return
    setEnviando(true)
    try {
      const res = await authedFetch(
        `/api/v1/bicicletas/${bici.id}/verificar`,
        { method: 'POST' }
      )
      if (!res.ok) {
        const info = await parseApiError(res)
        toast.error('No pudimos verificar tu bicicleta', {
          description: info.message,
        })
        return
      }
      const data = (await res.json()) as {
        estado: string
        pendienteRevision?: boolean
      }
      if (data.estado === 'activo') {
        toast.success('¡Identidad verificada!', {
          description: `${etiquetaBici(bici)} ya tiene su CIT activo. Podés publicarla.`,
        })
      } else {
        toast.info('Solicitud enviada', {
          description:
            'Tu bicicleta quedó en revisión. Te avisamos cuando el CIT esté activo.',
        })
      }
      onOpenChange(false)
      onVerificada()
    } catch {
      toast.error('No pudimos verificar tu bicicleta', {
        description: 'Revisá tu conexión e intentá nuevamente.',
      })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl border border-ink/10 bg-paper">
        <DialogHeader>
          <span className="flex size-12 items-center justify-center rounded-xl bg-lime text-ink">
            <Fingerprint className="size-6" />
          </span>
          <DialogTitle className="font-display text-ink">
            Verificá la identidad de tu bici
          </DialogTitle>
          <DialogDescription className="text-slate-warm">
            {bici
              ? `Vamos a generar el CIT de ${etiquetaBici(bici)} (N° ${bici.numeroSerie}). El CIT es la cédula de identidad de tu bicicleta: confirma que es tuya y habilita la publicación con la protección RODAID PAY.`
              : 'El CIT es la cédula de identidad de tu bicicleta.'}
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 text-sm text-slate-warm">
          <li className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-lime-deep" />
            Asociamos el número de serie a tu cuenta como titular.
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-lime-deep" />
            La bici queda marcada como verificada en el marketplace.
          </li>
        </ul>

        <button
          type="button"
          onClick={solicitar}
          disabled={enviando || !bici}
          className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-60"
        >
          {enviando ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Verificando…
            </>
          ) : (
            <>
              <Fingerprint className="size-4 text-lime" />
              Solicitar verificación
            </>
          )}
        </button>
      </DialogContent>
    </Dialog>
  )
}
