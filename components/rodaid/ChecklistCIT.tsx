'use client'
import { useState, useRef } from 'react'
import { CheckCircle, XCircle, AlertCircle, MinusCircle, Camera, X, ChevronDown, ChevronUp } from 'lucide-react'
import { PUNTOS_INSPECCION, ChecklistInspeccion, ResultadoPunto, calcularResultadoChecklist } from '@/lib/puntos-inspeccion'

const RESULTADO_CONFIG: Record<ResultadoPunto, { label: string; color: string; icono: typeof CheckCircle }> = {
  ok: { label: 'OK', color: 'text-green-600 bg-green-100 border-green-300', icono: CheckCircle },
  observacion: { label: 'Obs.', color: 'text-amber-600 bg-amber-100 border-amber-300', icono: AlertCircle },
  falla: { label: 'Falla', color: 'text-red-600 bg-red-100 border-red-300', icono: XCircle },
  no_aplica: { label: 'N/A', color: 'text-slate-400 bg-slate-100 border-slate-200', icono: MinusCircle },
}

interface Props {
  onSubmit: (checklist: ChecklistInspeccion, fotos: string[], notas: string) => void
  enviando?: boolean
}

export function ChecklistCIT({ onSubmit, enviando = false }: Props) {
  const [checklist, setChecklist] = useState<ChecklistInspeccion>({})
  const [notasGlobal, setNotasGlobal] = useState('')
  const [fotos, setFotos] = useState<string[]>([])
  const [categoriasAbiertas, setCategoriasAbiertas] = useState<Record<string, boolean>>({
    'Identificación': true,
    'Cuadro y Horquilla': true,
    'Ruedas y Neumáticos': false,
    'Frenos': false,
    'Transmisión': false,
    'Componentes': false,
    'Seguridad': true,
  })
  const fileRef = useRef<HTMLInputElement>(null)

  const categorias = [...new Set(PUNTOS_INSPECCION.map(p => p.categoria))]

  const setResultado = (puntoId: string, resultado: ResultadoPunto) => {
    setChecklist(prev => ({ ...prev, [puntoId]: { ...prev[puntoId], resultado } }))
  }

  const setNota = (puntoId: string, nota: string) => {
    setChecklist(prev => ({ ...prev, [puntoId]: { ...prev[puntoId], nota } }))
  }

  const subirFoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    files.forEach(file => {
      const reader = new FileReader()
      reader.onload = ev => {
        const base64 = ev.target?.result as string
        setFotos(prev => [...prev, base64])
      }
      reader.readAsDataURL(file)
    })
  }

  const resultado = calcularResultadoChecklist(checklist)
  const completados = Object.keys(checklist).length
  const progreso = Math.round((completados / PUNTOS_INSPECCION.length) * 100)

  const toggleCategoria = (cat: string) => {
    setCategoriasAbiertas(prev => ({ ...prev, [cat]: !prev[cat] }))
  }

  const handleSubmit = () => {
    if (completados < PUNTOS_INSPECCION.length) {
      alert(`Faltan ${PUNTOS_INSPECCION.length - completados} puntos por evaluar.`)
      return
    }
    onSubmit(checklist, fotos, notasGlobal)
  }

  return (
    <div className="space-y-4">
      {/* Progreso */}
      <div className="rounded-2xl border border-ink/10 bg-white p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-base font-semibold text-[#0F1E35]">Checklist CIT — 20 Puntos</h3>
          <span className="text-sm font-semibold text-[#2BBCB8]">{completados}/{PUNTOS_INSPECCION.length}</span>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full rounded-full bg-[#2BBCB8] transition-all" style={{ width: `${progreso}%` }} />
        </div>
        <div className="flex gap-4 mt-3 text-xs">
          <span className="text-green-600">✅ {resultado.puntosOk} OK</span>
          <span className="text-amber-600">⚠ {resultado.puntosObservacion} Obs.</span>
          <span className="text-red-600">✗ {resultado.puntosFalla} Falla</span>
        </div>
        {completados === PUNTOS_INSPECCION.length && (
          <div className={`mt-3 rounded-xl p-3 text-sm font-semibold ${resultado.aprobada ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {resultado.aprobada
              ? '✅ Inspección APROBADA — puede emitirse el CIT'
              : `❌ Inspección RECHAZADA — ${resultado.puntosCriticosFailados.length} punto(s) crítico(s) fallado(s)`}
          </div>
        )}
      </div>

      {/* Puntos por categoría */}
      {categorias.map(cat => {
        const puntosCat = PUNTOS_INSPECCION.filter(p => p.categoria === cat)
        const abierta = categoriasAbiertas[cat] ?? false
        return (
          <div key={cat} className="rounded-2xl border border-ink/10 bg-white overflow-hidden">
            <button type="button" onClick={() => toggleCategoria(cat)}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50">
              <span className="font-semibold text-sm text-[#0F1E35]">{cat}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-warm">
                  {puntosCat.filter(p => checklist[p.id]?.resultado).length}/{puntosCat.length}
                </span>
                {abierta ? <ChevronUp className="size-4 text-slate-warm" /> : <ChevronDown className="size-4 text-slate-warm" />}
              </div>
            </button>
            {abierta && (
              <div className="border-t border-slate-100 divide-y divide-slate-50">
                {puntosCat.map(punto => {
                  const r = checklist[punto.id]?.resultado
                  return (
                    <div key={punto.id} className="px-5 py-4">
                      <div className="flex items-start gap-3 mb-2">
                        <span className="shrink-0 text-xs font-mono font-bold text-slate-400 mt-0.5">{punto.id}</span>
                        <div className="flex-1">
                          <p className="text-sm text-[#0F1E35]">
                            {punto.descripcion}
                            {punto.critico && <span className="ml-1 text-[10px] font-bold text-red-500">CRÍTICO</span>}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2 flex-wrap ml-8">
                        {(['ok', 'observacion', 'falla', 'no_aplica'] as ResultadoPunto[]).map(res => {
                          const cfg = RESULTADO_CONFIG[res]
                          const Icono = cfg.icono
                          const activo = r === res
                          return (
                            <button key={res} type="button"
                              onClick={() => setResultado(punto.id, res)}
                              className={`inline-flex items-center gap-1 px-3 py-1 rounded-full border text-xs font-semibold transition-all ${activo ? cfg.color + ' border-current' : 'border-slate-200 text-slate-400 hover:border-slate-300'}`}>
                              <Icono className="size-3" />
                              {cfg.label}
                            </button>
                          )
                        })}
                      </div>
                      {(r === 'observacion' || r === 'falla') && (
                        <input type="text"
                          placeholder={r === 'falla' ? 'Describí el defecto encontrado...' : 'Descripción de la observación...'}
                          value={checklist[punto.id]?.nota ?? ''}
                          onChange={e => setNota(punto.id, e.target.value)}
                          className="mt-2 ml-8 w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-[#2BBCB8]" />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {/* Fotos */}
      <div className="rounded-2xl border border-ink/10 bg-white p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-base font-semibold text-[#0F1E35] flex items-center gap-2">
            <Camera className="size-4 text-[#F47B20]" /> Fotos de la inspección
          </h3>
          <label className="inline-flex items-center gap-1 rounded-full bg-[#F47B20] px-3 py-1.5 text-xs font-semibold text-white cursor-pointer hover:bg-[#F47B20]/80">
            <Camera className="size-3" /> Agregar fotos
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={subirFoto} />
          </label>
        </div>
        {fotos.length === 0 ? (
          <p className="text-sm text-slate-warm text-center py-4">Agregá fotos del número de serie, cuadro y componentes inspeccionados.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {fotos.map((f, i) => (
              <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-slate-100">
                <img src={f} alt={`Foto ${i+1}`} loading="lazy" className="w-full h-full object-cover" />
                <button type="button" onClick={() => setFotos(prev => prev.filter((_, j) => j !== i))}
                  className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white">
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notas generales */}
      <div className="rounded-2xl border border-ink/10 bg-white p-5">
        <h3 className="font-display text-sm font-semibold text-[#0F1E35] mb-3">Notas generales del inspector</h3>
        <textarea rows={3} placeholder="Observaciones adicionales, condiciones de la inspección, etc."
          value={notasGlobal} onChange={e => setNotasGlobal(e.target.value)}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8] resize-none" />
      </div>

      {/* Botón submit */}
      <div className="flex gap-3 justify-end">
        <button type="button" onClick={handleSubmit} disabled={enviando || completados < PUNTOS_INSPECCION.length}
          className={`inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white disabled:opacity-50 ${resultado.aprobada && completados === PUNTOS_INSPECCION.length ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
          {enviando ? 'Enviando...' : completados < PUNTOS_INSPECCION.length ? `Faltan ${PUNTOS_INSPECCION.length - completados} puntos` : resultado.aprobada ? '✅ Aprobar y emitir CIT' : '❌ Rechazar inspección'}
        </button>
      </div>
    </div>
  )
}
