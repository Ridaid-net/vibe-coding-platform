import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
import { Wrench, ChevronLeft, Clock, CheckCircle } from 'lucide-react'
import Link from 'next/link'
export const metadata = { title: 'Mecanica de Emergencia — Academia RODAID' }
export default function MecanicaEmergenciaPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
        <Link href="/academia" className="inline-flex items-center gap-1 text-xs text-slate-warm hover:text-ink mb-6">
          <ChevronLeft className="size-3" /> Volver a Academia
        </Link>
        <div className="flex items-center gap-3 mb-6">
          <div className="flex size-12 items-center justify-center rounded-xl bg-orange-50">
            <Wrench className="size-6 text-[#F47B20]" />
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-[#F47B20]">Basico</span>
            <h1 className="font-display text-2xl font-bold text-ink">Mecanica de Emergencia</h1>
          </div>
        </div>
        <div className="flex gap-4 text-xs text-slate-warm mb-8">
          <span className="flex items-center gap-1"><Clock className="size-3" /> 25 minutos</span>
          <span>4 modulos</span>
        </div>
        <div className="space-y-6">
          {[
            { titulo: 'Como cambiar una camara en 5 minutos', contenido: 'Antes de salir siempre lleva: camara de repuesto del tamaño correcto, palancas de neumatico (al menos 2), bomba de mano o CO2, y parches de emergencia.\n\nPaso 1: Desinfla completamente la rueda. Paso 2: Con las palancas, retira el neumatico empezando en el punto opuesto a la valvula. Paso 3: Saca la camara pinchada. Paso 4: Revisa el interior del neumatico con los dedos buscando el objeto que causo el pinchazo. Paso 5: Coloca la camara nueva comenzando por la valvula. Paso 6: Monta el neumatico con las manos, evitando las palancas para no pinchar la camara nueva. Paso 7: Infla a la presion recomendada.' },
            { titulo: 'Ajuste rapido de frenos en ruta', contenido: 'Si el freno esta muy suelto: busca el tornillo de ajuste en el cable (generalmente en el manillar o la mordaza). Giralo en sentido antihorario para tensar el cable. Si la palanca toca el manillar: necesitas tensar el cable mas de lo que permite el ajuste fino. Afloja el tornillo de fijacion del cable en la mordaza, tira del cable con alicates y vuelve a apretar. Frenos de disco hidraulicos: si se aflojan en ruta, la solucion temporaria es ajustar el tornillo de alcance del manillar para que la palanca tenga mas recorrido.' },
            { titulo: 'Solucion a cadena saltada o cortada', contenido: 'Cadena saltada del plato: Con la mano (usa un trapo), vuelve a colocar la cadena en el plato mas pequeno. Si salta frecuentemente, el limitador del cambio delantero necesita ajuste.\n\nCadena cortada: necesitas un rompecadenas portatil. Empuja el pin de la cadena hacia afuera, retira el eslabon danado, y vuelve a unir la cadena. La cadena quedara un eslabon mas corta — funcionara pero evita los platos mas grandes.\n\nConsejo: Lleva siempre 2-3 eslabones de repuesto y un rompecadenas en el kit de emergencia.' },
            { titulo: 'Kit de emergencia recomendado', contenido: 'Kit basico (200g aprox): 1 camara de repuesto · 2 palancas de neumatico · Bomba de mano · 3 parches autoadhesivos · Rompecadenas · 2-3 eslabones de cadena · Llave multiherramienta (Allen 3/4/5mm + torx T25) · Cinta de teflon.\n\nKit avanzado (agrega): Eslabones rapidos de cadena · Mini bomba de CO2 (2 cartuchos) · Parche para tubeless · Cable de freno de repuesto · Brida de plastico x3.\n\nDonde guardarlo: Bolsita bajo el asiento, en el marco o en un cinturon de herramientas.' },
          ].map((mod, i) => (
            <div key={i} className="rounded-2xl border border-ink/10 bg-white p-5">
              <div className="flex items-start gap-3 mb-3">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#F47B20] text-xs font-bold text-white">{i+1}</div>
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
          <Link href="/academia" className="inline-flex items-center gap-2 rounded-full bg-[#F47B20] px-4 py-2 text-xs font-semibold text-white">
            Ver mas cursos
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  )
}
