'use client'

import { useState } from 'react'
import { CheckCircle2, Handshake, Loader2, Store } from 'lucide-react'
import { toast } from 'sonner'
import { solicitarAliado } from '@/lib/aliados'

const TIPOS = [
  { value: 'taller', label: 'Taller' },
  { value: 'tienda', label: 'Tienda' },
  { value: 'otro', label: 'Otro' },
]

/**
 * Formulario público para que un taller/tienda solicite ser Aliado de RODAID.
 * Tras enviarse, la solicitud queda pendiente de aprobación de un admin.
 */
export function AliadoForm() {
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState('taller')
  const [email, setEmail] = useState('')
  const [telefono, setTelefono] = useState('')
  const [ciudad, setCiudad] = useState('')
  const [direccion, setDireccion] = useState('')
  const [cuit, setCuit] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (enviando) return
    if (!nombre.trim() || !email.trim()) {
      toast.error('Faltan datos', { description: 'Completá el nombre y el email.' })
      return
    }
    setEnviando(true)
    try {
      await solicitarAliado({
        nombre: nombre.trim(),
        tipo,
        email: email.trim(),
        telefono: telefono.trim() || undefined,
        ciudad: ciudad.trim() || undefined,
        direccion: direccion.trim() || undefined,
        cuit: cuit.trim() || undefined,
      })
      setEnviado(true)
      toast.success('Solicitud enviada', {
        description: 'Un administrador la revisará a la brevedad.',
      })
    } catch (err) {
      toast.error('No pudimos enviar la solicitud', {
        description: (err as Error).message,
      })
    } finally {
      setEnviando(false)
    }
  }

  if (enviado) {
    return (
      <div className="rounded-3xl border border-lime-deep/40 bg-lime/15 px-6 py-14 text-center">
        <CheckCircle2 className="mx-auto size-10 text-lime-deep" />
        <h2 className="mt-4 font-display text-2xl font-bold text-ink">
          ¡Solicitud recibida!
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-warm">
          Revisaremos los datos de <strong>{nombre}</strong> y, una vez aprobada,
          tu cuenta podrá inspeccionar las bicis vinculadas a tu taller desde el
          Panel de Inspecciones.
        </p>
      </div>
    )
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-3xl border border-ink/12 bg-white p-6 sm:p-8"
      noValidate
    >
      <h2 className="flex items-center gap-2 font-display text-2xl font-bold text-ink">
        <Handshake className="size-6 text-lime-deep" />
        Sumate como Aliado
      </h2>
      <p className="mt-2 text-sm text-slate-warm">
        Talleres y tiendas pueden validar físicamente las bicicletas que venden o
        mantienen, acelerando su verificación en RODAID.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Campo label="Nombre del taller / tienda">
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Bike Center"
            className={input}
          />
        </Campo>
        <Campo label="Tipo">
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={input}>
            {TIPOS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Email de contacto">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="taller@email.com"
            className={input}
          />
        </Campo>
        <Campo label="Teléfono">
          <input
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="11 5555 5555"
            className={input}
          />
        </Campo>
        <Campo label="Ciudad">
          <input
            value={ciudad}
            onChange={(e) => setCiudad(e.target.value)}
            placeholder="CABA"
            className={input}
          />
        </Campo>
        <Campo label="CUIT">
          <input
            value={cuit}
            onChange={(e) => setCuit(e.target.value)}
            placeholder="30-12345678-9"
            className={input}
          />
        </Campo>
        <div className="sm:col-span-2">
          <Campo label="Dirección">
            <input
              value={direccion}
              onChange={(e) => setDireccion(e.target.value)}
              placeholder="Av. Siempreviva 742"
              className={input}
            />
          </Campo>
        </div>
      </div>

      <button
        type="submit"
        disabled={enviando}
        className="mt-6 inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft disabled:opacity-60"
      >
        {enviando ? <Loader2 className="size-4 animate-spin" /> : <Store className="size-4 text-lime" />}
        Enviar solicitud
      </button>
    </form>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  )
}

const input =
  'w-full rounded-xl border border-ink/15 bg-white px-4 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-slate-warm/60 focus:border-ink/40 focus:ring-4 focus:ring-lime/25'
