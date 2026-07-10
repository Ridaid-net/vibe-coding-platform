import Link from 'next/link'
import { ShieldAlert, FileWarning, ArrowRight } from 'lucide-react'

export function DenunciaComunitaria() {
  return (
    <section id="seguridad" className="bg-[#0F1E35] py-20">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-clay/30 bg-clay/10 px-3 py-1.5">
              <ShieldAlert className="size-4 text-clay" />
              <span className="text-xs font-semibold uppercase tracking-wide text-clay">Servicio a la Comunidad</span>
            </div>
            <h2 className="font-display text-3xl font-bold tracking-tight text-paper sm:text-4xl">
              Te robaron la bici?
              <br />
              <span className="text-[#2BBCB8]">Publicala en RODAID.</span>
            </h2>
            <p className="mt-4 text-base leading-relaxed text-paper/65">
              Si tu bicicleta fue hurtada o robada, registra la denuncia en nuestra plataforma.
              El numero de serie queda marcado como alerta activa en toda la red RODAID:
              ningun taller aliado podra emitir un CIT para esa bicicleta sin que el sistema lo detecte.
            </p>
            <ul className="mt-6 space-y-3">
              <li className="flex items-start gap-3 text-sm text-paper/70"><FileWarning className="mt-0.5 size-4 shrink-0 text-[#2BBCB8]" />La bici queda bloqueada en el marketplace automaticamente.</li>
              <li className="flex items-start gap-3 text-sm text-paper/70"><FileWarning className="mt-0.5 size-4 shrink-0 text-[#2BBCB8]" />Los talleres aliados reciben la alerta al intentar verificarla.</li>
              <li className="flex items-start gap-3 text-sm text-paper/70"><FileWarning className="mt-0.5 size-4 shrink-0 text-[#2BBCB8]" />El sistema cruza la denuncia con el Ministerio de Seguridad (MPF).</li>
              <li className="flex items-start gap-3 text-sm text-paper/70"><FileWarning className="mt-0.5 size-4 shrink-0 text-[#2BBCB8]" />Recibes notificaciones si la bici aparece en la red.</li>
            </ul>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/ingresar?next=/garaje&motivo=denuncia" className="inline-flex items-center justify-center gap-2 rounded-full bg-clay px-6 py-3 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5">
                <ShieldAlert className="size-4" />
                Denunciar bicicleta hurtada
                <ArrowRight className="size-4" />
              </Link>
              <Link href="/verificar" className="inline-flex items-center justify-center gap-2 rounded-full border border-paper/20 px-6 py-3 text-sm font-semibold text-paper/80 transition-colors hover:border-paper/40 hover:text-paper">
                Verificar numero de serie
              </Link>
            </div>
            <p className="mt-4 text-xs text-paper/35">
              Requiere cuenta RODAID verificada. Es gratis si tu bici ya tiene un CIT activo;
              si no, te mostramos el costo exacto antes de confirmar la denuncia.
            </p>
          </div>
          <div className="rounded-2xl border border-paper/10 bg-paper/5 p-6">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-clay/20">
                <ShieldAlert className="size-5 text-clay" />
              </div>
              <div>
                <p className="text-sm font-bold text-paper">Alerta Activa en Red RODAID</p>
                <p className="text-xs text-paper/50">Sistema de trazabilidad comunitaria</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-xl border border-paper/8 bg-paper/5 px-4 py-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#2BBCB8]/20 text-[11px] font-bold text-[#2BBCB8]">01</span><span className="text-xs text-paper/80">Ingresa con tu cuenta RODAID</span></div>
              <div className="flex items-center gap-3 rounded-xl border border-paper/8 bg-paper/5 px-4 py-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#2BBCB8]/20 text-[11px] font-bold text-[#2BBCB8]">02</span><span className="text-xs text-paper/80">Carga el numero de serie de la bici</span></div>
              <div className="flex items-center gap-3 rounded-xl border border-paper/8 bg-paper/5 px-4 py-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-clay/20 text-[11px] font-bold text-clay">03</span><span className="text-xs text-paper/80">Adjunta la denuncia policial (PDF)</span></div>
              <div className="flex items-center gap-3 rounded-xl border border-paper/8 bg-paper/5 px-4 py-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-paper/10 text-[11px] font-bold text-paper/30">04</span><span className="text-xs text-paper/35">La alerta se activa en toda la red</span></div>
              <div className="flex items-center gap-3 rounded-xl border border-paper/8 bg-paper/5 px-4 py-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-paper/10 text-[11px] font-bold text-paper/30">05</span><span className="text-xs text-paper/35">Recibes notificaciones de coincidencias</span></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
