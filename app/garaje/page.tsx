'use client'

// Pantalla del Garaje Digital RODAID — /garaje
// Renderiza el Garaje Digital cableado al endpoint optimizado y conecta las
// acciones de cada card (cotizar seguro / ver CIT / registrar) con feedback
// al usuario vía toasts.

import { toast } from 'sonner'
import { GarajeDigital } from '@/components/garaje/garaje-digital'
import { C } from '@/components/garaje/theme'

export default function GarajePage() {
  const handleCotizar = (_biciId: string, citId: string) => {
    toast.info('Cotización de seguro', {
      description: `Iniciando cotización para el CIT ${citId}.`,
    })
  }

  const handleRegistrar = () => {
    toast.info('Registrar bicicleta', {
      description: 'Iniciando el alta de un nuevo rodado.',
    })
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: C.navy,
        color: '#F8FAFC',
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
        padding: '32px 16px',
      }}
    >
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <header style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 26 }}>🚲</span>
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Garaje Digital</h1>
          </div>
          <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>
            Tus rodados, su Certificado de Identidad Tecnológica y la cobertura de seguro, en un
            solo lugar.
          </p>
        </header>

        <GarajeDigital
          onCotizar={handleCotizar}
          onRegistrar={handleRegistrar}
        />
      </div>
    </main>
  )
}
