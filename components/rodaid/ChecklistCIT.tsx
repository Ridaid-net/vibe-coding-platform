'use client'
import { useEffect, useRef, useState } from 'react'
import { CheckCircle, XCircle, AlertCircle, MinusCircle, Camera, X, ChevronDown, ChevronUp, Tag } from 'lucide-react'
import {
  PUNTOS_INSPECCION,
  ChecklistInspeccion,
  ComponenteCapturado,
  ResultadoPunto,
  calcularResultadoChecklist,
  esPuntoConComponente,
  puntosPremiumAplicables,
} from '@/lib/puntos-inspeccion'

const RESULTADO_CONFIG: Record<ResultadoPunto, { label: string; color: string; icono: typeof CheckCircle }> = {
  ok: { label: 'OK', color: 'text-green-600 bg-green-100 border-green-300', icono: CheckCircle },
  observacion: { label: 'Obs.', color: 'text-amber-600 bg-amber-100 border-amber-300', icono: AlertCircle },
  falla: { label: 'Falla', color: 'text-red-600 bg-red-100 border-red-300', icono: XCircle },
  no_aplica: { label: 'N/A', color: 'text-slate-400 bg-slate-100 border-slate-200', icono: MinusCircle },
}

interface Props {
  /** Tipo y suspensión trasera de la bici -- decide qué puntos premium
   * (suspensión/e-bike) son candidatos a mostrarse. */
  bici: { tipo: string; suspensionTrasera: boolean | null }
  onSubmit: (
    checklist: ChecklistInspeccion,
    fotosPorPunto: Record<string, File>,
    notas: string,
    checklistPremium: ChecklistInspeccion
  ) => void
  enviando?: boolean
}

