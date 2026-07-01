'use client'

import { useState, useRef } from 'react'
import { Shield, AlertTriangle, Upload, X, Clock, ChevronRight, Loader2, FileText } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { authedFetch } from '@/lib/session'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type EstadoTransaccion =
  | 'DEPOSITO_PENDIENTE'
  | 'FONDOS_RETENIDOS'
  | 'EN_ESPERA_DE_LIBERACION'
  | 'DISPUTA_ACTIVA'
  | 'EN_CAMINO'
  | 'COMPLETADA'
  | 'REEMBOLSADA'

export interface Disputa {
  id: string
  transaccionId: string
  estado: 'ABIERTA' | 'EN_REVISION' | 'RESUELTA'
  evidenciaComprador: string[]
  resolucion: 'FAVOR_COMPRADOR' | 'FAVOR_VENDEDOR' | null
}

interface Props {
  transaccionId: string
  estadoTransaccion: EstadoTransaccion
  disputaActiva?: Disputa | null
  onDisputaAbierta?: () => void
}

// ─── Motivos de disputa ───────────────────────────────────────────────────────

const MOTIVOS = [
  { id: 'cit_no_coincide', label: 'El rodado no coincide con la inspección CIT' },
  { id: 'documentacion_faltante', label: 'La documentación no fue entregada' },
  { id: 'danos_ocultos', label: 'Daños ocultos no reportados en el CIT' },
  { id: 'otros', label: 'Otros motivos' },
]

// ─── Componente principal ─────────────────────────────────────────────────────

