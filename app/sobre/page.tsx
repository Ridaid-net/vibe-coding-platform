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
            <div className="flex flex-wrap gap-2 mt-3">
              {['Incubadora municipal','Intendente Junin','Agencia I+D+i 2026'].map(t => (
                <span key={t} className="text-xs px-2 py-1 rounded-full bg-green-50 text-green-700">{t}</span>
              ))}
            </div>
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
            <p className="text-sm text-slate-warm leading-relaxed">RODAID actua como catalizador del sector de bicycleterias de Zona Este. La demanda de CIT genera visitas a talleres aliados, el mantenimiento predictivo fideliza clientes, y la red de confianza eleva el valor percibido de todo el mercado de bicis usadas en la region.</p>
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

      <p className="text-xs text-center text-slate-warm/60 pt-4">RODAID · rodaid.net · San Martin, Mendoza, Argentina · 2026</p>
    </div>
  )
}
