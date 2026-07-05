import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
import { BookOpen, ChevronLeft, Clock, CheckCircle } from 'lucide-react'
import Link from 'next/link'
export const metadata = { title: 'Como usar RODAID al maximo — Academia RODAID' }
export default function UsarRodaidPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
        <Link href="/academia" className="inline-flex items-center gap-1 text-xs text-slate-warm hover:text-ink mb-6">
          <ChevronLeft className="size-3" /> Volver a Academia
        </Link>
        <div className="flex items-center gap-3 mb-6">
          <div className="flex size-12 items-center justify-center rounded-xl bg-violet-50">
            <BookOpen className="size-6 text-violet-600" />
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-violet-600">Avanzado</span>
            <h1 className="font-display text-2xl font-bold text-ink">Como usar RODAID al maximo</h1>
          </div>
        </div>
        <div className="flex gap-4 text-xs text-slate-warm mb-8">
          <span className="flex items-center gap-1"><Clock className="size-3" /> 40 minutos</span>
          <span>4 modulos</span>
        </div>
        <div className="space-y-6">
          {[
            { titulo: 'Como obtener tu CIT paso a paso', contenido: 'El CIT (Certificado de Identidad Tecnica) es el corazon de RODAID. Aqui el proceso completo:\n\nPaso 1: Registrate en rodaid.net con tu email o CUIL. Es gratuito.\n\nPaso 2: En tu Garaje Digital, haz click en "Agregar bicicleta" y completa los datos (marca, modelo, numero de serie, color, ano).\n\nPaso 3: Llevá la bici a un taller aliado RODAID. El inspector realizara la inspeccion de 20 puntos.\n\nPaso 4: El taller emite el CIT ($18.000 ARS — 60% va al taller, 40% a RODAID). Recibes el codigo CIT formato CIT-XXXXXX-XXXXXX.\n\nPaso 5: La huella SHA-256 del CIT queda anclada en la Blockchain Federal Argentina. Tu bici tiene identidad digital permanente.\n\nPaso 6: Cualquier persona puede verificar la autenticidad en rodaid.net/verificar ingresando el numero de serie.' },
            { titulo: 'Publicar y vender con RODAID PAY', contenido: 'Para publicar en el marketplace de RODAID tu bici necesita CIT activo.\n\nComo publicar: En tu Garaje Digital, selecciona la bici verificada y haz click en "Publicar en marketplace". Completa precio, descripcion y fotos.\n\nComo funciona RODAID PAY: Cuando alguien quiere comprar tu bici, el dinero no te llega directamente. Va a una cuenta escrow (custodia) de RODAID PAY via MercadoPago. El comprador verifica que la bici coincide con el CIT. Si todo esta bien, confirma la entrega y el dinero te llega (80% para vos, 20% RODAID). Si hay disputa, RODAID actua como mediador tecnico basandose en el CIT.\n\nVentajas de vender con CIT: Tu bici vale mas. El comprador paga con confianza. Vos cobras con seguridad.' },
            { titulo: 'Conectar Strava para odometro automatico', contenido: 'La integracion con Strava convierte cada pedalada en un registro automatico en tu Garaje Digital.\n\nComo conectar: En tu Garaje Digital, haz click en "Conectar Strava". Autorizas el acceso con tu cuenta de Strava. RODAID registra el Webhook ID 359648 — desde ese momento cada actividad de ciclismo se suma automaticamente al odometro de tu bici.\n\nQue registra: Distancia en km. Tiempo en movimiento. Desnivel acumulado. Velocidad promedio. Ruta GPS (solo vos la ves).\n\nPrivacidad: Tu ubicacion exacta NUNCA es visible para otros usuarios. Solo vos ves tus rutas. La integracion usa OAuth 2.0 oficial de Strava.' },
            { titulo: 'Interpretar las alertas de Bici-Salud', contenido: 'Bici-Salud es el sistema de mantenimiento predictivo de RODAID que analiza tu odometro y te avisa cuando tu bici necesita atencion.\n\nAlertas por kilometraje: 500 km → Transmision y cadena (lubricar y ajustar). 800 km → Revision de cables y fundas. 1000 km → Servicio de frenos. 1500 km → Service general completo.\n\nComo aparecen: En la tarjeta de tu bici dentro del Garaje Digital. Las alertas naranjas son advertencias. Las alertas rojas son urgentes.\n\nQue hacer: Haz click en "Buscar taller aliado" para encontrar el mas cercano. El taller aliado tendra acceso al historial de tu CIT para un servicio mas preciso.\n\nDescartar alertas: Si ya realizaste el mantenimiento, podés descartar la alerta. La proxima alerta aparecera en el proximo multiplo de km.' },
          ].map((mod, i) => (
            <div key={i} className="rounded-2xl border border-ink/10 bg-white p-5">
              <div className="flex items-start gap-3 mb-3">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-violet-600 text-xs font-bold text-white">{i+1}</div>
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
          <Link href="/garaje" className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-xs font-semibold text-white">
            Ir a mi Garaje
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  )
}
