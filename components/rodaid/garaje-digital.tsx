'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Award,
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
  Siren,
  Store,
  UserCheck,
  Wrench,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { parseApiError } from '@/lib/api-errors'
import {
  activarCompartirBici,
  descargarCertificadoActivo,
  ESTADO_VISUAL,
  etiquetaActivo,
  listarTalleresAprobados,
  reservarCit,
  revocarCompartirBici,
  useActivosGaraje,
  useEstadoCompartir,
  useGemeloDigital,
  useMiPerfil,
  type ActivoGaraje,
  type TallerAprobado,
} from '@/lib/garaje-digital'
import { AgregarBicicletaForm } from './garaje'
import { BiciSaludBot } from './BiciSaludBot'
import { InsigniasUsuario } from './InsigniasUsuario'
import { ProgramaEmbajadores } from './ProgramaEmbajadores'
import { SeguroDinamico } from './SeguroDinamico'
import { ArmaTuSalida } from './ArmaTuSalida'
import { MisSalidas } from './MisSalidas'
import { PushNotificaciones } from './PushNotificaciones'
import { authedFetch, clearSession, getSession } from '@/lib/session'
import { BiciSeguraShare } from './BiciSeguraShare'
import { GemeloDigitalBici } from './GemeloDigitalBici'
import { SolicitarVerificacionModal } from './solicitar-verificacion-modal'
import { DenunciaMpfModal } from './denuncia-mpf-modal'
import { TarjetaSemanal } from './TarjetaSemanal'
import {
  agregarAutorizado,
  editarAutorizado,
  eliminarAutorizado,
  listarAutorizados,
  type Autorizado,
} from '@/lib/autorizados'

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
  const [modoPanico, setModoPanico] = useState<ActivoGaraje | null>(null)
  const [reservar, setReservar] = useState<ActivoGaraje | null>(null)
  const [autorizarUso, setAutorizarUso] = useState<ActivoGaraje | null>(null)
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
        <div className="mt-5 flex items-center gap-3 rounded-2xl border border-[#0a7d5a]/25 bg-[#0a7d5a]/8 px-5 py-3.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#0a7d5a]/15 text-[#0a7d5a]">
            <ShieldCheck className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#0a7d5a]">
              Identidad verificada por Mendoza por Mí
            </p>
            <p className="text-xs text-slate-warm">
              Tu sello gubernamental acelera la confianza de tus operaciones en
              RODAID.
            </p>
          </div>
          <BadgeCheck className="ml-auto hidden size-5 shrink-0 text-[#0a7d5a] sm:block" />
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button
          onClick={() => setAgregando(true)}
          className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-full text-xs font-semibold transition-colors bg-ink text-paper hover:bg-ink-soft"
        >
          <Plus className="size-3.5 text-lime" />
          Agregar bicicleta
        </button>
        <ArmaTuSalida />
        <a
          href={`https://wa.me/?text=${encodeURIComponent('Te invito a verificar tu bici en RODAID - la plataforma que diseñamos para la mejor seguridad en la comunidad de ciclistas de Mendoza. Registrate gratis: https://rodaid.net')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-full text-xs font-semibold transition-colors bg-[#25D366] text-white hover:bg-[#25D366]/80"
        >
          Invitar ciclistas
        </a>
        <button
          type="button"
          onClick={() => { clearSession(); window.location.href = "/" }}
          className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-full text-xs font-semibold transition-colors border border-clay/30 bg-clay/5 text-clay hover:bg-clay/10"
        >
          Cerrar sesión
        </button>
      </div>
      <PushNotificaciones />
          <MisSalidas />
          <TarjetaSemanal />
          <ProgramaEmbajadores
        usuarioId={perfil?.id ?? ""}
        nombreUsuario={perfil?.nombre ?? perfil?.email ?? ""}
        nivel="Ciclista"
        referidosActivos={0}
      />
      <InsigniasUsuario
        tieneCit={activos?.some(a => a.codigoCit) ?? false}
        citActivo={activos?.some(a => a.estado === "verificado") ?? false}
        stravaConectado={data?.stravaConectado ?? false}
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
                onModoPanico={() => setModoPanico(a)}
                onReservarCit={() => setReservar(a)}
                onAutorizarUso={() => setAutorizarUso(a)}
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

      <ModoPanicoStepUp
        bici={modoPanico}
        open={modoPanico !== null}
        onOpenChange={(o) => !o && setModoPanico(null)}
        onConfirmado={() => {
          setDenunciar(modoPanico)
          setModoPanico(null)
        }}
      />

      <ReservarCitModal
        bici={reservar}
        open={reservar !== null}
        onOpenChange={(o) => !o && setReservar(null)}
      />

      <AutorizarUsoModal
        bici={autorizarUso}
        open={autorizarUso !== null}
        onOpenChange={(o) => !o && setAutorizarUso(null)}
      />

      <p className="mt-10 flex items-center justify-center gap-2.5 text-center text-[11px] font-bold uppercase tracking-[0.16em] text-[#2BBCB8]">
        <span className="size-1.5 rounded-full bg-[#F47B20]" />
        Contigo, siempre siempre bien.
        <span className="size-1.5 rounded-full bg-[#F47B20]" />
      </p>
    </section>
  )
}

/**
 * Boton de Panico "Modo Robo" — paso de confirmacion antes de saltar al
 * formulario de denuncia ya existente (DenunciaMpfModal), pre-cargado con la
 * bici. NO es un mecanismo nuevo de bloqueo: el flujo de destino es el mismo
 * de siempre (PDF real del MPF + aprobacion en Moderacion), asi que este
 * paso solo protege el ATAJO en si (que alguien con el telefono desbloqueado
 * no dispare por error/de mala fe el flujo con la identidad de otra persona).
 *
 * Se evaluo reusar el "Re-verificar MFA" del Admin Dashboard
 * (lib/admin-panel.ts) para esto y se descarto: esta scopeado a `rol=admin`
 * con un TOTP ya enrolado, algo que ningun ciclista tiene ni jamas configuro
 * -- exigirlo aca hubiera significado construir un enrolamiento de 2FA nuevo
 * de punta a punta, y la primera vez que un ciclista lo veria seria en medio
 * de un robo real. En su lugar se reusa `verifyPassword()` (el mismo
 * primitivo que ya usa "cambiar contraseña"), vía POST /api/v1/usuario/
 * reautenticar. Las cuentas de Mendoza x Mi no tienen contraseña local
 * (`password_hash IS NULL`) -- para esas, el GET de ese mismo endpoint
 * devuelve `requierePassword: false` y este paso se salta solo, porque su
 * identidad ya viene verificada por el Estado.
 */
function ModoPanicoStepUp({
  bici,
  open,
  onOpenChange,
  onConfirmado,
}: {
  bici: ActivoGaraje | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirmado: () => void
}) {
  const [requierePassword, setRequierePassword] = useState<boolean | null>(null)
  const [password, setPassword] = useState('')
  const [verificando, setVerificando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setRequierePassword(null)
      setPassword('')
      setError(null)
      setVerificando(false)
      return
    }
    let cancelado = false
    authedFetch('/api/v1/usuario/reautenticar')
      .then((r) => r.json())
      .then((data: { requierePassword: boolean }) => {
        if (cancelado) return
        if (!data.requierePassword) {
          onConfirmado()
          return
        }
        setRequierePassword(true)
      })
      .catch(() => {
        // Fail-safe: si no podemos confirmar el estado de la cuenta, pedimos
        // la contraseña igual en vez de saltear el paso de confirmacion.
        if (!cancelado) setRequierePassword(true)
      })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const confirmar = async () => {
    if (!password || verificando) return
    setVerificando(true)
    setError(null)
    try {
      const res = await authedFetch('/api/v1/usuario/reautenticar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) {
        const info = await parseApiError(res)
        setError(info.message)
        return
      }
      onConfirmado()
    } catch {
      setError('No pudimos verificar tu conexión. Probá de nuevo.')
    } finally {
      setVerificando(false)
    }
  }

  if (!bici) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl border border-ink/10 bg-paper">
        <DialogHeader>
          <span className="flex size-12 items-center justify-center rounded-xl bg-clay/15 text-clay">
            <Siren className="size-6" />
          </span>
          <DialogTitle className="font-display text-ink">Modo Robo</DialogTitle>
          <DialogDescription className="text-slate-warm">
            Confirmá que sos vos para continuar con {etiquetaActivo(bici)}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-2xl bg-amber-50 px-3.5 py-3 text-xs text-amber-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            Esto te lleva al formulario de denuncia con tu bici precargada.
            No bloquea tu bici al instante: vas a necesitar subir el PDF real
            de tu denuncia ante el MPF, y un equipo de RODAID tiene que
            aprobarla.
          </span>
        </div>

        {requierePassword === null ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-warm">
            <Loader2 className="size-4 animate-spin" />
            Verificando tu sesión…
          </div>
        ) : (
          <>
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirmar()}
              placeholder="Tu contraseña"
              className="w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-clay/50"
            />
            {error && <p className="text-xs text-clay">{error}</p>}
            <button
              type="button"
              onClick={confirmar}
              disabled={verificando || !password}
              className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-full bg-clay px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-clay/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {verificando ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Verificando…
                </>
              ) : (
                <>
                  <Siren className="size-4" />
                  Confirmar y continuar
                </>
              )}
            </button>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * "Reservar CIT" — reserva simple, sin horario y sin pago: el ciclista elige
 * un Taller Aliado desde su Garaje y el taller lo ve en su panel para
 * contactarlo por fuera del sistema. El tipo de CIT (Express/Completo) se
 * define recien en esa conversacion, no aca.
 */
function ReservarCitModal({
  bici,
  open,
  onOpenChange,
}: {
  bici: ActivoGaraje | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [talleres, setTalleres] = useState<TallerAprobado[] | null>(null)
  const [aliadoId, setAliadoId] = useState<string | null>(null)
  const [nota, setNota] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setTalleres(null)
      setAliadoId(null)
      setNota('')
      setEnviando(false)
      setEnviado(false)
      setError(null)
      return
    }
    listarTalleresAprobados()
      .then(setTalleres)
      .catch(() => setError('No pudimos cargar la lista de talleres. Probá de nuevo.'))
  }, [open])

  const enviar = async () => {
    if (!bici || !aliadoId || enviando) return
    setEnviando(true)
    setError(null)
    try {
      await reservarCit(bici.id, aliadoId, nota)
      setEnviado(true)
    } catch (err) {
      setError((err as Error).message || 'No pudimos enviar la reserva. Probá de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  if (!bici) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl border border-ink/10 bg-paper">
        <DialogHeader>
          <span className="flex size-12 items-center justify-center rounded-xl bg-lime/20 text-ink">
            <Wrench className="size-6" />
          </span>
          <DialogTitle className="font-display text-ink">Reservar CIT</DialogTitle>
          <DialogDescription className="text-slate-warm">
            Elegí un Taller Aliado para certificar {etiquetaActivo(bici)}. Sin
            horario ni pago: el taller te contacta para coordinar.
          </DialogDescription>
        </DialogHeader>

        {enviado ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 className="size-8 text-lime-deep" />
            <p className="text-sm font-semibold text-ink">¡Listo! Le avisamos al taller.</p>
            <p className="text-xs text-slate-warm">
              Te va a contactar para coordinar la certificación.
            </p>
          </div>
        ) : talleres === null ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-warm">
            <Loader2 className="size-4 animate-spin" />
            Cargando talleres…
          </div>
        ) : talleres.length === 0 ? (
          <p className="py-4 text-sm text-slate-warm">
            Todavía no hay talleres aliados aprobados disponibles.
          </p>
        ) : (
          <>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {talleres.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setAliadoId(t.id)}
                  className={`flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-colors ${
                    aliadoId === t.id
                      ? 'border-ink bg-ink/5'
                      : 'border-ink/12 bg-white hover:border-ink/30'
                  }`}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-lime/20 text-ink">
                    <Store className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{t.nombre}</p>
                    <p className="truncate text-xs text-slate-warm">
                      {[t.tipo, t.ciudad].filter(Boolean).join(' · ')}
                    </p>
                  </span>
                </button>
              ))}
            </div>
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Nota opcional para el taller (ej. horarios en los que podés ir)"
              rows={2}
              className="w-full resize-none rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-ink/40"
            />
            {error && <p className="text-xs text-clay">{error}</p>}
            <button
              type="button"
              onClick={enviar}
              disabled={!aliadoId || enviando}
              className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-60"
            >
              {enviando ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Enviando…
                </>
              ) : (
                <>
                  <Wrench className="size-4" />
                  Reservar
                </>
              )}
            </button>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

const MAX_AUTORIZADOS = 2

/**
 * "Autorizar uso" — el dueño carga hasta 2 personas que pueden circular con
 * la bici de forma legítima. DNI/dirección viajan cifrados en reposo
 * (autorizados.service.ts) y NUNCA se exponen en el verificador público
 * (solo un booleano/cantidad ahí) -- ver CLAUDE.md para el diseño completo
 * de exposición por canal (público / gov según tenant).
 */
function AutorizarUsoModal({
  bici,
  open,
  onOpenChange,
}: {
  bici: ActivoGaraje | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [autorizados, setAutorizados] = useState<Autorizado[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editando, setEditando] = useState<Autorizado | 'nuevo' | null>(null)

  const cargar = async () => {
    if (!bici) return
    setError(null)
    try {
      setAutorizados(await listarAutorizados(bici.id))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    if (!open) {
      setAutorizados(null)
      setError(null)
      setEditando(null)
      return
    }
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bici?.id])

  const quitar = async (autorizadoId: string) => {
    if (!bici) return
    try {
      await eliminarAutorizado(bici.id, autorizadoId)
      await cargar()
      toast.success('Autorización quitada')
    } catch (err) {
      toast.error('No pudimos quitarla', { description: (err as Error).message })
    }
  }

  if (!bici) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl border border-ink/10 bg-paper">
        <DialogHeader>
          <span className="flex size-12 items-center justify-center rounded-xl bg-lime/20 text-ink">
            <UserCheck className="size-6" />
          </span>
          <DialogTitle className="font-display text-ink">Autorizar uso</DialogTitle>
          <DialogDescription className="text-slate-warm">
            Hasta {MAX_AUTORIZADOS} personas que pueden circular con {etiquetaActivo(bici)}. Si la Policía los verifica, esta lista es prueba de uso legítimo.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-xs text-clay">{error}</p>}

        {autorizados === null ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-warm">
            <Loader2 className="size-4 animate-spin" />
            Cargando…
          </div>
        ) : editando ? (
          <AutorizadoForm
            bicicletaId={bici.id}
            inicial={editando === 'nuevo' ? null : editando}
            onGuardado={async () => {
              setEditando(null)
              await cargar()
            }}
            onCancelar={() => setEditando(null)}
          />
        ) : (
          <>
            {autorizados.length === 0 ? (
              <p className="py-4 text-sm text-slate-warm">Todavía no autorizaste a nadie más.</p>
            ) : (
              <ul className="space-y-2">
                {autorizados.map((a) => (
                  <li
                    key={a.id}
                    className="rounded-xl border border-ink/12 bg-white p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink">{a.nombreCompleto}</p>
                        <p className="text-xs text-slate-warm">DNI {a.dni}</p>
                        <p className="truncate text-xs text-slate-warm">{a.direccion}</p>
                        {a.telefono && <p className="text-xs text-slate-warm">{a.telefono}</p>}
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditando(a)}
                          className="rounded-full border border-ink/15 bg-white px-2.5 py-1 text-[11px] font-semibold text-ink hover:border-ink/40"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => quitar(a.id)}
                          className="rounded-full border border-clay/30 bg-clay/5 px-2.5 py-1 text-[11px] font-semibold text-clay hover:bg-clay/10"
                        >
                          Quitar
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {autorizados.length < MAX_AUTORIZADOS && (
              <button
                type="button"
                onClick={() => setEditando('nuevo')}
                className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-full border border-ink/15 bg-white px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-ink/40"
              >
                <UserCheck className="size-4" />
                Agregar persona autorizada
              </button>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function AutorizadoForm({
  bicicletaId,
  inicial,
  onGuardado,
  onCancelar,
}: {
  bicicletaId: string
  inicial: Autorizado | null
  onGuardado: () => void
  onCancelar: () => void
}) {
  const [nombreCompleto, setNombreCompleto] = useState(inicial?.nombreCompleto ?? '')
  const [dni, setDni] = useState(inicial?.dni ?? '')
  const [direccion, setDireccion] = useState(inicial?.direccion ?? '')
  const [telefono, setTelefono] = useState(inicial?.telefono ?? '')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const guardar = async () => {
    if (!nombreCompleto.trim() || !dni.trim() || !direccion.trim() || enviando) return
    setEnviando(true)
    setError(null)
    try {
      const input = {
        nombreCompleto: nombreCompleto.trim(),
        dni: dni.trim(),
        direccion: direccion.trim(),
        telefono: telefono.trim() || undefined,
      }
      if (inicial) {
        await editarAutorizado(bicicletaId, inicial.id, input)
      } else {
        await agregarAutorizado(bicicletaId, input)
      }
      onGuardado()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="space-y-2">
      <input
        value={nombreCompleto}
        onChange={(e) => setNombreCompleto(e.target.value)}
        placeholder="Nombre y Apellido"
        className="w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-ink/40"
      />
      <input
        value={dni}
        onChange={(e) => setDni(e.target.value.replace(/\D/g, ''))}
        placeholder="DNI (sin puntos)"
        inputMode="numeric"
        className="w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-ink/40"
      />
      <input
        value={direccion}
        onChange={(e) => setDireccion(e.target.value)}
        placeholder="Dirección"
        className="w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-ink/40"
      />
      <input
        value={telefono}
        onChange={(e) => setTelefono(e.target.value)}
        placeholder="Teléfono (opcional)"
        className="w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-ink/40"
      />
      {error && <p className="text-xs text-clay">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={guardar}
          disabled={!nombreCompleto.trim() || !dni.trim() || !direccion.trim() || enviando}
          className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-xs font-semibold text-paper transition-colors hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          {enviando ? <Loader2 className="size-3.5 animate-spin" /> : <UserCheck className="size-3.5" />}
          Guardar
        </button>
        <button
          type="button"
          onClick={onCancelar}
          disabled={enviando}
          className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3.5 py-2 text-xs font-semibold text-ink transition-colors hover:border-ink/40"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}

// ── Tarjeta de activo ──────────────────────────────────────────────────────

function ActivoCard({
  activo,
  onVerificar,
  puedeDenunciar,
  onDenunciar,
  onModoPanico,
  onReservarCit,
  onAutorizarUso,
}: {
  activo: ActivoGaraje
  onVerificar: () => void
  puedeDenunciar: boolean
  onDenunciar: () => void
  onModoPanico: () => void
  onReservarCit: () => void
  onAutorizarUso: () => void
}) {
  const visual = ESTADO_VISUAL[activo.estado]
  const specs = [
    activo.tipo,
    activo.rodado ? `R${activo.rodado}` : null,
    activo.talleCuadro,
  ]
    .filter(Boolean)
    .join(' · ')

  // Historial Clinico publico (opt-in): solo tiene sentido pedir el estado
  // para bicis con identidad verificada -- sin CIT activo no hay nada que
  // compartir todavia. `null` desactiva el fetch (key null de SWR) sin
  // romper las Rules of Hooks.
  const { data: estadoCompartir, mutate: mutateCompartir } = useEstadoCompartir(
    activo.estado === 'verificado' ? activo.id : null
  )

  // Gemelo Digital: mismo gate que el resto de los widgets de salud -- solo
  // tiene sentido para bicis con identidad verificada.
  const { data: gemelo } = useGemeloDigital(
    activo.estado === 'verificado' ? activo.id : null
  )

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

      {/* Score de Confianza de la Bici */}
      <ScoreConfianzaBloque activo={activo} />

      {/* Gemelo Digital Interactivo (puntos de calor) */}
      {activo.estado === 'verificado' && gemelo && (
        <div className="mt-4">
          <GemeloDigitalBici gemelo={gemelo} />
        </div>
      )}

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

      {/* Denuncia de tercero: espera confirmacion del propietario */}
      <DenunciaTerceroBanner activoId={activo.id} />

      {/* Anclaje BFA */}
      {activo.bfa && activo.hashSha256 && <AnclajeBfaBloque activo={activo} />}

      {/* Actas firmadas */}
      {activo.actas.length > 0 && <ActasBloque activo={activo} />}

      {/* Acciones directas */}
      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        {activo.estado === 'verificado' && (
          <DescargarCertificadoButton activo={activo} />
        )}

        {activo.estado === 'verificado' && (
          <BiciSeguraShare
            marca={activo.marca}
            modelo={activo.modelo}
            año={activo.anio}
            estado={estadoCompartir ?? null}
            onActivar={async () => {
              await activarCompartirBici(activo.id)
              await mutateCompartir()
            }}
            onDesactivar={async () => {
              await revocarCompartirBici(activo.id)
              await mutateCompartir()
            }}
          />
        )}

        {activo.estado === 'verificado' && (
          <button
            onClick={onAutorizarUso}
            className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3.5 py-2 text-xs font-semibold text-ink transition-colors hover:border-ink/40"
          >
            <UserCheck className="size-3.5" />
            Autorizar uso
          </button>
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

        {(activo.estado === 'sin_verificar' ||
          activo.estado === 'vencido' ||
          activo.estado === 'rechazado') && (
          <button
            onClick={onReservarCit}
            className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3.5 py-2 text-xs font-semibold text-ink transition-colors hover:border-ink/40"
          >
            <Wrench className="size-3.5" />
            Reservar CIT
          </button>
        )}

        {activo.estado === 'pago_pendiente' && activo.solicitudPago && (
          <a
            href={activo.solicitudPago.initPoint}
            className="inline-flex items-center gap-1.5 rounded-full bg-lime px-3.5 py-2 text-xs font-semibold text-ink transition-colors hover:bg-lime-deep"
          >
            <Clock className="size-3.5" />
            Continuar pago (
            {activo.solicitudPago.montoARS.toLocaleString('es-AR', {
              style: 'currency',
              currency: 'ARS',
              maximumFractionDigits: 0,
            })}
            )
          </a>
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
          (activo.tienePublicacionActiva && activo.publicacionId ? (
            <Link
              // FIX (mismo bug encontrado en mis-publicaciones.tsx 2026-07-18):
              // /marketplace/[id] espera el UUID real, no el slug.
              href={`/marketplace/${activo.publicacionId}`}
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

        {/* Boton de Panico "Modo Robo" — atajo de un toque al mismo formulario
            de denuncia de abajo, con un paso de confirmacion (contraseña) antes.
            Mismas condiciones que "Denunciar robo": no tiene sentido ofrecerlo
            sobre una bici ya bloqueada. */}
        {puedeDenunciar &&
          (activo.estado === 'verificado' ||
            activo.estado === 'pendiente' ||
            activo.estado === 'vencido' ||
            activo.estado === 'sin_verificar') && (
            <button
              onClick={onModoPanico}
              className="inline-flex items-center gap-1.5 rounded-full bg-clay px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-clay/90"
            >
              <Siren className="size-3.5" />
              Modo Robo
            </button>
          )}

        {/* Denuncia ciudadana (Hito 18) — solo para identidad gubernamental (MxM)
            y bicis con identidad que no estén ya bloqueadas. */}
        {puedeDenunciar &&
          (activo.estado === 'verificado' ||
            activo.estado === 'pendiente' ||
            activo.estado === 'vencido' ||
            activo.estado === 'sin_verificar') && (
            <button
              onClick={onDenunciar}
              className="inline-flex items-center gap-1.5 rounded-full border border-clay/40 bg-clay/5 px-3.5 py-2 text-xs font-semibold text-clay transition-colors hover:bg-clay/10"
            >
              <ShieldAlert className="size-3.5" />
              Denunciar robo
            </button>
          )}
      </div>

      {puedeDenunciar &&
        (activo.estado === 'verificado' ||
          activo.estado === 'pendiente' ||
          activo.estado === 'vencido' ||
          activo.estado === 'sin_verificar') && (
          <p className="mt-2 text-[11px] leading-snug text-slate-warm">
            Modo Robo te lleva directo al formulario de denuncia con esta bici
            precargada. No bloquea tu bici al instante: necesita el PDF real
            de tu denuncia ante el MPF y la aprobación de un equipo de RODAID.
          </p>
        )}
    </li>
  )
}

/**
 * Item 5: banner de "alguien reporto esta bici como robada, confirmame".
 * Fetch unico al montar (sin polling: es un evento rarisimo y de alto
 * impacto, el canal urgente real es push/email, no este banner). No depende
 * de activo.estado -- un tercero puede denunciar cualquier numero de serie
 * que coincida, sin relacion al estado actual del CIT.
 */
function DenunciaTerceroBanner({ activoId }: { activoId: string }) {
  const [denuncia, setDenuncia] = useState<{
    id: string
    estado: string
    montoARS: number
    propietarioVenceEn: string | null
  } | null>(null)
  const [cargado, setCargado] = useState(false)
  const [respondiendo, setRespondiendo] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelado = false
    authedFetch(`/api/v1/bicicletas/${activoId}/denuncia-tercero`)
      .then((r) => r.json())
      .then((data: { denuncia: typeof denuncia }) => {
        if (!cancelado) setDenuncia(data.denuncia)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelado) setCargado(true)
      })
    return () => {
      cancelado = true
    }
  }, [activoId])

  if (!cargado || !denuncia || denuncia.estado !== 'ESPERANDO_PROPIETARIO') {
    return null
  }

  const responder = async (confirmaRobo: boolean) => {
    setRespondiendo(confirmaRobo)
    try {
      const res = await authedFetch(
        `/api/v1/bicicletas/${activoId}/denuncia-tercero/${denuncia.id}/confirmar`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ confirmaRobo }),
        }
      )
      if (!res.ok) throw new Error()
      toast.success(
        confirmaRobo
          ? 'Gracias por confirmar. Vamos a procesar el reembolso al denunciante.'
          : 'Gracias por avisarnos. Dimos por perdida la denuncia.'
      )
      setDenuncia(null)
    } catch {
      toast.error('No pudimos registrar tu respuesta', {
        description: 'Probá de nuevo en unos segundos.',
      })
    } finally {
      setRespondiendo(null)
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-clay/30 bg-clay/5 px-4 py-3.5 text-sm">
      <p className="flex items-center gap-2 font-semibold text-clay">
        <ShieldAlert className="size-4 shrink-0" />
        Alguien reportó esta bici como robada
      </p>
      <p className="mt-1.5 text-xs text-slate-warm">
        Necesitamos que confirmes si es cierto. Si no respondés antes de que
        venza el plazo, se da por perdida la denuncia automáticamente.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => responder(true)}
          disabled={respondiendo !== null}
          className="inline-flex items-center gap-1.5 rounded-full bg-clay px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-clay/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {respondiendo === true && <Loader2 className="size-3.5 animate-spin" />}
          Sí, es cierto
        </button>
        <button
          onClick={() => responder(false)}
          disabled={respondiendo !== null}
          className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-white px-4 py-2 text-xs font-semibold text-ink transition-colors hover:border-ink/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {respondiendo === false && <Loader2 className="size-3.5 animate-spin" />}
          No, es un error
        </button>
      </div>
    </div>
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

const SCORE_MEDALLA: Record<'oro' | 'bronce', { label: string; clase: string }> = {
  oro: { label: 'Oro', clase: 'bg-amber-100 text-amber-800 border-amber-300/70' },
  bronce: { label: 'Bronce', clase: 'bg-orange-100 text-orange-800 border-orange-300/60' },
}

/**
 * Score de Confianza de la Bici (0-100): CIT + historial de talleres +
 * BiciSalud + antiguedad en la plataforma. Ver CLAUDE.md para el diseno
 * completo y el motivo por el que Strava queda afuera por ahora.
 */
function ScoreConfianzaBloque({ activo }: { activo: ActivoGaraje }) {
  const score = activo.scoreConfianza
  const medalla = score.badge ? SCORE_MEDALLA[score.badge] : null

  return (
    <div className="mt-4 flex items-center justify-between gap-2 rounded-2xl border border-ink/10 bg-paper/60 px-3.5 py-3">
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
        <ShieldCheck className="size-3.5 text-ink/50" />
        Score de Confianza
      </span>
      <span className="flex items-center gap-2">
        {medalla && (
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${medalla.clase}`}
          >
            <Award className="size-3" />
            {medalla.label}
          </span>
        )}
        <span className="text-sm font-bold text-ink">
          {score.total}
          <span className="text-[10px] font-medium text-slate-warm">/100</span>
        </span>
      </span>
    </div>
  )
}

