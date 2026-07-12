'use client'

import { useRef, useState } from 'react'
import {
  AlertTriangle,
  FileWarning,
  Loader2,
  ShieldAlert,
  Upload,
} from 'lucide-react'
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
import { etiquetaActivo, type ActivoGaraje } from '@/lib/garaje-digital'

/**
 * Modal de "Denuncia Ciudadana" (Hito 18).
 *
 * Al reportar el robo/hurto, el usuario adjunta OBLIGATORIAMENTE el PDF de la
 * denuncia realizada ante el MPF. El backend valida que el documento contenga el
 * expediente, la fecha y los datos del titular (verificados por MxM). Si valida:
 *   - con CIT activo (Fase 7, caso 1): la bici pasa a DENUNCIA_JUDICIAL_ACTIVA de
 *     inmediato (se desactiva el CIT, se bloquea el Marketplace y se avisa al
 *     Ministerio de Seguridad con un link seguro al PDF), gratis.
 *   - sin CIT activo (Fase 7, caso 2): queda PENDIENTE_PAGO -- el bloqueo recien
 *     se activa cuando se confirma el pago de la tarifa (mismo precio que un CIT
 *     Express) via MercadoPago.
 * Si no valida, la denuncia queda en revisión, sin bloquear automáticamente.
 *
 * Restringido a usuarios con identidad gubernamental (MxM): el testigo verificado.
 */
interface RegistrarResultado {
  estado: 'DENUNCIA_JUDICIAL_ACTIVA' | 'EN_REVISION' | 'ANULADA' | 'PENDIENTE_PAGO'
  bloqueada: boolean
  expediente: string | null
  fechaDocumento: string | null
  validacion?: { motivos?: string[] }
  pago?: {
    preferenceId: string
    initPoint: string
    sandboxPoint: string | null
    gateway: string
    montoARS: number
  } | null
}

function pesos(n: number): string {
  return n.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  })
}

