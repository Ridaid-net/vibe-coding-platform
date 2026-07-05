import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
import { Bike, ChevronLeft, Clock, CheckCircle } from 'lucide-react'
import Link from 'next/link'
export const metadata = { title: 'Mantenimiento Preventivo — Academia RODAID' }
export default function MantenimientoPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
        <Link href="/academia" className="inline-flex items-center gap-1 text-xs text-slate-warm hover:text-ink mb-6">
          <ChevronLeft className="size-3" /> Volver a Academia
        </Link>
        <div className="flex items-center gap-3 mb-6">
          <div className="flex size-12 items-center justify-center rounded-xl bg-green-50">
            <Bike className="size-6 text-green-600" />
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-green-600">Mantenimiento</span>
            <h1 className="font-display text-2xl font-bold text-ink">Mantenimiento Preventivo</h1>
          </div>
        </div>
        <div className="flex gap-4 text-xs text-slate-warm mb-8">
          <span className="flex items-center gap-1"><Clock className="size-3" /> 35 minutos</span>
          <span>4 modulos</span>
        </div>
        <div className="space-y-6">
          {[
            { titulo: 'Checklist de 20 puntos (igual que el CIT RODAID)', contenido: 'Este checklist es el mismo que usa el inspector de un taller aliado RODAID para emitir tu CIT:\n\n1. Cuadro: busca fisuras, abolladuras o soldaduras danadass\n2. Horquilla: verifica alineacion y ausencia de golpes\n3. Freno delantero: pastillas, tension de cable, centrado\n4. Freno trasero: idem delantero\n5. Transmision delantera: platos, bielas, pedalier\n6. Transmision trasera: cassette o pinon, tension de cadena\n7. Cambio delantero: ajuste y limites de desplazamiento\n8. Cambio trasero: ajuste, limites y alineacion del pulpo\n9. Manubrio: apriete, centrado y sin juego\n10. Potencia: apriete correcto sin fisuras\n11. Rueda delantera: centrado, tension de rayos, rodamiento\n12. Rueda trasera: idem delantera\n13. Neumaticos: presion, desgaste y cortes\n14. Pedales: rodamiento y fijacion al eje\n15. Tija: apriete y altura correcta\n16. Sillin: nivel y posicion anteroposterior\n17. Direccion: juego de direccion, sin holguras\n18. Cables y fundas: estado, recorrido y tension\n19. Sistema electrico (si aplica): bateria y conexiones\n20. Numero de serie: visible y legible' },
            { titulo: 'Lubricacion de cadena y transmision', contenido: 'Cada cuanto: Cada 200-300 km en condiciones normales. Despues de cada lluvia o mojada.\n\nComo limpiar la cadena: Usa un limpiador especifico o desengrasante. Con un trapo seco, pasa la cadena por el trapo mientras pedaleas hacia atras. Para limpieza profunda, usa una maquina limpiadora de cadena con liquido desengrasante.\n\nComo lubricar: Aplica el lubricante gota a gota en cada eslabon mientras pedaleas hacia atras lentamente. Espera 5 minutos y con un trapo seco limpia el exceso — el lubricante debe estar en el interior de los eslabones, no en el exterior.\n\nTipo de lubricante: Seco (cera) para condiciones secas. Humedo para condiciones multiples. Nunca uses WD-40 como lubricante permanente.' },
            { titulo: 'Revision de rodamientos y pedalier', contenido: 'Rodamientos de ruedas: Sujeta la bici del cuadro, toma la rueda con ambas manos y muevela lateralmente. Si hay movimiento o "juego", los rodamientos necesitan ajuste o reemplazo.\n\nDireccion: Sujeta el freno delantero y empuja la bici hacia adelante y atras. Si sientes un "golpeteo", el juego de direccion tiene holgura — necesita ajuste.\n\nPedalier: Con los pedales instalados, intenta mover el conjunto biela de lado a lado. Cualquier movimiento lateral indica que el pedalier necesita ajuste o reemplazo.\n\nCada cuanto revisarlos: Cada 6 meses o 1500 km. El agua y el barro aceleran el desgaste.' },
            { titulo: 'Cuando ir al taller aliado', contenido: 'Ve al taller inmediatamente si: Los frenos no responden correctamente. Escuchas ruidos metalicos al pedalear o frenar. La bici no cambia de marcha fluidamente. Sientes vibraciones anomalas. Detectas fisuras en el cuadro o la horquilla.\n\nMantenimiento programado cada 500 km: Revision y lubricacion de cadena. Ajuste de frenos y cambios. Verificacion de presion de neumaticos.\n\nMantenimiento programado cada 1000 km: Todo lo anterior + revision de rodamientos. Cambio de cables y fundas si es necesario.\n\nMantenimiento programado cada 1500 km: Service completo. Posible reemplazo de cadena y cassette. RODAID te avisa automaticamente via Bici-Salud cuando alcanzas estos hitos.' },
          ].map((mod, i) => (
            <div key={i} className="rounded-2xl border border-ink/10 bg-white p-5">
              <div className="flex items-start gap-3 mb-3">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-green-600 text-xs font-bold text-white">{i+1}</div>
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
          <Link href="/academia" className="inline-flex items-center gap-2 rounded-full bg-green-600 px-4 py-2 text-xs font-semibold text-white">
            Ver mas cursos
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  )
}
