'use client'
import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
import { MapPin, Calendar, Users, ChevronRight, Bike, Wrench, Star } from 'lucide-react'

const EVENTOS = [
  {
    id: 1,
    tipo: 'rodada',
    icono: Bike,
    color: '#2BBCB8',
    bg: 'bg-teal-50',
    titulo: 'Rodada Nocturna Zona Este',
    fecha: 'Sabado 12 de julio · 20:00hs',
    lugar: 'Plaza San Martin, San Martin, Mendoza',
    participantes: 24,
    descripcion: 'Rodada nocturna por las ciclovias de Zona Este. Todos los niveles bienvenidos. Velocidad moderada, ambiente familiar.',
    organizador: 'RODAID + Municipalidad San Martin',
    libre: true,
    tag: 'Comunidad',
  },
  {
    id: 2,
    tipo: 'taller',
    icono: Wrench,
    color: '#F47B20',
    bg: 'bg-orange-50',
    titulo: 'Taller de Mecanica Basica',
    fecha: 'Sabado 19 de julio · 10:00hs',
    lugar: 'Taller Aliado RODAID — San Martin',
    participantes: 12,
    descripcion: 'Aprende a reparar pinchazos, ajustar frenos y lubricar la cadena. Herramientas incluidas. Cupos limitados a 15 personas.',
    organizador: 'Taller Aliado RODAID',
    libre: true,
    tag: 'Educacion',
  },
  {
    id: 3,
    tipo: 'feria',
    icono: Star,
    color: '#7c3aed',
    bg: 'bg-violet-50',
    titulo: 'Feria de Bicicletas Verificadas',
    fecha: 'Domingo 27 de julio · 09:00 a 14:00hs',
    lugar: 'Parque Municipal San Martin',
    participantes: 89,
    descripcion: 'Primera feria de bicicletas verificadas con CIT RODAID en Mendoza. Compra, venta e intercambio con identidad digital garantizada.',
    organizador: 'RODAID',
    libre: true,
    tag: 'Marketplace',
  },
  {
    id: 4,
    tipo: 'rodada',
    icono: Bike,
    color: '#2BBCB8',
    bg: 'bg-teal-50',
    titulo: 'Gran Vuelta Zona Este',
    fecha: 'Domingo 3 de agosto · 08:00hs',
    lugar: 'Municipalidad de Junin',
    participantes: 41,
    descripcion: 'Recorrido de 45km por San Martin, Junin y Rivadavia. Para ciclistas con experiencia. Soporte mecanico RODAID en ruta.',
    organizador: 'RODAID + CFdE Junin',
    libre: true,
    tag: 'Deporte',
  },
]

const TIPO_COLOR: Record<string, string> = {
  rodada: 'bg-teal-100 text-teal-700',
  taller: 'bg-orange-100 text-orange-700',
  feria: 'bg-violet-100 text-violet-700',
}

export default function EventosPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main>
        <section className="bg-[#0F1E35] py-16 px-5">
          <div className="mx-auto max-w-4xl text-center">
            <span className="text-xs font-semibold uppercase tracking-widest text-[#2BBCB8]">RODAID · Comunidad ciclista</span>
            <h1 className="mt-3 font-display text-4xl font-bold text-white sm:text-5xl">Eventos RODAID</h1>
            <p className="mt-4 text-base text-white/60 max-w-2xl mx-auto">Rodadas, talleres de mecanica y ferias de bicicletas verificadas en Zona Este, Mendoza. Unite a la comunidad ciclista mas confiable de la region.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-4 text-sm text-white/50">
              <span>✓ Entrada libre</span>
              <span>✓ Zona Este Mendoza</span>
              <span>✓ Organizados por RODAID</span>
              <span>✓ Comunidad verificada</span>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-5 py-14 sm:px-8">
          <div className="space-y-6">
            {EVENTOS.map((evento) => {
              const Icono = evento.icono
              return (
                <div key={evento.id} className="rounded-2xl border border-ink/10 bg-white p-5">
                  <div className="flex items-start gap-4">
                    <div className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${evento.bg}`}>
                      <Icono className="size-5" style={{ color: evento.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <h3 className="font-display text-lg font-semibold text-ink">{evento.titulo}</h3>
                        <span className={`text-xs font-semibold px-2 py-1 rounded-full shrink-0 ${TIPO_COLOR[evento.tipo]}`}>{evento.tag}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-warm">
                        <span className="flex items-center gap-1"><Calendar className="size-3" />{evento.fecha}</span>
                        <span className="flex items-center gap-1"><MapPin className="size-3" />{evento.lugar}</span>
                        <span className="flex items-center gap-1"><Users className="size-3" />{evento.participantes} inscriptos</span>
                      </div>
                      <p className="mt-3 text-sm text-slate-warm leading-relaxed">{evento.descripcion}</p>
                      <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
                        <span className="text-xs text-slate-warm/70">Organiza: {evento.organizador}</span>
                        <div className="flex gap-2">
                          {evento.libre && <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-1 rounded-full">Entrada libre</span>}
                          <button className="inline-flex items-center gap-1 rounded-full bg-[#0F1E35] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0F1E35]/80">
                            Me apunto <ChevronRight className="size-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-[#F47B20]/30 bg-orange-50 p-5">
              <p className="text-sm font-semibold text-[#0F1E35] mb-2">¿Organizas un evento ciclista?</p>
              <p className="text-xs text-slate-warm mb-3">Difundilo gratis en la red RODAID y llegá a cientos de ciclistas verificados de Zona Este.</p>
              <a href="mailto:federicodegeaceo@rodaid.net?subject=Evento RODAID - Propuesta"
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#F47B20] hover:underline">
                Enviar propuesta <ChevronRight className="size-3" />
              </a>
            </div>
            <div className="rounded-2xl border border-[#2BBCB8]/30 bg-teal-50 p-5">
              <p className="text-sm font-semibold text-[#0F1E35] mb-2">Notificaciones de eventos</p>
              <p className="text-xs text-slate-warm mb-3">Recibe alertas cuando haya eventos nuevos en tu zona. Activalo desde tu Garaje Digital.</p>
              <a href="/garaje"
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#2BBCB8] hover:underline">
                Ir al Garaje <ChevronRight className="size-3" />
              </a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
