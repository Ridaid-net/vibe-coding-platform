'use client'

// ─── RODAID · <QRScannerVerificador /> ────────────────────────────────────
//
// Lector de QR del Verificador Público (Tarea 6). Activa la cámara del
// dispositivo, decodifica el QR con jsqr, extrae el número de serie y consulta
// GET /api/v1/verificar/[serial]. Renderiza el panel de resultados con el badge
// de color correspondiente al estado canónico.
//
// Colores de badge requeridos:
//   · ACTIVO    → #166534 (verde)
//   · BLOQUEADO → #991B1B (rojo)
//
// Incluye entrada manual de serial como alternativa a la cámara (escritorio sin
// webcam, permisos denegados, etc.).

import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

// ── Tipos mínimos de la respuesta del endpoint ─────────────────────────────
type Estado =
  | 'ACTIVO'
  | 'EXPIRADO'
  | 'BLOQUEADO'
  | 'RECHAZADO'
  | 'PENDIENTE'
  | 'NO_ENCONTRADO'

interface Verificacion {
  serial: string
  numeroCIT?: string
  encontrado: boolean
  estado: Estado
  estadoLabel: string
  vigente: boolean | null
  bicicleta?: { marca: string; modelo: string; anio: number; tipo: string; color: string }
  inspeccion?: { resultado: string; puntos: number; maximo: number; porcentaje: number; fechaVencimiento: string }
  propietario?: { nombre: string; dni: string }
  inspector?: { nombre: string; apellido: string; taller: string; localidad: string }
  blockchain: {
    red: string
    indexado: boolean
    tokenId?: number
    txHash?: string
    estado: string
    bloqueado: boolean
    transferencias: number
    validacion: { valido: boolean; contrato: string; disponible: boolean }
  }
  selloTemporal: { emitido: boolean; codigoVerif?: string; modoLabel?: string }
  firmaDigital: { firmado: boolean; certSubject?: string }
  alertas: Array<{ tipo: string; mensaje: string }>
}

// ── Paleta por estado ───────────────────────────────────────────────────────
const COLOR_ESTADO: Record<Estado, string> = {
  ACTIVO: '#166534',
  BLOQUEADO: '#991B1B',
  RECHAZADO: '#991B1B',
  EXPIRADO: '#92400E',
  PENDIENTE: '#854D0E',
  NO_ENCONTRADO: '#374151',
}

/** Extrae el serial del contenido del QR. Acepta una URL .../verificar/SERIAL
 *  o el serial en texto plano. */
