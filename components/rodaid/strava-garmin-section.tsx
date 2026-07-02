import Link from 'next/link'
import { Activity, MapPin, Zap, Shield } from 'lucide-react'

export function StravaGarminSection() {
  return (
    <section className="bg-paper py-20">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="text-center mb-12">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#2BBCB8]/30 bg-[#2BBCB8]/5 px-3 py-1.5">
            <Activity className="size-4 text-[#2BBCB8]" />
            <span className="text-xs font-semibold uppercase tracking-wide text-[#2BBCB8]">Nuevo · RODAID Connect</span>
          </div>
          <h2 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Tu bici conectada con
            <span className="text-[#FC4C02]"> Strava</span> y
            <span className="text-[#007DC1]"> Garmin</span>
          </h2>
          <p className="mt-4 mx-auto max-w-2xl text-base leading-relaxed text-slate-warm">
            Vinculá tu cuenta de Strava o Garmin y RODAID registra automáticamente cada actividad.
            Tu odómetro se actualiza solo, el historial queda en la blockchain y el sistema te avisa
            cuándo hacerle mantenimiento a tu bici.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-ink/8 bg-white p-6 shadow-sm">
            <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-[#FC4C02]/10">
              <Activity className="size-5 text-[#FC4C02]" />
            </div>
            <h3 className="font-display text-base font-semibold text-ink">Odómetro automático</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-warm">
              Cada salida suma kilómetros a tu bicicleta certificada. Sin cargar nada manualmente.
            </p>
          </div>
          <div className="rounded-2xl border border-ink/8 bg-white p-6 shadow-sm">
            <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-[#2BBCB8]/10">
              <MapPin className="size-5 text-[#2BBCB8]" />
            </div>
            <h3 className="font-display text-base font-semibold text-ink">Mapa de rutas</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-warm">
              Visualizá todas tus rutas en el mapa de calor de RODAID. Solo vos ves tus datos.
            </p>
          </div>
          <div className="rounded-2xl border border-ink/8 bg-white p-6 shadow-sm">
            <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-lime/20">
              <Zap className="size-5 text-lime-deep" />
            </div>
            <h3 className="font-display text-base font-semibold text-ink">Mantenimiento predictivo</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-warm">
              El sistema te avisa cada 500 km para revisar transmisión, cadena y frenos.
            </p>
          </div>
          <div className="rounded-2xl border border-ink/8 bg-white p-6 shadow-sm">
            <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-[#F47B20]/10">
              <Shield className="size-5 text-[#F47B20]" />
            </div>
            <h3 className="font-display text-base font-semibold text-ink">Historial verificado</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-warm">
              El kilometraje queda registrado junto al CIT en la Blockchain Federal Argentina.
            </p>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Link href="/ingresar?next=/garaje&motivo=strava"
            className="inline-flex items-center gap-2 rounded-full bg-[#FC4C02] px-6 py-3 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5">
            <Activity className="size-4" />
            Conectar con Strava
          </Link>
          <Link href="/ingresar?next=/garaje&motivo=garmin"
            className="inline-flex items-center gap-2 rounded-full border border-[#007DC1] px-6 py-3 text-sm font-semibold text-[#007DC1] transition-colors hover:bg-[#007DC1]/5">
            Conectar con Garmin
          </Link>
        </div>
        <p className="mt-4 text-center text-xs text-slate-warm/60">
          Tu privacidad es prioridad — solo vos accedés a tus rutas. La integración usa OAuth 2.0 oficial.
        </p>
      </div>
    </section>
  )
}
