'use client'

import { useMemo, useState } from 'react'
import { evaluarInspeccion, type CategoriaCIT, type ResultadosPuntos } from '@/lib/cit'
import type {
  ColaItem,
  ResumenHoy,
  TallerRow,
  RegistrarInspeccionResultado,
} from '@/src/services/cit.service'
import { registrarInspeccionAction } from './actions'

// Paleta RODAID.
const NAVY = '#0F1E35'
const NAVY_DEEP = '#0A1322'
const ORANGE = '#F47B20'
const TEAL = '#2BBCB8'

type Vista = 'cola' | 'inspeccion' | 'dj' | 'resultado'

interface Props {
  cola: ColaItem[]
  talleres: TallerRow[]
  resumen: ResumenHoy
  categorias: CategoriaCIT[]
}

function scoreColor(puntaje: number) {
  if (puntaje >= 75) return '#4ade80'
  if (puntaje >= 50) return ORANGE
  return '#f87171'
}

export function InspectorPanel({ cola: colaInicial, talleres, resumen, categorias }: Props) {
  const [cola, setCola] = useState<ColaItem[]>(colaInicial)
  const [vista, setVista] = useState<Vista>('cola')
  const [bici, setBici] = useState<ColaItem | null>(null)
  const [tallerId, setTallerId] = useState<string>(talleres[0]?.id ?? '')
  const [inspectorNombre, setInspectorNombre] = useState('')
  const [resultados, setResultados] = useState<Record<string, boolean | undefined>>({})
  const [observaciones, setObservaciones] = useState<Record<string, string>>({})
  const [puntoActivo, setPuntoActivo] = useState<string | null>(null)
  const [notas, setNotas] = useState('')
  const [djFirmada, setDjFirmada] = useState(false)
  const [firmaNombre, setFirmaNombre] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [resultado, setResultado] = useState<RegistrarInspeccionResultado | null>(null)

  const totalPuntos = categorias.reduce((acc, c) => acc + c.puntos.length, 0)

  // Evaluacion en vivo (misma funcion que el servidor usa para gatillar el evento).
  const evalResultados = useMemo<ResultadosPuntos>(() => {
    const r: ResultadosPuntos = {}
    for (const cat of categorias) {
      for (const p of cat.puntos) r[p.key] = resultados[p.key] === true
    }
    return r
  }, [resultados, categorias])

  const evaluacion = useMemo(() => evaluarInspeccion(evalResultados), [evalResultados])
  const marcados = useMemo(
    () => categorias.reduce((acc, c) => acc + c.puntos.filter((p) => resultados[p.key] !== undefined).length, 0),
    [resultados, categorias]
  )
  const todosMarcados = marcados === totalPuntos

  function abrirInspeccion(item: ColaItem) {
    setBici(item)
    setResultados({})
    setObservaciones({})
    setNotas('')
    setDjFirmada(false)
    setFirmaNombre('')
    setErrorMsg(null)
    setPuntoActivo(null)
    setVista('inspeccion')
  }

  function volverCola() {
    setBici(null)
    setVista('cola')
  }

  function setPunto(key: string, valor: boolean) {
    setResultados((prev) => ({ ...prev, [key]: valor }))
  }

  function marcarTodos(valor: boolean) {
    const next: Record<string, boolean> = {}
    for (const cat of categorias) for (const p of cat.puntos) next[p.key] = valor
    setResultados(next)
  }

  async function enviar() {
    if (!bici || !djFirmada || firmaNombre.trim().length < 3) return
    setEnviando(true)
    setErrorMsg(null)
    const res = await registrarInspeccionAction({
      bicicletaId: bici.bicicletaId,
      tallerId: tallerId || null,
      inspectorNombre: firmaNombre.trim(),
      resultados: evalResultados,
      observaciones,
      notas: notas.trim() || null,
      djFirmada: true,
    })
    setEnviando(false)
    if (!res.ok) {
      setErrorMsg(res.error)
      return
    }
    setResultado(res.resultado)
    if (res.resultado.aprobado) {
      // El CIT ACTIVO saca a la bici de la cola.
      setCola((prev) => prev.filter((c) => c.bicicletaId !== bici.bicicletaId))
    }
    setVista('resultado')
  }

  const tallerSel = talleres.find((t) => t.id === tallerId) ?? talleres[0] ?? null

  return (
    <main
      className="min-h-screen text-slate-100"
      style={{
        background: `radial-gradient(1200px 600px at 80% -10%, rgba(244,123,32,0.10), transparent 60%), radial-gradient(900px 500px at -10% 110%, rgba(43,188,184,0.10), transparent 55%), linear-gradient(180deg, ${NAVY} 0%, ${NAVY_DEEP} 100%)`,
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div className="mx-auto max-w-3xl px-5 py-8">
        <Header
          taller={tallerSel}
          enInspeccion={vista !== 'cola'}
          bici={bici}
        />

        {vista === 'cola' && (
          <Cola
            cola={cola}
            resumen={resumen}
            talleres={talleres}
            tallerId={tallerId}
            inspectorNombre={inspectorNombre}
            onTaller={setTallerId}
            onInspector={setInspectorNombre}
            onSeleccionar={abrirInspeccion}
          />
        )}

        {vista === 'inspeccion' && bici && (
          <Inspeccion
            bici={bici}
            categorias={categorias}
            resultados={resultados}
            observaciones={observaciones}
            puntoActivo={puntoActivo}
            evaluacion={evaluacion}
            marcados={marcados}
            totalPuntos={totalPuntos}
            todosMarcados={todosMarcados}
            onVolver={volverCola}
            onSetPunto={setPunto}
            onMarcarTodos={marcarTodos}
            onObservacion={(k, v) => setObservaciones((p) => ({ ...p, [k]: v }))}
            onPuntoActivo={setPuntoActivo}
            onContinuar={() => setVista('dj')}
          />
        )}

        {vista === 'dj' && bici && (
          <DeclaracionJurada
            bici={bici}
            categorias={categorias}
            evaluacion={evaluacion}
            resultados={resultados}
            notas={notas}
            firmaNombre={firmaNombre}
            djFirmada={djFirmada}
            enviando={enviando}
            errorMsg={errorMsg}
            onNotas={setNotas}
            onFirma={setFirmaNombre}
            onDj={setDjFirmada}
            onVolver={() => setVista('inspeccion')}
            onEnviar={enviar}
          />
        )}

        {vista === 'resultado' && resultado && (
          <Resultado
            resultado={resultado}
            onVolver={() => {
              setResultado(null)
              volverCola()
            }}
          />
        )}
      </div>
    </main>
  )
}

// ── Header ───────────────────────────────────────────────────────────────────

function Header({
  taller,
  enInspeccion,
  bici,
}: {
  taller: TallerRow | null
  enInspeccion: boolean
  bici: ColaItem | null
}) {
  return (
    <header className="mb-7 flex items-center gap-3 border-b border-white/10 pb-5">
      <div
        className="flex h-10 w-10 items-center justify-center rounded-xl text-lg font-black"
        style={{ background: ORANGE, color: '#fff' }}
        aria-hidden
      >
        <WrenchGlyph />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: TEAL }}>
          RODAID · CIT
        </p>
        <h1 className="text-lg font-bold leading-tight">Panel de Inspector</h1>
        <p className="truncate text-xs text-slate-400">
          {taller ? `${taller.nombre} · ${taller.localidad ?? taller.provincia}` : 'Taller aliado'} · Ley Prov. 9556
        </p>
      </div>
      {enInspeccion && (
        <span
          className="ml-auto shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold"
          style={{ background: 'rgba(244,123,32,0.15)', color: ORANGE }}
        >
          {bici ? `${bici.marca} ${bici.modelo}` : 'En inspección'}
        </span>
      )}
    </header>
  )
}

