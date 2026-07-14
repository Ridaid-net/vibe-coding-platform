'use client'
import { useState } from 'react'
import { Fingerprint, Loader2, ShieldCheck, RefreshCw, Clock } from 'lucide-react'
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

export function SolicitarVerificacionModal({
  bici,
  open,
  onOpenChange,
  onVerificada,
  esRenovacion = false,
}: {
  bici: BicicletaGaraje | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onVerificada: () => void
  esRenovacion?: boolean
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
        toast.error(esRenovacion ? 'No pudimos renovar el CIT' : 'No pudimos verificar tu bicicleta', {
          description: info.message,
        })
        return
      }
      const data = (await res.json()) as {
        estado: string
        initPoint?: string
        montoARS?: number
        reanudada?: boolean
      }
      if (data.estado === 'pago_pendiente' && data.initPoint) {
        toast.info(
          data.reanudada ? 'Continuando tu pago pendiente' : 'Redirigiendo al pago',
          {
            description: `Te llevamos a MercadoPago para pagar el CIT Express de ${etiquetaBici(bici)}. El CIT se activa apenas confirmemos el pago.`,
          }
        )
        onOpenChange(false)
        window.location.href = data.initPoint
        return
      }
      // Respuesta inesperada (sin initPoint): no hay a donde redirigir.
      toast.error(esRenovacion ? 'No pudimos renovar el CIT' : 'No pudimos verificar tu bicicleta', {
        description: 'No recibimos el link de pago. Probá de nuevo en unos segundos.',
      })
    } catch {
      toast.error(esRenovacion ? 'No pudimos renovar el CIT' : 'No pudimos verificar tu bicicleta', {
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
          <DialogTitle className="font-display text-xl font-bold text-ink">
            {esRenovacion ? 'Renovar CIT' : 'Solicitar verificación'}
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-warm">
            {bici ? etiquetaBici(bici) : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {esRenovacion ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <Clock className="size-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-800">CIT Vencido</p>
                  <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                    Tu Certificado de Identidad Técnica venció. Pagás el CIT Express y, apenas confirmemos el pago, arranca automáticamente la validación de tu identidad.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-[#2BBCB8]/30 bg-teal-50 p-4">
              <div className="flex items-start gap-3">
                <Fingerprint className="size-5 text-[#2BBCB8] shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-[#0F1E35]">Solicitar CIT Express</p>
                  <p className="text-xs text-slate-warm mt-1 leading-relaxed">
                    Verificación automática de identidad (sin inspección presencial), válida por 12 meses. Pagás ahora y, apenas se confirme el pago, arranca la validación.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-xl bg-slate-50 p-3 space-y-1.5 text-xs text-slate-warm">
            <p className="flex items-center gap-1.5"><ShieldCheck className="size-3 text-[#2BBCB8]" /> Verificación automática (sin inspección de un taller)</p>
            <p className="flex items-center gap-1.5"><ShieldCheck className="size-3 text-[#2BBCB8]" /> Hash SHA-256 anclado en Blockchain Federal Argentina</p>
            <p className="flex items-center gap-1.5"><ShieldCheck className="size-3 text-[#2BBCB8]" /> Vigencia 12 meses</p>
            <p className="flex items-center gap-1.5"><ShieldCheck className="size-3 text-[#2BBCB8]" /> Vas a ver el monto exacto en el checkout de MercadoPago</p>
          </div>

          <button
            onClick={solicitar}
            disabled={enviando}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#0F1E35] px-5 py-3 text-sm font-semibold text-white hover:bg-[#0F1E35]/80 disabled:opacity-50"
          >
            {enviando ? (
              <Loader2 className="size-4 animate-spin" />
            ) : esRenovacion ? (
              <RefreshCw className="size-4" />
            ) : (
              <Fingerprint className="size-4" />
            )}
            {enviando
              ? 'Redirigiendo a MercadoPago...'
              : esRenovacion
                ? 'Ir a pagar la renovación'
                : 'Ir a pagar el CIT Express'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
