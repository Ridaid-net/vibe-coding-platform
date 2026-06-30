'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  BatteryLow,
  Bike,
  Copy,
  Gauge,
  Loader2,
  MapPin,
  Plus,
  Radio,
  ShieldAlert,
  Siren,
  Sparkles,
  Trash2,
  Wrench,
} from 'lucide-react'
import { toast } from 'sonner'
import { useActivosGaraje } from '@/lib/garaje-digital'
import {
  actualizarDispositivo,
  actualizarGeovalla,
  analizarMantenimiento,
  crearGeovalla,
  eliminarGeovalla,
  reconocerAlertaIot,
  reportarRoboEnCurso,
  vincularDispositivo,
  useAlertasIot,
  useDispositivosIot,
  useGeovallas,
  useUbicacionTiempoReal,
  SEVERIDAD_VISUAL,
  TIPO_ALERTA_LABEL,
  type AlertaIot,
  type AnalisisMantenimiento,
  type DispositivoIot,
} from '@/lib/iot'
import { cargarLeaflet } from '@/lib/leaflet'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * "Ubicación en Tiempo Real" — Hito 17: RODAID-IoT.
 *
 * Capa de telemetria del Garaje Digital. Solo visible para el propietario y la
 * ubicacion precisa solo se muestra si el sensor esta ACTIVO (opt-in expreso del
 * usuario). Incluye: gestion de dispositivos, mapa en vivo, geovallas (zonas
 * seguras), mantenimiento predictivo con IA, reporte de robo en curso y el
 * historial de alertas. Identidad 'Bianco Sport'.
 */
export function IotTiempoReal() {
  const { data, isLoading, mutate } = useDispositivosIot()
  const { data: alertasData, mutate: mutarAlertas } = useAlertasIot()
  const [vinculando, setVinculando] = useState(false)

  const dispositivos = data?.dispositivos ?? []
  const alertas = alertasData?.alertas ?? []

  return (
    <section className="mt-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-clay">
            RODAID-IoT
          </span>
          <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-ink">
            Ubicación en tiempo real
          </h2>
          <p className="mt-2 max-w-lg text-sm text-slate-warm">
            Seguimiento en vivo y mantenimiento predictivo de tus bicis conectadas.
            Solo vos ves la ubicación, y solo cuando activás la transmisión. La
            telemetría viaja cifrada de extremo a extremo.
          </p>
        </div>
        {!vinculando && (
          <button
            onClick={() => setVinculando(true)}
            className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
          >
            <Plus className="size-4 text-lime" />
            Vincular sensor
          </button>
        )}
      </div>

      {vinculando && (
        <VincularSensor
          dispositivos={dispositivos}
          onClose={() => setVinculando(false)}
          onVinculado={() => {
            setVinculando(false)
            mutate()
          }}
        />
      )}

      <div className="mt-6">
        {isLoading && !data ? (
          <div className="rounded-3xl border border-ink/10 bg-white p-6">
            <div className="h-5 w-40 animate-pulse rounded bg-paper-dim" />
            <div className="mt-4 h-40 animate-pulse rounded-2xl bg-paper-dim" />
          </div>
        ) : dispositivos.length === 0 && !vinculando ? (
          <div className="flex flex-col items-center rounded-3xl border border-dashed border-ink/20 bg-white/50 px-6 py-14 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-lime/20 text-ink">
              <Radio className="size-7" />
            </span>
            <h3 className="mt-4 font-display text-xl font-bold text-ink">
              Conectá tu primera bici
            </h3>
            <p className="mt-2 max-w-sm text-sm text-slate-warm">
              Vinculá un sensor GPS/IoT a una bicicleta verificada para activar el
              seguimiento en tiempo real y el mantenimiento predictivo.
            </p>
          </div>
        ) : (
          <ul className="space-y-4">
            {dispositivos.map((d) => (
              <DispositivoCard
                key={d.id}
                dispositivo={d}
                onCambio={() => {
                  mutate()
                  mutarAlertas()
                }}
              />
            ))}
          </ul>
        )}
      </div>

      <AlertasIotPanel alertas={alertas} onCambio={() => mutarAlertas()} />
    </section>
  )
}

// ── Vincular un sensor a una bici ──────────────────────────────────────────────

