'use client'

// BicicletaCard — muestra los datos reales que devuelve el endpoint
// GET /api/v1/garaje/resumen para un rodado: CIT, asegurabilidad y póliza.

import type { BicicletaGaraje, EstadoCIT } from '@/lib/garaje-api'
import { C, CIT_BADGE } from './theme'

function BadgeCIT({ estado }: { estado: EstadoCIT }) {
  const b = CIT_BADGE[estado] ?? CIT_BADGE.SIN_CIT
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 10px',
        borderRadius: 99,
        fontSize: 11,
        fontWeight: 600,
        background: b.bg,
        color: b.color,
      }}
    >
      {b.label}
    </span>
  )
}

// Anillo de score circular.
export function ScoreRing({ score, size = 56 }: { score: number; size?: number }) {
  const color = score >= 75 ? C.teal : score >= 50 ? C.orange : C.red
  const pct = Math.min(100, score)
  const r = size / 2 - 5
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ flexShrink: 0, transform: 'rotate(-90deg)' }}
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth={5} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={5}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray .6s ease' }}
      />
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill={color}
        fontSize={size * 0.28}
        fontWeight={700}
        style={{ transform: 'rotate(90deg)', transformOrigin: `${size / 2}px ${size / 2}px` }}
      >
        {score}
      </text>
    </svg>
  )
}

