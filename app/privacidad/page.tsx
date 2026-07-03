import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
export const metadata = { title: 'Politica de Privacidad — RODAID' }
export default function PrivacidadPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-3xl px-5 py-14 sm:px-8">
        <h1 className="font-display text-4xl font-bold text-ink mb-8">Politica de Privacidad</h1>
        <p className="text-sm text-slate-warm mb-6">Ultima actualizacion: 2 de julio de 2026</p>
        <div className="space-y-6 text-sm leading-relaxed text-slate-warm">
          <p>RODAID (rodaid.net) es una plataforma de certificacion tecnica digital y marketplace de bicicletas verificadas operada por Federico De Gea, con sede en San Martin, Mendoza, Argentina.</p>
          <h2 className="font-display text-xl font-bold text-ink mt-8">1. Datos que recopilamos</h2>
          <p>Recopilamos nombre, email, CUIL (opcional), y datos de las bicicletas registradas. Si conectas Strava o Garmin, accedemos a tus actividades de ciclismo con tu consentimiento explicito.</p>
          <h2 className="font-display text-xl font-bold text-ink mt-8">2. Uso de los datos</h2>
          <p>Los datos se usan para emitir certificados digitales (CIT), procesar pagos mediante MercadoPago, registrar denuncias de hurto y mejorar el servicio. No vendemos datos a terceros.</p>
          <h2 className="font-display text-xl font-bold text-ink mt-8">3. Almacenamiento y seguridad</h2>
          <p>Los datos se almacenan en servidores seguros. Los certificados se anclan en la Blockchain Federal Argentina (BFA) de forma permanente e inmutable.</p>
          <h2 className="font-display text-xl font-bold text-ink mt-8">4. Tus derechos</h2>
          <p>Podes solicitar acceso, rectificacion o eliminacion de tus datos escribiendo a contactoarribaeleste@gmail.com. Aplicamos la Ley 25.326 de Proteccion de Datos Personales de Argentina.</p>
          <h2 className="font-display text-xl font-bold text-ink mt-8">5. Contacto</h2>
          <p>Para consultas sobre privacidad: contactoarribaeleste@gmail.com · San Martin, Mendoza, Argentina.</p>
        </div>
      </main>
      <Footer />
    </div>
  )
}
