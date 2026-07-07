'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  Bike,
  CheckCircle2,
  Clock,
  Download,
  FileSignature,
  Fingerprint,
  Link2,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Store,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  descargarCertificadoActivo,
  ESTADO_VISUAL,
  etiquetaActivo,
  useActivosGaraje,
  useMiPerfil,
  type ActivoGaraje,
} from '@/lib/garaje-digital'
import { AgregarBicicletaForm } from './garaje'
import { BiciSaludBot } from './BiciSaludBot'
import { InsigniasUsuario } from './InsigniasUsuario'
import { ProgramaEmbajadores } from './ProgramaEmbajadores'
import { SeguroDinamico } from './SeguroDinamico'
import { ArmaTuSalida } from './ArmaTuSalida'
import { MisSalidas } from './MisSalidas'
import { PushNotificaciones } from './PushNotificaciones'
import { clearSession, getSession } from '@/lib/session'
import { BiciSeguraShare } from './BiciSeguraShare'
import { SolicitarVerificacionModal } from './solicitar-verificacion-modal'
import { DenunciaMpfModal } from './denuncia-mpf-modal'

/**
 * "Mi Garaje Digital" — Hito 14: el hub central del usuario.
 *
 * Dashboard de gestion de activos: muestra cada bici con su estado consolidado
 * (CIT, huella anclada en la BFA, pipeline de 72hs y actas firmadas) en tarjetas
 * con estados claros y acciones directas. El estado se refresca en tiempo real
 * (polling optimizado): apenas el CIT pasa a APROBADO o BLOQUEADO, la UI lo
 * refleja y avisa al usuario.
 *
 * Identidad visual 'Bianco Sport': papel calido, tinta casi negra y acento lima.
 */