function AnclajeBfaBloque({ activo }: { activo: ActivoGaraje }) {
  const bfa = activo.bfa!
  const anclado = bfa.estado === 'ACUNADO'
  // Honestidad de estado (auditoria 2026-07-11): sin BFA_RPC_URL/BFA_PRIVATE_KEY/
  // BFA_CIT_CONTRACT configuradas, ningun anclaje es ONCHAIN real todavia --
  // "Anclado on-chain" solo aparece cuando bfa.modo lo confirma. `stub` cubre
  // tambien los CITs anclados antes de esta migracion (bfa.modo null), que son
  // STUB por confirmacion de la auditoria.
  const onchain = anclado && bfa.modo === 'ONCHAIN'
  const stub = anclado && bfa.modo !== 'ONCHAIN'
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
            onchain
              ? 'bg-lime/25 text-ink'
              : stub
                ? 'bg-amber-100 text-amber-700'
                : 'bg-paper-dim text-slate-warm'
          }`}
        >
          {onchain ? 'Anclado on-chain' : stub ? 'Identidad registrada' : 'Pendiente de anclaje'}
        </span>
      </div>
      {stub && (
        <p className="mt-1.5 text-[10px] leading-snug text-slate-warm">
          El anclaje en la Blockchain Federal Argentina está en proceso de habilitación institucional. Tu CIT es válido igual.
        </p>
      )}
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
