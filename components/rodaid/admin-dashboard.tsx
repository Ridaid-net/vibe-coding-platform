'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Ban,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Flame,
  Gauge,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  ScrollText,
  Server,
  ShieldCheck,
  Store,
  Unlock,
  UserCog,
  Users,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  accionarApiKey,
  accionarDenuncia,
  accionarInspector,
  accionarPublicacion,
  AdminError,
  clearStepUp,
  enrollMfa,
  getMfaStatus,
  obtenerAnalitica,
  obtenerApiKeys,
  obtenerBitacora,
  obtenerDenuncias,
  obtenerInspectores,
  obtenerIntegridad,
  obtenerMapaInstitucional,
  obtenerPublicaciones,
  puede,
  revelarDatos,
  rolActual,
  stepUp,
  tieneStepUp,
  type AdminPermiso,
  type AdminRol,
  type AnaliticaEcosistema,
  type ApiKeyAdmin,
  type BitacoraEntrada,
  type DenunciaModeracion,
  type InspectorAdmin,
  type IntegridadSistema,
  type MapaInstitucional,
  type PublicacionDisputa,
  type SaludEstado,
  type TallerOpcion,
} from '@/lib/admin-panel-client'

// ── Helpers de presentacion ────────────────────────────────────────────────────

const ROL_LABEL: Record<AdminRol, string> = {
  superadmin: 'SuperAdmin',
  auditor: 'Auditor',
  soporte: 'Operador de Soporte',
}

function fmtNum(n: number): string {
  return new Intl.NumberFormat('es-AR').format(n)
}
function fmtARS(n: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}
function fmtFecha(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

const SALUD_DOT: Record<SaludEstado, string> = {
  operativo: 'bg-lime-deep',
  degradado: 'bg-amber-400',
  caido: 'bg-clay',
}
const SALUD_LABEL: Record<SaludEstado, string> = {
  operativo: 'Operativo',
  degradado: 'Degradado',
  caido: 'Caído',
}

// ── Componente raiz ──────────────────────────────────────────────────────────

type Pestana = 'integridad' | 'moderacion' | 'analitica' | 'identidades' | 'bitacora' | 'gobierno'

const PESTANAS: { id: Pestana; label: string; icon: typeof Activity; permiso: AdminPermiso }[] = [
  { id: 'integridad', label: 'Integridad', icon: Activity, permiso: 'integridad:ver' },
  { id: 'moderacion', label: 'Moderación', icon: ShieldCheck, permiso: 'moderacion:ver' },
  { id: 'analitica', label: 'Analítica', icon: Gauge, permiso: 'analitica:ver' },
  { id: 'identidades', label: 'Identidades', icon: UserCog, permiso: 'identidades:ver' },
  { id: 'bitacora', label: 'Bitácora', icon: ScrollText, permiso: 'bitacora:ver' },
  { id: 'gobierno', label: 'Gobierno', icon: ShieldCheck, permiso: 'identidades:ver' },
]

export function AdminDashboard() {
  const [listo, setListo] = useState(tieneStepUp())
  const [rol, setRol] = useState<AdminRol | null>(rolActual())
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    getMfaStatus()
      .then((s) => setRol(s.adminRol))
      .catch(() => undefined)
      .finally(() => setCargando(false))
  }, [])

  if (cargando) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-warm">
        <Loader2 className="size-4 animate-spin" /> Verificando acceso…
      </div>
    )
  }

  if (!listo) {
    return (
      <MfaGate
        onReady={(r) => {
          setRol(r)
          setListo(true)
        }}
      />
    )
  }

  return <Panel rol={rol} onLogout={() => { clearStepUp(); setListo(false) }} />
}

// ── Puerta MFA ─────────────────────────────────────────────────────────────────