export function GarajeDigital() {
  const sesion = typeof window !== "undefined" ? getSession() : null
  if (typeof window !== "undefined" && !sesion) {
    window.location.replace("/ingresar?next=/garaje")
    return null
  }
  const { data, error, isLoading, mutate } = useActivosGaraje()
  const { data: perfil } = useMiPerfil()
  const [verificar, setVerificar] = useState<ActivoGaraje | null>(null)
  const [denunciar, setDenunciar] = useState<ActivoGaraje | null>(null)
  const [agregando, setAgregando] = useState(false)

  const activos = data?.activos ?? null
  const lista = activos ?? []
  const hayVerificada = lista.some((a) => a.estado === 'verificado')

  // ── Real-time: avisar cuando un activo cambia de estado en el pipeline ──
  const previo = useRef<Map<string, string>>(new Map())
  useEffect(() => {
    if (!activos) return
    const anterior = previo.current
    for (const a of activos) {
      const antes = anterior.get(a.id)
      if (antes && antes !== a.estado) {
        if (a.estado === 'verificado') {
          toast.success('¡Identidad verificada!', {
            description: `${etiquetaActivo(a)} ya tiene su CIT activo. Podés descargar el certificado y publicarla.`,
          })
        } else if (a.estado === 'bloqueado') {
          toast.error('Bicicleta bloqueada', {
            description: `${etiquetaActivo(a)} quedó bloqueada tras el control de seguridad.`,
          })
        }
      }
    }
    previo.current = new Map(activos.map((a) => [a.id, a.estado]))
  }, [activos])

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-clay">
            Tu garaje digital
          </span>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-ink">
            Mi Garaje
          </h1>
          <p className="mt-2 max-w-lg text-sm text-slate-warm">
            El estado de cada rodado, en vivo: identidad (CIT), anclaje en la
            Blockchain Federal Argentina, actas firmadas y publicaciones.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data?.hayPendientes && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-700">
              <Loader2 className="size-3.5 animate-spin" />
              Actualizando en vivo
            </span>
          )}
          {!agregando && (
            <button
              onClick={() => setAgregando(true)}
              className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
            >
              <Plus className="size-4 text-lime" />
              Agregar bicicleta
            </button>
          )}
        </div>
      </div>

      {/* Sello Gubernamental (Hito 9) — identidad verificada con el Estado. */}
      {perfil?.selloGubernamental && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setAgregando(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-xs font-semibold text-paper transition-colors hover:bg-ink-soft"
          >
            <Plus className="size-3.5 text-lime" />
            Agregar bicicleta
          </button>
          <ArmaTuSalida />
          <a
            href={`https://wa.me/?text=${encodeURIComponent('Te invito a verificar tu bici en RODAID - la plataforma que diseñamos para la mejor seguridad en la comunidad de ciclistas de Mendoza. Registrate gratis: https://rodaid.net')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-white px-4 py-2 text-xs font-semibold text-ink hover:border-ink/40"
          >
            Invitar ciclistas
          </a>
          <button
            type="button"
            onClick={() => { clearSession(); window.location.href = "/" }}
            className="inline-flex items-center gap-1.5 rounded-full border border-clay/30 bg-clay/5 px-4 py-2 text-xs font-semibold text-clay hover:bg-clay/10"
          >
            Cerrar sesión
          </button>
        </div>
        <div className="mt-4 mb-2 flex justify-end">
          <button type="button" onClick={() => { clearSession(); window.location.href = "/" }} className="inline-flex items-center gap-2 rounded-full border border-clay/30 bg-clay/5 px-3 py-1.5 text-xs font-semibold text-clay hover:bg-clay/10">Cerrar sesion</button>
        </div>
        <div className="mb-6 flex justify-center">
      </div>
      <PushNotificaciones />
          <MisSalidas />
          <ProgramaEmbajadores
        usuarioId={perfil?.id ?? ""}
        nombreUsuario={perfil?.nombre ?? perfil?.email ?? ""}
        nivel="Ciclista"
        referidosActivos={0}
      />
      <InsigniasUsuario
        tieneCit={activos?.some(a => a.codigoCit) ?? false}
        citActivo={activos?.some(a => a.estado === "verificado") ?? false}
        stravaConectado={false}
        kmTotales={0}
        tienePublicacion={false}
        denunciasRegistradas={0}
      />
      {agregando && (
        <AgregarBicicletaForm
          onCancel={() => setAgregando(false)}
          onCreada={() => {
            setAgregando(false)
            mutate()
          }}
        />
      )}

      <div className="mt-8">
        {isLoading && !activos ? (
          <GarajeSkeleton />
        ) : error ? (
          <div className="rounded-3xl border border-clay/30 bg-clay/5 px-6 py-14 text-center">
            <h3 className="font-display text-xl font-bold text-ink">
              No pudimos cargar tu garaje
            </h3>
            <button
              onClick={() => mutate()}
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
            >
              <RefreshCw className="size-4" />
              Reintentar
            </button>
          </div>
        ) : lista.length === 0 ? (
          <div className="flex flex-col items-center rounded-3xl border border-dashed border-ink/20 bg-white/50 px-6 py-16 text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-lime/20 text-ink">
              <Bike className="size-8" />
            </span>
            <h3 className="mt-5 font-display text-2xl font-bold text-ink">
              Tu garaje está vacío
            </h3>
            <p className="mt-2 max-w-sm text-sm text-slate-warm">
              Agregá tu primera bicicleta para verificar su identidad y
              publicarla.
            </p>
            <button
              onClick={() => setAgregando(true)}
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
            >
              <Plus className="size-4 text-lime" />
              Agregar bicicleta
            </button>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {lista.map((a) => (
              <ActivoCard
                key={a.id}
                activo={a}
                onVerificar={() => setVerificar(a)}
                puedeDenunciar={true}
                onDenunciar={() => setDenunciar(a)}
              />
            ))}
          </ul>
        )}
      </div>

      <SolicitarVerificacionModal
        bici={verificar}
        open={verificar !== null}
        onOpenChange={(o) => !o && setVerificar(null)}
        onVerificada={() => mutate()}
        esRenovacion={verificar?.estado === 'vencido'}
      />

      <DenunciaMpfModal
        bici={denunciar}
        open={denunciar !== null}
        onOpenChange={(o) => !o && setDenunciar(null)}
        onDenunciada={() => mutate()}
      />
    </section>
  )
}

// ── Tarjeta de activo ──────────────────────────────────────────────────────

function ActivoCard({
  activo,
  onVerificar,
  puedeDenunciar,
  onDenunciar,
}: {
  activo: ActivoGaraje
  onVerificar: () => void
  puedeDenunciar: boolean
  onDenunciar: () => void
}) {
  const visual = ESTADO_VISUAL[activo.estado]
  const specs = [
    activo.tipo,
    activo.rodado ? `R${activo.rodado}` : null,
    activo.talleCuadro,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <li
      className={`flex flex-col rounded-3xl border bg-white p-5 ${visual.acento}`}
    >
      <div className="flex items-start gap-4">
        <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-paper-dim text-ink/30">
          {activo.fotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={activo.fotoUrl}
              alt={etiquetaActivo(activo)}
              className="h-full w-full object-cover"
            />
          ) : (
            <Bike className="size-7" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate font-display text-lg font-bold text-ink">
              {etiquetaActivo(activo)}
            </p>
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${visual.badge}`}
            >
              <EstadoIcono estado={activo.estado} />
              {visual.label}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-warm">
            {[specs, `N° ${activo.numeroSerie}`].filter(Boolean).join(' · ')}
          </p>
          {activo.codigoCit && (
            <p className="mt-1 font-mono text-[11px] text-slate-warm">
              {activo.codigoCit}
            </p>
          )}
        </div>
      </div>

      {/* Pipeline en vivo (72hs) */}
      {activo.estado === 'pendiente' && <PipelineEstado activo={activo} />}

      {/* Aviso de bloqueo */}
      {activo.estado === 'bloqueado' && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl bg-clay/8 px-3.5 py-3 text-xs text-clay">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            Esta bicicleta figura bloqueada por el control de seguridad. No
            podés publicarla hasta resolver su situación.
          </span>
        </div>
      )}

      {/* Anclaje BFA */}
      {activo.bfa && activo.hashSha256 && <AnclajeBfaBloque activo={activo} />}

      {/* Actas firmadas */}
      {activo.actas.length > 0 && <ActasBloque activo={activo} />}

      {/* Acciones directas */}
      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        {activo.estado === 'verificado' && (
          <DescargarCertificadoButton activo={activo} />
        )}

        {(activo.estado === 'sin_verificar' ||
          activo.estado === 'vencido' ||
          activo.estado === 'rechazado') && (
          <button
            onClick={onVerificar}
            className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3.5 py-2 text-xs font-semibold text-ink transition-colors hover:border-ink/40"
          >
            <Fingerprint className="size-3.5" />
            {activo.estado === 'vencido' ? 'Renovar CIT' : 'Verificar identidad'}
          </button>
        )}

        {/* Verificar Estado (Hito 7) — verificador público por serial */}
        {activo.estado !== 'sin_verificar' && (
          <Link
            href={`/verificar/${encodeURIComponent(activo.numeroSerie)}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3.5 py-2 text-xs font-semibold text-ink transition-colors hover:border-ink/40"
          >
            <ShieldCheck className="size-3.5" />
            Verificar estado
          </Link>
        )}

        {/* Publicar / Ver publicación */}
        {activo.estado === 'verificado' &&
          (activo.tienePublicacionActiva && activo.publicacionSlug ? (
            <Link
              href={`/marketplace/${activo.publicacionSlug}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3.5 py-2 text-xs font-semibold text-ink transition-colors hover:border-ink/40"
            >
              <Store className="size-3.5" />
              Ver publicación
            </Link>
          ) : (
            <Link
              href="/publicar"
              className="inline-flex items-center gap-1.5 rounded-full bg-lime px-3.5 py-2 text-xs font-semibold text-ink transition-colors hover:bg-lime-deep"
            >
              <Store className="size-3.5" />
              Publicar en Marketplace
            </Link>
          ))}

        {/* Denuncia ciudadana (Hito 18) — solo para identidad gubernamental (MxM)
            y bicis con identidad que no estén ya bloqueadas. */}
        {puedeDenunciar &&
          (activo.estado === 'verificado' ||
            activo.estado === 'pendiente' ||
            activo.estado === 'vencido') && (
            <button
              onClick={onDenunciar}
              className="inline-flex items-center gap-1.5 rounded-full border border-clay/40 bg-clay/5 px-3.5 py-2 text-xs font-semibold text-clay transition-colors hover:bg-clay/10"
            >
              <ShieldAlert className="size-3.5" />
              Denunciar robo
            </button>
          )}
      </div>
    </li>
  )
}

