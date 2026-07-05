import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
import { Bike, ChevronLeft, Calendar, MapPin, Users, Clock } from 'lucide-react'
import Link from 'next/link'
export const metadata = { title: 'Rodada Nocturna Zona Este — RODAID Eventos' }
export default function RodadaNocturnaPage() {
  const textoWsp = encodeURIComponent('Me anoto a la Rodada Nocturna Zona Este organizada por RODAID el Sabado 12 de julio a las 20hs. Plaza San Martin, San Martin, Mendoza. Mas info: rodaid.net/eventos')
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
        <Link href="/eventos" className="inline-flex items-center gap-1 text-xs text-slate-warm hover:text-ink mb-6">
          <ChevronLeft className="size-3" /> Volver a Eventos
        </Link>
        <div className="flex items-center gap-3 mb-6">
          <div className="flex size-12 items-center justify-center rounded-xl bg-teal-50">
            <Bike className="size-6 text-[#2BBCB8]" />
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-[#2BBCB8]">Comunidad</span>
            <h1 className="font-display text-2xl font-bold text-ink">Rodada Nocturna Zona Este</h1>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {[
            { icono: Calendar, label: 'Fecha', valor: 'Sab 12 julio' },
            { icono: Clock, label: 'Hora', valor: '20:00 hs' },
            { icono: MapPin, label: 'Encuentro', valor: 'Plaza San Martin' },
            { icono: Users, label: 'Inscriptos', valor: '24 ciclistas' },
          ].map((d, i) => (
            <div key={i} className="rounded-xl bg-white border border-ink/10 p-3 text-center">
              <d.icono className="size-4 text-[#2BBCB8] mx-auto mb-1" />
              <p className="text-[10px] text-slate-warm">{d.label}</p>
              <p className="text-xs font-semibold text-ink">{d.valor}</p>
            </div>
          ))}
        </div>
        <div className="space-y-4 mb-8">
          <div className="rounded-2xl border border-ink/10 bg-white p-5">
            <h2 className="font-display text-base font-semibold text-ink mb-3">Sobre la rodada</h2>
            <p className="text-sm text-slate-warm leading-relaxed">Rodada nocturna por las ciclovias de Zona Este. Todos los niveles bienvenidos. Velocidad moderada entre 18-22 km/h, ambiente familiar y sin competencia. El recorrido pasa por San Martin, Palmira y regresa por la ruta del canal.</p>
          </div>
          <div className="rounded-2xl border border-ink/10 bg-white p-5">
            <h2 className="font-display text-base font-semibold text-ink mb-3">Detalles del recorrido</h2>
            <div className="space-y-2 text-sm text-slate-warm">
              <p>📍 Salida: Plaza San Martin, San Martin</p>
              <p>🗺️ Recorrido: 35 km aproximados</p>
              <p>⏱️ Duracion estimada: 2 horas</p>
              <p>🚦 Nivel: Todos los niveles</p>
              <p>🔦 Obligatorio: Luz delantera y trasera</p>
              <p>🛠️ Soporte mecanico: RODAID en ruta</p>
            </div>
          </div>
          <div className="rounded-2xl border border-ink/10 bg-white p-5">
            <h2 className="font-display text-base font-semibold text-ink mb-3">Que llevar</h2>
            <div className="grid grid-cols-2 gap-2 text-xs text-slate-warm">
              {['Luz delantera (blanca)', 'Luz trasera (roja)', 'Casco', 'Agua (al menos 500ml)', 'Kit de emergencia', 'Abrigo liviano', 'Documento de identidad', 'Bici en buen estado'].map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[#2BBCB8]">✓</span> {item}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl bg-[#0F1E35]/5 border border-ink/10 p-4">
            <p className="text-xs text-slate-warm">Organizado por <strong className="text-ink">RODAID + Municipalidad de San Martin</strong>. Entrada libre y gratuita. No se requiere inscripcion previa pero avisanos por WhatsApp para coordinar el grupo.</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <a href={`https://wa.me/+542634639578?text=${textoWsp}`} target="_blank" rel="noopener noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-[#25D366] px-5 py-3 text-sm font-semibold text-white hover:bg-[#25D366]/80">
            <svg viewBox="0 0 24 24" className="size-4 fill-white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.117.554 4.1 1.523 5.82L0 24l6.337-1.505A11.955 11.955 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.015-1.373l-.36-.213-3.73.886.938-3.63-.235-.374A9.818 9.818 0 1112 21.818z"/></svg>
            Me apunto por WhatsApp
          </a>
          <Link href="/eventos" className="flex-1 inline-flex items-center justify-center gap-2 rounded-full border border-ink/20 px-5 py-3 text-sm font-semibold text-ink hover:bg-ink/5">
            Ver otros eventos
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  )
}
