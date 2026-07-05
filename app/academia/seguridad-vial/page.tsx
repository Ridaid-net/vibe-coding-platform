import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
import { Shield, ChevronLeft, Clock, CheckCircle } from 'lucide-react'
import Link from 'next/link'
export const metadata = { title: 'Seguridad Vial y Legislacion — Academia RODAID' }
export default function SeguridadVialPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
        <Link href="/academia" className="inline-flex items-center gap-1 text-xs text-slate-warm hover:text-ink mb-6">
          <ChevronLeft className="size-3" /> Volver a Academia
        </Link>
        <div className="flex items-center gap-3 mb-6">
          <div className="flex size-12 items-center justify-center rounded-xl bg-teal-50">
            <Shield className="size-6 text-[#2BBCB8]" />
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-[#2BBCB8]">Esencial</span>
            <h1 className="font-display text-2xl font-bold text-ink">Seguridad Vial y Legislacion</h1>
          </div>
        </div>
        <div className="flex gap-4 text-xs text-slate-warm mb-8">
          <span className="flex items-center gap-1"><Clock className="size-3" /> 30 minutos</span>
          <span>4 modulos</span>
        </div>
        <div className="space-y-6">
          {[
            { titulo: 'Legislacion ciclista en Mendoza', contenido: 'En Mendoza, los ciclistas tienen los mismos derechos y obligaciones que los conductores de vehiculos. La Ley Provincial regula:\n\nDerechos: Usar la calzada cuando no hay ciclovias. Transitar por el carril derecho. Ser respetados por los vehiculos motorizados con una distancia minima de 1.5 metros al adelantar.\n\nObligaciones: Circular en el sentido del transito. Respetar semaforos y senales. Ceder el paso a peatones en la senda.\n\nLa Ley Provincial N° 9556 (RODAID) establece el marco para la certificacion de identidad de bicicletas, complementando la legislacion vial.' },
            { titulo: 'Equipamiento obligatorio y recomendado', contenido: 'Obligatorio en Mendoza: Luces delantera (blanca) y trasera (roja) para circular de noche. Reflectivos laterales y traseros. Timbre o bocina.\n\nMuy recomendado: Casco (obligatorio para menores de 16 anos). Guantes. Ropa con reflectivos o colores vivos. Lentes de sol o gafas de proteccion.\n\nPara rutas largas: Casco con visera. Maillot con bolsillos traseros. Calzas con badana. Cubrezapatillas. Mangas y calentadores.' },
            { titulo: 'Tecnicas de circulacion segura', contenido: 'Posicion en la calzada: Circula a 1 metro del borde derecho — evita la zona de puertas de autos estacionados (zona de 1.5m desde el auto).\n\nEn intersecciones: Reduce velocidad. Toma el carril necesario con anticipacion. Usa senales manuales: brazo izquierdo extendido = girar izquierda, brazo derecho extendido = girar derecha, brazo izquierdo hacia abajo = frenar.\n\nVision: Mantén la vista 20-30 metros adelante. Identifica superficies irregulares, rejillas y rieles con anticipacion.\n\nContacto visual: Asegurate de que los conductores te vean antes de cruzar frente a ellos.' },
            { titulo: 'Que hacer ante un accidente de transito', contenido: 'Inmediatamente: Alejate de la calzada si podes moverte. Llama al 911. No muevas a personas heridas graves.\n\nDocumentacion: Fotografia la escena, los vehiculos involucrados y las senales de transito. Obtene datos del conductor (nombre, DNI, patente, seguro).\n\nDenuncia: Concurri a la seccional policial mas cercana. Guarda toda la documentacion medica.\n\nSi hay danos a la bici: El CIT de RODAID facilita la identificacion del rodado ante companilas de seguros y en procesos judiciales.' },
          ].map((mod, i) => (
            <div key={i} className="rounded-2xl border border-ink/10 bg-white p-5">
              <div className="flex items-start gap-3 mb-3">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#2BBCB8] text-xs font-bold text-white">{i+1}</div>
                <h2 className="font-display text-base font-semibold text-ink">{mod.titulo}</h2>
              </div>
              <div className="pl-10 space-y-2">
                {mod.contenido.split('\n\n').map((p, j) => (
                  <p key={j} className="text-sm text-slate-warm leading-relaxed">{p}</p>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-8 rounded-2xl bg-[#0F1E35] p-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="size-5 text-[#2BBCB8]" />
            <p className="text-sm font-semibold text-white">Curso completado</p>
          </div>
          <Link href="/academia" className="inline-flex items-center gap-2 rounded-full bg-[#2BBCB8] px-4 py-2 text-xs font-semibold text-white">
            Ver mas cursos
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  )
}
