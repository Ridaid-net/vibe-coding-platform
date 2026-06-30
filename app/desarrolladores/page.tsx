import { Footer } from '@/components/rodaid/footer'
import { Nav } from '@/components/rodaid/nav'
import { DesarrolladoresPortal } from '@/components/rodaid/desarrolladores-portal'

export const metadata = {
  title: 'RODAID Open-Connect — Portal de Desarrolladores',
  description:
    'Integrá el estado de confianza de RODAID en tu producto: el Botón de Verificación con una línea, OAuth2/OIDC con consentimiento del usuario, webhooks de ecosistema y Credenciales Verificables W3C. Solo estado público; nunca datos personales.',
}

export default function DesarrolladoresPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-wide text-lime-deep">
            RODAID Open-Connect
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Portal de Desarrolladores
          </h1>
          <p className="mt-2 max-w-2xl text-slate-warm">
            Abrí RODAID a tu producto sin comprometer la seguridad. El ecosistema solo consume el
            estado público verificado de una bicicleta —segura, robada, en validación— y siempre con
            el consentimiento expreso del dueño vía OAuth2 / OpenID Connect. Los datos personales
            siguen siendo nulos para terceros.
          </p>
        </div>
        <DesarrolladoresPortal />
      </main>
      <Footer />
    </div>
  )
}
