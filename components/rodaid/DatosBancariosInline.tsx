'use client'

import { useState } from 'react'
import { Loader2, Landmark } from 'lucide-react'
import { toast } from 'sonner'
import { validarAlias, validarCBU } from '@/lib/cbu'
import { guardarDatosBancariosCliente } from '@/lib/swipe-to-sell'

/**
 * Formulario mínimo de CBU/alias -- cierra el hueco de "el endpoint existe
 * (POST /api/v1/usuario/datos-bancarios) pero no tenía ninguna UI todavía".
 * Deliberadamente simple (2 campos + titular), no un formulario elaborado:
 * solo necesita destrabar el 409 DATOS_BANCARIOS_FALTANTES para que Swipe to
 * Sell no deje al usuario varado en un mensaje de error.
 */
export function DatosBancariosInline({ onGuardado }: { onGuardado: () => void }) {
  const [cbu, setCbu] = useState('')
  const [alias, setAlias] = useState('')
  const [titular, setTitular] = useState('')
  const [enviando, setEnviando] = useState(false)

  const handleGuardar = async () => {
    if (!cbu.trim() && !alias.trim()) {
      toast.error('Cargá al menos un CBU o un alias.')
      return
    }
    if (cbu.trim() && !validarCBU(cbu.trim())) {
      toast.error('El CBU ingresado no es válido.')
      return
    }
    if (alias.trim() && !validarAlias(alias.trim())) {
      toast.error('El alias debe tener 6-20 caracteres (letras, números, puntos o guiones).')
      return
    }
    if (!titular.trim()) {
      toast.error('Indicá el titular de la cuenta.')
      return
    }

    setEnviando(true)
    try {
      await guardarDatosBancariosCliente({
        cbu: cbu.trim() || null,
        alias: alias.trim() || null,
        titularDeclarado: titular.trim(),
      })
      toast.success('Datos bancarios guardados')
      onGuardado()
    } catch (err) {
      toast.error('No pudimos guardar tus datos bancarios', { description: (err as Error).message })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="rounded-2xl border border-amber-300/60 bg-amber-50 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-800">
        <Landmark className="size-4" />
        Cargá tu CBU o alias para poder cobrar
      </p>
      <p className="mt-1 text-xs text-amber-700">
        Sin esto, RODAID no tiene forma de transferirte cuando se concrete una venta.
      </p>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input
          type="text"
          placeholder="CBU (22 dígitos)"
          value={cbu}
          onChange={(e) => setCbu(e.target.value)}
          className="rounded-lg border border-amber-300/60 bg-white px-2.5 py-1.5 text-xs font-mono outline-none focus:border-amber-500"
        />
        <input
          type="text"
          placeholder="o Alias"
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          className="rounded-lg border border-amber-300/60 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-amber-500"
        />
        <input
          type="text"
          placeholder="Titular de la cuenta"
          value={titular}
          onChange={(e) => setTitular(e.target.value)}
          className="rounded-lg border border-amber-300/60 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-amber-500"
        />
      </div>
      <button
        type="button"
        onClick={handleGuardar}
        disabled={enviando}
        className="mt-3 inline-flex items-center gap-2 rounded-full bg-amber-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
      >
        {enviando ? <Loader2 className="size-3.5 animate-spin" /> : <Landmark className="size-3.5" />}
        Guardar
      </button>
    </div>
  )
}