function extraerSerial(texto: string): string {
  const limpio = texto.trim()
  const match = limpio.match(/verificar\/([^/?#\s]+)/i)
  if (match) return decodeURIComponent(match[1]).toUpperCase()
  return limpio.toUpperCase()
}

export function QRScannerVerificador() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)

  const [escaneando, setEscaneando] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultado, setResultado] = useState<Verificacion | null>(null)
  const [manual, setManual] = useState('')

  const detenerCamara = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setEscaneando(false)
  }, [])

  const consultar = useCallback(
    async (serial: string) => {
      const s = serial.trim().toUpperCase()
      if (!s) return
      detenerCamara()
      setCargando(true)
      setError(null)
      setResultado(null)
      try {
        const res = await fetch(`/api/v1/verificar/${encodeURIComponent(s)}`)
        const data = (await res.json()) as Verificacion
        setResultado(data)
      } catch {
        setError('No se pudo consultar el verificador. Reintentá en unos segundos.')
      } finally {
        setCargando(false)
      }
    },
    [detenerCamara]
  )

  // Bucle de escaneo: lee frames del <video>, los pasa por jsqr.
  const escanearFrame = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(escanearFrame)
      return
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert',
    })
    if (code && code.data) {
      void consultar(extraerSerial(code.data))
      return
    }
    rafRef.current = requestAnimationFrame(escanearFrame)
  }, [consultar])

  const iniciarCamara = useCallback(async () => {
    setError(null)
    setResultado(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      streamRef.current = stream
      setEscaneando(true)
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        await video.play()
        rafRef.current = requestAnimationFrame(escanearFrame)
      }
    } catch {
      setEscaneando(false)
      setError(
        'No se pudo acceder a la cámara. Revisá los permisos o usá la búsqueda manual.'
      )
    }
  }, [escanearFrame])

  // Limpieza al desmontar.
  useEffect(() => detenerCamara, [detenerCamara])

  const color = resultado ? COLOR_ESTADO[resultado.estado] ?? '#374151' : '#374151'

  return (
    <div className="mx-auto w-full max-w-xl space-y-4 p-4">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold">Verificador RODAID</h2>
        <p className="text-sm text-muted-foreground">
          Escaneá el QR del Certificado de Inspección Técnica (CIT) o ingresá el
          número de serie para verificar su estado.
        </p>
      </header>

      {/* Cámara / escáner */}
      <div className="overflow-hidden rounded-lg border bg-black/90">
        <div className="relative aspect-video w-full">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            muted
            playsInline
          />
          {!escaneando && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
              Cámara apagada
            </div>
          )}
          {escaneando && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-48 w-48 rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
          )}
        </div>
      </div>
      <canvas ref={canvasRef} className="hidden" />

      <div className="flex flex-wrap gap-2">
        {!escaneando ? (
          <button
            onClick={iniciarCamara}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Activar cámara
          </button>
        ) : (
          <button
            onClick={detenerCamara}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Detener
          </button>
        )}
      </div>

      {/* Búsqueda manual */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void consultar(manual)
        }}
        className="flex gap-2"
      >
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Ej: RODAID-MZA-0001"
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          aria-label="Número de serie"
        />
        <button
          type="submit"
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          Verificar
        </button>
      </form>

      {cargando && (
        <p className="text-sm text-muted-foreground">Consultando verificador…</p>
      )}
      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {/* Panel de resultados */}
      {resultado && (
        <section className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Serial {resultado.serial}
              </p>
              {resultado.numeroCIT && (
                <p className="text-xs text-muted-foreground">{resultado.numeroCIT}</p>
              )}
            </div>
            <span
              className="inline-flex items-center rounded-md px-3 py-1 text-sm font-semibold text-white"
              style={{ backgroundColor: color }}
            >
              {resultado.estado}
            </span>
          </div>

          <p className="text-sm font-medium" style={{ color }}>
            {resultado.estadoLabel}
          </p>

          {resultado.alertas.length > 0 && (
            <ul className="space-y-1">
              {resultado.alertas.map((a, i) => (
                <li
                  key={i}
                  className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
                >
                  ⚠ {a.mensaje}
                </li>
              ))}
            </ul>
          )}

          {resultado.encontrado && resultado.bicicleta && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Dato label="Bicicleta">
                {resultado.bicicleta.marca} {resultado.bicicleta.modelo} ·{' '}
                {resultado.bicicleta.anio}
              </Dato>
              <Dato label="Tipo / Color">
                {resultado.bicicleta.tipo} · {resultado.bicicleta.color}
              </Dato>
              {resultado.propietario && (
                <Dato label="Propietario">
                  {resultado.propietario.nombre} · DNI {resultado.propietario.dni}
                </Dato>
              )}
              {resultado.inspeccion && (
                <Dato label="Inspección">
                  {resultado.inspeccion.puntos}/{resultado.inspeccion.maximo} (
                  {resultado.inspeccion.porcentaje}%)
                </Dato>
              )}
              {resultado.inspector && (
                <Dato label="Inspector">
                  {resultado.inspector.nombre} {resultado.inspector.apellido} —{' '}
                  {resultado.inspector.taller}
                </Dato>
              )}
            </dl>
          )}

          {/* Bloque Blockchain BFA (siempre presente, resiliente) */}
          <div className="rounded-md bg-muted/40 p-3 text-xs">
            <p className="mb-1 font-semibold">{resultado.blockchain.red}</p>
            <div className="grid grid-cols-2 gap-1 text-muted-foreground">
              <span>Estado: {resultado.blockchain.estado}</span>
              <span>
                Validación:{' '}
                {resultado.blockchain.validacion.disponible
                  ? resultado.blockchain.validacion.valido
                    ? '✓ íntegro'
                    : '✗ no válido'
                  : 'no disponible'}
              </span>
              {resultado.blockchain.tokenId != null && (
                <span>Token #{resultado.blockchain.tokenId}</span>
              )}
              <span>Transferencias: {resultado.blockchain.transferencias}</span>
              {resultado.blockchain.txHash && (
                <span className="col-span-2 truncate font-mono">
                  tx {resultado.blockchain.txHash}…
                </span>
              )}
            </div>
          </div>

          {(resultado.selloTemporal.emitido || resultado.firmaDigital.firmado) && (
            <div className="grid grid-cols-1 gap-1 text-xs text-muted-foreground">
              {resultado.selloTemporal.emitido && (
                <span>
                  Sello temporal: {resultado.selloTemporal.codigoVerif} ·{' '}
                  {resultado.selloTemporal.modoLabel}
                </span>
              )}
              {resultado.firmaDigital.firmado && (
                <span>Firma digital: {resultado.firmaDigital.certSubject}</span>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  )
}

export default QRScannerVerificador