// ── Cola de trabajo ────────────────────────────────────────────────────────────

function Cola({
  cola,
  resumen,
  talleres,
  tallerId,
  inspectorNombre,
  onTaller,
  onInspector,
  onSeleccionar,
}: {
  cola: ColaItem[]
  resumen: ResumenHoy
  talleres: TallerRow[]
  tallerId: string
  inspectorNombre: string
  onTaller: (id: string) => void
  onInspector: (v: string) => void
  onSeleccionar: (item: ColaItem) => void
}) {
  const kpis = [
    { label: 'CITs hoy', value: resumen.total, color: TEAL },
    { label: 'Aprobados', value: resumen.aprobados, color: '#4ade80' },
    { label: 'Rechazados', value: resumen.rechazados, color: '#f87171' },
  ]

  return (
    <div>
      <div className="mb-6 grid grid-cols-3 gap-3">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3"
          >
            <div className="text-[10px] uppercase tracking-wide text-slate-400">{k.label}</div>
            <div className="text-2xl font-extrabold" style={{ color: k.color }}>
              {k.value}
            </div>
          </div>
        ))}
      </div>

      <div className="mb-6 grid gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[11px] text-slate-400">Taller aliado</span>
          <select
            value={tallerId}
            onChange={(e) => onTaller(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-slate-100 outline-none focus:border-[--ring-orange]"
            style={{ ['--ring-orange' as string]: ORANGE }}
          >
            {talleres.map((t) => (
              <option key={t.id} value={t.id} className="bg-slate-900">
                {t.nombre} — {t.localidad ?? t.provincia}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] text-slate-400">Inspector a cargo</span>
          <input
            type="text"
            value={inspectorNombre}
            onChange={(e) => onInspector(e.target.value)}
            placeholder="Nombre del inspector certificado"
            className="w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
          />
        </label>
      </div>

      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
        Cola de trabajo — {cola.length} {cola.length === 1 ? 'rodado' : 'rodados'}
      </p>

      {cola.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-12 text-center text-sm text-slate-400">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full" style={{ background: 'rgba(74,222,128,0.12)', color: '#4ade80' }}>
            <CheckGlyph />
          </div>
          Cola vacía — no hay rodados pendientes de inspección.
        </div>
      ) : (
        <ul className="space-y-2.5">
          {cola.map((item) => {
            const rechazado = item.ultimoCitEstado === 'RECHAZADO'
            return (
              <li key={item.bicicletaId}>
                <button
                  type="button"
                  onClick={() => onSeleccionar(item)}
                  className="group flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3.5 text-left transition-colors hover:border-[color:var(--hover)]"
                  style={{ ['--hover' as string]: 'rgba(244,123,32,0.45)' }}
                >
                  <div className="min-w-0">
                    <div className="font-bold">
                      {item.marca} {item.modelo}{' '}
                      <span className="text-xs font-normal text-slate-400">· {item.anio ?? '—'}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-slate-400">{item.numeroSerie}</div>
                    <div className="text-[11px] text-slate-400">{item.propietarioNombre ?? 'Propietario sin nombre'}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {rechazado ? (
                      <span className="rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ background: 'rgba(248,113,113,0.14)', color: '#f87171' }}>
                        Re-inspección
                      </span>
                    ) : (
                      <span className="rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ background: 'rgba(43,188,184,0.14)', color: TEAL }}>
                        Nueva inspección
                      </span>
                    )}
                    <span className="text-lg font-bold transition-transform group-hover:translate-x-0.5" style={{ color: ORANGE }}>
                      →
                    </span>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ── Inspección: los 20 puntos ──────────────────────────────────────────────────

function Inspeccion({
  bici,
  categorias,
  resultados,
  observaciones,
  puntoActivo,
  evaluacion,
  marcados,
  totalPuntos,
  todosMarcados,
  onVolver,
  onSetPunto,
  onMarcarTodos,
  onObservacion,
  onPuntoActivo,
  onContinuar,
}: {
  bici: ColaItem
  categorias: CategoriaCIT[]
  resultados: Record<string, boolean | undefined>
  observaciones: Record<string, string>
  puntoActivo: string | null
  evaluacion: ReturnType<typeof evaluarInspeccion>
  marcados: number
  totalPuntos: number
  todosMarcados: boolean
  onVolver: () => void
  onSetPunto: (key: string, valor: boolean) => void
  onMarcarTodos: (valor: boolean) => void
  onObservacion: (key: string, value: string) => void
  onPuntoActivo: (key: string | null) => void
  onContinuar: () => void
}) {
  const color = scoreColor(evaluacion.puntaje)

  return (
    <div className="pb-28">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <button onClick={onVolver} className="mb-1 text-xs text-slate-400 hover:text-slate-200">
            ← Cola de trabajo
          </button>
          <div className="text-lg font-bold">
            {bici.marca} {bici.modelo}
          </div>
          <div className="font-mono text-[11px] text-slate-400">
            {bici.numeroSerie} · {bici.propietarioNombre ?? 'Propietario'}
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-extrabold tabular-nums" style={{ color }}>
            {evaluacion.puntaje}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400">score aseg.</div>
          <div className="text-sm font-bold" style={{ color: evaluacion.aprobado ? '#4ade80' : ORANGE }}>
            {evaluacion.puntos}/20 · {evaluacion.aprobado ? 'APTO' : `faltan ${Math.max(0, 15 - evaluacion.puntos)}`}
          </div>
        </div>
      </div>

      {/* Barra de progreso de puntos aprobados */}
      <div className="mb-2 h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${(evaluacion.puntos / 20) * 100}%`,
            background: evaluacion.puntos >= 15 ? '#4ade80' : evaluacion.puntos >= 10 ? ORANGE : '#f87171',
          }}
        />
      </div>
      <div className="mb-5 flex items-center justify-between text-[11px] text-slate-400">
        <span>
          {marcados}/{totalPuntos} puntos evaluados
        </span>
        <div className="flex gap-3">
          <button onClick={() => onMarcarTodos(true)} className="hover:text-slate-200">
            Marcar todos aptos
          </button>
          <button onClick={() => onMarcarTodos(false)} className="hover:text-slate-200">
            Limpiar
          </button>
        </div>
      </div>

      {categorias.map((cat) => {
        const aprobadosCat = cat.puntos.filter((p) => resultados[p.key] === true).length
        return (
          <section key={cat.id} className="mb-5">
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: cat.color }} />
              <span className="text-xs font-semibold" style={{ color: cat.color }}>
                {cat.label}
              </span>
              <span className="text-[10px] text-slate-500">{cat.peso}%</span>
              <span className="ml-auto text-[11px] text-slate-400">
                {aprobadosCat}/{cat.puntos.length}
              </span>
            </div>

            <div className="space-y-2">
              {cat.puntos.map((pt) => {
                const estado = resultados[pt.key]
                const abierto = puntoActivo === pt.key
                return (
                  <div
                    key={pt.key}
                    className="rounded-lg border px-3.5 py-3 transition-colors"
                    style={{
                      borderColor:
                        estado === true
                          ? 'rgba(74,222,128,0.35)'
                          : estado === false
                            ? 'rgba(248,113,113,0.35)'
                            : 'rgba(255,255,255,0.08)',
                      background:
                        estado === true
                          ? 'rgba(74,222,128,0.06)'
                          : estado === false
                            ? 'rgba(248,113,113,0.06)'
                            : 'rgba(255,255,255,0.03)',
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{pt.label}</span>
                          {pt.critico && (
                            <span
                              className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                              style={{ background: 'rgba(244,123,32,0.16)', color: ORANGE }}
                            >
                              Crítico
                            </span>
                          )}
                        </div>
                        {abierto ? (
                          <div className="mt-2">
                            <p className="mb-2 text-[11px] leading-relaxed text-slate-400">{pt.desc}</p>
                            <textarea
                              value={observaciones[pt.key] ?? ''}
                              onChange={(e) => onObservacion(pt.key, e.target.value)}
                              placeholder="Observación (opcional)"
                              className="h-14 w-full resize-none rounded-md border border-white/10 bg-white/[0.06] px-2.5 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-500"
                            />
                            <button
                              onClick={() => onPuntoActivo(null)}
                              className="mt-1 text-[10px] text-slate-500 hover:text-slate-300"
                            >
                              Cerrar ↑
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => onPuntoActivo(pt.key)}
                            className="mt-0.5 text-left text-[10px] text-slate-500 hover:text-slate-300"
                          >
                            {observaciones[pt.key]
                              ? `Nota: ${observaciones[pt.key].slice(0, 44)}${observaciones[pt.key].length > 44 ? '…' : ''}`
                              : 'Ver criterio técnico + nota'}
                          </button>
                        )}
                      </div>

                      {/* Segmento Apto / No apto */}
                      <div className="flex shrink-0 overflow-hidden rounded-lg border border-white/10">
                        <button
                          onClick={() => onSetPunto(pt.key, true)}
                          className="px-2.5 py-1.5 text-[11px] font-semibold transition-colors"
                          style={
                            estado === true
                              ? { background: '#22a558', color: '#fff' }
                              : { color: '#9fb0c9' }
                          }
                          aria-pressed={estado === true}
                        >
                          Apto
                        </button>
                        <button
                          onClick={() => onSetPunto(pt.key, false)}
                          className="border-l border-white/10 px-2.5 py-1.5 text-[11px] font-semibold transition-colors"
                          style={
                            estado === false
                              ? { background: '#d6453f', color: '#fff' }
                              : { color: '#9fb0c9' }
                          }
                          aria-pressed={estado === false}
                        >
                          No apto
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}

      {/* Barra de acción fija con el veredicto en vivo */}
      <div className="fixed inset-x-0 bottom-0 border-t border-white/10 backdrop-blur" style={{ background: 'rgba(10,19,34,0.92)' }}>
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-slate-400">
              {todosMarcados
                ? 'Inspección completa'
                : `Faltan ${totalPuntos - marcados} puntos por evaluar`}
            </div>
            <div className="text-sm font-bold" style={{ color: evaluacion.aprobado ? '#4ade80' : '#f87171' }}>
              {evaluacion.aprobado ? 'Resultado previsto: CIT APROBADO' : 'Resultado previsto: CIT RECHAZADO'}
            </div>
          </div>
          <button
            onClick={onContinuar}
            disabled={!todosMarcados}
            className="rounded-lg px-5 py-2.5 text-sm font-bold transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              background: evaluacion.aprobado ? ORANGE : 'rgba(248,113,113,0.18)',
              color: evaluacion.aprobado ? '#fff' : '#f87171',
            }}
          >
            Continuar →
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Declaración jurada ──────────────────────────────────────────────────────────

function DeclaracionJurada({
  bici,
  categorias,
  evaluacion,
  resultados,
  notas,
  firmaNombre,
  djFirmada,
  enviando,
  errorMsg,
  onNotas,
  onFirma,
  onDj,
  onVolver,
  onEnviar,
}: {
  bici: ColaItem
  categorias: CategoriaCIT[]
  evaluacion: ReturnType<typeof evaluarInspeccion>
  resultados: Record<string, boolean | undefined>
  notas: string
  firmaNombre: string
  djFirmada: boolean
  enviando: boolean
  errorMsg: string | null
  onNotas: (v: string) => void
  onFirma: (v: string) => void
  onDj: (v: boolean) => void
  onVolver: () => void
  onEnviar: () => void
}) {
  const aprobado = evaluacion.aprobado
  const puedeEnviar = djFirmada && firmaNombre.trim().length >= 3 && !enviando

  return (
    <div>
      <button onClick={onVolver} className="mb-4 text-xs text-slate-400 hover:text-slate-200">
        ← Volver a los 20 puntos
      </button>

      <div
        className="mb-5 rounded-xl border p-5"
        style={{
          borderColor: aprobado ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)',
          background: aprobado ? 'rgba(74,222,128,0.06)' : 'rgba(248,113,113,0.06)',
        }}
      >
        <div className="text-lg font-extrabold" style={{ color: aprobado ? '#4ade80' : '#f87171' }}>
          {aprobado ? 'CIT APROBADO' : 'CIT RECHAZADO'} — {evaluacion.puntos}/20 puntos
        </div>
        <div className="mb-3 text-xs text-slate-400">
          {bici.marca} {bici.modelo} · <span className="font-mono">{bici.numeroSerie}</span>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {evaluacion.porCategoria.map((c) => (
            <div key={c.id} className="rounded-md bg-white/[0.04] py-2 text-center">
              <div className="text-xs font-bold" style={{ color: c.color }}>
                {c.aprobados}/{c.total}
              </div>
              <div className="text-[9px] text-slate-500">{c.label.split(' ')[0]}</div>
            </div>
          ))}
        </div>
        {!aprobado && evaluacion.criticosFallidos.length > 0 && (
          <p className="mt-3 text-[11px]" style={{ color: '#f87171' }}>
            Puntos críticos no aptos:{' '}
            {evaluacion.criticosFallidos
              .map((k) => categorias.flatMap((c) => c.puntos).find((p) => p.key === k)?.label ?? k)
              .join(', ')}
          </p>
        )}
      </div>

      <div className="mb-5 rounded-xl border border-white/10 bg-white/[0.04] p-5">
        <div className="mb-2 text-sm font-semibold">Declaración jurada del inspector</div>
        <ul className="mb-4 space-y-1 text-[12px] leading-relaxed text-slate-400">
          <li>· La inspección fue realizada en forma presencial en el taller aliado.</li>
          <li>· Los 20 puntos registrados reflejan el estado real del rodado.</li>
          <li>· El número de serie fue verificado visualmente contra el registro.</li>
          <li>· La información es verídica conforme a la Ley Provincial N° 9556.</li>
        </ul>

        <label className="mb-3 block">
          <span className="mb-1 block text-[11px] text-slate-400">Notas generales (opcional)</span>
          <textarea
            value={notas}
            onChange={(e) => onNotas(e.target.value)}
            placeholder="Observaciones de cierre, recomendaciones al ciclista, etc."
            className="h-16 w-full resize-none rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[12px] text-slate-100 outline-none placeholder:text-slate-500"
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-[11px] text-slate-400">Firma del inspector (nombre completo)</span>
          <input
            type="text"
            value={firmaNombre}
            onChange={(e) => onFirma(e.target.value)}
            placeholder="Escribí tu nombre completo para firmar"
            className="w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500"
          />
        </label>

        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={djFirmada}
            onChange={(e) => onDj(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[--acc]"
            style={{ ['--acc' as string]: ORANGE }}
          />
          <span className="text-[12px] text-slate-400">
            Confirmo que la información es correcta y firmo digitalmente esta declaración jurada.
          </span>
        </label>
      </div>

      {errorMsg && (
        <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
          {errorMsg}
        </p>
      )}

      <button
        onClick={onEnviar}
        disabled={!puedeEnviar}
        className="w-full rounded-xl py-3.5 text-sm font-bold transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          background: aprobado ? ORANGE : 'rgba(248,113,113,0.2)',
          color: aprobado ? '#fff' : '#f87171',
        }}
      >
        {enviando
          ? 'Registrando…'
          : aprobado
            ? 'Emitir CIT y notificar al ciclista'
            : 'Registrar RECHAZADO y notificar'}
      </button>
    </div>
  )
}

// ── Resultado ────────────────────────────────────────────────────────────────

function Resultado({
  resultado,
  onVolver,
}: {
  resultado: RegistrarInspeccionResultado
  onVolver: () => void
}) {
  const aprobado = resultado.aprobado
  const vence = resultado.fechaVencimiento
    ? new Date(resultado.fechaVencimiento).toLocaleDateString('es-AR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    : null

  return (
    <div>
      <div
        className="mb-5 rounded-2xl border p-7 text-center"
        style={{
          borderColor: aprobado ? 'rgba(74,222,128,0.35)' : 'rgba(248,113,113,0.35)',
          background: aprobado ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)',
        }}
      >
        <div
          className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full"
          style={{
            background: aprobado ? 'rgba(74,222,128,0.16)' : 'rgba(248,113,113,0.16)',
            color: aprobado ? '#4ade80' : '#f87171',
          }}
        >
          {aprobado ? <CheckGlyph size={30} /> : <CrossGlyph size={30} />}
        </div>
        <div className="text-2xl font-extrabold" style={{ color: aprobado ? '#4ade80' : '#f87171' }}>
          CIT {aprobado ? 'APROBADO' : 'RECHAZADO'}
        </div>
        <div className="mt-1 font-mono text-sm text-slate-300">{resultado.numeroCIT}</div>
        <div className="mt-1 text-[13px] text-slate-400">
          {resultado.bicicleta.marca} {resultado.bicicleta.modelo} ·{' '}
          {resultado.puntos}/20 puntos · score {resultado.puntaje}
        </div>

        {aprobado ? (
          <div
            className="mt-5 rounded-lg px-4 py-3 text-left text-[12px]"
            style={{ background: 'rgba(43,188,184,0.12)', color: TEAL }}
          >
            Certificado vigente {vence ? `hasta el ${vence}` : 'por 12 meses'}. El rodado queda
            habilitado para publicarse en el Marketplace de RODAID con este CIT.
          </div>
        ) : (
          <div
            className="mt-5 rounded-lg px-4 py-3 text-left text-[12px]"
            style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171' }}
          >
            {resultado.motivoRechazo ?? 'No se alcanzó el mínimo de 15/20 puntos.'} Se notificó al
            ciclista los puntos a corregir para una re-inspección.
          </div>
        )}
      </div>

      <button
        onClick={onVolver}
        className="w-full rounded-xl py-3 text-sm font-semibold text-white"
        style={{ background: ORANGE }}
      >
        ← Volver a la cola de trabajo
      </button>
    </div>
  )
}

// ── Glyphs (SVG) ────────────────────────────────────────────────────────────

function WrenchGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14.7 6.3a4 4 0 0 0-5.4 5.1L4 16.7a1.6 1.6 0 0 0 2.3 2.3l5.3-5.3a4 4 0 0 0 5.1-5.4l-2.3 2.3-2-2 2.3-2.3Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CheckGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CrossGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}