export function DenunciaMpfModal({
  bici,
  open,
  onOpenChange,
  onDenunciada,
}: {
  bici: ActivoGaraje | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDenunciada: () => void
}) {
  const [archivo, setArchivo] = useState<File | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<RegistrarResultado | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setArchivo(null)
    setResultado(null)
    setEnviando(false)
  }

  const cerrar = (o: boolean) => {
    if (!o) reset()
    onOpenChange(o)
  }

  const enviar = async () => {
    if (!bici || !archivo || enviando) return
    setEnviando(true)
    try {
      const form = new FormData()
      form.set('pdf', archivo)
      const res = await authedFetch(`/api/v1/bicicletas/${bici.id}/denuncia`, {
        method: 'POST',
        body: form,
      })
      if (!res.ok) {
        const info = await parseApiError(res)
        toast.error('No pudimos registrar la denuncia', {
          description: info.message,
        })
        return
      }
      const data = (await res.json()) as RegistrarResultado
      setResultado(data)
      if (data.estado === 'DENUNCIA_JUDICIAL_ACTIVA') {
        toast.error('Denuncia judicial activa', {
          description: data.expediente
            ? `Bloqueamos tu bici y avisamos al Ministerio (expediente ${data.expediente}).`
            : 'Bloqueamos tu bici y avisamos al Ministerio de Seguridad.',
        })
      } else if (data.estado === 'PENDIENTE_PAGO') {
        toast.info('Falta pagar la tarifa de denuncia', {
          description:
            'Como no tenés un CIT activo, hay que confirmar el pago antes de activar el bloqueo.',
        })
      } else {
        toast.info('Denuncia en revisión', {
          description:
            'No pudimos validar la estructura del documento. Un equipo de RODAID la revisará.',
        })
      }
      onDenunciada()
    } catch {
      toast.error('No pudimos registrar la denuncia', {
        description: 'Revisá tu conexión e intentá nuevamente.',
      })
    } finally {
      setEnviando(false)
    }
  }

  const onPick = (file: File | null) => {
    if (file && file.type && !/pdf/i.test(file.type) && !/\.pdf$/i.test(file.name)) {
      toast.error('El documento debe ser un PDF de la denuncia del MPF.')
      return
    }
    setArchivo(file)
  }

  return (
    <Dialog open={open} onOpenChange={cerrar}>
      <DialogContent className="rounded-2xl border border-ink/10 bg-paper">
        <DialogHeader>
          <span className="flex size-12 items-center justify-center rounded-xl bg-clay/15 text-clay">
            <ShieldAlert className="size-6" />
          </span>
          <DialogTitle className="font-display text-ink">
            Denunciar robo o hurto
          </DialogTitle>
          <DialogDescription className="text-slate-warm">
            {bici
              ? `Adjuntá el PDF de la denuncia que hiciste ante el MPF por ${etiquetaActivo(
                  bici
                )} (N° ${bici.numeroSerie}). Validamos que contenga el expediente, la fecha y tus datos como titular.`
              : 'Adjuntá el PDF de la denuncia realizada ante el MPF.'}
          </DialogDescription>
        </DialogHeader>

        {resultado ? (
          <ResultadoDenuncia resultado={resultado} onCerrar={() => cerrar(false)} />
        ) : (
          <>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-ink/25 bg-white/60 px-4 py-8 text-center transition-colors hover:border-clay/50"
            >
              <Upload className="size-6 text-ink/50" />
              <span className="text-sm font-semibold text-ink">
                {archivo ? archivo.name : 'Subí el PDF de la denuncia del MPF'}
              </span>
              <span className="text-xs text-slate-warm">
                {archivo
                  ? `${(archivo.size / 1024).toFixed(0)} KB · tocá para cambiar`
                  : 'Formato PDF · obligatorio'}
              </span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            />

            <div className="flex items-start gap-2 rounded-2xl bg-amber-50 px-3.5 py-3 text-xs text-amber-700">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                Al confirmar, si el documento valida, tu bici queda con{' '}
                <strong>denuncia judicial activa</strong>: se desactiva el CIT, se
                bloquea su publicación en el Marketplace y se notifica al
                Ministerio de Seguridad.
              </span>
            </div>

            <button
              type="button"
              onClick={enviar}
              disabled={enviando || !archivo}
              className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-full bg-clay px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-clay/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {enviando ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Validando documento…
                </>
              ) : (
                <>
                  <ShieldAlert className="size-4" />
                  Confirmar denuncia
                </>
              )}
            </button>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ResultadoDenuncia({
  resultado,
  onCerrar,
}: {
  resultado: RegistrarResultado
  onCerrar: () => void
}) {
  const activa = resultado.estado === 'DENUNCIA_JUDICIAL_ACTIVA'
  const pendientePago = resultado.estado === 'PENDIENTE_PAGO'
  const motivos = resultado.validacion?.motivos ?? []

  const pagar = () => {
    if (!resultado.pago) return
    const url =
      resultado.pago.gateway === 'SANDBOX' && resultado.pago.sandboxPoint
        ? resultado.pago.sandboxPoint
        : resultado.pago.initPoint
    window.location.href = url
  }

  return (
    <div className="space-y-4">
      <div
        className={`rounded-2xl px-4 py-3.5 ${
          activa ? 'bg-clay/10 text-clay' : 'bg-amber-50 text-amber-700'
        }`}
      >
        <p className="flex items-center gap-2 text-sm font-semibold">
          {activa ? (
            <ShieldAlert className="size-4" />
          ) : (
            <FileWarning className="size-4" />
          )}
          {activa
            ? 'Denuncia judicial activa'
            : pendientePago
              ? 'Falta pagar la tarifa de denuncia'
              : 'Denuncia en revisión'}
        </p>
        <p className="mt-1 text-xs">
          {activa
            ? 'Bloqueamos tu bici y compartimos la documentación con el Ministerio de Seguridad en tiempo real.'
            : pendientePago
              ? `Validamos tu documento, pero como no tenés un CIT activo hay que pagar ${
                  resultado.pago ? pesos(resultado.pago.montoARS) : 'la tarifa'
                } para activar el bloqueo — el mismo precio que un CIT Express.`
              : 'No pudimos validar automáticamente el documento. Tu bici no se bloqueó; un equipo de RODAID revisará la denuncia.'}
        </p>
        {resultado.expediente && (
          <p className="mt-2 font-mono text-xs">
            Expediente: {resultado.expediente}
            {resultado.fechaDocumento ? ` · ${resultado.fechaDocumento}` : ''}
          </p>
        )}
      </div>

      {!activa && !pendientePago && motivos.length > 0 && (
        <ul className="space-y-1.5 text-xs text-slate-warm">
          {motivos.map((m, i) => (
            <li key={i} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
              {m}
            </li>
          ))}
        </ul>
      )}

      {pendientePago && resultado.pago ? (
        // TODO(retomar pago con retorno persistente): "Pagar ahora" es hoy la
        // UNICA salida clara de este estado -- no ofrecemos un boton de
        // "pagar mas tarde" porque no existe todavia ninguna pantalla donde
        // el usuario pueda volver despues y retomar un pago pendiente (el
        // backend ya expone GET /api/v1/bicicletas/:id/denuncia con
        // pagoPendiente, pero ningun componente del frontend lo consume hoy
        // -- ver lib/garaje-digital.ts). Cerrar este modal sin pagar (via la
        // X, ESC o click afuera del Dialog) sigue siendo posible -- eso lo
        // maneja el Dialog de shadcn/Radix por defecto y no lo bloqueamos
        // aca -- pero no lo OFRECEMOS como un boton que prometa un regreso
        // que no existe. Resolver esto de verdad es parte natural del
        // trabajo grande del lado comprador (auditoria de frontend, item 4:
        // pantallas de "mis compras"/estado persistente), no un banner
        // aislado aca.
        <>
          <button
            type="button"
            onClick={pagar}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-clay px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-clay/90"
          >
            <ShieldAlert className="size-4" />
            Pagar {pesos(resultado.pago.montoARS)} y activar el bloqueo
          </button>
          <a
            href="https://wa.me/5492617542335"
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-xs text-slate-warm underline hover:text-ink"
          >
            ¿No podés pagar ahora? Escribinos por WhatsApp
          </a>
          <p className="text-center text-[11px] leading-snug text-slate-warm">
            Este pago es por el bloqueo y la alerta en la red RODAID. Denunciar
            el robo ante la Justicia siempre es gratis, con o sin RODAID, en{' '}
            <a
              href="https://denuncias.mpfmza.gob.ar"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-ink"
            >
              denuncias.mpfmza.gob.ar
            </a>
            .
          </p>
        </>
      ) : (
        <button
          type="button"
          onClick={onCerrar}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
        >
          Entendido
        </button>
      )}
    </div>
  )
}
