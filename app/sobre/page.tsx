import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'

export const metadata = {
  title: 'Sobre RODAID — Plataforma de certificacion de bicicletas verificadas',
  description: 'Perfil de desarrollo, alcances, beneficios y valor social de RODAID.',
}

export default function SobrePage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-4xl px-5 py-14 sm:px-8">
        <header className="mb-10">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-clay">
            Plataforma · Mendoza · Argentina
          </span>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-ink">
            Sobre RODAID
          </h1>
          <p className="mt-3 text-base text-slate-warm max-w-2xl">
            La primera plataforma de certificacion tecnica digital y marketplace de bicicletas verificadas de Argentina.
          </p>
        </header>
        <SobreContent />
      </main>
      <Footer />
    </div>
  )
}

function SobreContent() {
  return (
    <div className="space-y-10">
        <section className="mb-10 grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-ink/10 bg-white p-6">
            <span className="text-xs font-semibold uppercase tracking-widest text-[#2BBCB8]">Vision</span>
            <p className="mt-3 text-base font-display font-semibold text-ink leading-snug">Ser la infraestructura de confianza del mercado de bicicletas usadas de Argentina.</p>
            <p className="mt-2 text-sm text-slate-warm leading-relaxed">Donde cada rodado tenga una identidad digital verificable, cada transaccion sea segura, y cada hurto deje una huella rastreable en la red.</p>
          </div>
          <div className="rounded-2xl border border-ink/10 bg-white p-6">
            <span className="text-xs font-semibold uppercase tracking-widest text-[#F47B20]">Mision</span>
            <p className="mt-3 text-base font-display font-semibold text-ink leading-snug">Certificar la identidad tecnica de las bicicletas y conectar compradores y vendedores con garantias reales.</p>
            <p className="mt-2 text-sm text-slate-warm leading-relaxed">Mediante tecnologia blockchain, pago protegido en escrow, y una red de talleres aliados que fortalece el ecosistema ciclístico de Mendoza como referencia provincial.</p>
          </div>
        </section>
      <section>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-warm mb-4">Que es el CIT</p>
        <div className="rounded-2xl border border-ink/10 bg-white p-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="sm:col-span-2">
              <h2 className="font-display text-xl font-semibold text-ink mb-3">Cedula de Identidad Tecnica de la Bicicleta</h2>
              <p className="text-sm text-slate-warm leading-relaxed mb-4">El CIT es el certificado digital que acredita la identidad y el estado tecnico de una bicicleta. Funciona como la cedula verde de un auto: identifica al rodado de forma unica, registra su historial de inspeccion y vincula al titular verificado. Cada CIT es generado por un taller aliado RODAID luego de una inspeccion tecnica de 20 puntos, y su huella SHA-256 queda anclada de forma inmutable en la Blockchain Federal Argentina (BFA).</p>
              <p className="text-sm text-slate-warm leading-relaxed">Una vez emitido, el CIT es publicamente verificable por cualquier persona — sin necesidad de cuenta — escaneando el codigo QR o ingresando el numero de serie en rodaid.net/verificar. Esto permite que compradores, vendedores, talleres y fuerzas de seguridad puedan confirmar la identidad del rodado en tiempo real.</p>
            </div>
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-warm mb-1">Vigencia</p>
                <p className="text-2xl font-semibold text-ink">12 meses</p>
                <p className="text-xs text-slate-warm mt-1">Renovable anualmente en cualquier taller aliado</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-warm mb-1">Valor del tramite</p>
                <p className="text-2xl font-semibold text-ink">18.000</p>
                <p className="text-xs text-slate-warm mt-1">ARS · U segun cotizacion BNA del dia</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6 pt-6 border-t border-ink/8">
            <div>
              <p className="text-sm font-semibold text-ink mb-2">Para el comprador</p>
              <p className="text-sm text-slate-warm">Certeza de que la bicicleta no es robada, que el numero de serie coincide con el cuadro y que el estado tecnico fue auditado por un profesional. Elimina el principal riesgo de la compra de bicicletas usadas.</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-ink mb-2">Para el vendedor</p>
              <p className="text-sm text-slate-warm">El CIT activo aumenta el valor de venta del rodado porque elimina la desconfianza del comprador. Una bici con CIT vigente se vende mas rapido y a mejor precio que una sin certificacion.</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-ink mb-2">Valor al rodado</p>
              <p className="text-sm text-slate-warm">El CIT transforma una bicicleta usada en un activo con identidad verificada. El historial de inspecciones queda registrado en la blockchain de forma permanente, agregando transparencia y trazabilidad a toda la vida util del rodado.</p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-warm mb-4">Perfil de desarrollo</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-ink/10 bg-white p-5">
            <p className="font-semibold text-ink mb-2">Stack tecnologico</p>
            <p className="text-sm text-slate-warm">Next.js · Node.js · PostgreSQL · Blockchain Federal Argentina · Capacitor (iOS/Android)</p>
            <div className="flex flex-wrap gap-2 mt-3">
              {['OAuth 2.0','JWT + MFA','SHA-256 + HMAC','ERC-721 NFT','MercadoPago Escrow'].map(t => (
                <span key={t} className="text-xs px-2 py-1 rounded-full bg-sky-50 text-sky-700">{t}</span>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-ink/10 bg-white p-5">
            <p className="font-semibold text-ink mb-2">Marco legal e institucional</p>
            <p className="text-sm text-slate-warm">Ley Provincial N° 9556 · Ley 24.240 · Ley 25.326 · EDI X-Road Mendoza</p>
            
          </div>
        </div>
      </section>

      <section>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-warm mb-4">Beneficios a usuarios</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { titulo: 'Compradores', color: 'border-l-sky-500', items: ['Historial tecnico verificado antes de comprar','Pago retenido en escrow hasta confirmar entrega','Mediacion tecnica en disputas (3 niveles)','Verificacion publica del CIT sin cuenta'] },
            { titulo: 'Vendedores', color: 'border-l-green-500', items: ['Precio diferencial por bici certificada','Menor friccion de venta — identidad demostrada','Publicacion restringida a bicis con CIT activo','60% de la tarifa CIT va al taller aliado'] },
            { titulo: 'Talleres aliados', color: 'border-l-orange-500', items: ['Nueva fuente de ingresos por CIT ($18.000 ARS)','Panel Inspector con 20 puntos de inspeccion','Red de referencia — clientes buscan CIT','Alertas de mantenimiento predictivo (Strava)'] },
          ].map(s => (
            <div key={s.titulo} className={`rounded-2xl border border-ink/10 bg-white p-5 border-l-4 ${s.color}`}>
              <p className="font-semibold text-ink mb-3">{s.titulo}</p>
              <ul className="space-y-2">
                {s.items.map(i => <li key={i} className="text-sm text-slate-warm flex gap-2"><span className="text-lime-deep mt-0.5">✓</span>{i}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-warm mb-4">Valor agregado a la sociedad</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-ink/10 bg-white p-5">
            <p className="font-semibold text-ink mb-2">Mitigacion del hurto en Mendoza</p>
            <p className="text-sm text-slate-warm leading-relaxed">Cuando una bicicleta es denunciada por hurto, su numero de serie queda marcado como alerta activa en toda la red. Ningun taller aliado puede emitir un CIT para esa bicicleta sin que el sistema lo detecte. El cruce con el MPF le da peso administrativo real a la denuncia.</p>
            <div className="flex flex-wrap gap-2 mt-3">
              {['Alerta en red real-time','Bloqueo en marketplace','Cruce MPF Mendoza','Notificaciones al propietario'].map(t => (
                <span key={t} className="text-xs px-2 py-1 rounded-full bg-red-50 text-red-700">{t}</span>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-ink/10 bg-white p-5">
            <p className="font-semibold text-ink mb-2">Fomento del ecosistema ciclístico provincial</p>
            <p className="text-sm text-slate-warm leading-relaxed">RODAID actua como catalizador del sector de bicicleterias de Mendoza con proyeccion nacional. La demanda de CIT genera visitas a talleres aliados, el mantenimiento predictivo fideliza clientes, y la red de confianza eleva el valor percibido de todo el mercado de bicis usadas en la region.</p>
            <div className="flex flex-wrap gap-2 mt-3">
              {['Talleres aliados certificados','Economia local','Movilidad sustentable'].map(t => (
                <span key={t} className="text-xs px-2 py-1 rounded-full bg-green-50 text-green-700">{t}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-warm mb-4">Alcances del marketplace</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { val: '$18.000', lbl: 'ARS por CIT emitido' },
            { val: '60 / 40', lbl: 'Split aliado / RODAID' },
            { val: '19.008', lbl: 'Dispositivos Android compatibles' },
            { val: 'BFA', lbl: 'Blockchain Federal Argentina' },
          ].map(m => (
            <div key={m.lbl} className="rounded-xl bg-slate-50 p-4 text-center">
              <p className="text-xl font-semibold text-ink">{m.val}</p>
              <p className="text-xs text-slate-warm mt-1">{m.lbl}</p>
            </div>
          ))}
        </div>
      </section>

            <section className="mt-12 border-t border-ink/8 pt-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-warm mb-6">Fundador</p>
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
          <div className="shrink-0">
            <img
              src="/Federico-degea.jpg"
              alt="Federico De Gea — Founder CEO RODAID"
              className="size-28 rounded-full object-cover object-top"
              style={{border: '2.5px solid #2BBCB8'}}
            />
          </div>
          <div className="text-center sm:text-left">
            <p className="font-display text-2xl font-semibold text-[#0F1E35]">Federico De Gea</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-[#F47B20]">Founder &amp; CEO — RODAID</p>
            <p className="mt-3 text-sm leading-relaxed text-slate-warm max-w-xl">
              Emprendedor tecnológico y navegante de rally raid con base en San Martín, Mendoza. 
              Fundó RODAID con la visión de crear infraestructura de confianza para el mercado 
              de bicicletas usadas de Argentina, combinando blockchain, certificación técnica 
              y protección al consumidor en una sola plataforma.
            </p>
            <div className="mt-4 flex flex-wrap justify-center sm:justify-start gap-2">
              <span className="text-xs px-3 py-1 rounded-full bg-[#0F1E35]/8 text-[#0F1E35]">Rally Raid SAR 2021</span>
              <span className="text-xs px-3 py-1 rounded-full bg-[#0F1E35]/8 text-[#0F1E35]">Zona Este · Mendoza</span>
              <span className="text-xs px-3 py-1 rounded-full bg-[#0F1E35]/8 text-[#0F1E35]">Blockchain &amp; Fintech</span>
            </div>
            <p className="mt-4 text-xs text-slate-warm/70">
              <a href="mailto:federicodegeaceo@rodaid.net" className="text-[#2BBCB8] hover:underline">federicodegeaceo@rodaid.net</a>
            </p>
          </div>
        </div>
      </section>
      <p className="text-xs text-center text-slate-warm/60 pt-4">RODAID · rodaid.net · San Martin, Mendoza, Argentina · 2026</p>
    </div>
  )
}
