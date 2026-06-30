import { ShieldCheck, Lock } from 'lucide-react'

/**
 * Indicador visual de 'Proteccion RODAID PAY'. Comunica que el pago viaja por
 * el escrow y que los fondos quedan retenidos y seguros hasta la entrega.
 */
export function RodaidPayBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-paper ${className}`}
    >
      <ShieldCheck className="size-3.5 text-lime" />
      Protección RODAID PAY
    </span>
  )
}

/**
 * Panel explicativo de la proteccion. Con `retenido` activo refleja el estado
 * real de FONDOS_RETENIDOS: el dinero ya esta en custodia.
 */
export function ProteccionRodaidPay({
  retenido = false,
}: {
  retenido?: boolean
}) {
  return (
    <div
      className={`rounded-2xl border p-5 ${
        retenido
          ? 'border-lime/60 bg-lime/10'
          : 'border-ink/12 bg-paper-dim/60'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${
            retenido ? 'bg-lime text-ink' : 'bg-ink text-lime'
          }`}
        >
          {retenido ? (
            <Lock className="size-5" />
          ) : (
            <ShieldCheck className="size-5" />
          )}
        </span>
        <div>
          <p className="font-display text-sm font-bold text-ink">
            {retenido
              ? 'Fondos retenidos y seguros'
              : 'Protección RODAID PAY'}
          </p>
          <p className="text-xs text-slate-warm">
            {retenido
              ? 'El dinero está en custodia. El vendedor no cobra hasta que confirmes la entrega.'
              : 'El pago queda retenido en custodia hasta que recibas la bici.'}
          </p>
        </div>
      </div>

      <ul className="mt-4 space-y-2 text-xs text-slate-warm">
        <li className="flex items-start gap-2">
          <span className="mt-1 size-1.5 shrink-0 rounded-full bg-lime" />
          El dinero entra a RODAID PAY, no a la cuenta del vendedor.
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-1 size-1.5 shrink-0 rounded-full bg-lime" />
          Se libera solo cuando confirmás que la bici llegó.
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-1 size-1.5 shrink-0 rounded-full bg-lime" />
          Si algo sale mal, abrís una disputa y te devolvemos el depósito.
        </li>
      </ul>
    </div>
  )
}