export function ChecklistCIT({ bici, onSubmit, enviando = false }: Props) {
  const [checklist, setChecklist] = useState<ChecklistInspeccion>({})
  const [notasGlobal, setNotasGlobal] = useState('')
  const [fotosPorPunto, setFotosPorPunto] = useState<Record<string, File>>({})
  const [previewsPorPunto, setPreviewsPorPunto] = useState<Record<string, string>>({})
  const [categoriasAbiertas, setCategoriasAbiertas] = useState<Record<string, boolean>>({
    'Identificación': true,
    'Cuadro y Horquilla': true,
    'Ruedas y Neumáticos': false,
    'Frenos': false,
    'Transmisión': false,
    'Componentes': false,
    'Seguridad': true,
  })
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  // Checklist Premium (suspensión trasera / e-bike) -- módulo opcional
  // anidado dentro del checklist completo, nunca gatea el submit principal
  // (ver lib/puntos-inspeccion.ts::PUNTOS_INSPECCION_PREMIUM).
  const [moduloPremiumActivo, setModuloPremiumActivo] = useState(false)
  const [checklistPremium, setChecklistPremium] = useState<ChecklistInspeccion>({})
  const [categoriasPremiumAbiertas, setCategoriasPremiumAbiertas] = useState<Record<string, boolean>>({})
  // Fotos/previews/fileRefs se comparten con el checklist base -- ambos son
  // diccionarios keyeados por puntoId, y P01-P20 nunca colisiona con
  // PR01-PR08 (prefijos distintos).

  // Revoca todas las URL de preview al desmontar (no antes -- se revocan
  // individualmente al reemplazar/quitar una foto, ver adjuntarFotoPunto).
  useEffect(() => {
    return () => {
      Object.values(previewsPorPunto).forEach(url => URL.revokeObjectURL(url))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const categorias = [...new Set(PUNTOS_INSPECCION.map(p => p.categoria))]

  const setResultado = (puntoId: string, resultado: ResultadoPunto) => {
    setChecklist(prev => ({ ...prev, [puntoId]: { ...prev[puntoId], resultado } }))
  }

  const setNota = (puntoId: string, nota: string) => {
    setChecklist(prev => ({ ...prev, [puntoId]: { ...prev[puntoId], nota } }))
  }

  const setComponenteCampo = (puntoId: string, campo: keyof ComponenteCapturado, valor: string) => {
    setChecklist(prev => ({
      ...prev,
      [puntoId]: {
        ...prev[puntoId],
        componente: { ...prev[puntoId]?.componente, [campo]: valor },
      },
    }))
  }

  const adjuntarFotoPunto = (puntoId: string, file: File) => {
    setFotosPorPunto(prev => ({ ...prev, [puntoId]: file }))
    setPreviewsPorPunto(prev => {
      if (prev[puntoId]) URL.revokeObjectURL(prev[puntoId])
      return { ...prev, [puntoId]: URL.createObjectURL(file) }
    })
  }

  const quitarFotoPunto = (puntoId: string) => {
    setFotosPorPunto(prev => {
      const { [puntoId]: _quitada, ...resto } = prev
      return resto
    })
    setPreviewsPorPunto(prev => {
      if (prev[puntoId]) URL.revokeObjectURL(prev[puntoId])
      const { [puntoId]: _quitada, ...resto } = prev
      return resto
    })
  }

  const setResultadoPremium = (puntoId: string, resultado: ResultadoPunto) => {
    setChecklistPremium(prev => ({ ...prev, [puntoId]: { ...prev[puntoId], resultado } }))
  }

  const setNotaPremium = (puntoId: string, nota: string) => {
    setChecklistPremium(prev => ({ ...prev, [puntoId]: { ...prev[puntoId], nota } }))
  }

  const setComponentePremiumCampo = (puntoId: string, campo: keyof ComponenteCapturado, valor: string) => {
    setChecklistPremium(prev => ({
      ...prev,
      [puntoId]: {
        ...prev[puntoId],
        componente: { ...prev[puntoId]?.componente, [campo]: valor },
      },
    }))
  }

  /** Solo PR07 (potencia_w) y PR08 (capacidad_wh/voltaje/ciclos_carga_estimados). */
  const setEspecificacionPremiumCampo = (puntoId: string, campo: string, valor: string) => {
    const num = valor === '' ? undefined : Number(valor)
    setChecklistPremium(prev => {
      const especificaciones = { ...prev[puntoId]?.componente?.especificaciones }
      if (num === undefined || Number.isNaN(num)) delete especificaciones[campo]
      else especificaciones[campo] = num
      return {
        ...prev,
        [puntoId]: {
          ...prev[puntoId],
          componente: { ...prev[puntoId]?.componente, especificaciones },
        },
      }
    })
  }

  const resultado = calcularResultadoChecklist(checklist)
  const completados = Object.keys(checklist).length
  const progreso = Math.round((completados / PUNTOS_INSPECCION.length) * 100)

  const puntosPremiumAplic = puntosPremiumAplicables(bici)
  const categoriasPremium = [...new Set(puntosPremiumAplic.map(p => p.categoria))]
  const completadosPremium = Object.keys(checklistPremium).length

  const toggleCategoria = (cat: string) => {
    setCategoriasAbiertas(prev => ({ ...prev, [cat]: !prev[cat] }))
  }

  const toggleCategoriaPremium = (cat: string) => {
    setCategoriasPremiumAbiertas(prev => ({ ...prev, [cat]: !prev[cat] }))
  }

  const handleSubmit = () => {
    if (completados < PUNTOS_INSPECCION.length) {
      alert(`Faltan ${PUNTOS_INSPECCION.length - completados} puntos por evaluar.`)
      return
    }
    // El checklist premium nunca bloquea el submit -- es opcional, sin
    // "faltan N puntos" (ver puntos-inspeccion.ts).
    onSubmit(checklist, fotosPorPunto, notasGlobal, moduloPremiumActivo ? checklistPremium : {})
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
                  const conComponente = esPuntoConComponente(punto.id)
                  const componente = checklist[punto.id]?.componente
                  const foto = fotosPorPunto[punto.id]
                  const preview = previewsPorPunto[punto.id]
                  return (
                    <div key={punto.id} className="px-5 py-4">
                      <div className="flex items-start gap-3 mb-2">
                        <span className="shrink-0 text-xs font-mono font-bold text-slate-400 mt-0.5">{punto.id}</span>
                        <div className="flex-1">
                          <p className="text-sm text-[#0F1E35]">
                            {punto.descripcion}
                            {punto.critico && <span className="ml-1 text-[10px] font-bold text-red-500">CRÍTICO</span>}
                            {conComponente && (
                              <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] font-bold text-[#2BBCB8]">
                                <Tag className="size-2.5" /> COMPONENTE
                              </span>
                            )}
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

                      {conComponente && (
                        <div className="mt-3 ml-8 rounded-xl border border-[#2BBCB8]/25 bg-[#2BBCB8]/5 p-3 space-y-2">
                          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#2BBCB8]">
                            <Tag className="size-3" /> Componente tokenizado (opcional)
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <input type="text" placeholder="Marca"
                              value={componente?.marca ?? ''}
                              onChange={e => setComponenteCampo(punto.id, 'marca', e.target.value)}
                              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#2BBCB8]" />
                            <input type="text" placeholder="Modelo"
                              value={componente?.modelo ?? ''}
                              onChange={e => setComponenteCampo(punto.id, 'modelo', e.target.value)}
                              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#2BBCB8]" />
                            <input type="text" placeholder="N° de serie"
                              value={componente?.numeroSerie ?? ''}
                              onChange={e => setComponenteCampo(punto.id, 'numeroSerie', e.target.value)}
                              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-mono outline-none focus:border-[#2BBCB8]" />
                          </div>
                          <div className="flex items-center gap-2">
                            {preview ? (
                              <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={preview} alt={`Foto ${punto.id}`} className="size-full object-cover" />
                                <button type="button" onClick={() => quitarFotoPunto(punto.id)}
                                  className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-black/60 text-white">
                                  <X className="size-2.5" />
                                </button>
                              </div>
                            ) : (
                              <label className="inline-flex items-center gap-1 rounded-full bg-[#F47B20] px-2.5 py-1 text-[11px] font-semibold text-white cursor-pointer hover:bg-[#F47B20]/80">
                                <Camera className="size-3" /> Foto del serial
                                <input
                                  ref={el => { fileRefs.current[punto.id] = el }}
                                  type="file" accept="image/*" className="hidden"
                                  onChange={e => {
                                    const file = e.target.files?.[0]
                                    if (file) adjuntarFotoPunto(punto.id, file)
                                  }} />
                              </label>
                            )}
                            {foto && <span className="text-[11px] text-slate-warm">{foto.name}</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {/* Checklist Premium (suspensión trasera / e-bike) -- solo si hay al
          menos un punto candidato para esta bici (tipo/suspensión). Módulo
          opcional, nunca gatea el submit principal. */}
      {puntosPremiumAplic.length > 0 && (
        <div className="rounded-2xl border border-[#2BBCB8]/30 bg-white overflow-hidden">
          <button type="button" onClick={() => setModuloPremiumActivo(v => !v)}
            className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#2BBCB8]/5">
            <div className="text-left">
              <span className="font-display text-sm font-semibold text-[#0F1E35]">Checklist Premium</span>
              <p className="text-[11px] text-slate-warm">Suspensión trasera, componentes electrónicos, e-bike (opcional)</p>
            </div>
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${moduloPremiumActivo ? 'bg-[#2BBCB8] text-white' : 'bg-slate-100 text-slate-500'}`}>
              {moduloPremiumActivo ? `Activado · ${completadosPremium}/${puntosPremiumAplic.length}` : 'Activar'}
            </span>
          </button>

          {moduloPremiumActivo && categoriasPremium.map(cat => {
            const puntosCat = puntosPremiumAplic.filter(p => p.categoria === cat)
            const abierta = categoriasPremiumAbiertas[cat] ?? true
            return (
              <div key={cat} className="border-t border-slate-100">
                <button type="button" onClick={() => toggleCategoriaPremium(cat)}
                  className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50">
                  <span className="font-semibold text-sm text-[#0F1E35]">{cat}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-warm">
                      {puntosCat.filter(p => checklistPremium[p.id]?.resultado).length}/{puntosCat.length}
                    </span>
                    {abierta ? <ChevronUp className="size-4 text-slate-warm" /> : <ChevronDown className="size-4 text-slate-warm" />}
                  </div>
                </button>
                {abierta && (
                  <div className="border-t border-slate-100 divide-y divide-slate-50">
                    {puntosCat.map(punto => {
                      const r = checklistPremium[punto.id]?.resultado
                      const componente = checklistPremium[punto.id]?.componente
                      const foto = fotosPorPunto[punto.id]
                      const preview = previewsPorPunto[punto.id]
                      const tieneEspecificaciones = punto.id === 'PR07' || punto.id === 'PR08'
                      return (
                        <div key={punto.id} className="px-5 py-4">
                          <div className="flex items-start gap-3 mb-2">
                            <span className="shrink-0 text-xs font-mono font-bold text-[#2BBCB8] mt-0.5">{punto.id}</span>
                            <p className="flex-1 text-sm text-[#0F1E35]">{punto.descripcion}</p>
                          </div>
                          <div className="flex gap-2 flex-wrap ml-8">
                            {(['ok', 'observacion', 'falla', 'no_aplica'] as ResultadoPunto[]).map(res => {
                              const cfg = RESULTADO_CONFIG[res]
                              const Icono = cfg.icono
                              const activo = r === res
                              return (
                                <button key={res} type="button"
                                  onClick={() => setResultadoPremium(punto.id, res)}
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
                              value={checklistPremium[punto.id]?.nota ?? ''}
                              onChange={e => setNotaPremium(punto.id, e.target.value)}
                              className="mt-2 ml-8 w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-[#2BBCB8]" />
                          )}

                          <div className="mt-3 ml-8 rounded-xl border border-[#2BBCB8]/25 bg-[#2BBCB8]/5 p-3 space-y-2">
                            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#2BBCB8]">
                              <Tag className="size-3" /> Componente tokenizado (opcional)
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <input type="text" placeholder="Marca"
                                value={componente?.marca ?? ''}
                                onChange={e => setComponentePremiumCampo(punto.id, 'marca', e.target.value)}
                                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#2BBCB8]" />
                              <input type="text" placeholder="Modelo"
                                value={componente?.modelo ?? ''}
                                onChange={e => setComponentePremiumCampo(punto.id, 'modelo', e.target.value)}
                                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#2BBCB8]" />
                              <input type="text" placeholder="N° de serie"
                                value={componente?.numeroSerie ?? ''}
                                onChange={e => setComponentePremiumCampo(punto.id, 'numeroSerie', e.target.value)}
                                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-mono outline-none focus:border-[#2BBCB8]" />
                            </div>

                            {tieneEspecificaciones && (
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                                {punto.id === 'PR07' && (
                                  <input type="number" placeholder="Potencia (W)"
                                    value={componente?.especificaciones?.potencia_w ?? ''}
                                    onChange={e => setEspecificacionPremiumCampo(punto.id, 'potencia_w', e.target.value)}
                                    className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#2BBCB8]" />
                                )}
                                {punto.id === 'PR08' && (
                                  <>
                                    <input type="number" placeholder="Capacidad (Wh)"
                                      value={componente?.especificaciones?.capacidad_wh ?? ''}
                                      onChange={e => setEspecificacionPremiumCampo(punto.id, 'capacidad_wh', e.target.value)}
                                      className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#2BBCB8]" />
                                    <input type="number" placeholder="Voltaje (V)"
                                      value={componente?.especificaciones?.voltaje ?? ''}
                                      onChange={e => setEspecificacionPremiumCampo(punto.id, 'voltaje', e.target.value)}
                                      className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#2BBCB8]" />
                                    <input type="number" placeholder="Ciclos de carga (est.)"
                                      value={componente?.especificaciones?.ciclos_carga_estimados ?? ''}
                                      onChange={e => setEspecificacionPremiumCampo(punto.id, 'ciclos_carga_estimados', e.target.value)}
                                      className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#2BBCB8]" />
                                  </>
                                )}
                              </div>
                            )}

                            <div className="flex items-center gap-2">
                              {preview ? (
                                <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={preview} alt={`Foto ${punto.id}`} className="size-full object-cover" />
                                  <button type="button" onClick={() => quitarFotoPunto(punto.id)}
                                    className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-black/60 text-white">
                                    <X className="size-2.5" />
                                  </button>
                                </div>
                              ) : (
                                <label className="inline-flex items-center gap-1 rounded-full bg-[#F47B20] px-2.5 py-1 text-[11px] font-semibold text-white cursor-pointer hover:bg-[#F47B20]/80">
                                  <Camera className="size-3" /> Foto del componente
                                  <input
                                    ref={el => { fileRefs.current[punto.id] = el }}
                                    type="file" accept="image/*" className="hidden"
                                    onChange={e => {
                                      const file = e.target.files?.[0]
                                      if (file) adjuntarFotoPunto(punto.id, file)
                                    }} />
                                </label>
                              )}
                              {foto && <span className="text-[11px] text-slate-warm">{foto.name}</span>}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

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
