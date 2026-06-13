// Paleta y estilos compartidos del Garaje Digital RODAID.

export const C = {
  navy:   '#0F1E35',
  orange: '#F47B20',
  teal:   '#2BBCB8',
  muted:  '#8FA3C0',
  border: 'rgba(255,255,255,0.08)',
  card:   'rgba(255,255,255,0.04)',
  green:  '#4ade80',
  yellow: '#fbbf24',
  red:    '#f87171',
} as const

import type { EstadoCIT } from '@/lib/garaje-api'

export const CIT_BADGE: Record<EstadoCIT, { label: string; bg: string; color: string }> = {
  ACTIVO:         { label: '✅ CIT ACTIVO',           bg: 'rgba(74,222,128,.12)',  color: C.green  },
  PENDIENTE_PAGO: { label: '⏳ Tasa pendiente',       bg: 'rgba(251,191,36,.12)',  color: C.yellow },
  EXPIRADO:       { label: '❌ CIT expirado',         bg: 'rgba(248,113,113,.12)', color: C.red    },
  BORRADOR:       { label: '⚠ Inspección incompleta', bg: 'rgba(244,123,32,.12)',  color: C.orange },
  SIN_CIT:        { label: '— Sin CIT',               bg: 'rgba(143,163,192,.10)', color: C.muted  },
}
