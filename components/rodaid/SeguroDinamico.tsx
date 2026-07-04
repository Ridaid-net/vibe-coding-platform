'use client'
import { useState } from 'react'
import { Shield, ChevronRight, CheckCircle, Calculator, AlertCircle } from 'lucide-react'

interface SeguroDinamicoProps {
  marca: string
  modelo: string
  año: number | null
  tipo: string | null
  citActivo: boolean
  kmTotales: number
  codigoCit: string
}

const VALOR_BICI: Record<string, number> = {
  'MTB': 350000,
  'Ruta': 450000,
  'Urbana': 180000,
  'BMX': 150000,
  'Electrica': 600000,
  'default': 250000,
}

export function SeguroDinamico({ marca, modelo, año, tipo, citActivo, kmTotales, codigoCit }: SeguroDinamicoProps) {
  const [expandido, setExpandido] = useState(false)
  const [diasUso, setDiasUso] = useState(30)
  const [cobertura, setCobertura] = useState<'basica' | 'completa'>('basica')
  const [solicitado, setSolicitado] = useState(false)

  const valorBase = VALOR_BICI[tipo ?? 'default'] ?? VALOR_BICI['default']
  const ajusteAño = año ? Math.max(0.6, 1 - (2026 - año) * 0.05) : 0.8
  const valorBici = Math.round(valorBase * ajusteAño)

  // Prima base mensual: 0.8% del valor para basica, 1.5% para completa
  const tasaMensual = cobertura === 'basica' ? 0.008 : 0.015
  // Descuento por CIT activo: 20%
  const descuentoCit = citActivo ? 0.20 : 0
  // Descuento por km bajos: si menos de 300km/mes, 10% adicional
  const kmMensuales = kmTotales > 0 ? kmTotales / 6 : 0
  const descuentoKm = kmMensuales < 300 ? 0.10 : 0
  // Prima diaria
  const primaMensualBase = Math.round(valorBici * tasaMensual)
  const descuentoTotal = descuentoCit + descuentoKm
  const primaMensualFinal = Math.round(primaMensualBase * (1 - descuentoTotal))
  const primaDiaria = Math.round(primaMensualFinal / 30)
  const primaPeriodo = Math.round(primaDiaria * diasUso)

  const coberturas = {
    basica: ['Robo con fuerza', 'Daño total por accidente', 'Asistencia en ruta 24hs'],
    completa: ['Robo con fuerza', 'Robo sin fuerza', 'Daño parcial y total', 'Asistencia en ruta 24hs', 'Responsabilidad civil', 'Accesorios incluidos'],
  }

  const handleSolicitar = () => {
    setSolicitado(true)
    const asunto = encodeURIComponent(`Solicitud Seguro CIT RODAID — ${marca} ${modelo}`)
    const cuerpo = encodeURIComponent(
      `Hola, solicito información sobre el Seguro CIT RODAID para mi bicicleta:\n\n` +
      `Bicicleta: ${marca} ${modelo} ${año ?? ''} (${tipo})\n` +
      `CIT: ${codigoCit}\n` +
      `Cobertura: ${cobertura === 'basica' ? 'Básica' : 'Completa'}\n` +
      `Días de uso mensuales: ${diasUso}\n` +
      `Prima estimada: $${primaPeriodo.toLocaleString('es-AR')} ARS por ${diasUso} días\n\n` +
      `Por favor contactarme para formalizar la póliza.`
    )
    window.open(`mailto:federicodegeaceo@rodaid.net?subject=${asunto}&body=${cuerpo}`)
  }

  if (!citActivo) return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 mt-4">
      <div className="flex items-center gap-2">
        <AlertCircle className="size-4 text-slate-400" />
        <p className="text-xs text-slate-warm">Activá tu CIT para acceder al Seguro Dinámico RODAID con prima reducida.</p>
      </div>
    </div>
  )

  return (
    <div className="rounded-2xl border border-[#2BBCB8]/30 bg-teal-50 p-5 mt-4">
      <button type="button" onClick={() => setExpandido(v => !v)} className="w-full flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-[#2BBCB8]">
            <Shield className="size-5 text-white" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-[#0F1E35]">Seguro Dinámico CIT</p>
            <p className="text-xs text-teal-700">Prima estimada desde ${primaDiaria.toLocaleString('es-AR')} ARS/día · 20% descuento CIT</p>
          </div>
        </div>
        <ChevronRight className={`size-4 text-teal-600 transition-transform ${expandido ? 'rotate-90' : ''}`} />
      </button>

      {expandido && (
        <div className="mt-4 space-y-4">

          <div className="rounded-xl bg-white border border-teal-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Calculator className="size-4 text-[#2BBCB8]" />
              <p className="text-xs font-semibold text-[#0F1E35]">Calculadora de prima</p>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-slate-warm mb-2">Tipo de cobertura</p>
                <div className="flex gap-2">
                  {(['basica', 'completa'] as const).map(c => (
                    <button key={c} type="button" onClick={() => setCobertura(c)}
                      className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-colors ${cobertura === c ? 'bg-[#0F1E35] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                      {c === 'basica' ? 'Básica' : 'Completa'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <p className="text-xs text-slate-warm">Días de uso este mes</p>
                  <p className="text-xs font-semibold text-[#0F1E35]">{diasUso} días</p>
                </div>
                <input type="range" min={1} max={31} value={diasUso}
                  onChange={e => setDiasUso(Number(e.target.value))}
                  className="w-full accent-teal-500" />
                <div className="flex justify-between text-[10px] text-slate-warm mt-0.5">
                  <span>1 día</span><span>31 días</span>
                </div>
              </div>

              <div className="rounded-lg bg-teal-50 p-3 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-warm">Valor estimado bici</span>
                  <span className="font-semibold">${valorBici.toLocaleString('es-AR')} ARS</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-warm">Prima base mensual</span>
                  <span>${primaMensualBase.toLocaleString('es-AR')} ARS</span>
                </div>
                {citActivo && (
                  <div className="flex justify-between text-xs text-green-600">
                    <span>Descuento CIT activo</span>
                    <span>-20%</span>
                  </div>
                )}
                {descuentoKm > 0 && (
                  <div className="flex justify-between text-xs text-green-600">
                    <span>Descuento bajo kilometraje</span>
                    <span>-10%</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold text-[#0F1E35] pt-1 border-t border-teal-200">
                  <span>Total por {diasUso} días</span>
                  <span className="text-[#2BBCB8]">${primaPeriodo.toLocaleString('es-AR')} ARS</span>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-white border border-teal-200 p-4">
            <p className="text-xs font-semibold text-[#0F1E35] mb-2">Coberturas incluidas</p>
            <ul className="space-y-1">
              {coberturas[cobertura].map((c, i) => (
                <li key={i} className="flex items-center gap-2 text-xs text-slate-warm">
                  <CheckCircle className="size-3 text-green-500 shrink-0" />
                  {c}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl bg-[#0F1E35]/5 p-3">
            <p className="text-[11px] text-slate-warm">Prima calculada sobre el valor estimado de la bicicleta. La póliza final dependerá de la evaluación de la aseguradora aliada. CIT activo es requisito para la contratación.</p>
          </div>

          {solicitado ? (
            <div className="rounded-xl bg-green-50 border border-green-200 p-3 text-center">
              <CheckCircle className="size-5 text-green-500 mx-auto mb-1" />
              <p className="text-xs font-semibold text-green-700">Solicitud enviada</p>
              <p className="text-[11px] text-green-600">Te contactaremos a la brevedad para formalizar tu póliza.</p>
            </div>
          ) : (
            <button type="button" onClick={handleSolicitar}
              className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-[#2BBCB8] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2BBCB8]/80">
              <Shield className="size-4" />
              Solicitar Seguro CIT — ${primaPeriodo.toLocaleString('es-AR')} ARS
            </button>
          )}
        </div>
      )}
    </div>
  )
}
