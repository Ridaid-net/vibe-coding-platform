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
            { titulo: 'Como obtener tu CIT paso a paso', contenido: 'El CIT (Certificado de Identidad Tecnica) es el certificado digital que acredita la identidad y el estado tecnico de tu bicicleta, con su huella anclada de forma inmutable en la Blockchain Federal Argentina. RODAID tiene dos niveles de CIT, segun lo que necesites.\n\nCIT Express — para circular tranquilo. Paso 1: Registrate en rodaid.net con tu email o CUIL, es gratuito. Paso 2: En tu Garaje Digital, hace click en "Agregar bicicleta" y completa los datos (marca, modelo, numero de serie, color, ano). RODAID verifica que el numero de serie sea legitimo y que la bici no figure como robada. Vigencia: 12 meses, renovable en cualquier taller aliado. Valor: $5.100 ARS.\n\nCIT Completo / Transferencia — para vender con confianza. Es el que necesitas para publicar en el Marketplace, e incluye como parte del mismo tramite la inspeccion de 20 puntos de un Taller Aliado. La secuencia real: publicas tu bici gratis en el Marketplace (con tu CIT Express activo) → un comprador la reserva y paga una sena → esa sena financia la verificacion tecnica de 20 puntos que hace el Taller Aliado sobre tu bici → una vez que el taller sella la verificacion (firma digital, acta anclada en la Blockchain), la venta se completa: se coordina la logistica y el comprador paga el saldo.\n\nQuien cobra que: el Taller Aliado recibe $18.000 por la verificacion y $15.000 por el embalaje — el 100% para el taller en los dos casos. Al concretarse la venta, RODAID cobra ademas una comision de exito del 2% del valor de venta, que se reparte 50/50 entre RODAID y el Taller Aliado.\n\nVerificacion publica: cualquier persona puede confirmar la autenticidad de un CIT — Express o Completo — en rodaid.net/verificar, escaneando el codigo QR o ingresando el numero de serie.\n\nSi vendes tu bici: el CIT nunca se pierde ni se vuelve a emitir — el comprador recibe la misma bici con la misma identidad certificada de siempre, ligada al rodado, no a vos. Lo unico que cambia es quien figura como dueño, y eso ocurre recien cuando el vendedor confirma la entrega (o se libera automaticamente) y el saldo ya fue pagado por completo. Si el comprador se arrepiente antes de pagar el saldo, no pasa nada con tu bici ni con tu CIT: podes volver a publicarla con otro comprador sin ningun tramite adicional.' },
            { titulo: 'Publicar y vender con RODAID PAY', contenido: 'Para publicar en el marketplace de RODAID tu bici necesita CIT activo.\n\nComo publicar: En tu Garaje Digital, selecciona la bici verificada y haz click en "Publicar en marketplace". Completa precio, descripcion y fotos.\n\nComo funciona RODAID PAY: Cuando alguien quiere comprar tu bici, el dinero no te llega directamente. Va a una cuenta escrow (custodia) de RODAID PAY via MercadoPago. El comprador verifica que la bici coincide con el CIT. Al concretarse la venta, RODAID cobra una comision de exito, compartida con el Taller Aliado que preparo tu bici para el despacho. Vos recibis el resto del valor de venta. Si hay disputa, RODAID actua como mediador tecnico basandose en el CIT.\n\nVentajas de vender con CIT: Tu bici vale mas. El comprador paga con confianza. Vos cobras con seguridad.' },
            { titulo: 'Conectar Strava para odometro automatico', contenido: 'La integracion con Strava convierte cada pedalada en un registro automatico en tu Garaje Digital.\n\nComo conectar: En tu Garaje Digital, haz click en "Conectar Strava". Autorizas el acceso con tu cuenta de Strava. RODAID registra el Webhook ID 359648 — desde ese momento cada actividad de ciclismo se suma automaticamente al odometro de tu bici.\n\nQue registra: Distancia en km. Tiempo en movimiento. Desnivel acumulado. Velocidad promedio. Ruta GPS (solo vos la ves).\n\nPrivacidad: Tu ubicacion exacta NUNCA es visible para otros usuarios. Solo vos ves tus rutas. La integracion usa OAuth 2.0 oficial de Strava.' },
            { titulo: 'Interpretar las alertas de Bici-Salud', contenido: 'Bici-Salud es el sistema de mantenimiento predictivo de RODAID: analiza los datos de telemetria de tu bici (el acelerometro del dispositivo IoT vinculado) con inteligencia artificial para anticipar posibles fallas antes de que ocurran — desgaste de cadena, problemas de cubiertas o necesidad de servicio tecnico.\n\nComo aparecen: En tu Garaje Digital, cada diagnostico muestra una probabilidad y una severidad (baja, media o alta). Las alertas de mayor severidad son las mas urgentes.\n\nQue hacer: Haz click en "Buscar taller aliado" para encontrar el mas cercano. El taller aliado tendra acceso al historial de tu CIT para un servicio mas preciso.\n\nDescartar alertas: Si ya realizaste el mantenimiento, podes marcar la alerta como resuelta desde tu Garaje Digital.\n\nSin datos suficientes: Si tu bici todavia no acumulo suficiente telemetria, el sistema no inventa un diagnostico — te avisa que todavia faltan datos.\n\nSi compras una bici usada: vas a ver el estado mecanico mas reciente de esa bici (por ejemplo, si la cadena o las cubiertas necesitan revision) — esa informacion viaja con el rodado porque te sirve para decidir la compra. Lo que no vas a ver es la actividad personal del dueño anterior: sus rutas, ubicaciones o habitos de uso quedan siempre privados. Ten en cuenta que el diagnostico mostrado refleja el ultimo analisis disponible: si la bici tuvo un arreglo reciente que todavia no genero un nuevo analisis, la alerta visible podria ser anterior a ese arreglo — ante la duda, confirma el estado real con un taller aliado RODAID.' },
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
