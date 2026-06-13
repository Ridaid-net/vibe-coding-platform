'use client'

// Estados no-felices del Garaje Digital: garaje vacío y error de carga.

import { C } from './theme'
import type { ApiClientError } from '@/lib/garaje-api'

export function GarajeVacio({ onRegistrar }: { onRegistrar?: () => void }) {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '48px 24px',
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
      }}
    >
      <div style={{ fontSize: 48, marginBottom: 12 }}>🚲</div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Tu garaje está vacío</div>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>
        Registrá tu primera bicicleta para obtener el CIT y protegerla en la blockchain.
      </div>
      <button
        onClick={onRegistrar}
        style={{
          padding: '12px 28px',
          fontSize: 14,
          fontWeight: 600,
          background: C.orange,
          color: '#fff',
          border: 'none',
          borderRadius: 10,
          cursor: 'pointer',
        }}
      >
        Registrar mi bicicleta →
      </button>
    </div>
  )
}

export function ErrorGaraje({
  error,
  onRetry,
  intentos,
}: {
  error: ApiClientError | null
  onRetry: () => void
  intentos: number
}) {
  return (
    <div
      style={{
        padding: 20,
        background: 'rgba(248,113,113,.06)',
        border: '1px solid rgba(248,113,113,.2)',
        borderRadius: 14,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 14, color: C.red, marginBottom: 8 }}>
        ✗ Error cargando el Garaje Digital
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 16, fontFamily: 'monospace' }}>
        {error?.message ?? 'Error desconocido'}
      </div>
      {intentos < 3 && (
        <button
          onClick={onRetry}
          style={{
            padding: '8px 20px',
            fontSize: 12,
            fontWeight: 600,
            background: 'rgba(248,113,113,.12)',
            color: C.red,
            border: '1px solid rgba(248,113,113,.3)',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          Reintentar ({intentos}/3)
        </button>
      )}
    </div>
  )
}