function EstadoIcono({ estado }: { estado: ActivoGaraje['estado'] }) {
  if (estado === 'verificado') return <CheckCircle2 className="size-3" />
  if (estado === 'bloqueado' || estado === 'rechazado')
    return <Lock className="size-3" />
  if (estado === 'pendiente') return <Clock className="size-3" />
  return null
}

/**
 * Estado en vivo del pipeline de validacion de 72hs. Muestra una barra de
 * progreso temporal hacia `ejecutarEn` (fin de la ventana) — la UI se refresca
 * sola por el polling del hook.
 */
function PipelineEstado({ activo }: { activo: ActivoGaraje }) {
  const job = activo.pipeline
  const ejecutar = job?.ejecutarEn ? new Date(job.ejecutarEn).getTime() : null
  const creado = job?.creadoEn ? new Date(job.creadoEn).getTime() : null
  const ahora = Date.now()

  let progreso = 0
  let restante = ''
  if (ejecutar && creado && ejecutar > creado) {
    progreso = Math.min(
      100,
      Math.max(0, ((ahora - creado) / (ejecutar - creado)) * 100)
    )
    const ms = ejecutar - ahora
    if (ms <= 0) {
      restante = 'Procesando el veredicto…'
    } else {
      const horas = Math.floor(ms / 3_600_000)
      const min = Math.floor((ms % 3_600_000) / 60_000)
      restante =
        horas > 0 ? `Veredicto en ~${horas}h ${min}m` : `Veredicto en ~${min}m`
    }
  } else {
    progreso = 50
    restante = 'En el control de 72 horas'
  }

  return (
    <div className="mt-4 rounded-2xl bg-amber-50 px-3.5 py-3">
      <div className="flex items-center justify-between text-xs font-semibold text-amber-700">
        <span className="inline-flex items-center gap-1.5">
          <Loader2 className="size-3.5 animate-spin" />
          Validación en curso
        </span>
        <span>{restante}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-amber-200/60">
        <div
          className="h-full rounded-full bg-amber-500 transition-all duration-700"
          style={{ width: `${progreso}%` }}
        />
      </div>
    </div>
  )
}