export function KPICell({
  label,
  value,
  color = '#F8FAFC',
  sub,
}: {
  label: string
  value: number | string
  color?: string
  sub?: string
}) {
  return (
    <div
      style={{
        background: 'rgba(255,255,255,.03)',
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: 12,
      }}
    >
      <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export function BicicletaCard({
  bici,
  onCotizar,
  onVerCIT,
  onRefresh,
}: {
  bici: BicicletaGaraje
  onCotizar: (biciId: string, citId: string) => void
  onVerCIT: (citId: string) => void
  onRefresh: () => void
}) {
  const { cit, certAseg, poliza, scoreSalud } = bici
  const scoreColor = scoreSalud >= 75 ? C.teal : scoreSalud >= 50 ? C.orange : C.red
  const puntosColor = (cit?.puntosTotal ?? 0) >= 16 ? C.green : C.orange

  const diasLabel =
    cit?.diasRestantes != null
      ? cit.diasRestantes > 0
        ? `Vence en ${cit.diasRestantes}d`
        : 'Vencido hace ' + Math.abs(cit.diasRestantes) + 'd'
      : null

  const diasColor =
    (cit?.diasRestantes ?? 999) < 30 ? C.red : (cit?.diasRestantes ?? 999) < 90 ? C.yellow : C.green

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: 20,
        marginBottom: 12,
        transition: 'border-color .2s',
      }}
    >
      {/* ── Header ───────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 14,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: 'rgba(255,255,255,.06)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
            }}
          >
            🚲
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              {bici.marca} {bici.modelo}
            </div>
            <div style={{ fontSize: 11, color: C.muted, fontFamily: 'monospace', marginTop: 2 }}>
              {bici.numeroSerie}
            </div>
          </div>
        </div>
        <BadgeCIT estado={cit?.estado ?? 'SIN_CIT'} />
      </div>

      {/* ── KPIs ─────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 14 }}>
        <KPICell label="Score salud" value={scoreSalud} color={scoreColor} sub="/ 100" />
        <KPICell
          label="Puntos CIT"
          value={cit ? `${cit.puntosTotal}/${cit.puntajeMax}` : '—'}
          color={puntosColor}
        />
        <KPICell
          label="Asegurabilidad"
          value={certAseg ? `${Math.round(certAseg.score)}` : '—'}
          color={certAseg ? C.teal : C.muted}
          sub={certAseg?.nivel ?? ''}
        />
        <KPICell
          label="Póliza"
          value={poliza ? poliza.primaFinalARS : '—'}
          color={poliza ? C.green : C.muted}
          sub={poliza ? '/mes' : 'sin seguro'}
        />
      </div>

      {/* ── Hash BFA y NFT ───────────────────────────── */}
      {cit?.hashSHA256 && (
        <div
          style={{
            background: 'rgba(43,188,184,.05)',
            border: '1px solid rgba(43,188,184,.15)',
            borderRadius: 8,
            padding: '8px 12px',
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ fontSize: 14 }}>⛓</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>
              SHA-256 · BFA{cit.nftTokenId ? ` · NFT #${cit.nftTokenId}` : ' · NFT pendiente mainnet'}
            </div>
            <div
              style={{
                fontSize: 10,
                fontFamily: 'monospace',
                color: C.teal,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {cit.hashSHA256}
            </div>
          </div>
        </div>
      )}

      {/* ── Progreso vencimiento ─────────────────────── */}
      {cit?.fechaEmision && cit?.fechaVencimiento && (
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              height: 6,
              background: 'rgba(255,255,255,.08)',
              borderRadius: 99,
              overflow: 'hidden',
              marginBottom: 5,
            }}
          >
            {(() => {
              const total =
                new Date(cit.fechaVencimiento).getTime() - new Date(cit.fechaEmision).getTime()
              const elapsed = Date.now() - new Date(cit.fechaEmision).getTime()
              const pct = total > 0 ? Math.min(100, Math.max(0, (elapsed / total) * 100)) : 0
              return (
                <div
                  style={{
                    height: '100%',
                    width: `${pct}%`,
                    background: pct > 85 ? C.red : pct > 70 ? C.yellow : C.teal,
                    borderRadius: 99,
                    transition: 'width .6s',
                  }}
                />
              )
            })()}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.muted }}>
            <span>Emitido {new Date(cit.fechaEmision).toLocaleDateString('es-AR')}</span>
            {diasLabel && <span style={{ color: diasColor, fontWeight: 600 }}>{diasLabel}</span>}
          </div>
        </div>
      )}

      {/* ── Alerta BORRADOR ──────────────────────────── */}
      {cit?.estado === 'BORRADOR' && (
        <div
          style={{
            background: 'rgba(244,123,32,.08)',
            border: '1px solid rgba(244,123,32,.2)',
            borderRadius: 8,
            padding: '8px 12px',
            marginBottom: 12,
            fontSize: 12,
            color: C.orange,
          }}
        >
          ⚠ Inspección incompleta — {cit.puntosTotal}/{cit.puntajeMax} puntos. Mínimo requerido:
          15/20 para emitir el CIT.
        </div>
      )}

      {/* ── Alerta PENDIENTE_PAGO ─────────────────────── */}
      {cit?.estado === 'PENDIENTE_PAGO' && (
        <div
          style={{
            background: 'rgba(251,191,36,.08)',
            border: '1px solid rgba(251,191,36,.2)',
            borderRadius: 8,
            padding: '8px 12px',
            marginBottom: 12,
            fontSize: 12,
            color: C.yellow,
          }}
        >
          ⏳ Tasa MxM pendiente de pago ($3.000 ARS). El CIT está firmado digitalmente pero no es
          oficial hasta que se acredite el pago.
        </div>
      )}

      {/* ── CTA Seguro ───────────────────────────────── */}
      {!poliza && certAseg?.asegurable && cit?.id && (
        <div
          style={{
            background: 'rgba(43,188,184,.06)',
            border: '1px solid rgba(43,188,184,.2)',
            borderRadius: 8,
            padding: '10px 14px',
            marginBottom: 12,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 12, color: C.teal }}>
            🛡 Tu bicicleta califica para seguro con hasta 35% de descuento
          </div>
          <button
            onClick={() => onCotizar(bici.id, cit.id)}
            style={{
              padding: '5px 12px',
              fontSize: 11,
              fontWeight: 600,
              background: 'rgba(43,188,184,.15)',
              color: C.teal,
              border: '1px solid rgba(43,188,184,.3)',
              borderRadius: 99,
              cursor: 'pointer',
            }}
          >
            Cotizar →
          </button>
        </div>
      )}

      {/* ── Póliza activa resumen ─────────────────────── */}
      {poliza && (
        <div
          style={{
            background: 'rgba(74,222,128,.06)',
            border: '1px solid rgba(74,222,128,.2)',
            borderRadius: 8,
            padding: '8px 12px',
            marginBottom: 12,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 6,
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>✅ Seguro activo</div>
            <div style={{ fontSize: 10, color: C.muted }}>
              {poliza.aseguradora} · {poliza.numeroPoliza}
            </div>
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>{poliza.primaFinalARS}/mes</div>
        </div>
      )}

      {/* ── Acciones ─────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {cit?.estado === 'PENDIENTE_PAGO' && (
          <button
            onClick={() => onVerCIT(cit.id)}
            style={{
              flex: 1,
              padding: '9px 14px',
              fontSize: 12,
              fontWeight: 600,
              background: C.orange,
              color: '#fff',
              border: 'none',
              borderRadius: 9,
              cursor: 'pointer',
            }}
          >
            💳 Pagar tasa MxM
          </button>
        )}
        {cit?.id && (
          <button
            onClick={() => onVerCIT(cit.id)}
            style={{
              flex: 1,
              padding: '9px 14px',
              fontSize: 12,
              background: 'rgba(255,255,255,.05)',
              border: `1px solid ${C.border}`,
              color: '#F8FAFC',
              borderRadius: 9,
              cursor: 'pointer',
            }}
          >
            📋 Ver CIT
          </button>
        )}
        <button
          onClick={onRefresh}
          aria-label="Refrescar"
          style={{
            padding: '9px 14px',
            fontSize: 12,
            background: 'rgba(255,255,255,.05)',
            border: `1px solid ${C.border}`,
            color: C.muted,
            borderRadius: 9,
            cursor: 'pointer',
          }}
        >
          ↻
        </button>
      </div>
    </div>
  )
}
