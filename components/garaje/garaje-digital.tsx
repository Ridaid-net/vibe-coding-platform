'use client'

// Componente principal del Garaje Digital. Orquesta los cuatro estados de
// la pantalla a partir del hook `useGaraje`:
//   loading → <SkeletonGaraje />
//   error   → <ErrorGaraje /> (retry hasta 3×)
//   empty   → <GarajeVacio />
//   data    → KPIs globales + <BicicletaCard /> por rodado

import { useState } from 'react'
import { useGaraje } from './use-garaje'
import { SkeletonGaraje } from './skeletons'
import { BicicletaCard, KPICell } from './bicicleta-card'
import { ErrorGaraje, GarajeVacio } from './states'
import { C } from './theme'
import { CertificadoModal } from '@/components/certificado/certificado-modal'
import type { CertificadoData } from '@/components/certificado/certificado-cit'
import type { BicicletaGaraje } from '@/lib/garaje-api'

export interface GarajeDigitalProps {
  onCotizar?: (biciId: string, citId: string) => void
  onVerCIT?: (citId: string) => void
  onRegistrar?: () => void
}

/** Construye los datos del documento CIT a partir de una bicicleta del garaje. */
function aCertificadoData(bici: BicicletaGaraje): CertificadoData | null {
  const cit = bici.cit
  if (!cit) return null
  return {
    marca: bici.marca,
    modelo: bici.modelo,
    numeroSerie: bici.numeroSerie,
    numeroCIT: cit.numeroCIT,
    estado: cit.estado,
    puntosTotal: cit.puntosTotal,
    puntajeMax: cit.puntajeMax,
    hasHashBFA: cit.hasHashBFA,
    nftTokenId: cit.nftTokenId,
    tasaPagada: cit.tasaPagada,
    fechaEmision: cit.fechaEmision,
    fechaVencimiento: cit.fechaVencimiento,
    hashSHA256: cit.hashSHA256,
  }
}

export function GarajeDigital({ onCotizar, onVerCIT, onRegistrar }: GarajeDigitalProps) {
  const { data, loading, error, intentos, refresh } = useGaraje()
  const [certificado, setCertificado] = useState<CertificadoData | null>(null)

  const handleCotizar = (biciId: string, citId: string) => onCotizar?.(biciId, citId)
  const handleVerCIT = (citId: string) => {
    const bici = data?.bicicletas.find((b) => b.cit?.id === citId)
    const cert = bici ? aCertificadoData(bici) : null
    if (cert) setCertificado(cert)
    onVerCIT?.(citId)
  }

  if (loading) {
    return (
      <div>
        <div style={{ marginBottom: 12, fontSize: 12, color: C.muted }}>
          Cargando Garaje Digital…
        </div>
        <SkeletonGaraje count={2} />
      </div>
    )
  }

  if (error) {
    return <ErrorGaraje error={error} onRetry={refresh} intentos={intentos} />
  }

  if (!data?.bicicletas?.length) {
    return <GarajeVacio onRegistrar={onRegistrar} />
  }

  const { bicicletas, resumen } = data

  return (
    <div>
      {/* ── KPIs globales del garaje ──────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: 10,
          marginBottom: 16,
        }}
      >
        <KPICell label="Bicicletas" value={resumen.totalBicicletas} color="#F8FAFC" sub="en tu garaje" />
        <KPICell
          label="CITs activos"
          value={resumen.citsActivos}
          color={resumen.citsActivos > 0 ? C.green : C.muted}
          sub={resumen.citsBorrador > 0 ? `${resumen.citsBorrador} en borrador` : 'al día'}
        />
        <KPICell
          label="Score promedio"
          value={resumen.scorePromedioSalud}
          color={resumen.scorePromedioSalud >= 75 ? C.teal : C.orange}
          sub="/ 100 salud"
        />
        <KPICell
          label="Pólizas activas"
          value={resumen.polizasActivas}
          color={resumen.polizasActivas > 0 ? C.green : C.muted}
          sub={resumen.polizasActivas > 0 ? 'aseguradas' : 'sin seguro'}
        />
      </div>

      {/* ── Cards de bicicletas ───────────────────────── */}
      {bicicletas.map((bici) => (
        <BicicletaCard
          key={bici.id}
          bici={bici}
          onCotizar={handleCotizar}
          onVerCIT={handleVerCIT}
          onRefresh={refresh}
        />
      ))}

      {/* ── Footer endpoint info ──────────────────────── */}
      <div
        style={{
          marginTop: 8,
          padding: '8px 12px',
          background: 'rgba(255,255,255,.02)',
          borderRadius: 8,
          fontSize: 10,
          color: C.muted,
          fontFamily: 'monospace',
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 4,
        }}
      >
        <span>GET /api/v1/garaje/resumen · Cache 30s</span>
        <button
          onClick={refresh}
          style={{
            background: 'none',
            border: 'none',
            color: C.muted,
            fontFamily: 'monospace',
            fontSize: 10,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          ↻ Actualizar
        </button>
      </div>

      {certificado && (
        <CertificadoModal data={certificado} onClose={() => setCertificado(null)} />
      )}
    </div>
  )
}

export default GarajeDigital