function MfaGate({ onReady }: { onReady: (rol: AdminRol) => void }) {
  const [secret, setSecret] = useState<string | null>(null)
  const [otpauth, setOtpauth] = useState<string | null>(null)
  const [codigoDemo, setCodigoDemo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [paso, setPaso] = useState<'enrolar' | 'verificar'>('enrolar')
  const [busy, setBusy] = useState(false)

  const enrolar = async () => {
    setBusy(true)
    try {
      const r = await enrollMfa()
      setSecret(r.secret)
      setOtpauth(r.otpauthUri)
      setCodigoDemo(r.codigoDemo)
      if (r.codigoDemo) setCode(r.codigoDemo)
      setPaso('verificar')
    } catch (err) {
      toast.error('No pudimos preparar el segundo factor', { description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const verificar = async () => {
    setBusy(true)
    try {
      const s = await stepUp(code.trim())
      toast.success('Acceso verificado', { description: `Sesión de ${ROL_LABEL[s.adminRol]}` })
      onReady(s.adminRol)
    } catch (err) {
      const msg = err instanceof AdminError ? err.message : (err as Error).message
      toast.error('Código inválido', { description: msg })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-3xl border border-ink/12 bg-white p-8 shadow-sm">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-ink text-paper">
          <Lock className="size-5" />
        </span>
        <span className="mt-5 block text-xs font-semibold uppercase tracking-[0.18em] text-clay">
          Acceso restringido
        </span>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-ink">
          Verificación en dos pasos
        </h1>
        <p className="mt-2 text-sm text-slate-warm">
          El Dashboard de Administración exige un segundo factor (MFA) obligatorio. Enrolá tu app de
          autenticación y verificá tu identidad para continuar.
        </p>

        {paso === 'enrolar' ? (
          <button
            onClick={enrolar}
            disabled={busy}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4 text-lime" />}
            Preparar segundo factor
          </button>
        ) : (
          <div className="mt-6 space-y-4">
            {secret && (
              <div className="rounded-2xl bg-paper-dim/60 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-warm">Clave para tu app TOTP</p>
                <p className="mt-1 break-all font-mono text-sm text-ink">{secret}</p>
                {otpauth && (
                  <a
                    href={otpauth}
                    className="mt-2 inline-block text-xs font-semibold text-clay underline underline-offset-2"
                  >
                    Abrir en app de autenticación
                  </a>
                )}
              </div>
            )}
            {codigoDemo && (
              <div className="flex items-start gap-2 rounded-2xl border border-lime-deep/40 bg-lime/10 p-3 text-xs text-ink">
                <BadgeCheck className="mt-0.5 size-4 shrink-0 text-lime-deep" />
                <span>
                  Entorno de vista previa: tu código de demostración vigente es{' '}
                  <strong className="font-mono">{codigoDemo}</strong>.
                </span>
              </div>
            )}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-warm">
                Código de 6 dígitos
              </label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                placeholder="000000"
                className="mt-1 w-full rounded-xl border border-ink/15 bg-white px-4 py-3 text-center font-mono text-lg tracking-[0.4em] text-ink outline-none focus:border-ink/40"
              />
            </div>
            <button
              onClick={verificar}
              disabled={busy || code.length !== 6}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Unlock className="size-4 text-lime" />}
              Verificar e ingresar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Panel principal ──────────────────────────────────────────────────────────

function Panel({ rol, onLogout }: { rol: AdminRol | null; onLogout: () => void }) {
  const visibles = PESTANAS.filter((p) => puede(p.permiso))
  const [pestana, setPestana] = useState<Pestana>(visibles[0]?.id ?? 'integridad')

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-clay">
            Operaciones · Administración
          </span>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-ink">
            Dashboard de Administración
          </h1>
          <p className="mt-1 text-sm text-slate-warm">
            Visibilidad total y control de la infraestructura provincial RODAID.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {rol && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-paper">
              <ShieldCheck className="size-3.5 text-lime" /> {ROL_LABEL[rol]}
            </span>
          )}
          <button
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-ink/40"
          >
            <Lock className="size-3.5" /> Cerrar MFA
          </button>
        </div>
      </div>

      <div className="mt-7 flex flex-wrap gap-2 border-b border-ink/10 pb-3">
        {visibles.map((p) => {
          const Icon = p.icon
          return (
            <button
              key={p.id}
              onClick={() => setPestana(p.id)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                pestana === p.id ? 'bg-ink text-paper' : 'border border-ink/15 bg-white text-ink hover:border-ink/40'
              }`}
            >
              <Icon className="size-4" /> {p.label}
            </button>
          )
        })}
      </div>

      <div className="mt-7">
        {pestana === 'integridad' && <TabIntegridad />}
        {pestana === 'moderacion' && <TabModeracion />}
        {pestana === 'analitica' && <TabAnalitica />}
        {pestana === 'identidades' && <TabIdentidades />}
        {pestana === 'bitacora' && <TabBitacora />}
      </div>
    </>
  )
}

// ── Estados compartidos de carga / error ───────────────────────────────────────

function Cargando() {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-warm">
      <Loader2 className="size-4 animate-spin" /> Cargando…
    </div>
  )
}
function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="rounded-3xl border border-clay/30 bg-clay/5 px-6 py-10 text-center">
      <AlertTriangle className="mx-auto size-7 text-clay" />
      <p className="mt-2 font-display text-lg font-bold text-ink">No pudimos cargar los datos</p>
      <p className="mt-1 text-sm text-slate-warm">{msg}</p>
    </div>
  )
}

function useCarga<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cargar = useCallback(async () => {
    setData(null)
    setError(null)
    try {
      setData(await fn())
    } catch (err) {
      setError((err as Error).message)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => {
    cargar()
  }, [cargar])
  return { data, error, recargar: cargar }
}

function CabeceraSeccion({
  titulo,
  desc,
  onRefresh,
}: {
  titulo: string
  desc: string
  onRefresh: () => void
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-2xl font-bold tracking-tight text-ink">{titulo}</h2>
        <p className="mt-1 text-sm text-slate-warm">{desc}</p>
      </div>
      <button
        onClick={onRefresh}
        className="inline-flex items-center gap-2 rounded-full border border-ink/15 bg-white px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-ink/40"
      >
        <RefreshCw className="size-4" /> Actualizar
      </button>
    </div>
  )
}

// ── TAB 1: Integridad ──────────────────────────────────────────────────────────

function TabIntegridad() {
  const { data, error, recargar } = useCarga<IntegridadSistema>(obtenerIntegridad)
  return (
    <>
      <CabeceraSeccion
        titulo="Monitor de Integridad del Sistema"
        desc="Estado en tiempo real de los servicios y de los nodos de la Blockchain Federal Argentina."
        onRefresh={recargar}
      />
      {error ? (
        <ErrorBox msg={error} />
      ) : !data ? (
        <Cargando />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.servicios.map((s) => (
              <div key={s.clave} className="rounded-2xl border border-ink/12 bg-white p-4">
                <div className="flex items-center justify-between">
                  <Server className="size-5 text-ink/60" />
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-warm">
                    <span className={`size-2.5 rounded-full ${SALUD_DOT[s.estado]}`} />
                    {SALUD_LABEL[s.estado]}
                  </span>
                </div>
                <p className="mt-3 font-display font-semibold text-ink">{s.nombre}</p>
                <p className="mt-1 text-xs text-slate-warm">{s.detalle}</p>
                <div className="mt-3 flex items-center justify-between text-xs text-slate-warm">
                  <span className="rounded-full bg-paper-dim px-2 py-0.5 font-mono">{s.modo}</span>
                  {s.latenciaMs != null && <span>{s.latenciaMs} ms</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-3xl border border-ink/12 bg-white p-6">
            <h3 className="font-display text-lg font-bold text-ink">
              Semáforo de nodos · Blockchain Federal Argentina
            </h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {data.nodosBFA.map((n) => (
                <div key={n.nombre} className="flex items-center gap-3 rounded-2xl bg-paper-dim/50 p-3">
                  <span className={`size-3 rounded-full ${SALUD_DOT[n.estado]}`} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{n.nombre}</p>
                    <p className="text-xs text-slate-warm">
                      {SALUD_LABEL[n.estado]}
                      {n.latenciaMs != null ? ` · ${n.latenciaMs} ms` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  )
}

// ── TAB 2: Moderación ──────────────────────────────────────────────────────────

function TabModeracion() {
  const [sub, setSub] = useState<'denuncias' | 'publicaciones'>('denuncias')
  return (
    <>
      <div className="mb-5 flex gap-2">
        {[
          { id: 'denuncias' as const, label: 'Denuncias en revisión' },
          { id: 'publicaciones' as const, label: 'Publicaciones en disputa' },
        ].map((s) => (
          <button
            key={s.id}
            onClick={() => setSub(s.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
              sub === s.id ? 'bg-lime text-ink' : 'border border-ink/15 bg-white text-ink hover:border-ink/40'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {sub === 'denuncias' ? <ModeracionDenuncias /> : <ModeracionPublicaciones />}
    </>
  )
}

function ModeracionDenuncias() {
  const { data, error, recargar } = useCarga<DenunciaModeracion[]>(() => obtenerDenuncias())
  const [busy, setBusy] = useState<string | null>(null)
  const accionar = puede('moderacion:accion')

  const ejecutar = async (id: string, accion: 'aprobar' | 'rechazar' | 'desbloquear') => {
    setBusy(id)
    try {
      const r = await accionarDenuncia(id, accion)
      toast.success('Acción registrada', { description: `${r.estado} · ${r.cambios.join(', ')}` })
      recargar()
    } catch (err) {
      toast.error('No se pudo ejecutar', { description: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <CabeceraSeccion
        titulo="Denuncias en revisión"
        desc="Verificá el documento del MPF, aprobá o rechazá la denuncia y desbloqueá activos."
        onRefresh={recargar}
      />
      {error ? (
        <ErrorBox msg={error} />
      ) : !data ? (
        <Cargando />
      ) : data.length === 0 ? (
        <Vacio icon={FileText} texto="No hay denuncias para moderar." />
      ) : (
        <ul className="space-y-3">
          {data.map((d) => (
            <li key={d.id} className="rounded-2xl border border-ink/12 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display font-semibold text-ink">
                    Serie {d.serial}{' '}
                    <EstadoPill estado={d.estado} />
                  </p>
                  <p className="mt-1 text-xs text-slate-warm">
                    Expediente: {d.expediente ?? '—'} · Fecha: {d.fechaDocumento ?? '—'} ·{' '}
                    {fmtFecha(d.creadoEn)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                    <Chip ok={d.estructuraValida} label="Estructura" />
                    <Chip ok={d.titularCoincide} label="Titular" />
                    <Chip ok={!d.ilegible} label="Legible" />
                  </div>
                  {d.motivos.length > 0 && (
                    <p className="mt-2 text-xs text-clay">{d.motivos.join(' · ')}</p>
                  )}
                  <p className="mt-2 break-all font-mono text-[11px] text-slate-warm">
                    PDF sha256: {d.pdfHash.slice(0, 24)}…
                  </p>
                  <a
                    href={d.documentoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-clay underline underline-offset-2"
                  >
                    <FileText className="size-3.5" /> Verificar PDF del MPF
                  </a>
                </div>
                {accionar && (
                  <div className="flex flex-col gap-2">
                    {d.estado === 'EN_REVISION' && (
                      <>
                        <BtnAccion
                          onClick={() => ejecutar(d.id, 'aprobar')}
                          busy={busy === d.id}
                          icon={CheckCircle2}
                          label="Aprobar y bloquear"
                          variant="dark"
                        />
                        <BtnAccion
                          onClick={() => ejecutar(d.id, 'rechazar')}
                          busy={busy === d.id}
                          icon={XCircle}
                          label="Rechazar"
                          variant="ghost"
                        />
                      </>
                    )}
                    {d.estado === 'DENUNCIA_JUDICIAL_ACTIVA' && (
                      <BtnAccion
                        onClick={() => ejecutar(d.id, 'desbloquear')}
                        busy={busy === d.id}
                        icon={Unlock}
                        label="Desbloquear activo"
                        variant="ghost"
                      />
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function ModeracionPublicaciones() {
  const { data, error, recargar } = useCarga<PublicacionDisputa[]>(obtenerPublicaciones)
  const [busy, setBusy] = useState<string | null>(null)
  const accionar = puede('moderacion:accion')

  const ejecutar = async (
    id: string,
    accion: 'despublicar' | 'reactivar' | 'suspender-cuenta' | 'reactivar-cuenta'
  ) => {
    setBusy(id + accion)
    try {
      await accionarPublicacion(id, accion)
      toast.success('Acción registrada en la bitácora')
      recargar()
    } catch (err) {
      toast.error('No se pudo ejecutar', { description: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <CabeceraSeccion
        titulo="Publicaciones en disputa"
        desc="Control total sobre el Marketplace: suspendé cuentas o borrá publicaciones que infrinjan los términos."
        onRefresh={recargar}
      />
      {error ? (
        <ErrorBox msg={error} />
      ) : !data ? (
        <Cargando />
      ) : data.length === 0 ? (
        <Vacio icon={Store} texto="No hay publicaciones bajo escrutinio." />
      ) : (
        <ul className="space-y-3">
          {data.map((p) => (
            <li key={p.id} className="rounded-2xl border border-ink/12 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display font-semibold text-ink">
                    {p.titulo} <EstadoPill estado={p.estado} />
                    {p.enDisputa && (
                      <span className="ml-1 rounded-full bg-clay/15 px-2 py-0.5 text-[11px] font-semibold text-clay">
                        En disputa
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-slate-warm">
                    {fmtARS(p.precioARS)} · Serie {p.serial ?? '—'} · {fmtFecha(p.publicadoEn)}
                  </p>
                  <p className="mt-1 text-xs text-slate-warm">
                    Cuenta vendedor:{' '}
                    <span className={p.vendedorEstado === 'suspendido' ? 'font-semibold text-clay' : ''}>
                      {p.vendedorEstado}
                    </span>
                  </p>
                  {p.motivo && <p className="mt-1 text-xs text-clay">Motivo: {p.motivo}</p>}
                </div>
                {accionar && (
                  <div className="flex flex-col gap-2">
                    {p.estado !== 'RECHAZADA' ? (
                      <BtnAccion
                        onClick={() => ejecutar(p.id, 'despublicar')}
                        busy={busy === p.id + 'despublicar'}
                        icon={Ban}
                        label="Borrar publicación"
                        variant="ghost"
                      />
                    ) : (
                      <BtnAccion
                        onClick={() => ejecutar(p.id, 'reactivar')}
                        busy={busy === p.id + 'reactivar'}
                        icon={RefreshCw}
                        label="Reactivar publicación"
                        variant="ghost"
                      />
                    )}
                    {p.vendedorEstado !== 'suspendido' ? (
                      <BtnAccion
                        onClick={() => ejecutar(p.id, 'suspender-cuenta')}
                        busy={busy === p.id + 'suspender-cuenta'}
                        icon={Ban}
                        label="Suspender cuenta"
                        variant="dark"
                      />
                    ) : (
                      <BtnAccion
                        onClick={() => ejecutar(p.id, 'reactivar-cuenta')}
                        busy={busy === p.id + 'reactivar-cuenta'}
                        icon={CheckCircle2}
                        label="Reactivar cuenta"
                        variant="dark"
                      />
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

// ── TAB 3: Analítica ───────────────────────────────────────────────────────────

function TabAnalitica() {
  const { data, error, recargar } = useCarga<AnaliticaEcosistema>(obtenerAnalitica)
  return (
    <>
      <CabeceraSeccion
        titulo="Analítica de Ecosistema"
        desc="Métricas agregadas de uso (tokens GPT, consumo de API, RODAID PAY) y mapa de calor institucional."
        onRefresh={recargar}
      />
      {error ? (
        <ErrorBox msg={error} />
      ) : !data ? (
        <Cargando />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric titulo="Consultas RODAID-GPT (30d)" valor={fmtNum(data.gpt.consultas30d)} sub={`${fmtNum(data.gpt.tokensEntrada30d + data.gpt.tokensSalida30d)} tokens · ${fmtNum(data.gpt.cacheHits30d)} de caché`} icon={Activity} />
            <Metric titulo="Llamadas API terceros (30d)" valor={fmtNum(data.api.llamadas30d)} sub={`${fmtNum(data.api.errores30d)} errores · P95 ${data.api.latenciaP95Ms ?? '—'} ms · ${data.api.appsActivas} apps`} icon={KeyRound} />
            <Metric titulo="Volumen RODAID PAY (30d)" valor={fmtARS(data.pay.volumenARS30d)} sub={`${fmtNum(data.pay.transacciones30d)} tx · ${fmtNum(data.pay.completadas30d)} completadas · ${fmtNum(data.pay.enDisputa)} en disputa`} icon={Gauge} />
            <Metric titulo="Comisión RODAID (30d)" valor={fmtARS(data.pay.comisionARS30d)} sub="Ingresos por intermediación" icon={BadgeCheck} />
            <Metric titulo="CITs" valor={fmtNum(data.cits.total)} sub={`${fmtNum(data.cits.activos)} activos · ${fmtNum(data.cits.bloqueados)} bloqueados`} icon={ShieldCheck} />
            <Metric titulo="Usuarios" valor={fmtNum(data.usuarios.total)} sub={`${fmtNum(data.usuarios.conSelloMxm)} con sello MxM · ${fmtNum(data.usuarios.suspendidos)} suspendidos`} icon={Users} />
          </div>
          <MapaInstitucionalPanel />
        </>
      )}
    </>
  )
}

function MapaInstitucionalPanel() {
  const [dias, setDias] = useState(30)
  const { data, error, recargar } = useCarga<MapaInstitucional>(() => obtenerMapaInstitucional(dias), [dias])

  return (
    <div className="mt-6 rounded-3xl border border-ink/12 bg-white p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-bold text-ink">Mapa de calor institucional</h3>
          <p className="mt-1 text-sm text-slate-warm">
            Versión sin la supresión por k-anonimato del mapa público: focos reales para que el
            Ministerio actúe. La posición sigue agregada a nivel barrio. Tu acceso queda auditado.
          </p>
        </div>
        <div className="flex gap-1.5">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDias(d)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                dias === d ? 'bg-ink text-paper' : 'border border-ink/15 bg-white text-ink hover:border-ink/40'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <p className="mt-4 text-sm text-clay">{error}</p>
      ) : !data ? (
        <div className="mt-4">
          <Cargando />
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Mini label="Consultas" valor={fmtNum(data.totales.consultas)} />
            <Mini label="Denuncias / discrepancias" valor={fmtNum(data.totales.denuncias)} />
            <Mini label="Celdas con actividad" valor={fmtNum(data.totales.celdas)} />
          </div>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-warm">
            Focos más calientes
          </p>
          <ul className="mt-2 space-y-1.5">
            {data.focos
              .slice()
              .sort((a, b) => b.total - a.total)
              .slice(0, 12)
              .map((f, i) => (
                <li
                  key={`${f.celda}-${f.capa}-${i}`}
                  className="flex items-center justify-between rounded-xl bg-paper-dim/50 px-3 py-2 text-sm"
                >
                  <span className="inline-flex items-center gap-2">
                    <Flame
                      className={`size-4 ${f.capa === 'denuncias' ? 'text-clay' : 'text-amber-500'}`}
                    />
                    <span className="text-ink">{f.zona}</span>
                    <span className="text-xs text-slate-warm">
                      {f.capa} · {f.lat.toFixed(3)}, {f.lon.toFixed(3)}
                    </span>
                  </span>
                  <span className="font-mono font-semibold text-ink">{fmtNum(f.total)}</span>
                </li>
              ))}
          </ul>
          {data.focos.length === 0 && (
            <p className="mt-3 text-sm text-slate-warm">Sin actividad geolocalizada en la ventana.</p>
          )}
        </>
      )}
    </div>
  )
}

// ── TAB 4: Identidades ───────────────────────────────────────────────────────

function TabIdentidades() {
  const [sub, setSub] = useState<'inspectores' | 'apikeys'>('inspectores')
  return (
    <>
      <div className="mb-5 flex gap-2">
        {[
          { id: 'inspectores' as const, label: 'Inspectores' },
          { id: 'apikeys' as const, label: 'Accesos de terceros' },
        ].map((s) => (
          <button
            key={s.id}
            onClick={() => setSub(s.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
              sub === s.id ? 'bg-lime text-ink' : 'border border-ink/15 bg-white text-ink hover:border-ink/40'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {sub === 'inspectores' ? <Inspectores /> : <ApiKeys />}
    </>
  )
}

function Inspectores() {
  const { data, error, recargar } = useCarga<{ inspectores: InspectorAdmin[]; talleres: TallerOpcion[] }>(
    obtenerInspectores
  )
  const [busy, setBusy] = useState<string | null>(null)
  const accionar = puede('identidades:accion')

  const cambiarLicencia = async (id: string, estado: string) => {
    setBusy(id)
    try {
      await accionarInspector(id, { accion: 'licencia', licenciaEstado: estado })
      toast.success(`Licencia ${estado}`)
      recargar()
    } catch (err) {
      toast.error('No se pudo actualizar', { description: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const asignarTaller = async (id: string, aliadoId: string) => {
    if (!aliadoId) return
    setBusy(id)
    try {
      await accionarInspector(id, { accion: 'asignar-taller', aliadoId })
      toast.success('Taller autorizado asignado')
      recargar()
    } catch (err) {
      toast.error('No se pudo asignar', { description: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const quitarTaller = async (id: string, aliadoId: string) => {
    setBusy(id)
    try {
      await accionarInspector(id, { accion: 'quitar-taller', aliadoId })
      toast.success('Taller revocado')
      recargar()
    } catch (err) {
      toast.error('No se pudo quitar', { description: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const verDatos = async (id: string) => {
    const motivo = window.prompt(
      'Acceso a datos personales para SOPORTE OFICIAL. Indicá el motivo (queda auditado, mín. 8 caracteres):'
    )
    if (!motivo) return
    try {
      const d = await revelarDatos(id, motivo)
      toast.info('Datos personales (acceso auditado)', {
        description: `${d.nombre ?? '—'} · ${d.email ?? '—'} · DNI ${d.dni ?? '—'} · ${d.telefono ?? '—'}`,
        duration: 12000,
      })
    } catch (err) {
      toast.error('No se pudo revelar', { description: (err as Error).message })
    }
  }

  return (
    <>
      <CabeceraSeccion
        titulo="Administración de inspectores"
        desc="Asigná talleres autorizados y gestioná las licencias (Hito 11). Los datos personales se muestran enmascarados."
        onRefresh={recargar}
      />
      {error ? (
        <ErrorBox msg={error} />
      ) : !data ? (
        <Cargando />
      ) : data.inspectores.length === 0 ? (
        <Vacio icon={UserCog} texto="No hay inspectores registrados." />
      ) : (
        <ul className="space-y-3">
          {data.inspectores.map((ins) => (
            <li key={ins.id} className="rounded-2xl border border-ink/12 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display font-semibold text-ink">
                    {ins.nombre ?? 'Inspector'}{' '}
                    <span className="text-xs font-normal text-slate-warm">({ins.rol})</span>{' '}
                    <LicenciaPill estado={ins.licenciaEstado} />
                  </p>
                  <p className="mt-1 text-xs text-slate-warm">
                    {ins.emailMasked ?? '—'} · {ins.inspecciones} inspección(es)
                    {ins.licenciaVenceEn ? ` · vence ${ins.licenciaVenceEn}` : ''}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {ins.talleres.length === 0 ? (
                      <span className="text-xs text-slate-warm">Sin talleres asignados</span>
                    ) : (
                      ins.talleres.map((t) => (
                        <span
                          key={t.id}
                          className="inline-flex items-center gap-1 rounded-full bg-paper-dim px-2.5 py-0.5 text-[11px] font-semibold text-ink"
                        >
                          <Store className="size-3" /> {t.nombre}
                          {accionar && (
                            <button
                              onClick={() => quitarTaller(ins.id, t.id)}
                              className="ml-0.5 text-clay hover:opacity-70"
                              aria-label="Quitar taller"
                            >
                              <XCircle className="size-3" />
                            </button>
                          )}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                {accionar && (
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex gap-1.5">
                      {puede('datos-personales:ver') && (
                        <button
                          onClick={() => verDatos(ins.id)}
                          className="inline-flex items-center gap-1 rounded-full border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-ink/40"
                        >
                          <Eye className="size-3.5 text-clay" /> Ver datos (soporte)
                        </button>
                      )}
                      <button
                        onClick={() => cambiarLicencia(ins.id, ins.licenciaEstado === 'suspendida' ? 'activa' : 'suspendida')}
                        disabled={busy === ins.id}
                        className="inline-flex items-center gap-1 rounded-full border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-ink/40 disabled:opacity-50"
                      >
                        {ins.licenciaEstado === 'suspendida' ? (
                          <>
                            <CheckCircle2 className="size-3.5 text-lime-deep" /> Reactivar licencia
                          </>
                        ) : (
                          <>
                            <Ban className="size-3.5 text-clay" /> Suspender licencia
                          </>
                        )}
                      </button>
                    </div>
                    <select
                      onChange={(e) => {
                        asignarTaller(ins.id, e.target.value)
                        e.target.value = ''
                      }}
                      defaultValue=""
                      className="rounded-full border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink outline-none"
                    >
                      <option value="" disabled>
                        Asignar taller…
                      </option>
                      {data.talleres.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.nombre}
                          {t.ciudad ? ` (${t.ciudad})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function ApiKeys() {
  const { data, error, recargar } = useCarga<ApiKeyAdmin[]>(obtenerApiKeys)
  const [busy, setBusy] = useState<string | null>(null)
  const accionar = puede('identidades:accion')

  const ejecutar = async (id: string, accion: 'revocar' | 'habilitar') => {
    setBusy(id)
    try {
      await accionarApiKey(id, accion)
      toast.success(accion === 'revocar' ? 'API Key revocada' : 'API Key habilitada')
      recargar()
    } catch (err) {
      toast.error('No se pudo ejecutar', { description: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <CabeceraSeccion
        titulo="Control de accesos de terceros"
        desc="Habilitá o revocá las API Keys de aseguradoras o empresas de logística (Hito 16)."
        onRefresh={recargar}
      />
      {error ? (
        <ErrorBox msg={error} />
      ) : !data ? (
        <Cargando />
      ) : data.length === 0 ? (
        <Vacio icon={KeyRound} texto="No hay aplicaciones de terceros registradas." />
      ) : (
        <ul className="space-y-3">
          {data.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-4 rounded-2xl border border-ink/12 bg-white p-4">
              <span className="flex size-11 items-center justify-center rounded-xl bg-paper-dim text-ink">
                <KeyRound className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display font-semibold text-ink">
                  {a.nombre} <EstadoPill estado={a.estado} />
                  <span className="ml-1 rounded-full bg-paper-dim px-2 py-0.5 text-[11px] font-semibold text-slate-warm">
                    {a.entorno}
                  </span>
                </p>
                <p className="mt-0.5 truncate font-mono text-xs text-slate-warm">
                  {a.apiKeyPrefix}··· · {a.scopes.join(', ') || 'sin scopes'} · {fmtNum(a.llamadas30d)} llamadas (30d) · {a.rateLimitRpm} rpm
                </p>
              </div>
              {accionar &&
                (a.estado === 'activa' ? (
                  <BtnAccion
                    onClick={() => ejecutar(a.id, 'revocar')}
                    busy={busy === a.id}
                    icon={Ban}
                    label="Revocar"
                    variant="ghost"
                  />
                ) : (
                  <BtnAccion
                    onClick={() => ejecutar(a.id, 'habilitar')}
                    busy={busy === a.id}
                    icon={CheckCircle2}
                    label="Habilitar"
                    variant="dark"
                  />
                ))}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

// ── TAB 5: Bitácora ────────────────────────────────────────────────────────────

function TabBitacora() {
  const { data, error, recargar } = useCarga<BitacoraEntrada[]>(() => obtenerBitacora())
  return (
    <>
      <CabeceraSeccion
        titulo="Bitácora inmutable"
        desc="Toda acción de modificación queda registrada con la identidad del administrador que la ejecutó. No se puede alterar ni borrar."
        onRefresh={recargar}
      />
      {error ? (
        <ErrorBox msg={error} />
      ) : !data ? (
        <Cargando />
      ) : data.length === 0 ? (
        <Vacio icon={ScrollText} texto="Sin acciones registradas todavía." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-ink/12 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-paper-dim/60 text-xs uppercase tracking-wide text-slate-warm">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Fecha</th>
                <th className="px-4 py-2.5 font-semibold">Acción</th>
                <th className="px-4 py-2.5 font-semibold">Recurso</th>
                <th className="px-4 py-2.5 font-semibold">Admin</th>
              </tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id} className="border-t border-ink/8">
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-warm">{fmtFecha(e.createdAt)}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-ink">
                      <Clock className="size-3 text-slate-warm" /> {e.accion}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-warm">
                    {e.recursoTipo ?? '—'}
                    {e.recursoId ? `:${e.recursoId.slice(0, 8)}` : ''}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="rounded-full bg-ink px-2 py-0.5 text-[11px] font-semibold text-paper">
                      {e.adminRol}
                    </span>
                    <span className="ml-1 font-mono text-[11px] text-slate-warm">{e.adminId.slice(0, 8)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ── Atomos compartidos ──────────────────────────────────────────────────────────

function Metric({
  titulo,
  valor,
  sub,
  icon: Icon,
}: {
  titulo: string
  valor: string
  sub: string
  icon: typeof Activity
}) {
  return (
    <div className="rounded-2xl border border-ink/12 bg-white p-4">
      <div className="flex items-center justify-between">
        <Icon className="size-5 text-ink/60" />
      </div>
      <p className="mt-3 font-display text-2xl font-bold tracking-tight text-ink">{valor}</p>
      <p className="mt-0.5 text-xs font-semibold text-ink/80">{titulo}</p>
      <p className="mt-1 text-xs text-slate-warm">{sub}</p>
    </div>
  )
}

function Mini({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="rounded-2xl bg-paper-dim/50 p-3">
      <p className="font-display text-xl font-bold text-ink">{valor}</p>
      <p className="text-xs text-slate-warm">{label}</p>
    </div>
  )
}

function EstadoPill({ estado }: { estado: string }) {
  const map: Record<string, string> = {
    activa: 'bg-lime/30 text-ink',
    ACTIVA: 'bg-lime/30 text-ink',
    suspendida: 'bg-clay/15 text-clay',
    PAUSADA: 'bg-amber-100 text-amber-700',
    RECHAZADA: 'bg-clay/15 text-clay',
    EN_REVISION: 'bg-amber-100 text-amber-700',
    DENUNCIA_JUDICIAL_ACTIVA: 'bg-clay/15 text-clay',
    ANULADA: 'bg-paper-dim text-slate-warm',
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${map[estado] ?? 'bg-paper-dim text-slate-warm'}`}>
      {estado}
    </span>
  )
}

function LicenciaPill({ estado }: { estado: string }) {
  const map: Record<string, string> = {
    activa: 'bg-lime/30 text-ink',
    suspendida: 'bg-clay/15 text-clay',
    vencida: 'bg-amber-100 text-amber-700',
    sin_licencia: 'bg-paper-dim text-slate-warm',
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${map[estado] ?? 'bg-paper-dim text-slate-warm'}`}>
      lic. {estado}
    </span>
  )
}

function Chip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
        ok ? 'bg-lime/25 text-ink' : 'bg-clay/15 text-clay'
      }`}
    >
      {ok ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
      {label}
    </span>
  )
}

function Vacio({ icon: Icon, texto }: { icon: typeof Activity; texto: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-ink/20 bg-white/50 px-6 py-16 text-center">
      <Icon className="mx-auto size-8 text-ink/30" />
      <p className="mt-3 font-display text-lg font-bold text-ink">{texto}</p>
    </div>
  )
}

function BtnAccion({
  onClick,
  busy,
  icon: Icon,
  label,
  variant,
}: {
  onClick: () => void
  busy: boolean
  icon: typeof Activity
  label: string
  variant: 'dark' | 'ghost'
}) {
  const cls =
    variant === 'dark'
      ? 'bg-ink text-paper hover:bg-ink-soft'
      : 'border border-ink/15 bg-white text-ink hover:border-ink/40'
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${cls}`}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
      {label}
    </button>
  )
}
