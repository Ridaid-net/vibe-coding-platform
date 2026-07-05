'use client'
import { authedFetch } from '@/lib/session'
import { useState } from 'react'
import { Calendar, Clock, MapPin, Route, Image, Share2, X, ChevronRight, Map, Users, Plus } from 'lucide-react'

interface SalidaData {
  dia: string
  hora: string
  lugar: string
  descripcion: string
  km: number
  nivel: 'facil' | 'moderado' | 'dificil'
  imagenes: string[]
  mapLink: string
  stravaLink: string
  garminLink: string
  trailforksLink: string
  wikilokLink: string
}

const NIVEL_COLOR = {
  facil: 'bg-green-100 text-green-700',
  moderado: 'bg-amber-100 text-amber-700',
  dificil: 'bg-red-100 text-red-700',
}

export function ArmaTuSalida() {
  const [abierto, setAbierto] = useState(false)
  const [paso, setPaso] = useState(1)
  const [publicado, setPublicado] = useState(false)
  const [salida, setSalida] = useState<SalidaData>({
    dia: '',
    hora: '',
    lugar: '',
    descripcion: '',
    km: 0,
    nivel: 'moderado',
    imagenes: [],
    mapLink: '',
    stravaLink: '',
    garminLink: '',
    trailforksLink: '',
    wikilokLink: '',
  })

  const actualizar = (campo: keyof SalidaData, valor: unknown) => {
    setSalida(prev => ({ ...prev, [campo]: valor }))
  }

  const agregarImagen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    Array.from(files).forEach(file => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        setSalida(prev => ({
          ...prev,
          imagenes: [...prev.imagenes, ev.target?.result as string].slice(0, 4)
        }))
      }
      reader.readAsDataURL(file)
    })
  }

  const textoWhatsApp = () => {
    const texto = `🚲 *SALIDA RODAID — ${salida.dia} ${salida.hora}*\n\n` +
      `📍 *Encuentro:* ${salida.lugar}\n` +
      `🗺️ *Recorrido:* ${salida.km} km · Nivel ${salida.nivel}\n\n` +
      `📝 ${salida.descripcion}\n\n` +
      (salida.stravaLink ? `🟠 *Strava:* ${salida.stravaLink}\n` : '') +
      (salida.trailforksLink ? `🟢 *Trailforks:* ${salida.trailforksLink}\n` : '') +
      (salida.wikilokLink ? `🔵 *Wikilok:* ${salida.wikilokLink}\n` : '') +
      (salida.mapLink ? `📌 *Maps:* ${salida.mapLink}\n` : '') +
      `\n✅ Organizado via RODAID · rodaid.net`
    return `https://wa.me/?text=${encodeURIComponent(texto)}`
  }

  const handlePublicar = async () => {
    try {
      const res = await authedFetch("/api/v1/salidas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo: salida.lugar + " - " + salida.dia,
          descripcion: salida.descripcion,
          fecha: salida.dia,
          hora: salida.hora,
          lugar: salida.lugar,
          km: salida.km,
          nivel: salida.nivel,
          mapLink: salida.mapLink,
          stravaLink: salida.stravaLink,
          garminLink: salida.garminLink,
          trailforksLink: salida.trailforksLink,
          wikilokLink: salida.wikilokLink,
        })
      })
      const data = await res.json()
      if (data.salida?.id) {
        window.open("/salidas/" + data.salida.id, "_blank")
      }
    } catch { /* silencioso */ }
    setPublicado(true)
    setTimeout(() => { setAbierto(false); setPublicado(false); setPaso(1) }, 2000)
  }

  if (!abierto) return (
    <button
      type="button"
      onClick={() => setAbierto(true)}
      className="inline-flex items-center gap-2 rounded-full bg-[#2BBCB8] px-5 py-3 text-sm font-semibold text-white shadow-lg hover:bg-[#2BBCB8]/80 transition-all hover:-translate-y-0.5"
    >
      <Route className="size-4" />
      Arma tu Salida 🚲
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-[#0F1E35] px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-white font-display text-lg font-bold">🚲 Arma tu Salida</p>
            <p className="text-white/60 text-xs">Paso {paso} de 3</p>
          </div>
          <button type="button" onClick={() => { setAbierto(false); setPaso(1) }} className="text-white/60 hover:text-white">
            <X className="size-5" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-slate-100">
          <div className="h-1 bg-[#2BBCB8] transition-all" style={{ width: `${(paso / 3) * 100}%` }} />
        </div>

        <div className="p-5 overflow-y-auto" style={{ maxHeight: '70vh' }}>

          {/* PASO 1 — Datos básicos */}
          {paso === 1 && (
            <div className="space-y-4">
              <p className="text-sm font-semibold text-[#0F1E35] mb-3">Datos de la salida</p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-warm mb-1 flex items-center gap-1"><Calendar className="size-3" /> Día</label>
                  <input type="date" value={salida.dia} onChange={e => actualizar('dia', e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8]" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-warm mb-1 flex items-center gap-1"><Clock className="size-3" /> Hora</label>
                  <input type="time" value={salida.hora} onChange={e => actualizar('hora', e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8]" />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-warm mb-1 flex items-center gap-1"><MapPin className="size-3" /> Lugar de encuentro</label>
                <input type="text" placeholder="Ej: Plaza San Martin, San Martin, Mendoza" value={salida.lugar} onChange={e => actualizar('lugar', e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8]" />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-warm mb-1">Descripcion de la salida</label>
                <textarea rows={3} placeholder="Describe el recorrido, dificultad, puntos de interes..." value={salida.descripcion}
                  onChange={e => actualizar('descripcion', e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8] resize-none" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-warm mb-1 flex items-center gap-1"><Route className="size-3" /> Km de recorrido</label>
                  <input type="number" min={1} max={500} placeholder="45" value={salida.km || ''} onChange={e => actualizar('km', Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8]" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-warm mb-1">Nivel</label>
                  <select value={salida.nivel} onChange={e => actualizar('nivel', e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8]">
                    <option value="facil">Facil</option>
                    <option value="moderado">Moderado</option>
                    <option value="dificil">Dificil</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* PASO 2 — Mapas e integraciones */}
          {paso === 2 && (
            <div className="space-y-4">
              <p className="text-sm font-semibold text-[#0F1E35] mb-3">Mapas e integraciones</p>

              <div className="space-y-3">
                {[
                  { campo: 'mapLink', label: 'Google Maps', placeholder: 'https://maps.google.com/...', color: '#4285F4', emoji: '📍' },
                  { campo: 'stravaLink', label: 'Strava Route', placeholder: 'https://www.strava.com/routes/...', color: '#FC4C02', emoji: '🟠' },
                  { campo: 'garminLink', label: 'Garmin Connect', placeholder: 'https://connect.garmin.com/...', color: '#007DC1', emoji: '🔵' },
                  { campo: 'trailforksLink', label: 'Trailforks', placeholder: 'https://www.trailforks.com/...', color: '#5cb85c', emoji: '🟢' },
                  { campo: 'wikilokLink', label: 'Wikilok', placeholder: 'https://www.wikiloc.com/...', color: '#FF6B35', emoji: '🗺️' },
                ].map(int => (
                  <div key={int.campo}>
                    <label className="text-xs font-semibold text-slate-warm mb-1 flex items-center gap-1">
                      <span>{int.emoji}</span> {int.label} <span className="text-slate-400 font-normal">(opcional)</span>
                    </label>
                    <input type="url" placeholder={int.placeholder}
                      value={(salida as unknown as Record<string, string>)[int.campo]}
                      onChange={e => actualizar(int.campo as keyof SalidaData, e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8]" />
                  </div>
                ))}
              </div>

              <div className="rounded-xl bg-[#0F1E35]/5 p-3">
                <p className="text-xs text-slate-warm">Pega el link de tu ruta desde cualquier plataforma. Los participantes podran ver el recorrido antes de sumarse.</p>
              </div>
            </div>
          )}

          {/* PASO 3 — Fotos y compartir */}
          {paso === 3 && (
            <div className="space-y-4">
              <p className="text-sm font-semibold text-[#0F1E35] mb-3">Fotos y compartir</p>

              <div>
                <label className="text-xs font-semibold text-slate-warm mb-2 flex items-center gap-1"><Image className="size-3" /> Imagenes de la salida (max 4)</label>
                <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 p-6 cursor-pointer hover:border-[#2BBCB8] transition-colors">
                  <Plus className="size-8 text-slate-300 mb-2" />
                  <span className="text-xs text-slate-warm">Tocá para agregar fotos</span>
                  <input type="file" accept="image/*" multiple className="hidden" onChange={agregarImagen} />
                </label>
                {salida.imagenes.length > 0 && (
                  <div className="grid grid-cols-4 gap-2 mt-2">
                    {salida.imagenes.map((img, i) => (
                      <div key={i} className="relative aspect-square rounded-lg overflow-hidden">
                        <img src={img} alt={`foto ${i+1}`} className="w-full h-full object-cover" />
                        <button type="button"
                          onClick={() => setSalida(prev => ({ ...prev, imagenes: prev.imagenes.filter((_, j) => j !== i) }))}
                          className="absolute top-0.5 right-0.5 size-4 rounded-full bg-black/60 text-white flex items-center justify-center">
                          <X className="size-2.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Preview */}
              <div className="rounded-xl border border-[#2BBCB8]/30 bg-teal-50 p-4">
                <p className="text-xs font-semibold text-[#0F1E35] mb-2">Vista previa</p>
                <div className="flex items-start gap-2">
                  <span className="text-2xl">🚲</span>
                  <div>
                    <p className="text-sm font-semibold text-[#0F1E35]">{salida.lugar || 'Lugar de encuentro'}</p>
                    <p className="text-xs text-slate-warm">{salida.dia} · {salida.hora} · {salida.km} km</p>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full mt-1 inline-block ${NIVEL_COLOR[salida.nivel]}`}>{salida.nivel}</span>
                    <p className="text-xs text-slate-warm mt-1 line-clamp-2">{salida.descripcion}</p>
                  </div>
                </div>
              </div>

              {/* WhatsApp */}
              <a href={textoWhatsApp()} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-full bg-[#25D366] px-5 py-3 text-sm font-semibold text-white hover:bg-[#25D366]/80">
                <svg viewBox="0 0 24 24" className="size-4 fill-white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.117.554 4.1 1.523 5.82L0 24l6.337-1.505A11.955 11.955 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.015-1.373l-.36-.213-3.73.886.938-3.63-.235-.374A9.818 9.818 0 1112 21.818z"/></svg>
                Invitar por WhatsApp
              </a>

              {publicado && (
                <div className="rounded-xl bg-green-50 border border-green-200 p-3 text-center">
                  <p className="text-sm font-semibold text-green-700">✅ Salida publicada en RODAID Eventos</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer navegacion */}
        <div className="border-t border-slate-100 px-5 py-4 flex justify-between">
          {paso > 1 ? (
            <button type="button" onClick={() => setPaso(p => p - 1)}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
              Atras
            </button>
          ) : <div />}

          {paso < 3 ? (
            <button type="button" onClick={() => setPaso(p => p + 1)}
              disabled={paso === 1 && (!salida.dia || !salida.hora || !salida.lugar)}
              className="inline-flex items-center gap-2 rounded-full bg-[#0F1E35] px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">
              Siguiente <ChevronRight className="size-4" />
            </button>
          ) : (
            <button type="button" onClick={handlePublicar}
              className="inline-flex items-center gap-2 rounded-full bg-[#F47B20] px-5 py-2 text-sm font-semibold text-white hover:bg-[#F47B20]/80">
              <Map className="size-4" /> Publicar Salida
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
