'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  XCircle,
} from 'lucide-react'
import { Footer } from '@/components/rodaid/footer'
import { Nav } from '@/components/rodaid/nav'
import { ProteccionRodaidPay } from '@/components/rodaid/rodaid-pay-badge'
import { BotonDisputa } from '@/components/rodaid/BotonDisputa'
import { authedFetch } from '@/lib/session'

type Fase =
  | 'verificando'
  | 'sena-confirmada'
  | 'retenido'
  | 'cit-express-pagado'
  | 'pendiente'
  | 'rechazado'
  | 'error'

const MAX_INTENTOS = 6
const INTERVALO_MS = 2000

function ResultadoInner() {
  const params = useSearchParams()
  const txId =
    params.get('external_reference') ?? params.get('tx') ?? params.get('txId')
  const statusParam =
    params.get('status') ?? params.get('collection_status') ?? null

  const [fase, setFase] = useState<Fase>('verificando')
  const [mensaje, setMensaje] = useState<string | null>(null)
  const intentos = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const verificar = useCallback(async () => {
    if (!txId) {
      setFase('error')
      setMensaje('No recibimos la referencia de la transacción.')
      return
    }

    try {
      // Re-consultamos el estado real a MercadoPago (best-effort) para forzar la
      // transicion a FONDOS_RETENIDOS sin depender de que el webhook ya llegó.
      await authedFetch(`/api/v1/escrow/pago/${txId}/refrescar`, {
        method: 'POST',
      }).catch(() => undefined)

      const res = await authedFetch(`/api/v1/escrow/pago/${txId}/estado`)
      if (res.status === 403) {
        setFase('error')
        setMensaje(
          'No podemos verificar esta transacción con tu sesión actual.'
        )
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data = (await res.json()) as {
        tipo?: 'escrow' | 'cit_express'
        estado: string
        plan?: string
      }

      // CIT Express (self-service o "Iniciar Certificación") -- tabla y
      // estados distintos de escrow_transacciones. Mismo endpoint/pantalla,
      // resuelto server-side por tipo. Ver CLAUDE.md, bug real 2026-07-21.
      if (data.tipo === 'cit_express') {
        if (data.estado === 'pagada') {
          setFase('cit-express-pagado')
          return
        }
        if (data.estado === 'rechazada' || data.estado === 'vencida') {
          setFase('rechazado')
          setMensaje(
            data.estado === 'vencida'
              ? 'La solicitud venció antes de completarse el pago.'
              : 'El pago no se aprobó. Podés intentar nuevamente desde tu Garaje.'
          )
          return
        }
        // Sigue en pago_pendiente.
        if (statusParam === 'failure' || statusParam === 'rejected' || statusParam === 'null') {
          setFase('rechazado')
          setMensaje('El pago no se aprobó. Podés intentar nuevamente desde tu Garaje.')
          return
        }
        if (intentos.current < MAX_INTENTOS) {
          intentos.current += 1
          timer.current = setTimeout(verificar, INTERVALO_MS)
          return
        }
        setFase('pendiente')
        return
      }

      if (data.estado === 'RESERVADA') {
        setFase('sena-confirmada')
        return
      }
      if (data.estado === 'FONDOS_RETENIDOS' || data.estado === 'EN_CAMINO') {
        setFase('retenido')
        return
      }
      if (data.estado === 'CANCELADA' || data.estado === 'RESERVA_VENCIDA') {
        setFase('rechazado')
        setMensaje(
          data.estado === 'RESERVA_VENCIDA'
            ? 'La reserva venció antes de completarse.'
            : 'La compra fue cancelada y el depósito reembolsado.'
        )
        return
      }

      // Sigue en DEPOSITO_PENDIENTE: o el pago no se aprobó, o el webhook
      // todavía no impactó. Reintentamos unas veces antes de mostrar pendiente.
      if (
        statusParam === 'failure' ||
        statusParam === 'rejected' ||
        statusParam === 'null'
      ) {
        setFase('rechazado')
        setMensaje('El pago no se aprobó. Podés intentar nuevamente.')
        return
      }

      if (intentos.current < MAX_INTENTOS) {
        intentos.current += 1
        timer.current = setTimeout(verificar, INTERVALO_MS)
        return
      }
      setFase('pendiente')
    } catch {
      if (intentos.current < MAX_INTENTOS) {
        intentos.current += 1
        timer.current = setTimeout(verificar, INTERVALO_MS)
        return
      }
      setFase('error')
      setMensaje('No pudimos confirmar el estado del pago.')
    }
  }, [txId, statusParam])

  useEffect(() => {
    verificar()
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [verificar])

  return (
    <section className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-5 py-20 text-center sm:px-8">
      {fase === 'verificando' && (
        <Estado
          icon={<Loader2 className="size-8 animate-spin" />}
          tone="neutral"
          titulo="Confirmando tu pago…"
          detalle="Estamos verificando que el dinero quedó retenido en RODAID PAY."
        />
      )}

      {fase === 'sena-confirmada' && (
        <Estado
          icon={<CheckCircle2 className="size-8" />}
          tone="ok"
          titulo="¡Seña confirmada!"
          detalle="El Taller Aliado ya puede verificar tu bici. Te avisamos apenas termine la inspección de 20 puntos, para que confirmes el pago del saldo."
        />
      )}

      {fase === 'cit-express-pagado' && (
        <Estado
          icon={<CheckCircle2 className="size-8" />}
          tone="ok"
          titulo="¡Pago confirmado!"
          detalle="Tu CIT Express ya se está activando. En breve vas a ver el resultado en tu Garaje Digital."
        />
      )}

      {fase === 'retenido' && (
        <>
          <Estado
            icon={<Lock className="size-8" />}
            tone="ok"
            titulo="¡Listo! Tu pago está protegido"
            detalle="Los fondos quedaron retenidos y seguros. El vendedor ya puede preparar el envío; el dinero se libera recién cuando confirmes que recibiste la bici."
          />
          <div className="mt-8 w-full text-left">
            <ProteccionRodaidPay retenido />
            <div className="mt-4">
              <BotonDisputa transaccionId={txId ?? ''} estadoTransaccion="EN_ESPERA_DE_LIBERACION" />
            </div>
          </div>
        </>
      )}

      {fase === 'pendiente' && (
        <Estado
          icon={<Clock className="size-8" />}
          tone="warn"
          titulo="Tu pago se está procesando"
          detalle="En cuanto MercadoPago lo confirme, los fondos pasarán a estar retenidos por RODAID PAY. Podés cerrar esta página: la operación sigue su curso."
        />
      )}

      {fase === 'rechazado' && (
        <Estado
          icon={<XCircle className="size-8" />}
          tone="error"
          titulo="El pago no se completó"
          detalle={mensaje ?? 'No se pudo retener el depósito. Probá nuevamente desde la publicación.'}
        />
      )}

      {fase === 'error' && (
        <Estado
          icon={<XCircle className="size-8" />}
          tone="error"
          titulo="No pudimos confirmar el pago"
          detalle={mensaje ?? 'Volvé a intentarlo en unos minutos.'}
        />
      )}

      <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/#comprar"
          className="inline-flex items-center gap-1.5 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
        >
          <ArrowLeft className="size-4" />
          Seguir explorando
        </Link>
        {(fase === 'pendiente' || fase === 'error') && (
          <button
            onClick={() => {
              intentos.current = 0
              setFase('verificando')
              verificar()
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-white px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-ink/40"
          >
            Volver a verificar
          </button>
        )}
      </div>
    </section>
  )
}

function Estado({
  icon,
  titulo,
  detalle,
  tone,
}: {
  icon: React.ReactNode
  titulo: string
  detalle: string
  tone: 'ok' | 'warn' | 'error' | 'neutral'
}) {
  const toneClass =
    tone === 'ok'
      ? 'bg-lime text-ink'
      : tone === 'warn'
        ? 'bg-lime/20 text-ink'
        : tone === 'error'
          ? 'bg-clay/15 text-clay'
          : 'bg-paper-dim text-ink'

  return (
    <div className="flex flex-col items-center">
      <span
        className={`flex size-16 items-center justify-center rounded-2xl ${toneClass}`}
      >
        {tone === 'ok' ? <CheckCircle2 className="size-8" /> : icon}
      </span>
      <h1 className="mt-6 font-display text-3xl font-bold tracking-tight text-ink">
        {titulo}
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-warm">
        {detalle}
      </p>
    </div>
  )
}

export default function CheckoutResultadoPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main>
        <Suspense
          fallback={
            <div className="flex min-h-[60vh] items-center justify-center">
              <Loader2 className="size-8 animate-spin text-ink" />
            </div>
          }
        >
          <ResultadoInner />
        </Suspense>
      </main>
      <Footer />
    </div>
  )
}
