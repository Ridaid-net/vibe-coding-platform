import Link from 'next/link'
import { ArrowLeft, ScrollText, ShieldCheck } from 'lucide-react'
import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
import { ConsultoriaLegalBoton } from '@/components/rodaid/consultoria-legal-opener'
import { CORPUS_LEGAL } from '@/lib/legal-corpus'

export const metadata = {
  title: 'Términos, Protocolo del CIT y Normativa — RODAID',
  description:
    'Términos y Condiciones, Protocolo de Emisión del CIT (Regla de las 72 horas y Declaración Jurada de Licitud) y normativa de seguridad y datos de RODAID.',
}

/**
 * Página pública del corpus legal de RODAID: Términos y Condiciones, Protocolo
 * de Emisión del CIT y normativa de seguridad/datos. Es la fuente que el
 * Asistente Oficial de Soporte y Consultoría Legal cita (su única base de
 * conocimiento), y desde acá el usuario puede abrir el asistente para resolver
 * dudas sin perder la lectura.
 */
export default function TerminosPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-warm transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-4" />
          Volver al inicio
        </Link>

        <header className="mt-6 border-b border-ink/10 pb-8">
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-clay">
            <ScrollText className="size-4" />
            Marco legal y de seguridad
          </span>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">
            Términos, Protocolo del CIT y Normativa
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-warm">
            Estos documentos rigen el uso de RODAID, el proceso de emisión de la
            Cédula de Identidad Tecnológica (CIT) y el tratamiento de tus datos.
            RODAID es una herramienta de registro y prevención operada en
            colaboración con el Ministerio de Seguridad de la Provincia de Mendoza;
            no es una compañía de seguros.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <ConsultoriaLegalBoton label="Consultar al Asistente Legal" />
            <p className="text-xs text-slate-warm">
              ¿Dudas sobre algún punto? Preguntale al asistente oficial: responde
              citando estas mismas cláusulas.
            </p>
          </div>
        </header>

        {/* Índice */}
        <nav className="mt-8 rounded-2xl border border-ink/10 bg-white p-5">
          <p className="text-sm font-semibold text-ink">Contenido</p>
          <ol className="mt-3 space-y-1.5 text-sm">
            {CORPUS_LEGAL.map((seccion, i) => (
              <li key={seccion.id}>
                <a
                  href={`#${seccion.id}`}
                  className="text-slate-warm transition-colors hover:text-lime-deep"
                >
                  {i + 1}. {seccion.titulo}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {/* Secciones */}
        <div className="mt-10 space-y-12">
          {CORPUS_LEGAL.map((seccion, i) => (
            <section key={seccion.id} id={seccion.id} className="scroll-mt-24">
              <h2 className="font-display text-2xl font-bold tracking-tight text-ink">
                {i + 1}. {seccion.titulo}
              </h2>
              <p className="mt-2 text-sm text-slate-warm">{seccion.resumen}</p>

              <div className="mt-5 space-y-5">
                {seccion.clausulas.map((clausula) => (
                  <article
                    key={clausula.id}
                    className="rounded-2xl border border-ink/10 bg-white p-5"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="rounded-full bg-lime/25 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-ink">
                        {clausula.id}
                      </span>
                      <h3 className="font-display text-base font-semibold text-ink">
                        {clausula.titulo}
                      </h3>
                    </div>
                    <p className="mt-2.5 text-sm leading-relaxed text-ink/80">
                      {clausula.texto}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Cierre */}
        <div className="mt-12 flex items-start gap-3 rounded-2xl border border-ink/10 bg-paper-dim/40 p-5">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-lime-deep" />
          <p className="text-sm leading-relaxed text-slate-warm">
            Este es el texto vigente del marco legal de RODAID. Para dudas puntuales
            sobre la validación, tus derechos y obligaciones o el régimen
            sancionatorio, abrí la{' '}
            <span className="font-semibold text-ink">Consultoría Legal</span>; para
            otros temas, contactá a nuestro soporte especializado.
          </p>
        </div>
      </main>
      <Footer />
    </div>
  )
}