function AnclajeBfaBloque({ activo }: { activo: ActivoGaraje }) {
  const bfa = activo.bfa!
  const anclado = bfa.estado === 'anclado'
  const hashCorto = activo.hashSha256
    ? `${activo.hashSha256.slice(0, 10)}…${activo.hashSha256.slice(-8)}`
    : null

  return (
    <div className="mt-4 rounded-2xl border border-ink/10 bg-paper/60 px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
          <Link2 className="size-3.5 text-ink/50" />
          Anclaje BFA
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            anclado
              ? 'bg-lime/25 text-ink'
              : 'bg-paper-dim text-slate-warm'
          }`}
        >
          {anclado ? 'Anclado on-chain' : 'Pendiente de anclaje'}
        </span>
      </div>
      {hashCorto && (
        <p className="mt-1.5 break-all font-mono text-[11px] text-slate-warm">
          {hashCorto}
        </p>
      )}
    </div>
  )
}

function ActasBloque({ activo }: { activo: ActivoGaraje }) {
  const acta = activo.actas[0]
  const firmadas = activo.actas.filter((x) => x.firmada).length
  return (
    <div className="mt-4 rounded-2xl border border-ink/10 bg-paper/60 px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
          <FileSignature className="size-3.5 text-ink/50" />
          Actas de inspección
        </span>
        <span className="text-[11px] text-slate-warm">
          {firmadas > 0
            ? `${firmadas} firmada${firmadas > 1 ? 's' : ''}`
            : `${activo.actas.length} registrada${activo.actas.length > 1 ? 's' : ''}`}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-slate-warm">
        Última: {acta.resultado === 'APROBADA' ? 'Aprobada' : 'Discrepancia'}
        {acta.tallerNombre ? ` · ${acta.tallerNombre}` : ''}
        {acta.firmada
          ? ` · firma ${acta.modo === 'real' ? 'oficial' : 'digital'}`
          : ''}
      </p>
    </div>
  )
}

function DescargarCertificadoButton({ activo }: { activo: ActivoGaraje }) {
  const [descargando, setDescargando] = useState(false)
  const onClick = async () => {
    if (descargando) return
    setDescargando(true)
    try {
      await descargarCertificadoActivo(activo)
      toast.success('Certificado generado', {
        description: 'Se descargó el PDF firmado de tu bici.',
      })
    } catch (err) {
      toast.error('No pudimos generar el certificado', {
        description:
          (err as Error).message ?? 'Probá de nuevo en unos instantes.',
      })
    } finally {
      setDescargando(false)
    }
  }
  return (
    <button
      onClick={onClick}
      disabled={descargando}
      className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-xs font-semibold text-paper transition-colors hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-60"
    >
      {descargando ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Download className="size-3.5 text-lime" />
      )}
      {descargando ? 'Generando…' : 'Descargar Certificado'}
    </button>
  )
}

function GarajeSkeleton() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <li
          key={i}
          className="rounded-3xl border border-ink/10 bg-white p-5"
        >
          <div className="flex items-start gap-4">
            <div className="size-16 animate-pulse rounded-2xl bg-paper-dim" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 animate-pulse rounded bg-paper-dim" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-paper-dim" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-paper-dim" />
            </div>
          </div>
          <div className="mt-4 h-12 animate-pulse rounded-2xl bg-paper-dim" />
          <div className="mt-4 flex gap-2">
            <div className="h-8 w-32 animate-pulse rounded-full bg-paper-dim" />
            <div className="h-8 w-28 animate-pulse rounded-full bg-paper-dim" />
          </div>
        </li>
      ))}
    </ul>
  )
}
