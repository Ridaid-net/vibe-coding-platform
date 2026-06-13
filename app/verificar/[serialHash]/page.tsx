// Pagina publica de verificacion del Certificado de Identidad Tecnologica.
// Es el destino del codigo QR impreso en cada certificado PDF: cualquiera
// puede escanearlo (por ejemplo, al comprar una bici usada) y confirmar la
// autenticidad y el estado del CIT, sin necesidad de iniciar sesion.

import Link from 'next/link'
import { verificarCIT, type VerificacionCIT } from '@/lib/verificar'
import { C } from '@/components/garaje/theme'

export const dynamic = 'force-dynamic'

const PAGE_FONT =
  'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif'

function fmtFecha(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

interface Veredicto {
  icono: string
  titulo: string
  detalle: string
  color: string
  bg: string
  borde: string
}

function veredictoDe(v: VerificacionCIT): Veredicto {
  if (v.estado === 'ACTIVO' && v.zonaVencimiento === 'PROXIMO_A_VENCER') {
    return {
      icono: '⚠️',
      titulo: 'Certificado vigente — próximo a vencer',
      detalle:
        v.diasRestantes != null
          ? `El CIT es auténtico y está vigente, pero vence en ${v.diasRestantes} día(s).`
          : 'El CIT es auténtico y está vigente, pero está próximo a vencer.',
      color: C.yellow,
      bg: 'rgba(251,191,36,.10)',
      borde: 'rgba(251,191,36,.35)',
    }
  }
  if (v.vigente) {
    return {
      icono: '✅',
      titulo: 'Certificado verificado y vigente',
      detalle: 'El CIT es auténtico y se encuentra activo en el registro de RODAID.',
      color: C.green,
      bg: 'rgba(74,222,128,.10)',
      borde: 'rgba(74,222,128,.35)',
    }
  }
  if (v.estado === 'PENDIENTE_PAGO') {
    return {
      icono: '⏳',
      titulo: 'Certificado auténtico — tasa pendiente',
      detalle:
        'El CIT está firmado digitalmente pero no es oficial hasta que se acredite el pago de la tasa.',
      color: C.yellow,
      bg: 'rgba(251,191,36,.10)',
      borde: 'rgba(251,191,36,.35)',
    }
  }
  if (v.estado === 'EXPIRADO' || v.zonaVencimiento === 'VENCIDO') {
    return {
      icono: '⛔',
      titulo: 'Certificado auténtico — expirado',
      detalle: 'El CIT existe en el registro pero su vigencia ya venció. Requiere renovación.',
      color: C.red,
      bg: 'rgba(248,113,113,.10)',
      borde: 'rgba(248,113,113,.35)',
    }
  }
  return {
    icono: '📝',
    titulo: 'Certificado en borrador',
    detalle: 'El registro existe pero el CIT aún no fue emitido de forma oficial.',
    color: C.orange,
    bg: 'rgba(244,123,32,.10)',
    borde: 'rgba(244,123,32,.35)',
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: C.navy,
        color: '#F8FAFC',
        fontFamily: PAGE_FONT,
        padding: '40px 16px',
      }}
    >
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <span style={{ fontSize: 24 }}>🚲</span>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: 0.5 }}>RODAID</div>
            <div style={{ fontSize: 11, color: C.muted }}>Verificación de certificado</div>
          </div>
        </div>
        {children}
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <Link href="/garaje" style={{ fontSize: 12, color: C.teal, textDecoration: 'none' }}>
            Ir al Garaje Digital →
          </Link>
        </div>
      </div>
    </main>
  )
}

function Dato({ etiqueta, valor, mono }: { etiqueta: string; valor: string; mono?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        padding: '10px 0',
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <span style={{ fontSize: 12, color: C.muted }}>{etiqueta}</span>
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          textAlign: 'right',
          fontFamily: mono ? 'monospace' : undefined,
          wordBreak: mono ? 'break-all' : undefined,
        }}
      >
        {valor}
      </span>
    </div>
  )
}

export default async function VerificarPage({
  params,
}: {
  params: Promise<{ serialHash: string }>
}) {
  const { serialHash } = await params
  const verificacion = await verificarCIT(serialHash)

  if (!verificacion) {
    return (
      <Shell>
        <div
          style={{
            background: 'rgba(248,113,113,.10)',
            border: '1px solid rgba(248,113,113,.35)',
            borderRadius: 14,
            padding: 24,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 8 }}>❌</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.red, marginBottom: 6 }}>
            Certificado no encontrado
          </div>
          <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>
            No existe ningún Certificado de Identidad Tecnológica asociado a este código de
            verificación. Si lo escaneaste de un documento, podría ser inválido o haber sido
            alterado.
          </p>
        </div>
      </Shell>
    )
  }

  const v = verificacion
  const veredicto = veredictoDe(v)

  return (
    <Shell>
      {/* Veredicto */}
      <div
        style={{
          background: veredicto.bg,
          border: `1px solid ${veredicto.borde}`,
          borderRadius: 14,
          padding: 24,
          textAlign: 'center',
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 8 }}>{veredicto.icono}</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: veredicto.color, marginBottom: 6 }}>
          {veredicto.titulo}
        </div>
        <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>{veredicto.detalle}</p>
      </div>

      {/* Detalle del certificado */}
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: '6px 20px 16px',
        }}
      >
        <div style={{ padding: '16px 0 8px' }}>
          <div style={{ fontSize: 10, color: C.teal, fontWeight: 700, letterSpacing: 1 }}>
            RODADO
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>
            {v.bicicleta.marca} {v.bicicleta.modelo}
          </div>
        </div>

        <Dato etiqueta="N.º de certificado" valor={v.numeroCIT} mono />
        <Dato etiqueta="Número de serie" valor={v.bicicleta.numeroSerie} mono />
        <Dato etiqueta="Fecha de emisión" valor={fmtFecha(v.fechaEmision)} />
        <Dato etiqueta="Válido hasta" valor={fmtFecha(v.fechaVencimiento)} />
        <Dato
          etiqueta="Sello blockchain"
          valor={
            v.hasHashBFA
              ? `Anclado en BFA${v.nftTokenId ? ` · NFT #${v.nftTokenId}` : ''}`
              : 'Pendiente de anclaje'
          }
        />
        <Dato etiqueta="Hash SHA-256" valor={v.hashSHA256} mono />
      </div>

      <p
        style={{
          fontSize: 11,
          color: C.muted,
          textAlign: 'center',
          marginTop: 14,
          lineHeight: 1.5,
        }}
      >
        Verificación realizada contra el registro oficial de RODAID. El hash SHA-256 identifica de
        forma única e inalterable a este certificado.
      </p>
    </Shell>
  )
}
