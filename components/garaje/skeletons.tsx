'use client'

// Skeleton loaders del Garaje Digital. Coinciden en forma y tamaño con las
// cards reales para evitar layout shift al hidratarse con los datos.

import { C } from './theme'

let shimmerInjected = false
function injectShimmer() {
  if (shimmerInjected || typeof document === 'undefined') return
  const style = document.createElement('style')
  style.textContent = `
    @keyframes rodaid-shimmer {
      0%   { background-position: -400px 0 }
      100% { background-position:  400px 0 }
    }
    .rsk {
      background: linear-gradient(90deg,
        rgba(255,255,255,.04) 25%,
        rgba(255,255,255,.09) 50%,
        rgba(255,255,255,.04) 75%
      );
      background-size: 400px 100%;
      background-repeat: no-repeat;
      animation: rodaid-shimmer 1.4s ease-in-out infinite;
      border-radius: 6px;
    }
  `
  document.head.appendChild(style)
  shimmerInjected = true
}

// Átomo shimmer.
export function Sk({
  w = '100%',
  h = 14,
  mb = 0,
  r = 6,
}: {
  w?: number | string
  h?: number | string
  mb?: number
  r?: number
}) {
  injectShimmer()
  return (
    <div
      className="rsk"
      style={{ width: w, height: h, marginBottom: mb, borderRadius: r }}
    />
  )
}

// Skeleton de una BicicletaCard completa.
function SkeletonBicicletaCard() {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: 20,
        marginBottom: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Sk w={40} h={40} r={10} />
          <div>
            <Sk w={120} h={16} mb={6} />
            <Sk w={90} h={11} />
          </div>
        </div>
        <Sk w={80} h={22} r={99} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 14 }}>
        {[...Array(4)].map((_, i) => (
          <div key={i} style={{ background: 'rgba(255,255,255,.03)', borderRadius: 8, padding: 10 }}>
            <Sk w="60%" h={10} mb={6} />
            <Sk w="80%" h={18} />
          </div>
        ))}
      </div>

      <Sk w="100%" h={6} r={99} mb={8} />
      <Sk w="50%" h={10} mb={14} />

      <div style={{ display: 'flex', gap: 8 }}>
        <Sk w="50%" h={36} r={9} />
        <Sk w="25%" h={36} r={9} />
        <Sk w="25%" h={36} r={9} />
      </div>
    </div>
  )
}

// Skeleton del Garaje completo (KPIs + N cards).
export function SkeletonGaraje({ count = 2 }: { count?: number }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}
          >
            <Sk w="70%" h={11} mb={6} />
            <Sk w="50%" h={22} mb={4} />
            <Sk w="80%" h={10} />
          </div>
        ))}
      </div>
      {[...Array(count)].map((_, i) => (
        <SkeletonBicicletaCard key={i} />
      ))}
    </div>
  )
}
