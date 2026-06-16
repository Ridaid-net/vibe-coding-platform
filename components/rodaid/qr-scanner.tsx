'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, Loader2, X } from 'lucide-react'

/**
 * Lector de QR del sticker CIT (Hito 7), con html5-qrcode.
 *
 * Abre la camara trasera del dispositivo y, al detectar un QR, devuelve el texto
 * decodificado (serial, codigo CIT o una URL del verificador). La libreria toca
 * el DOM y `navigator.mediaDevices`, asi que se carga de forma dinamica y solo
 * en el cliente (sin SSR). El componente degrada con gracia: si no hay camara o
 * se deniega el permiso, muestra el motivo y el usuario sigue pudiendo escribir
 * el serial a mano.
 */

const REGION_ID = 'rodaid-qr-region'

export function QrScanner({
  onResult,
  onClose,
}: {
  onResult: (text: string) => void
  onClose: () => void
}) {
  const [estado, setEstado] = useState<'cargando' | 'escaneando' | 'error'>(
    'cargando'
  )
  const [mensajeError, setMensajeError] = useState<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scannerRef = useRef<any>(null)
  const resueltoRef = useRef(false)

  useEffect(() => {
    let cancelado = false

    async function iniciar() {
      try {
        const { Html5Qrcode } = await import('html5-qrcode')
        if (cancelado) return

        const scanner = new Html5Qrcode(REGION_ID, { verbose: false })
        scannerRef.current = scanner

        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decodedText: string) => {
            if (resueltoRef.current) return
            resueltoRef.current = true
            // Detener antes de propagar para liberar la camara.
            scanner
              .stop()
              .catch(() => undefined)
              .finally(() => onResult(decodedText))
          },
          () => {
            // Callback por frame sin lectura: se ignora (ruido normal).
          }
        )
        if (!cancelado) setEstado('escaneando')
      } catch (err) {
        if (cancelado) return
        setEstado('error')
        setMensajeError(
          err instanceof Error && /permission|denied|notallowed/i.test(err.message)
            ? 'No pudimos acceder a la camara. Revisa los permisos del navegador.'
            : 'No pudimos iniciar la camara en este dispositivo. Escribi el serial a mano.'
        )
      }
    }

    iniciar()

    return () => {
      cancelado = true
      const scanner = scannerRef.current
      if (scanner) {
        scanner
          .stop()
          .catch(() => undefined)
          .finally(() => {
            try {
              scanner.clear()
            } catch {
              // ignore
            }
          })
      }
    }
  }, [onResult])

  return (
    <div className="rounded-3xl border border-ink/12 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Camera className="size-4 text-clay" />
          Escanear sticker CIT
        </span>
        <button
          onClick={onClose}
          className="inline-flex size-8 items-center justify-center rounded-full text-ink/50 transition-colors hover:bg-paper-dim hover:text-ink"
          aria-label="Cerrar lector"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="relative mt-3 overflow-hidden rounded-2xl bg-ink/5">
        {/* Region donde html5-qrcode monta el <video>. */}
        <div id={REGION_ID} className="mx-auto w-full [&_video]:rounded-2xl" />

        {estado === 'cargando' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 py-16 text-slate-warm">
            <Loader2 className="size-6 animate-spin" />
            <span className="text-xs">Iniciando la camara…</span>
          </div>
        )}

        {estado === 'error' && (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
            <span className="text-sm font-semibold text-ink">
              Cámara no disponible
            </span>
            <span className="max-w-xs text-xs text-slate-warm">
              {mensajeError}
            </span>
          </div>
        )}
      </div>

      {estado === 'escaneando' && (
        <p className="mt-3 text-center text-xs text-slate-warm">
          Apuntá la cámara al código QR del cuadro de la bici.
        </p>
      )}
    </div>
  )
}
