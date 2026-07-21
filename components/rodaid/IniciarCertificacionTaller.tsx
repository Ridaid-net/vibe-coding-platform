'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, UserPlus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { fetchContexto } from '@/lib/inspecciones'
import {
  iniciarCertificacion,
  type CertificacionMostradorResultado,
} from '@/lib/certificacion-mostrador'

const RODADOS_VALIDOS = [12, 16, 20, 24, 26, 27.5, 29, 700]

const CAMPO =
  'w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-ink/40'

/**
 * "Iniciar Certificación" — el taller arranca un CIT Express para un cliente
 * de mostrador sin cuenta en RODAID (o con una ya existente, si el email
 * coincide). Solo talleres tipo='taller' -- mismo criterio de capacidad
 * mecánica que restringe el sellado de inspecciones (ver CLAUDE.md).
 */
export function IniciarCertificacionTaller() {
  const [habilitado, setHabilitado] = useState<boolean | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    fetchContexto()
      .then((ctx) => setHabilitado(ctx.aliado?.tipo === 'taller'))
      .catch(() => setHabilitado(false))
  }, [])

  if (habilitado === false) return null

  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-5 mb-8">
      <div className="flex items-center gap-2 mb-1">
        <UserPlus className="size-5 text-[#F47B20]" />
        <h2 className="font-display text-lg font-bold text-[#0F1E35]">Iniciar Certificación</h2>
      </div>
      <p className="text-xs text-slate-warm mb-4">
        Para un cliente que llega a mostrador sin haber reservado antes. Le armamos la cuenta y arrancamos su CIT Express.
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={habilitado === null}
        className="inline-flex items-center gap-1.5 rounded-full bg-[#0F1E35] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#0F1E35]/80 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <UserPlus className="size-3.5" />
        Iniciar Certificación
      </button>

      <IniciarCertificacionModal open={open} onOpenChange={setOpen} />
    </div>
  )
}

function IniciarCertificacionModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [clienteNombre, setClienteNombre] = useState('')
  const [clienteEmail, setClienteEmail] = useState('')
  const [clienteTelefono, setClienteTelefono] = useState('')
  const [marca, setMarca] = useState('')
  const [modelo, setModelo] = useState('')
  const [numeroSerie, setNumeroSerie] = useState('')
  const [tipo, setTipo] = useState('')
  const [rodado, setRodado] = useState('')
  const [talleCuadro, setTalleCuadro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultado, setResultado] = useState<CertificacionMostradorResultado | null>(null)

  useEffect(() => {
    if (!open) {
      setClienteNombre('')
      setClienteEmail('')
      setClienteTelefono('')
      setMarca('')
      setModelo('')
      setNumeroSerie('')
      setTipo('')
      setRodado('')
      setTalleCuadro('')
      setEnviando(false)
      setError(null)
      setResultado(null)
    }
  }, [open])

  const listo = clienteNombre.trim() && clienteEmail.trim() && marca.trim() && modelo.trim() && numeroSerie.trim() && tipo.trim()

  const enviar = async () => {
    if (!listo || enviando) return
    setEnviando(true)
    setError(null)
    try {
      const r = await iniciarCertificacion({
        clienteNombre: clienteNombre.trim(),
        clienteEmail: clienteEmail.trim(),
        clienteTelefono: clienteTelefono.trim() || undefined,
        bici: {
          marca: marca.trim(),
          modelo: modelo.trim(),
          numeroSerie: numeroSerie.trim(),
          tipo: tipo.trim(),
          rodado: rodado ? Number(rodado) : null,
          talleCuadro: talleCuadro || null,
        },
      })
      setResultado(r)
      toast.success('Certificación iniciada')
    } catch (err) {
      setError((err as Error).message || 'No pudimos iniciar la certificación. Probá de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl border border-ink/10 bg-paper">
        <DialogHeader>
          <span className="flex size-12 items-center justify-center rounded-xl bg-lime/20 text-ink">
            <UserPlus className="size-6" />
          </span>
          <DialogTitle className="font-display text-ink">Iniciar Certificación</DialogTitle>
          <DialogDescription className="text-slate-warm">
            Datos del cliente y de la bici. Le armamos la cuenta (o usamos la que ya tenga con ese email) y le mandamos el link de pago del CIT Express.
          </DialogDescription>
        </DialogHeader>

        {resultado ? (
          <div className="space-y-3 py-2">
            <div className="flex flex-col items-center gap-2 py-2 text-center">
              <CheckCircle2 className="size-8 text-lime-deep" />
              <p className="text-sm font-semibold text-ink">
                {resultado.cuentaNueva ? 'Cuenta creada y mail enviado' : 'Cliente ya tenía cuenta'}
              </p>
              <p className="text-xs text-slate-warm">
                {resultado.cuentaNueva
                  ? 'Le mandamos un link para elegir su contraseña y el link de pago.'
                  : 'Le mandamos el link de pago del CIT Express por mail.'}
              </p>
            </div>
            <a
              href={resultado.initPoint}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-lime px-5 py-3 text-sm font-semibold text-ink transition-colors hover:bg-lime-deep"
            >
              Ver link de pago ({resultado.montoARS.toLocaleString('es-AR')} ARS)
            </a>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-warm">Cliente</p>
              <input className={CAMPO} placeholder="Nombre" value={clienteNombre} onChange={(e) => setClienteNombre(e.target.value)} />
              <input className={CAMPO} placeholder="Email" type="email" value={clienteEmail} onChange={(e) => setClienteEmail(e.target.value)} />
              <input className={CAMPO} placeholder="Teléfono (opcional)" value={clienteTelefono} onChange={(e) => setClienteTelefono(e.target.value)} />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-warm">Bicicleta</p>
              <input className={CAMPO} placeholder="Marca" value={marca} onChange={(e) => setMarca(e.target.value)} />
              <input className={CAMPO} placeholder="Modelo" value={modelo} onChange={(e) => setModelo(e.target.value)} />
              <input className={CAMPO} placeholder="Número de serie" value={numeroSerie} onChange={(e) => setNumeroSerie(e.target.value)} />
              <input className={CAMPO} placeholder="Tipo (ej. MTB, Ruta, Urbana)" value={tipo} onChange={(e) => setTipo(e.target.value)} />
              <div className="flex gap-2">
                <select className={CAMPO} value={rodado} onChange={(e) => setRodado(e.target.value)}>
                  <option value="">Rodado (opcional)</option>
                  {RODADOS_VALIDOS.map((r) => (
                    <option key={r} value={r}>
                      R{r}
                    </option>
                  ))}
                </select>
                <select className={CAMPO} value={talleCuadro} onChange={(e) => setTalleCuadro(e.target.value)}>
                  <option value="">Talle (opcional)</option>
                  {['S', 'M', 'L', 'XL'].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {error && <p className="text-xs text-clay">{error}</p>}
            <button
              type="button"
              onClick={enviar}
              disabled={!listo || enviando}
              className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-60"
            >
              {enviando ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Iniciando…
                </>
              ) : (
                <>
                  <UserPlus className="size-4" />
                  Iniciar Certificación
                </>
              )}
            </button>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
