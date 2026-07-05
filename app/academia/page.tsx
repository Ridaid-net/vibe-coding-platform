import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
import { BookOpen, Shield, Wrench, Bike, ChevronRight, Lock } from 'lucide-react'
import Link from 'next/link'

export const metadata = {
  title: 'Academia RODAID — Aprende a cuidar tu bici',
  description: 'Micro-cursos gratuitos sobre mecanica basica, seguridad vial y uso de RODAID para ciclistas de Mendoza.',
}

const CURSOS = [
  {
    id: 1,
    icono: Wrench,
    color: '#F47B20',
    bg: 'bg-orange-50',
    nivel: 'Basico',
    titulo: 'Mecanica de Emergencia', href: '/academia/mecanica-emergencia',
    descripcion: 'Como reparar un pinchaso, ajustar frenos y cambios, y resolver las fallas mas comunes en ruta sin herramientas especializadas.',
    modulos: [
      'Como cambiar una camara en 5 minutos',
      'Ajuste rapido de frenos en ruta',
      'Solucion a cadena saltada o cortada',
      'Kit de emergencia recomendado',
    ],
    duracion: '25 min',
    disponible: true,
  },
  {
    id: 2,
    icono: Shield,
    color: '#2BBCB8',
    bg: 'bg-teal-50',
    nivel: 'Esencial',
    titulo: 'Seguridad Vial y Legislacion', href: '/academia/seguridad-vial',
    descripcion: 'Derechos y obligaciones del ciclista en Mendoza, uso correcto del casco, luces y reflectivos, y como actuar ante un siniestro vial.',
    modulos: [
      'Legislacion ciclista en Mendoza (Ley provincial)',
      'Equipamiento obligatorio y recomendado',
      'Tecnicas de circulacion segura',
      'Que hacer ante un accidente de transito',
    ],
    duracion: '30 min',
    disponible: true,
  },
  {
    id: 3,
    icono: Lock,
    color: '#0F1E35',
    bg: 'bg-slate-50',
    nivel: 'Prevencion',
    titulo: 'Anticipo al Robo', href: '/academia/anticipo-robo',
    descripcion: 'Estrategias probadas para reducir el riesgo de robo: tecnicas de candado, puntos criticos de la ciudad y como usar RODAID para proteger tu bici.',
    modulos: [
      'Los 3 errores mas comunes al guardar la bici',
      'Tipos de candados y nivel de seguridad',
      'Como registrar tu bici en RODAID (CIT)',
      'Que hacer si te roban: denuncia comunitaria',
    ],
    duracion: '20 min',
    disponible: true,
  },
  {
    id: 4,
    icono: Bike,
    color: '#16a34a',
    bg: 'bg-green-50',
    nivel: 'Mantenimiento',
    titulo: 'Mantenimiento Preventivo', href: '/academia/mantenimiento-preventivo',
    descripcion: 'Guia de mantenimiento por kilometraje: que revisar cada 500, 1000 y 1500 km para que tu bici dure el doble.',
    modulos: [
      'Checklist de 20 puntos (igual que el CIT RODAID)',
      'Lubricacion de cadena y transmision',
      'Revision de rodamientos y pedalier',
      'Cuando ir al taller aliado',
    ],
    duracion: '35 min',
    disponible: true,
  },
  {
    id: 5,
    icono: BookOpen,
    color: '#7c3aed',
    bg: 'bg-violet-50',
    nivel: 'Avanzado',
    titulo: 'Como usar RODAID al maximo', href: '/academia/usar-rodaid',
    descripcion: 'Tutorial completo de la plataforma: certificar tu bici, publicar en el marketplace, usar el escrow y conectar Strava para mantenimiento predictivo.',
    modulos: [
      'Como obtener tu CIT paso a paso',
      'Publicar y vender con RODAID PAY',
      'Conectar Strava para odometro automatico',
      'Interpretar las alertas de Bici-Salud',
    ],
    duracion: '40 min',
    disponible: true,
  },
  {
    id: 6,
    icono: Shield,
    color: '#dc2626',
    bg: 'bg-red-50',
    nivel: 'Proximamente',
    titulo: 'Ciclismo Urbano Avanzado',
    descripcion: 'Tecnicas de ciclismo en ciudad, manejo de intersecciones peligrosas, conduccion nocturna y movilidad sustentable en Mendoza.',
    modulos: [
      'Conduccion en rotondas e intersecciones',
      'Ciclismo nocturno seguro',
      'Rutas recomendadas Zona Este Mendoza',
      'Integracion con transporte publico',
    ],
    duracion: '45 min',
    disponible: false,
  },
]

export default function AcademiaPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main>
        <section className="bg-[#0F1E35] py-16 px-5">
          <div className="mx-auto max-w-4xl text-center">
            <span className="text-xs font-semibold uppercase tracking-widest text-[#2BBCB8]">RODAID · Educacion ciclista</span>
            <h1 className="mt-3 font-display text-4xl font-bold text-white sm:text-5xl">Academia RODAID</h1>
            <p className="mt-4 text-base text-white/60 max-w-2xl mx-auto">Micro-cursos gratuitos para ciclistas de Mendoza. Aprende mecanica basica, seguridad vial y como proteger tu bici con tecnologia.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-4 text-sm text-white/50">
              <span>✓ 6 cursos disponibles</span>
              <span>✓ Acceso gratuito</span>
              <span>✓ Diseñado para Zona Este</span>
              <span>✓ Certificado de completado</span>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-5 py-14 sm:px-8">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {CURSOS.map((curso) => {
              const Icono = curso.icono
              return (
                <div key={curso.id} className={`rounded-2xl border border-ink/10 bg-white p-5 flex flex-col ${!curso.disponible ? 'opacity-60' : ''}`}>
                  <div className="flex items-start justify-between mb-4">
                    <div className={`flex size-11 items-center justify-center rounded-xl ${curso.bg}`}>
                      <Icono className="size-5" style={{ color: curso.color }} />
                    </div>
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${curso.disponible ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {curso.nivel}
                    </span>
                  </div>
                  <h3 className="font-display text-base font-semibold text-ink mb-2">{curso.titulo}</h3>
                  <p className="text-xs text-slate-warm leading-relaxed mb-4 flex-1">{curso.descripcion}</p>
                  <ul className="space-y-1 mb-4">
                    {curso.modulos.map((m, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-slate-warm">
                        <ChevronRight className="size-3 shrink-0 mt-0.5 text-[#2BBCB8]" />
                        {m}
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center justify-between pt-3 border-t border-ink/8">
                    <span className="text-xs text-slate-warm">{curso.duracion}</span>
                    {curso.disponible ? (
                      <button className="inline-flex items-center gap-1 rounded-full bg-[#0F1E35] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0F1E35]/80">
                        <BookOpen className="size-3" /> Comenzar
                      </button>
                    ) : (
                      <span className="text-xs text-slate-warm/60">Proximamente</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-12 rounded-2xl bg-[#0F1E35] p-6 text-center">
            <p className="text-sm font-semibold text-[#2BBCB8] uppercase tracking-wide mb-2">¿Sos taller aliado o instructor?</p>
            <p className="text-sm text-white/70 mb-4">Podés colaborar con contenido para la Academia RODAID y llegar a miles de ciclistas de Mendoza.</p>
            <a href="mailto:federicodegeaceo@rodaid.net?subject=Academia RODAID - Colaboracion"
              className="inline-flex items-center gap-2 rounded-full bg-[#F47B20] px-5 py-2 text-sm font-semibold text-white hover:bg-[#F47B20]/80">
              Escribinos
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
