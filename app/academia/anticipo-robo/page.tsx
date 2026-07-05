import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
import { Lock, ChevronLeft, Clock, CheckCircle } from 'lucide-react'
import Link from 'next/link'
export const metadata = { title: 'Anticipo al Robo — Academia RODAID' }
export default function AnticipoRoboPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
        <Link href="/academia" className="inline-flex items-center gap-1 text-xs text-slate-warm hover:text-ink mb-6">
          <ChevronLeft className="size-3" /> Volver a Academia
        </Link>
        <div className="flex items-center gap-3 mb-6">
          <div className="flex size-12 items-center justify-center rounded-xl bg-slate-50">
            <Lock className="size-6 text-[#0F1E35]" />
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-[#0F1E35]">Prevencion</span>
            <h1 className="font-display text-2xl font-bold text-ink">Anticipo al Robo</h1>
          </div>
        </div>
        <div className="flex gap-4 text-xs text-slate-warm mb-8">
          <span className="flex items-center gap-1"><Clock className="size-3" /> 20 minutos</span>
          <span>4 modulos</span>
        </div>
        <div className="space-y-6">
          {[
            { titulo: 'Los 3 errores mas comunes al guardar la bici', contenido: 'Error 1 — Usar un solo candado de baja calidad: Los ladrones llevan herramientas especificas. Un candado de cable fino se corta en segundos. Minimo usa un candado U de acero templado (nivel 8/10 en la escala Sold Secure).\n\nError 2 — Anclar solo la rueda: Siempre ancla el cuadro + al menos una rueda a un soporte fijo. Una rueda suelta es facil de remover.\n\nError 3 — Dejar la bici en el mismo lugar todos los dias: Los ladrones observan patrones. Varia los puntos de estacionamiento y los horarios.' },
            { titulo: 'Tipos de candados y nivel de seguridad', contenido: 'Candado U (nivel alto): El mas seguro para zonas urbanas. Busca los de acero templado con doble cerradura. Marcas: Kryptonite, Abus, OnGuard.\n\nCandado de cadena (nivel medio-alto): Flexible, util para rodeos complejos. Debe ser de cadena de acero endurecido, no cable plastificado.\n\nCandado de cable (nivel bajo): Solo util como complemento secundario. Nunca como unico medio de seguridad.\n\nTecnica del doble candado: Usa un candado U para el cuadro + soporte fijo, y una cadena o cable para la rueda trasera. Dificulta enormemente el robo.' },
            { titulo: 'Como registrar tu bici en RODAID (CIT)', contenido: 'El CIT (Certificado de Identidad Tecnica) es la herramienta mas potente para la recuperacion de tu bici si te la roban:\n\n1. Llevala a un taller aliado RODAID para la inspeccion de 20 puntos.\n2. El CIT queda registrado en la Blockchain Federal Argentina con el numero de serie y tus datos como titular.\n3. Si te roban la bici, el numero de serie queda bloqueado en toda la red RODAID: ningun taller aliado puede emitir un nuevo CIT para esa bicicleta.\n4. Las fuerzas de seguridad pueden verificar la identidad del rodado en rodaid.net/verificar.\n\nSin CIT, una bici recuperada es muy dificil de identificar como tuya legalmente.' },
            { titulo: 'Que hacer si te roban: denuncia comunitaria', contenido: 'Paso 1 — Denuncia policial: Concurri a la seccional mas cercana con el numero de serie y, si lo tenes, el codigo CIT.\n\nPaso 2 — Denuncia en RODAID: Desde tu Garaje Digital, usá la opcion "Denunciar robo" ($4.500 ARS). El numero de serie queda bloqueado inmediatamente en toda la red.\n\nPaso 3 — Difusion: Comparte el certificado BiciSegura de RODAID en redes sociales con la descripcion del robo.\n\nPaso 4 — Monitoreo: RODAID te notifica si alguien intenta certificar esa bicicleta en la red.' },
          ].map((mod, i) => (
            <div key={i} className="rounded-2xl border border-ink/10 bg-white p-5">
              <div className="flex items-start gap-3 mb-3">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#0F1E35] text-xs font-bold text-white">{i+1}</div>
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
          <Link href="/academia" className="inline-flex items-center gap-2 rounded-full bg-[#0F1E35] border border-white/20 px-4 py-2 text-xs font-semibold text-white">
            Ver mas cursos
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  )
}
