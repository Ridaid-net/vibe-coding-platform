'use client'
import { useState } from 'react'
import { Share2, Download, QrCode, CheckCircle } from 'lucide-react'

interface BiciSeguraShareProps {
  codigoCit: string
  marca: string
  modelo: string
  tipo: string
  numeroSerie: string
  año: number | null
  color: string | null
}

export function BiciSeguraShare({ codigoCit, marca, modelo, tipo, numeroSerie, año, color }: BiciSeguraShareProps) {
  const [copiado, setCopiado] = useState(false)
  const [abierto, setAbierto] = useState(false)

  const urlVerificacion = `https://rodaid.net/verificar/${numeroSerie}`
  const textoShare = `🚲 Mi bici está verificada en RODAID\n${marca} ${modelo} ${año ?? ''}\nCIT: ${codigoCit}\nVerificá su identidad: ${urlVerificacion}`

  const copiarLink = async () => {
    await navigator.clipboard.writeText(urlVerificacion)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  const compartirNativo = async () => {
    if (navigator.share) {
      await navigator.share({ title: `Mi bici verificada — RODAID`, text: textoShare, url: urlVerificacion })
    } else {
      copiarLink()
    }
  }

  if (!abierto) {
    return (
      <button
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-2 rounded-full border border-[#2BBCB8] px-4 py-2 text-xs font-semibold text-[#2BBCB8] hover:bg-[#2BBCB8]/5 transition-colors"
      >
        <Share2 className="size-3.5" />
        Compartir Certificado
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-[#2BBCB8]/30 bg-white p-5 mt-3">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold text-[#0F1E35]">Certificado BiciSegura</p>
        <button onClick={() => setAbierto(false)} className="text-xs text-slate-400 hover:text-slate-600">Cerrar</button>
      </div>

      <div className="rounded-xl border-2 border-[#2BBCB8] bg-[#0F1E35] p-4 text-white mb-4">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle className="size-5 text-[#2BBCB8]" />
          <span className="text-xs font-semibold uppercase tracking-widest text-[#2BBCB8]">RODAID · Verificada</span>
        </div>
        <p className="font-display text-xl font-bold">{marca} {modelo}</p>
        <p className="text-sm text-white/70 mt-1">{tipo}{año ? ` · ${año}` : ''}{color ? ` · ${color}` : ''}</p>
        <div className="mt-3 pt-3 border-t border-white/10">
          <p className="text-xs text-white/50">CIT</p>
          <p className="text-sm font-mono font-semibold text-[#F47B20]">{codigoCit}</p>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <QrCode className="size-10 text-white/30" />
          <div>
            <p className="text-xs text-white/50">Verificar identidad</p>
            <p className="text-xs text-[#2BBCB8] font-mono">rodaid.net/verificar</p>
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-500 mb-3">Compartí tu certificado sin exponer datos personales. Solo muestra información técnica pública.</p>

      <div className="flex gap-2">
        <button
          onClick={compartirNativo}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-[#0F1E35] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0F1E35]/80"
        >
          <Share2 className="size-3.5" />
          Compartir
        </button>
        <button
          onClick={copiarLink}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold text-ink hover:bg-slate-50"
        >
          {copiado ? <CheckCircle className="size-3.5 text-green-500" /> : <Download className="size-3.5" />}
          {copiado ? 'Link copiado' : 'Copiar link'}
        </button>
      </div>
    </div>
  )
}
