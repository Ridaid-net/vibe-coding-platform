'use client'
import { useState, useEffect } from 'react'
import { authedFetch } from '@/lib/session'
import { SERVICIOS_ALIADO, CATEGORIAS_SERVICIOS_ALIADO, normalizarWhatsapp } from '@/lib/aliado-servicios'
import { Megaphone, Save, X, UserX } from 'lucide-react'
import { useVerComoAliado } from '@/lib/admin-view-as'
import { AdminViewAsBanner } from '@/components/rodaid/AdminViewAsBanner'
import { SelectorVerComoAliado } from '@/components/rodaid/SelectorVerComoAliado'

interface EstadoPublicacion {
  puedePublicar: boolean
  citsPromedio30d: number
  umbral: number
  publicacion: {
    servicio: string
    precioArs: number
    logoUrl: string
    linkTienda: string | null
    whatsappNumero: string | null
    publicado: boolean
  } | null
  modoVista?: 'propio' | 'ver_como' | 'vista_previa'
}

export function PublicarServicioTaller() {
  const verComoAliado = useVerComoAliado()
  const [estado, setEstado] = useState<EstadoPublicacion | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [editando, setEditando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [servicio, setServicio] = useState('')
  const [precioArs, setPrecioArs] = useState('')
  const [linkTienda, setLinkTienda] = useState('')
  const [whatsappNumero, setWhatsappNumero] = useState('')
  const [whatsappError, setWhatsappError] = useState<string | null>(null)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)

  const cargar = () => {
    setCargando(true)
    setErrorCode(null)
    const qs = verComoAliado ? `?verComoAliado=${encodeURIComponent(verComoAliado)}` : ''
    authedFetch(`/api/v1/talleres/servicio-publicado${qs}`)
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok) {
          setErrorCode(typeof data?.error === 'string' ? data.error : 'ERROR_DESCONOCIDO')
          setEstado(null)
          return
        }
        setEstado(data)
        if (data.publicacion) {
          setServicio(data.publicacion.servicio)
          setPrecioArs(String(data.publicacion.precioArs))
          setLinkTienda(data.publicacion.linkTienda ?? '')
          setWhatsappNumero(data.publicacion.whatsappNumero ?? '')
        }
      })
      .catch(() => setErrorCode('ERROR_RED'))
      .finally(() => setCargando(false))
  }

  useEffect(() => { cargar() }, [verComoAliado])

  const elegirLogo = (file: File | null) => {
    setLogoFile(file)
    setLogoPreview(file ? URL.createObjectURL(file) : null)
  }

  const cambiarWhatsapp = (valor: string) => {
    setWhatsappNumero(valor)
    setWhatsappError(
      valor && !normalizarWhatsapp(valor)
        ? 'Formato: código de país + número, sin espacios ni "+" (ej. 5492617542335).'
        : null
    )
  }

  const guardar = async () => {
    if (!servicio || !precioArs) return
    if (whatsappNumero && !normalizarWhatsapp(whatsappNumero)) {
      setWhatsappError('Formato: código de país + número, sin espacios ni "+" (ej. 5492617542335).')
      return
    }
    setGuardando(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('servicio', servicio)
      form.append('precio_ars', precioArs)
      form.append('link_tienda', linkTienda)
      form.append('whatsapp_numero', whatsappNumero)
      if (logoFile) form.append('logo', logoFile)

      const res = await authedFetch('/api/v1/talleres/servicio-publicado', { method: 'PUT', body: form })
      const data = await res.json()
      if (!res.ok) {
        setError(data.message ?? 'No pudimos guardar la publicación.')
        return
      }
      setEstado(data)
      setEditando(false)
      elegirLogo(null)
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) return null

  if (errorCode === 'ALIADO_NO_ENCONTRADO') {
    return (
      <div className="rounded-2xl border border-dashed border-ink/10 bg-white p-5 mb-8">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-50">
            <UserX className="size-5 text-slate-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#0F1E35]">Sin perfil de Taller Aliado</p>
            <p className="text-xs text-slate-warm mt-0.5">
              Tu cuenta de administrador no tiene un perfil de Taller Aliado asociado, así que esta sección no aplica para vos.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (errorCode || !estado) return null

  const soloLectura = !!estado.modoVista && estado.modoVista !== 'propio'

  if (!estado.puedePublicar) {
    return (
      <div className="rounded-2xl border border-dashed border-ink/10 bg-white p-5 mb-8">
        <SelectorVerComoAliado />
        <AdminViewAsBanner modo={estado.modoVista ?? 'propio'} />
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-50">
            <Megaphone className="size-5 text-slate-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#0F1E35]">Publicá tus servicios en la home</p>
            <p className="text-xs text-slate-warm mt-0.5">
              Se desbloquea con un promedio sostenido de {estado.umbral} CITs/día (últimos 30 días).
              Hoy estás en {estado.citsPromedio30d.toFixed(1)}/día.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-[#2BBCB8]/30 bg-white p-5 mb-8">
      <SelectorVerComoAliado />
      <AdminViewAsBanner modo={estado.modoVista ?? 'propio'} />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-teal-50">
            <Megaphone className="size-5 text-[#2BBCB8]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#0F1E35]">
              {estado.publicacion?.publicado ? 'Tu publicación está activa' : 'Podés publicar tus servicios'}
            </p>
            <p className="text-xs text-slate-warm mt-0.5">
              {estado.citsPromedio30d.toFixed(1)} CITs/día promedio — superás el umbral de {estado.umbral}.
            </p>
          </div>
        </div>
        {!editando && !soloLectura && (
          <button type="button" onClick={() => setEditando(true)}
            className="inline-flex items-center gap-2 rounded-full bg-[#0F1E35] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0F1E35]/80">
            {estado.publicacion ? 'Editar publicación' : 'Publicar'}
          </button>
        )}
      </div>

      {editando && (
        <div className="mt-4 space-y-4 border-t border-ink/8 pt-4">
          <div>
            <label className="text-xs font-semibold text-slate-warm block mb-1">Servicio</label>
            <select value={servicio} onChange={e => setServicio(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8]">
              <option value="">Elegí un servicio</option>
              {CATEGORIAS_SERVICIOS_ALIADO.map(cat => (
                <optgroup key={cat} label={cat}>
                  {SERVICIOS_ALIADO.filter(s => s.categoria === cat).map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-warm block mb-1">Precio (ARS)</label>
              <input type="number" min="1" value={precioArs} onChange={e => setPrecioArs(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8]"
                placeholder="15000" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-warm block mb-1">Link de tu tienda/redes (opcional)</label>
              <input type="url" value={linkTienda} onChange={e => setLinkTienda(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8]"
                placeholder="https://instagram.com/tutaller" />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-warm block mb-1">Número de WhatsApp de la empresa (opcional)</label>
            <input type="text" value={whatsappNumero} onChange={e => cambiarWhatsapp(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8]"
              placeholder="5492617542335" />
            {whatsappError && <p className="mt-1 text-xs text-red-500">{whatsappError}</p>}
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-warm block mb-1">Logo del taller</label>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/avif"
              onChange={e => elegirLogo(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-slate-600 file:mr-3 file:rounded-full file:border-0 file:bg-[#0F1E35] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white file:cursor-pointer cursor-pointer" />
            {(logoPreview ?? estado.publicacion?.logoUrl) && (
              <div className="mt-2 size-20 rounded-xl overflow-hidden border border-slate-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoPreview ?? estado.publicacion?.logoUrl ?? ''} alt="Logo" className="w-full h-full object-cover" />
              </div>
            )}
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-2">
            <button type="button" onClick={guardar} disabled={guardando}
              className="inline-flex items-center gap-2 rounded-full bg-[#0F1E35] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              <Save className="size-4" /> {guardando ? 'Guardando...' : 'Guardar'}
            </button>
            <button type="button" onClick={() => setEditando(false)}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600">
              <X className="size-4" /> Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