function VincularSensor({
  dispositivos,
  onClose,
  onVinculado,
}: {
  dispositivos: DispositivoIot[]
  onClose: () => void
  onVinculado: () => void
}) {
  const { data } = useActivosGaraje()
  const yaVinculadas = new Set(dispositivos.map((d) => d.bicicletaId))
  const disponibles = (data?.activos ?? []).filter(
    (a) => !yaVinculadas.has(a.id)
  )

  const [biciId, setBiciId] = useState('')
  const [nombre, setNombre] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [credenciales, setCredenciales] = useState<{
    deviceUid: string
    deviceSecret: string
  } | null>(null)

  const onSubmit = async () => {
    if (!biciId) {
      toast.error('Elegí la bicicleta a conectar.')
      return
    }
    setEnviando(true)
    try {
      const res = await vincularDispositivo({
        bicicletaId: biciId,
        nombre: nombre.trim() || undefined,
      })
      setCredenciales({
        deviceUid: res.deviceUid,
        deviceSecret: res.deviceSecret,
      })
      toast.success('Sensor vinculado', {
        description: 'Guardá las credenciales: el secreto se muestra una sola vez.',
      })
      onVinculado()
    } catch (err) {
      toast.error('No pudimos vincular el sensor', {
        description: (err as Error).message,
      })
    } finally {
      setEnviando(false)
    }
  }

  if (credenciales) {
    return (
      <div className="mt-6 rounded-3xl border border-lime-deep/40 bg-lime/10 p-5">
        <h3 className="font-display text-lg font-bold text-ink">
          Credenciales del dispositivo
        </h3>
        <p className="mt-1 text-sm text-slate-warm">
          Cargá estas credenciales en tu sensor. El <strong>secreto</strong> se
          muestra una sola vez y no se puede recuperar.
        </p>
        <CampoCopiable etiqueta="Device UID" valor={credenciales.deviceUid} />
        <CampoCopiable
          etiqueta="Device Secret"
          valor={credenciales.deviceSecret}
        />
        <button
          onClick={onClose}
          className="mt-4 inline-flex items-center rounded-full bg-ink px-5 py-2 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
        >
          Listo, las guardé
        </button>
      </div>
    )
  }

  return (
    <div className="mt-6 rounded-3xl border border-ink/12 bg-white p-5">
      <h3 className="font-display text-lg font-bold text-ink">
        Vincular un sensor IoT
      </h3>
      {disponibles.length === 0 ? (
        <p className="mt-2 text-sm text-slate-warm">
          Todas tus bicis ya tienen un sensor vinculado, o todavía no agregaste
          ninguna. Agregá una bici en tu garaje para conectarla.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="text-xs font-semibold text-ink">Bicicleta</span>
            <select
              value={biciId}
              onChange={(e) => setBiciId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm text-ink"
            >
              <option value="">Elegí una bici…</option>
              {disponibles.map((a) => (
                <option key={a.id} value={a.id}>
                  {[a.marca, a.modelo].filter(Boolean).join(' ')} · N° {a.numeroSerie}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-ink">
              Nombre del sensor (opcional)
            </span>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Sensor de telemetría"
              className="mt-1 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm text-ink"
            />
          </label>
        </div>
      )}
      <div className="mt-5 flex gap-2">
        {disponibles.length > 0 && (
          <button
            onClick={onSubmit}
            disabled={enviando}
            className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft disabled:opacity-60"
          >
            {enviando ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Radio className="size-4 text-lime" />
            )}
            Vincular
          </button>
        )}
        <button
          onClick={onClose}
          className="inline-flex items-center rounded-full border border-ink/15 bg-white px-5 py-2 text-sm font-semibold text-ink transition-colors hover:border-ink/40"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}

function CampoCopiable({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="mt-3">
      <span className="text-xs font-semibold text-ink">{etiqueta}</span>
      <div className="mt-1 flex items-center gap-2 rounded-xl border border-ink/15 bg-paper px-3 py-2">
        <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-ink">
          {valor}
        </code>
        <button
          onClick={() => {
            navigator.clipboard.writeText(valor).then(
              () => toast.success('Copiado'),
              () => toast.error('No se pudo copiar')
            )
          }}
          className="shrink-0 rounded-lg p-1.5 text-ink/60 transition-colors hover:bg-ink/5 hover:text-ink"
          aria-label={`Copiar ${etiqueta}`}
        >
          <Copy className="size-4" />
        </button>
      </div>
    </div>
  )
}

// ── Tarjeta de dispositivo ──────────────────────────────────────────────────

function DispositivoCard({
  dispositivo,
  onCambio,
}: {
  dispositivo: DispositivoIot
  onCambio: () => void
}) {
  const [toggling, setToggling] = useState(false)
  const activa = dispositivo.transmisionActiva
  const { data: ubic } = useUbicacionTiempoReal(dispositivo.bicicletaId, activa)
  const ubicacion = ubic?.ubicacion ?? null

  const toggleTransmision = async () => {
    setToggling(true)
    try {
      await actualizarDispositivo(dispositivo.id, { transmisionActiva: !activa })
      onCambio()
      toast.success(
        !activa ? 'Transmisión activada' : 'Transmisión pausada',
        {
          description: !activa
            ? 'Tu bici comparte su ubicación en tiempo real (solo con vos).'
            : 'Dejamos de seguir la ubicación de tu bici.',
        }
      )
    } catch (err) {
      toast.error('No pudimos cambiar la transmisión', {
        description: (err as Error).message,
      })
    } finally {
      setToggling(false)
    }
  }

  const nombreBici =
    [dispositivo.bici.marca, dispositivo.bici.modelo].filter(Boolean).join(' ') ||
    'Bicicleta'

  return (
    <li className="rounded-3xl border border-ink/12 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-paper-dim text-ink/40">
            <Bike className="size-6" />
          </span>
          <div>
            <p className="font-display text-lg font-bold text-ink">{nombreBici}</p>
            <p className="text-xs text-slate-warm">
              {dispositivo.nombre} · N° {dispositivo.bici.numeroSerie}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <EstadoConexion dispositivo={dispositivo} />
              {dispositivo.nivelBateria != null && (
                <span className="inline-flex items-center gap-1 rounded-full bg-paper-dim px-2 py-0.5 text-[11px] font-semibold text-slate-warm">
                  {dispositivo.nivelBateria <= 15 ? (
                    <BatteryLow className="size-3.5 text-clay" />
                  ) : (
                    <Gauge className="size-3.5" />
                  )}
                  {dispositivo.nivelBateria}%
                </span>
              )}
              {dispositivo.modoBajoConsumo && (
                <span className="inline-flex items-center gap-1 rounded-full bg-lime/20 px-2 py-0.5 text-[11px] font-semibold text-ink">
                  Bajo consumo
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          onClick={toggleTransmision}
          disabled={toggling}
          className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
            activa
              ? 'bg-clay/15 text-clay hover:bg-clay/25'
              : 'bg-ink text-paper hover:bg-ink-soft'
          }`}
        >
          {toggling ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Radio className="size-4" />
          )}
          {activa ? 'Pausar transmisión' : 'Activar transmisión'}
        </button>
      </div>

      {/* Mapa en vivo: solo si la transmision esta activa. */}
      {activa ? (
        <MapaTiempoReal
          bicicletaId={dispositivo.bicicletaId}
          lat={ubicacion?.posicion?.lat ?? null}
          lng={ubicacion?.posicion?.lng ?? null}
          conectado={Boolean(ubicacion?.conectado)}
          velocidad={ubicacion?.velocidadKmh ?? null}
          ts={ubicacion?.ts ?? null}
        />
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-ink/15 bg-paper/60 px-4 py-6 text-center text-sm text-slate-warm">
          La ubicación en tiempo real está apagada. Activá la transmisión para
          ver tu bici en el mapa.
        </div>
      )}

      <GeovallasPanel bicicletaId={dispositivo.bicicletaId} ubic={ubicacion} />

      <MantenimientoPanel bicicletaId={dispositivo.bicicletaId} onCambio={onCambio} />

      <RoboEnCurso bicicletaId={dispositivo.bicicletaId} onCambio={onCambio} />
    </li>
  )
}

function EstadoConexion({ dispositivo }: { dispositivo: DispositivoIot }) {
  if (!dispositivo.transmisionActiva) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-paper-dim px-2 py-0.5 text-[11px] font-semibold text-slate-warm">
        Transmisión apagada
      </span>
    )
  }
  return dispositivo.conectado ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-lime/25 px-2 py-0.5 text-[11px] font-semibold text-ink">
      <Activity className="size-3.5 text-lime-deep" />
      Conectada
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
      Sin señal reciente
    </span>
  )
}

// ── Mapa en tiempo real (Leaflet) ──────────────────────────────────────────────

function MapaTiempoReal({
  lat,
  lng,
  conectado,
  velocidad,
  ts,
}: {
  bicicletaId: string
  lat: number | null
  lng: number | null
  conectado: boolean
  velocidad: number | null
  ts: string | null
}) {
  const contenedor = useRef<HTMLDivElement | null>(null)
  const mapaRef = useRef<any>(null)
  const marcadorRef = useRef<any>(null)

  useEffect(() => {
    let cancelado = false
    if (lat == null || lng == null) return
    cargarLeaflet().then((L: any) => {
      if (cancelado || !contenedor.current) return
      if (!mapaRef.current) {
        mapaRef.current = L.map(contenedor.current, {
          zoomControl: true,
          attributionControl: false,
        }).setView([lat, lng], 15)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
        }).addTo(mapaRef.current)
      }
      if (!marcadorRef.current) {
        marcadorRef.current = L.circleMarker([lat, lng], {
          radius: 9,
          color: '#0a7d5a',
          fillColor: '#a3e635',
          fillOpacity: 0.9,
          weight: 3,
        }).addTo(mapaRef.current)
      } else {
        marcadorRef.current.setLatLng([lat, lng])
      }
      mapaRef.current.setView([lat, lng], mapaRef.current.getZoom() || 15)
    })
    return () => {
      cancelado = true
    }
  }, [lat, lng])

  useEffect(() => {
    return () => {
      if (mapaRef.current) {
        mapaRef.current.remove()
        mapaRef.current = null
        marcadorRef.current = null
      }
    }
  }, [])

  if (lat == null || lng == null) {
    return (
      <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-ink/10 bg-paper/60 px-4 py-10 text-sm text-slate-warm">
        <Loader2 className="size-4 animate-spin" />
        Esperando la primera posición del sensor…
      </div>
    )
  }

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-ink/10">
      <div ref={contenedor} className="h-64 w-full" />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink/10 bg-paper/60 px-4 py-2.5 text-xs text-slate-warm">
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="size-3.5 text-clay" />
          {conectado ? 'Posición en vivo' : 'Última posición conocida'}
        </span>
        {velocidad != null && (
          <span className="inline-flex items-center gap-1.5">
            <Gauge className="size-3.5" />
            {velocidad.toFixed(1)} km/h
          </span>
        )}
        {ts && (
          <span>{new Date(ts).toLocaleString('es-AR')}</span>
        )}
      </div>
    </div>
  )
}

// ── Geovallas (zonas seguras) ──────────────────────────────────────────────────

function GeovallasPanel({
  bicicletaId,
  ubic,
}: {
  bicicletaId: string
  ubic: { posicion: { lat: number; lng: number } | null } | null
}) {
  const { data, mutate } = useGeovallas(bicicletaId)
  const [creando, setCreando] = useState(false)
  const [nombre, setNombre] = useState('Casa')
  const [radio, setRadio] = useState(300)
  const [enviando, setEnviando] = useState(false)

  const geovallas = (data?.geovallas ?? []).filter(
    (g) => g.bicicletaId === bicicletaId
  )

  const onCrear = async () => {
    const pos = ubic?.posicion
    if (!pos) {
      toast.error('Necesitamos una posición en vivo', {
        description: 'Activá la transmisión y esperá el primer fix para centrar la zona.',
      })
      return
    }
    setEnviando(true)
    try {
      await crearGeovalla({
        bicicletaId,
        nombre: nombre.trim() || 'Zona segura',
        centerLat: pos.lat,
        centerLng: pos.lng,
        radioM: radio,
      })
      toast.success('Zona segura creada', {
        description: 'Te avisamos si tu bici sale de esta zona sin autorización.',
      })
      setCreando(false)
      mutate()
    } catch (err) {
      toast.error('No pudimos crear la zona', {
        description: (err as Error).message,
      })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-ink/10 bg-paper/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
          <ShieldAlert className="size-4 text-ink/50" />
          Zonas seguras (geovallas)
        </span>
        {!creando && (
          <button
            onClick={() => setCreando(true)}
            className="inline-flex items-center gap-1 rounded-full border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-ink/40"
          >
            <Plus className="size-3.5" />
            Definir aquí
          </button>
        )}
      </div>

      {creando && (
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre (Casa, Trabajo…)"
            className="rounded-xl border border-ink/15 bg-white px-3 py-2 text-sm text-ink"
          />
          <input
            type="number"
            min={25}
            value={radio}
            onChange={(e) => setRadio(Number(e.target.value))}
            className="w-28 rounded-xl border border-ink/15 bg-white px-3 py-2 text-sm text-ink"
            aria-label="Radio en metros"
          />
          <div className="flex gap-2">
            <button
              onClick={onCrear}
              disabled={enviando}
              className="inline-flex items-center gap-1 rounded-full bg-ink px-4 py-2 text-xs font-semibold text-paper transition-colors hover:bg-ink-soft disabled:opacity-60"
            >
              {enviando ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Crear
            </button>
            <button
              onClick={() => setCreando(false)}
              className="rounded-full border border-ink/15 bg-white px-4 py-2 text-xs font-semibold text-ink"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {geovallas.length === 0 ? (
        <p className="mt-2 text-xs text-slate-warm">
          Sin zonas seguras todavía. Definí una con la bici en su lugar habitual
          (casa, trabajo) para recibir alertas si se mueve sin tu permiso.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {geovallas.map((g) => (
            <li
              key={g.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">
                  {g.nombre}
                </p>
                <p className="text-[11px] text-slate-warm">
                  Radio {g.radioM} m ·{' '}
                  {g.activa ? 'Activa' : 'Pausada'}
                  {g.autorizadaSalida ? ' · salida autorizada' : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    await actualizarGeovalla(g.id, {
                      autorizadaSalida: !g.autorizadaSalida,
                    }).catch((e) => toast.error((e as Error).message))
                    mutate()
                  }}
                  className="rounded-full border border-ink/15 bg-white px-3 py-1.5 text-[11px] font-semibold text-ink transition-colors hover:border-ink/40"
                >
                  {g.autorizadaSalida ? 'Revocar salida' : 'Autorizar salida'}
                </button>
                <button
                  onClick={async () => {
                    await eliminarGeovalla(g.id).catch((e) =>
                      toast.error((e as Error).message)
                    )
                    mutate()
                  }}
                  className="rounded-lg p-1.5 text-ink/50 transition-colors hover:bg-clay/10 hover:text-clay"
                  aria-label="Eliminar geovalla"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Mantenimiento predictivo con IA ────────────────────────────────────────────

function MantenimientoPanel({
  bicicletaId,
  onCambio,
}: {
  bicicletaId: string
  onCambio: () => void
}) {
  const [cargando, setCargando] = useState(false)
  const [analisis, setAnalisis] = useState<AnalisisMantenimiento | null>(null)

  const onAnalizar = async () => {
    setCargando(true)
    try {
      const res = await analizarMantenimiento(bicicletaId)
      setAnalisis(res)
      onCambio()
    } catch (err) {
      toast.error('No pudimos analizar el mantenimiento', {
        description: (err as Error).message,
      })
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-ink/10 bg-paper/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Wrench className="size-4 text-ink/50" />
          Mantenimiento predictivo
        </span>
        <button
          onClick={onAnalizar}
          disabled={cargando}
          className="inline-flex items-center gap-1.5 rounded-full bg-lime px-3.5 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-lime-deep disabled:opacity-60"
        >
          {cargando ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          Analizar con IA
        </button>
      </div>

      {analisis && (
        <div className="mt-3">
          {!analisis.tieneDatos || analisis.diagnosticos.length === 0 ? (
            <p className="text-xs text-slate-warm">
              {analisis.nota ??
                'Sin señales de desgaste por ahora. Tu bici está en buen estado según el acelerómetro.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {analisis.diagnosticos.map((d) => (
                <li
                  key={d.componente}
                  className="rounded-xl bg-white px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-ink">
                      {d.componente === 'cadena'
                        ? 'Cadena / transmisión'
                        : d.componente === 'cubiertas'
                          ? 'Presión de cubiertas'
                          : 'Servicio técnico'}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        SEVERIDAD_VISUAL[d.severidad] ?? SEVERIDAD_VISUAL.media
                      }`}
                    >
                      {Math.round(d.probabilidad * 100)}% · {d.severidad}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-warm">{d.recomendacion}</p>
                </li>
              ))}
            </ul>
          )}
          {analisis.muestrasAnalizadas > 0 && (
            <p className="mt-2 text-[11px] text-slate-warm">
              Analizadas {analisis.muestrasAnalizadas} muestras del acelerómetro.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Reporte de robo en curso ────────────────────────────────────────────────

function RoboEnCurso({
  bicicletaId,
  onCambio,
}: {
  bicicletaId: string
  onCambio: () => void
}) {
  const [confirmando, setConfirmando] = useState(false)
  const [enviando, setEnviando] = useState(false)

  const onReportar = async () => {
    setEnviando(true)
    try {
      const res = await reportarRoboEnCurso(bicicletaId, true)
      toast.success('Reporte enviado al Ministerio', {
        description: `Expediente ${res.expediente}. ${
          res.posicionCompartida
            ? 'Compartimos la ubicación en tiempo real.'
            : 'Activá la transmisión para compartir la ubicación.'
        }`,
      })
      setConfirmando(false)
      onCambio()
    } catch (err) {
      toast.error('No pudimos enviar el reporte', {
        description: (err as Error).message,
      })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-clay/30 bg-clay/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-clay">
          <Siren className="size-4" />
          Emergencia: robo en curso
        </span>
        {!confirmando ? (
          <button
            onClick={() => setConfirmando(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-clay px-3.5 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
          >
            Reportar robo
          </button>
        ) : null}
      </div>
      {confirmando && (
        <div className="mt-3">
          <p className="text-xs text-clay">
            Vas a compartir la <strong>ubicación en tiempo real</strong> de tu bici
            con el Ministerio de Seguridad. Solo se hace con tu autorización
            expresa ante la emergencia.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={onReportar}
              disabled={enviando}
              className="inline-flex items-center gap-1.5 rounded-full bg-clay px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {enviando ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Autorizo y reporto
            </button>
            <button
              onClick={() => setConfirmando(false)}
              className="rounded-full border border-ink/15 bg-white px-4 py-2 text-xs font-semibold text-ink"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Historial de alertas IoT ──────────────────────────────────────────────────

function AlertasIotPanel({
  alertas,
  onCambio,
}: {
  alertas: AlertaIot[]
  onCambio: () => void
}) {
  if (alertas.length === 0) return null
  return (
    <div className="mt-6 rounded-3xl border border-ink/12 bg-white p-5">
      <h3 className="font-display text-lg font-bold text-ink">Alertas recientes</h3>
      <ul className="mt-3 space-y-2">
        {alertas.slice(0, 12).map((a) => (
          <li
            key={a.id}
            className={`flex flex-wrap items-start justify-between gap-2 rounded-xl px-3 py-2.5 ${
              a.reconocida ? 'bg-paper/60 opacity-70' : 'bg-paper-dim'
            }`}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    SEVERIDAD_VISUAL[a.severidad] ?? SEVERIDAD_VISUAL.media
                  }`}
                >
                  {TIPO_ALERTA_LABEL[a.tipo] ?? a.tipo}
                </span>
                <span className="text-[11px] text-slate-warm">
                  {new Date(a.creadoEn).toLocaleString('es-AR')}
                </span>
              </div>
              <p className="mt-1 text-sm font-semibold text-ink">{a.titulo}</p>
              <p className="text-xs text-slate-warm">{a.mensaje}</p>
            </div>
            {!a.reconocida && (
              <button
                onClick={async () => {
                  await reconocerAlertaIot(a.id).catch((e) =>
                    toast.error((e as Error).message)
                  )
                  onCambio()
                }}
                className="shrink-0 rounded-full border border-ink/15 bg-white px-3 py-1.5 text-[11px] font-semibold text-ink transition-colors hover:border-ink/40"
              >
                Marcar visto
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
