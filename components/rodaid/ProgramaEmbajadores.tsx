'use client'
import { useState } from 'react'
import { Users, Gift, Copy, CheckCircle, ChevronRight, Star } from 'lucide-react'

interface ProgramaEmbajadoresProps {
  usuarioId: string
  nombreUsuario: string
  nivel: string
  referidosActivos: number
}

const BENEFICIOS = [
  { desde: 1, titulo: 'Descuento en service', detalle: '10% de descuento en cualquier taller aliado RODAID', icono: '🔧' },
  { desde: 3, titulo: 'CIT con bonificacion', detalle: '20% de descuento en tu proxima renovacion de CIT', icono: '🛡️' },
  { desde: 5, titulo: 'Seguro preferencial', detalle: 'Acceso a poliza Seguro CIT con prima reducida', icono: '📋' },
  { desde: 10, titulo: 'Embajador Oficial', detalle: 'Badge exclusivo en tu perfil y prioridad en eventos RODAID', icono: '🏆' },
]

export function ProgramaEmbajadores({ usuarioId, nombreUsuario, referidosActivos }: ProgramaEmbajadoresProps) {
  const [expandido, setExpandido] = useState(false)
  const [copiado, setCopiado] = useState(false)

  const codigoReferido = `RODAID-${usuarioId.slice(0, 6).toUpperCase()}`
  const urlReferido = `https://rodaid.net/ingresar?ref=${codigoReferido}`

  const copiar = async () => {
    await navigator.clipboard.writeText(urlReferido)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  const compartir = async () => {
    const texto = `🚲 Unite a RODAID — la plataforma de bicicletas verificadas de Mendoza.\nCertifica tu bici con blockchain y vendela con pago protegido.\nRegistrate con mi codigo y obtene beneficios: ${urlReferido}`
    if (navigator.share) {
      await navigator.share({ title: 'RODAID — Bicicletas Verificadas', text: texto, url: urlReferido })
    } else {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    }
  }

  const proximoBeneficio = BENEFICIOS.find(b => b.desde > referidosActivos)
  const beneficiosDesbloqueados = BENEFICIOS.filter(b => b.desde <= referidosActivos)

  return (
    <div className="rounded-2xl border border-[#F47B20]/30 bg-orange-50 p-5 mt-4">
      <button type="button" onClick={() => setExpandido(v => !v)} className="w-full flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-[#F47B20]">
            <Users className="size-5 text-white" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-[#0F1E35]">Programa de Embajadores</p>
            <p className="text-xs text-amber-700">{referidosActivos} referidos activos{proximoBeneficio ? ` · Falta ${proximoBeneficio.desde - referidosActivos} para ${proximoBeneficio.titulo}` : ' · Nivel maximo!'}</p>
          </div>
        </div>
        <ChevronRight className={`size-4 text-amber-600 transition-transform ${expandido ? 'rotate-90' : ''}`} />
      </button>

      {expandido && (
        <div className="mt-4 space-y-4">

          <div className="rounded-xl bg-white border border-amber-200 p-4">
            <p className="text-xs font-semibold text-[#0F1E35] mb-1">Tu codigo de referido</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg bg-slate-50 px-3 py-2 text-sm font-mono font-bold text-[#F47B20] border border-slate-200">{codigoReferido}</code>
              <button type="button" onClick={copiar}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#0F1E35] text-white hover:bg-[#0F1E35]/80">
                {copiado ? <CheckCircle className="size-4 text-green-400" /> : <Copy className="size-4" />}
              </button>
            </div>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={compartir}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-[#F47B20] px-4 py-2 text-xs font-semibold text-white hover:bg-[#F47B20]/80">
                <Users className="size-3.5" /> Invitar ciclistas
              </button>
              <button type="button" onClick={copiar}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-full border border-amber-300 px-4 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100">
                <Copy className="size-3.5" /> Copiar link
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-[#0F1E35]">Beneficios por referidos</p>
            {BENEFICIOS.map((b) => {
              const desbloqueado = referidosActivos >= b.desde
              return (
                <div key={b.desde} className={`rounded-xl p-3 flex items-start gap-3 ${desbloqueado ? 'bg-white border border-green-200' : 'bg-white/50 border border-amber-100 opacity-60'}`}>
                  <span className="text-lg">{b.icono}</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-[#0F1E35]">{b.titulo}</p>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${desbloqueado ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {desbloqueado ? 'Desbloqueado' : `${b.desde} referidos`}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-warm mt-0.5">{b.detalle}</p>
                  </div>
                  {desbloqueado && <CheckCircle className="size-4 text-green-500 shrink-0" />}
                </div>
              )
            })}
          </div>

          <div className="rounded-xl bg-[#0F1E35] p-3 text-center">
            <Star className="size-4 text-[#F47B20] mx-auto mb-1" />
            <p className="text-xs text-white/70">Cada referido que obtenga su CIT activo cuenta como referido valido. Los beneficios se aplican automaticamente.</p>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-amber-700 font-semibold">Total referidos activos</span>
            <span className="text-xl font-bold text-[#0F1E35]">{referidosActivos}</span>
          </div>
        </div>
      )}
    </div>
  )
}
