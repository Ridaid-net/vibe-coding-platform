import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
import { Wrench, Shield, ShoppingBag, MapPin, Star, ChevronRight, Phone } from 'lucide-react'
import Link from 'next/link'

export const metadata = {
  title: 'Marketplace de Servicios — RODAID',
  description: 'Talleres aliados, seguros especializados y repuestos para tu bicicleta certificada en Mendoza.',
}

const SERVICIOS = [
  {
    id: 1,
    categoria: 'talleres',
    icono: Wrench,
    color: '#F47B20',
    bg: 'bg-orange-50',
    nombre: 'Taller Aliado RODAID — San Martin',
    descripcion: 'Service completo, reparaciones, ajustes y emision de CIT certificado. 20 puntos de inspeccion oficial.',
    ubicacion: 'San Martin, Mendoza',
    distancia: '2.3 km',
    rating: 4.8,
    reviews: 24,
    servicios: ['Emision CIT', 'Service completo', 'Reparacion de pinchazos', 'Ajuste de frenos y cambios'],
    precio: 'Desde $3.500 ARS',
    disponible: true,
    esCitAliado: true,
  },
  {
    id: 2,
    categoria: 'talleres',
    icono: Wrench,
    color: '#F47B20',
    bg: 'bg-orange-50',
    nombre: 'Bicicleteria El Ciclista — Junin',
    descripcion: 'Taller especializado en MTB y bicicletas de ruta. Repuestos originales y lubricacion profesional.',
    ubicacion: 'Junin, Mendoza',
    distancia: '8.1 km',
    rating: 4.6,
    reviews: 17,
    servicios: ['Reparaciones MTB', 'Cambio de cubiertas', 'Lubricacion cadena', 'Ajuste de suspension'],
    precio: 'Desde $2.800 ARS',
    disponible: true,
    esCitAliado: false,
  },
  {
    id: 3,
    categoria: 'seguros',
    icono: Shield,
    color: '#2BBCB8',
    bg: 'bg-teal-50',
    nombre: 'Seguro CIT RODAID — Cobertura Basica',
    descripcion: 'Poliza de seguro para bicicletas con CIT activo. Cobertura contra robo con fuerza y danos accidentales.',
    ubicacion: 'Todo Mendoza',
    distancia: 'Online',
    rating: 4.9,
    reviews: 8,
    servicios: ['Robo con fuerza', 'Danos accidentales', 'Asistencia en ruta', 'Prima reducida con CIT'],
    precio: 'Desde $1.200 ARS/mes',
    disponible: false,
    esCitAliado: true,
  },
  {
    id: 4,
    categoria: 'repuestos',
    icono: ShoppingBag,
    color: '#7c3aed',
    bg: 'bg-violet-50',
    nombre: 'Repuestos Ciclismo Zona Este',
    descripcion: 'Cadenas, cubiertas, pastillas de freno y accesorios para todas las marcas. Envio a domicilio.',
    ubicacion: 'San Martin, Mendoza',
    distancia: '3.7 km',
    rating: 4.5,
    reviews: 31,
    servicios: ['Cadenas y pinones', 'Cubiertas y camaras', 'Frenos y cables', 'Accesorios de seguridad'],
    precio: 'Consultar stock',
    disponible: true,
    esCitAliado: false,
  },
]

export default function ServiciosPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main>
        <section className="bg-[#0F1E35] py-16 px-5">
          <div className="mx-auto max-w-4xl text-center">
            <span className="text-xs font-semibold uppercase tracking-widest text-[#2BBCB8]">RODAID · Red de servicios</span>
            <h1 className="mt-3 font-display text-4xl font-bold text-white sm:text-5xl">Marketplace de Servicios</h1>
            <p className="mt-4 text-base text-white/60 max-w-2xl mx-auto">Talleres aliados, seguros especializados y repuestos para tu bicicleta certificada. Todos los proveedores son verificados por RODAID.</p>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-5 py-14 sm:px-8">
          <div className="space-y-5">
            {SERVICIOS.map(s => {
              const Icono = s.icono
              return (
                <div key={s.id} className="rounded-2xl border border-ink/10 bg-white p-5">
                  <div className="flex items-start gap-4 flex-wrap">
                    <div className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${s.bg}`}>
                      <Icono className="size-5" style={{ color: s.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-display text-base font-semibold text-ink">{s.nombre}</h3>
                        {s.esCitAliado && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#2BBCB8]/10 text-[#2BBCB8]">
                            <Shield className="size-2.5" /> Aliado RODAID
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-warm">
                        <span className="flex items-center gap-1"><MapPin className="size-3" />{s.ubicacion} · {s.distancia}</span>
                        <span className="flex items-center gap-1"><Star className="size-3 text-amber-400" />{s.rating} ({s.reviews} reseñas)</span>
                      </div>
                      <p className="mt-2 text-sm text-slate-warm leading-relaxed">{s.descripcion}</p>
                      <div className="mt-3 flex flex-wrap gap-1">
                        {s.servicios.map((srv, i) => (
                          <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{srv}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between flex-wrap gap-2 pt-3 border-t border-ink/8">
                    <span className="text-sm font-semibold text-[#0F1E35]">{s.precio}</span>
                    <div className="flex gap-2">
                      <a href="mailto:federicodegeaceo@rodaid.net"
                        className="inline-flex items-center gap-1 rounded-full border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-ink/5">
                        <Phone className="size-3" /> Contactar
                      </a>
                      {s.disponible ? (
                        <Link href="/aliados" className="inline-flex items-center gap-1 rounded-full bg-[#0F1E35] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0F1E35]/80">
                          Ver detalle <ChevronRight className="size-3" />
                        </Link>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-700">
                          Proximamente
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-10 rounded-2xl bg-[#0F1E35] p-6 text-center">
            <p className="text-sm font-semibold text-[#2BBCB8] uppercase tracking-wide mb-2">¿Sos taller o proveedor?</p>
            <p className="text-sm text-white/70 mb-4">Unite a la red de aliados RODAID y llega a cientos de ciclistas verificados de Zona Este.</p>
            <Link href="/aliados" className="inline-flex items-center gap-2 rounded-full bg-[#F47B20] px-5 py-2 text-sm font-semibold text-white hover:bg-[#F47B20]/80">
              Quiero ser aliado <ChevronRight className="size-4" />
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