export function BotonDisputa({ transaccionId, estadoTransaccion, disputaActiva, onDisputaAbierta }: Props) {
  const [open, setOpen] = useState(false)
  const [paso, setPaso] = useState<1 | 2 | 3>(1)
  const [motivo, setMotivo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [archivos, setArchivos] = useState<File[]>([])
  const [aceptaClausula, setAceptaClausula] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Solo visible en EN_ESPERA_DE_LIBERACION
  if (estadoTransaccion !== 'EN_ESPERA_DE_LIBERACION' && estadoTransaccion !== 'DISPUTA_ACTIVA') {
    return null
  }

  // Disputa ya abierta
  if (estadoTransaccion === 'DISPUTA_ACTIVA' || disputaActiva) {
    return (
      <a
        href="#disputa"
        className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-xs font-semibold text-amber-400 transition-colors hover:bg-amber-400/20"
      >
        <Clock className="size-3.5" />
        Disputa en curso: ver estado
        <ChevronRight className="size-3.5" />
      </a>
    )
  }

  const agregarArchivo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nuevos = Array.from(e.target.files ?? [])
    setArchivos((prev) => [...prev, ...nuevos].slice(0, 3))
  }

  const quitarArchivo = (i: number) => setArchivos((prev) => prev.filter((_, idx) => idx !== i))

  const enviarDisputa = async () => {
    if (!motivo || !descripcion || !aceptaClausula) return
    setEnviando(true)
    try {
      const form = new FormData()
      form.append('transaccionId', transaccionId)
      form.append('motivo', motivo)
      form.append('descripcion', descripcion)
      archivos.forEach((f) => form.append('evidencia', f))

      const res = await authedFetch('/api/v1/disputas/abrir', { method: 'POST', body: form })
      if (!res.ok) throw new Error('Error al abrir disputa')

      toast.success('Disputa iniciada', {
        description: 'El pago quedó retenido. Revisaremos tu caso en 24-48hs hábiles.',
      })
      setOpen(false)
      onDisputaAbierta?.()
    } catch {
      toast.error('No pudimos abrir la disputa', { description: 'Intentá de nuevo en unos minutos.' })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setPaso(1) }}
        className="inline-flex items-center gap-2 rounded-full border border-clay/40 bg-clay/10 px-4 py-2 text-xs font-semibold text-clay transition-colors hover:bg-clay/20"
      >
        <AlertTriangle className="size-3.5" />
        Abrir Disputa / Detener Pago
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg rounded-2xl border border-ink/10 bg-paper p-0">
          <DialogHeader className="border-b border-ink/10 px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-clay/10">
                <Shield className="size-5 text-clay" />
              </div>
              <div>
                <DialogTitle className="font-display text-base font-bold text-ink">
                  Centro de Resolución RODAID
                </DialogTitle>
                <p className="text-xs text-slate-warm">Paso {paso} de 3</p>
              </div>
            </div>
            {/* Barra de progreso */}
            <div className="mt-4 flex gap-1.5">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className={`h-1 flex-1 rounded-full transition-colors ${n <= paso ? 'bg-clay' : 'bg-ink/10'}`}
                />
              ))}
            </div>
          </DialogHeader>

          <div className="px-6 py-5">
            {/* PASO 1: Motivo */}
            {paso === 1 && (
              <div className="space-y-4">
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <div className="flex gap-2">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                    <p className="text-xs text-amber-800">
                      <strong>Aviso de seguridad:</strong> Al abrir una disputa, el pago quedará
                      retenido temporalmente hasta la resolución técnica. Ambas partes serán
                      notificadas de inmediato.
                    </p>
                  </div>
                </div>
                <div>
                  <p className="mb-3 text-sm font-semibold text-ink">¿Cuál es el motivo de tu reclamo?</p>
                  <div className="space-y-2">
                    {MOTIVOS.map((m) => (
                      <label
                        key={m.id}
                        className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
                          motivo === m.id ? 'border-clay/40 bg-clay/5' : 'border-ink/10 hover:bg-ink/3'
                        }`}
                      >
                        <input
                          type="radio"
                          name="motivo"
                          value={m.id}
                          checked={motivo === m.id}
                          onChange={() => setMotivo(m.id)}
                          className="accent-clay"
                        />
                        <span className="text-sm text-ink">{m.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!motivo}
                  onClick={() => setPaso(2)}
                  className="mt-2 w-full rounded-full bg-ink py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink/80 disabled:opacity-40"
                >
                  Continuar
                </button>
              </div>
            )}

            {/* PASO 2: Evidencia */}
            {paso === 2 && (
              <div className="space-y-4">
                <div>
                  <p className="mb-1 text-sm font-semibold text-ink">Descripción del problema</p>
                  <textarea
                    value={descripcion}
                    onChange={(e) => setDescripcion(e.target.value)}
                    rows={3}
                    placeholder="Describí con detalle el inconveniente encontrado..."
                    className="w-full rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm text-ink placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-ink/20"
                  />
                </div>
                <div>
                  <p className="mb-1 text-sm font-semibold text-ink">Evidencia fotográfica (máx. 3)</p>
                  <p className="mb-3 text-xs text-slate-warm">Fotos, videos o PDFs de técnicos externos que respalden tu reclamo.</p>
                  <div
                    onClick={() => inputRef.current?.click()}
                    className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-ink/15 px-4 py-6 transition-colors hover:border-ink/30"
                  >
                    <Upload className="size-6 text-ink/40" />
                    <p className="text-xs text-ink/50">Hacé clic para subir archivos</p>
                    <input ref={inputRef} type="file" multiple accept="image/*,video/*,.pdf" onChange={agregarArchivo} className="hidden" />
                  </div>
                  {archivos.length > 0 && (
                    <ul className="mt-3 space-y-2">
                      {archivos.map((f, i) => (
                        <li key={i} className="flex items-center justify-between rounded-lg border border-ink/10 px-3 py-2">
                          <div className="flex items-center gap-2">
                            <FileText className="size-4 text-ink/40" />
                            <span className="text-xs text-ink">{f.name}</span>
                          </div>
                          <button type="button" onClick={() => quitarArchivo(i)} className="text-ink/40 hover:text-clay">
                            <X className="size-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setPaso(1)} className="flex-1 rounded-full border border-ink/15 py-2.5 text-sm font-semibold text-ink hover:bg-ink/5">
                    Atrás
                  </button>
                  <button
                    type="button"
                    disabled={!descripcion}
                    onClick={() => setPaso(3)}
                    className="flex-1 rounded-full bg-ink py-2.5 text-sm font-semibold text-paper hover:bg-ink/80 disabled:opacity-40"
                  >
                    Continuar
                  </button>
                </div>
              </div>
            )}

            {/* PASO 3: Cláusula y confirmación */}
            {paso === 3 && (
              <div className="space-y-4">
                <div className="rounded-xl border border-ink/10 bg-ink/3 px-4 py-4">
                  <div className="mb-2 flex items-center gap-2">
                    <FileText className="size-4 text-ink/60" />
                    <p className="text-xs font-bold uppercase tracking-wide text-ink/60">Cláusula de Arbitraje RODAID</p>
                  </div>
                  <p className="text-xs leading-relaxed text-ink/70">
                    Al iniciar una disputa, el usuario acepta la intervención de RODAID como mediador técnico. La decisión del comité de auditoría basada en el Certificado Digital y la evidencia técnica es <strong>definitiva</strong> para la gestión del fondo en garantía (Escrow), sin perjuicio de las acciones legales que las partes decidan emprender ante la Justicia Provincial.
                  </p>
                </div>

                {/* Niveles de resolución */}
                <div className="space-y-2">
                  {[
                    { nivel: 1, label: 'Mediación automática', desc: 'El sistema analiza la evidencia y el CIT registrado.' },
                    { nivel: 2, label: 'Revisión técnica RODAID', desc: 'Un auditor técnico evalúa el certificado digital.' },
                    { nivel: 3, label: 'Resolución administrativa', desc: 'Reintegro o liberación según dictamen final.' },
                  ].map((n) => (
                    <div key={n.nivel} className="flex gap-3 rounded-lg px-3 py-2">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-ink/10 text-[10px] font-bold text-ink">{n.nivel}</span>
                      <div>
                        <p className="text-xs font-semibold text-ink">{n.label}</p>
                        <p className="text-[11px] text-slate-warm">{n.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-ink/10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={aceptaClausula}
                    onChange={(e) => setAceptaClausula(e.target.checked)}
                    className="mt-0.5 accent-clay"
                  />
                  <span className="text-xs text-ink/70">
                    Leí y acepto la Cláusula de Arbitraje RODAID y entiendo que el pago quedará retenido durante el proceso.
                  </span>
                </label>

                <div className="flex gap-2">
                  <button type="button" onClick={() => setPaso(2)} className="flex-1 rounded-full border border-ink/15 py-2.5 text-sm font-semibold text-ink hover:bg-ink/5">
                    Atrás
                  </button>
                  <button
                    type="button"
                    disabled={!aceptaClausula || enviando}
                    onClick={enviarDisputa}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-clay py-2.5 text-sm font-semibold text-white hover:bg-clay/80 disabled:opacity-40"
                  >
                    {enviando ? <><Loader2 className="size-4 animate-spin" />Procesando…</> : 'Confirmar Disputa'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default BotonDisputa
