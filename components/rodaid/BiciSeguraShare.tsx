'use client'
import { useState } from 'react'
import { Share2, Download, CheckCircle, Lock, Loader2 } from 'lucide-react'
import type { EstadoCompartir } from '@/lib/garaje-digital'

interface BiciSeguraShareProps {
  marca: string
  modelo: string
  año: number | null
  /** null mientras se carga el estado inicial desde el backend. */
  estado: EstadoCompartir | null
  onActivar: () => Promise<void>
  onDesactivar: () => Promise<void>
}

/**
 * Botón de "Historial Clínico" público (opt-in) de una bici. Antes de
 * reconectarse (2026-07-18) apuntaba siempre a /verificar/:numeroSerie sin
 * ningún opt-in y mostraba un ícono de QR decorativo, no un QR real -- ver
 * CLAUDE.md, sección "Historial Clínico publico" para el diseño completo.
 */
export function BiciSeguraShare({ marca, modelo, año, estado, onActivar, onDesactivar }: BiciSeguraShareProps) {
  const [abierto, setAbierto] = useState(false)
  const [accionando, setAccionando] = useState(false)
  const [copiado, setCopiado] = useState(false)

  if (!estado) return null

  const activar = async () => {
    setAccionando(true)
    try {
      await onActivar()
      setAbierto(true)
    } finally {
      setAccionando(false)
    }
  }

  const desactivar = async () => {
    setAccionando(true)
    try {
      await onDesactivar()
      setAbierto(false)
    } finally {
      setAccionando(false)
    }
  }

  if (!estado.activo || !estado.url || !estado.token) {
    return (
      <button
        onClick={activar}
        disabled={accionando}
        className="inline-flex items-center gap-2 rounded-full border border-[#2BBCB8] px-4 py-2 text-xs font-semibold text-[#2BBCB8] transition-colors hover:bg-[#2BBCB8]/5 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {accionando ? <Loader2 className="size-3.5 animate-spin" /> : <Share2 className="size-3.5" />}
        Activar Historial Clínico público
      </button>
    )
  }

  const urlPublica = estado.url
  const qrUrl = `/api/v1/historial/${estado.token}/qr`
  const textoShare = `🚲 Mi bici está verificada en RODAID\n${marca} ${modelo} ${año ?? ''}\nHistorial completo: ${urlPublica}`

  const copiarLink = async () => {
    await navigator.clipboard.writeText(urlPublica)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  const compartirNativo = async () => {
    if (navigator.share) {
      await navigator.share({ title: 'Mi bici verificada — RODAID', text: textoShare, url: urlPublica })
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
        Compartir Historial Clínico
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-[#2BBCB8]/30 bg-white p-5 mt-3">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold text-[#0F1E35]">Historial Clínico público</p>
        <button onClick={() => setAbierto(false)} className="text-xs text-slate-400 hover:text-slate-600">Cerrar</button>
      </div>

      <div className="rounded-xl border-2 border-[#2BBCB8] bg-[#0F1E35] p-4 text-white mb-4">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle className="size-5 text-[#2BBCB8]" />
          <span className="text-xs font-semibold uppercase tracking-widest text-[#2BBCB8]">RODAID · Verificada</span>
        </div>
        <p className="font-display text-xl font-bold">{marca} {modelo}</p>
        <p className="text-sm text-white/70 mt-1">{año ?? ''}</p>
        <div className="mt-3 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrUrl} alt="QR del Historial Clínico" className="size-16 rounded bg-white p-1" />
          <div>
            <p className="text-xs text-white/50">Historial completo</p>
            <p className="text-xs text-[#2BBCB8] font-mono break-all">{urlPublica.replace(/^https?:\/\//, '')}</p>
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-500 mb-3">Pegá este link en Facebook Marketplace u otros canales — muestra la identidad y el historial de tu bici, sin datos personales.</p>

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
      <button
        onClick={desactivar}
        disabled={accionando}
        className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold text-slate-400 hover:text-clay disabled:cursor-not-allowed disabled:opacity-60"
      >
        {accionando ? <Loader2 className="size-3.5 animate-spin" /> : <Lock className="size-3.5" />}
        Desactivar Historial Clínico público
      </button>
    </div>
  )
}
