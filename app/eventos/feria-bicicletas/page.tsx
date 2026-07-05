import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
import { Star, ChevronLeft, Calendar, MapPin, Users, Clock } from 'lucide-react'
import Link from 'next/link'
export const metadata = { title: 'Feria de Bicicletas Verificadas — RODAID Eventos' }
export default function FeriaBicicletasPage() {
  const textoWsp = encodeURIComponent('Me anoto a la Feria de Bicicletas Verificadas RODAID el Domingo 27 de julio de 9 a 14hs en el Parque Municipal San Martin. Mas info: rodaid.net/eventos')
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
        <Link href="/eventos" className="inline-flex items-center gap-1 text-xs text-slate-warm hover:text-ink mb-6">
          <ChevronLeft className="size-3" /> Volver a Eventos
        </Link>
        <div className="flex items-center gap-3 mb-6">
          <div className="flex size-12 items-center justify-center rounded-xl bg-violet-50">
            <Star className="size-6 text-violet-600" />
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-violet-600">Marketplace</span>
            <h1 className="font-display text-2xl font-bold text-ink">Feria de Bicicletas Verificadas</h1>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {[
            { icono: Calendar, label: 'Fecha', valor: 'Dom 27 julio' },
            { icono: Clock, label: 'Horario', valor: '09:00-14:00' },
            { icono: MapPin, label: 'Lugar', valor: 'Parque Municipal' },
            { icono: Users, label: 'Inscriptos', valor: '89 ciclistas' },
          ].map((d, i) => (
            <div key={i} className="rounded-xl bg-white border border-ink/10 p-3 text-center">
              <d.icono className="size-4 text-violet-600 mx-auto mb-1" />
              <p className="text-[10px] text-slate-warm">{d.label}</p>
              <p className="text-xs font-semibold text-ink">{d.valor}</p>
            </div>
          ))}
        </div>
        <div className="space-y-4 mb-8">
          <div className="rounded-2xl border border-ink/10 bg-white p-5">
            <h2 className="font-display text-base font-semibold text-ink mb-3">Primera feria de bicicletas verificadas de Mendoza</h2>
            <p className="text-sm text-slate-warm leading-relaxed">La primera feria de bicicletas con identidad digital garantizada en Mendoza. Todas las bicicletas expuestas cuentan con CIT activo verificado en la Blockchain Federal Argentina. Compra, venta e intercambio con total confianza.</p>
          </div>
          <div className="rounded-2xl border border-ink/10 bg-white p-5">
            <h2 className="font-display text-base font-semibold text-ink mb-3">Que vas a encontrar</h2>
            <div className="space-y-2 text-sm text-slate-warm">
              {[
                'Bicis MTB, ruta, urbanas y BMX con CIT verificado',
                'Zona de accesorios y repuestos de talleres aliados',
                'Stand RODAID: obtene tu CIT en el momento',
                'Taller de mecanica rapida en vivo',
                'Charla: como vender tu bici de forma segura',
                'Zona de prueba de bicicletas en el parque',
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-violet-600">✓</span> {item}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-ink/10 bg-white p-5">
            <h2 className="font-display text-base font-semibold text-ink mb-3">Quiero exponer mi bici</h2>
            <p className="text-sm text-slate-warm mb-3">Si tenes una bici con CIT activo y queres exponerla para vender o intercambiar, avisanos por WhatsApp. El espacio es gratuito para usuarios RODAID.</p>
            <p className="text-xs text-slate-warm/70">Requisito: CIT activo en rodaid.net</p>
          </div>
          <div className="rounded-2xl bg-[#0F1E35]/5 border border-ink/10 p-4">
            <p className="text-xs text-slate-warm">Organizado por <strong className="text-ink">RODAID</strong>. Entrada libre. Parque Municipal San Martin, Mendoza.</p>
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
