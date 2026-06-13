'use client'

// ─── RODAID · Documento del Certificado de Identidad Tecnologica ────────
//
// Renderiza el CIT como un documento "oficial" imprimible en formato carta y
// permite descargarlo como PDF (client-side, via html2canvas + jsPDF). Incluye
// un codigo QR real que apunta a la pagina publica /verificar/:serialHash, de
// modo que el documento sea verificable por quien lo reciba.
//
// El documento usa exclusivamente estilos en linea con colores hex/rgb para
// que la rasterizacion con html2canvas sea fiel y no dependa de variables CSS.

import { useEffect, useRef, useState } from 'react'
import { C } from '@/components/garaje/theme'
import { descargarElementoComoPdf } from '@/lib/pdf'
import { generarQrVerificacion, urlVerificacion } from '@/lib/qr'

export interface CertificadoData {
  marca: string
  modelo: string
  numeroSerie: string
  numeroCIT: string
  estado: 'ACTIVO' | 'EXPIRADO' | 'BORRADOR' | 'PENDIENTE_PAGO' | 'SIN_CIT'
  puntosTotal: number
  puntajeMax: number
  hasHashBFA: boolean
  nftTokenId: string | null
  tasaPagada: boolean
  fechaEmision: string | null
  fechaVencimiento: string | null
  hashSHA256: string | null
}

const PAPER = '#FFFFFF'
const INK = '#0F1E35'
const INK_SOFT = '#475569'
const LINE = '#E2E8F0'

const ESTADO_LABEL: Record<CertificadoData['estado'], { label: string; color: string }> = {
  ACTIVO: { label: 'VIGENTE', color: '#15803d' },
  PENDIENTE_PAGO: { label: 'PENDIENTE DE PAGO', color: '#b45309' },
  EXPIRADO: { label: 'EXPIRADO', color: '#b91c1c' },
  BORRADOR: { label: 'BORRADOR · NO OFICIAL', color: '#c2410c' },
  SIN_CIT: { label: 'SIN CERTIFICAR', color: '#64748b' },
}

function fmtFecha(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

export function CertificadoCIT({ data }: { data: CertificadoData }) {
  const docRef = useRef<HTMLDivElement>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [descargando, setDescargando] = useState(false)
  const sellado = Boolean(data.hashSHA256)
  const estado = ESTADO_LABEL[data.estado] ?? ESTADO_LABEL.SIN_CIT

  useEffect(() => {
    let activo = true
    if (data.hashSHA256) {
      generarQrVerificacion(data.hashSHA256)
        .then((url) => {
          if (activo) setQr(url)
        })
        .catch(() => {
          if (activo) setQr(null)
        })
    } else {
      setQr(null)
    }
    return () => {
      activo = false
    }
  }, [data.hashSHA256])

  async function handleDescargar() {
    if (!docRef.current || descargando) return
    setDescargando(true)
    try {
      await descargarElementoComoPdf(docRef.current, {
        filename: `CIT-${data.numeroCIT}`,
        backgroundColor: PAPER,
      })
    } finally {
      setDescargando(false)
    }
  }

  return (
    <div>
      {/* ── Barra de acciones (no forma parte del PDF) ────────── */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
          marginBottom: 14,
          flexWrap: 'wrap',
        }}
      >
        {sellado && (
          <a
            href={urlVerificacion(data.hashSHA256 as string)}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '9px 16px',
              fontSize: 12,
              fontWeight: 600,
              background: 'rgba(43,188,184,.12)',
              color: C.teal,
              border: '1px solid rgba(43,188,184,.3)',
              borderRadius: 9,
              textDecoration: 'none',
            }}
          >
            🔗 Verificar online
          </a>
        )}
        <button
          onClick={handleDescargar}
          disabled={descargando}
          style={{
            padding: '9px 16px',
            fontSize: 12,
            fontWeight: 700,
            background: descargando ? 'rgba(244,123,32,.5)' : C.orange,
            color: '#fff',
            border: 'none',
            borderRadius: 9,
            cursor: descargando ? 'progress' : 'pointer',
          }}
        >
          {descargando ? 'Generando PDF…' : '⬇ Descargar PDF'}
        </button>
      </div>

      {/* ── Documento (esto es lo que se rasteriza al PDF) ─────── */}
      <div
        ref={docRef}
        style={{
          background: PAPER,
          color: INK,
          borderRadius: 6,
          overflow: 'hidden',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
          boxShadow: '0 10px 40px rgba(0,0,0,.35)',
          border: `1px solid ${LINE}`,
        }}
      >
        {/* Encabezado institucional */}
        <div
          style={{
            background: INK,
            color: '#fff',
            padding: '22px 28px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 30 }}>🚲</span>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 0.5 }}>RODAID</div>
              <div style={{ fontSize: 11, color: '#9fb2cc' }}>
                Certificado de Identidad Tecnológica
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: '#9fb2cc' }}>N.º de certificado</div>
            <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace' }}>
              {data.numeroCIT}
            </div>
          </div>
        </div>

        {/* Banda de estado */}
        <div
          style={{
            padding: '10px 28px',
            background: '#F8FAFC',
            borderBottom: `1px solid ${LINE}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ fontSize: 11, color: INK_SOFT }}>Estado del certificado</span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 800,
              color: estado.color,
              letterSpacing: 0.5,
            }}
          >
            ● {estado.label}
          </span>
        </div>

        {/* Cuerpo */}
        <div style={{ padding: '24px 28px' }}>
          {/* Datos del rodado */}
          <div style={{ marginBottom: 22 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: C.teal,
                letterSpacing: 1,
                marginBottom: 10,
              }}
            >
              RODADO CERTIFICADO
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: INK }}>
              {data.marca} {data.modelo}
            </div>
            <div style={{ display: 'flex', gap: 28, marginTop: 12, flexWrap: 'wrap' }}>
              <Campo etiqueta="Número de serie" valor={data.numeroSerie} mono />
              <Campo
                etiqueta="Inspección"
                valor={`${data.puntosTotal} / ${data.puntajeMax} puntos`}
              />
              <Campo etiqueta="Tasa MxM" valor={data.tasaPagada ? 'Pagada' : 'Pendiente'} />
            </div>
          </div>

          <div style={{ height: 1, background: LINE, margin: '4px 0 22px' }} />

          {/* Vigencia + QR */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 24,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: '1 1 220px' }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: C.teal,
                  letterSpacing: 1,
                  marginBottom: 10,
                }}
              >
                VIGENCIA
              </div>
              <Campo etiqueta="Fecha de emisión" valor={fmtFecha(data.fechaEmision)} />
              <div style={{ height: 10 }} />
              <Campo etiqueta="Válido hasta" valor={fmtFecha(data.fechaVencimiento)} />
            </div>

            {/* QR de verificacion */}
            <div style={{ textAlign: 'center', flex: '0 0 auto' }}>
              <div
                style={{
                  width: 140,
                  height: 140,
                  border: `1px solid ${LINE}`,
                  borderRadius: 10,
                  background: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 8,
                }}
              >
                {qr ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qr}
                    alt="Código QR de verificación"
                    width={124}
                    height={124}
                    style={{ display: 'block' }}
                  />
                ) : (
                  <span style={{ fontSize: 10, color: INK_SOFT, textAlign: 'center' }}>
                    {sellado ? 'Generando QR…' : 'Sin sello\ndigital'}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 9, color: INK_SOFT, marginTop: 6, maxWidth: 140 }}>
                {sellado ? 'Escaneá para verificar' : 'Certificado no oficial'}
              </div>
            </div>
          </div>

          {/* Sello blockchain */}
          <div
            style={{
              marginTop: 22,
              padding: '14px 16px',
              background: '#F1F5F9',
              border: `1px solid ${LINE}`,
              borderRadius: 10,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: C.teal,
                letterSpacing: 1,
                marginBottom: 8,
              }}
            >
              SELLO DIGITAL · BLOCKCHAIN FEDERAL ARGENTINA
            </div>
            {sellado ? (
              <>
                <div style={{ fontSize: 10, color: INK_SOFT, marginBottom: 3 }}>
                  Hash SHA-256 {data.hasHashBFA ? '· anclado en BFA' : '· pendiente de anclaje'}
                  {data.nftTokenId ? ` · NFT #${data.nftTokenId}` : ''}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: 'monospace',
                    color: INK,
                    wordBreak: 'break-all',
                    lineHeight: 1.5,
                  }}
                >
                  {data.hashSHA256}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 11, color: INK_SOFT }}>
                Este certificado aún no fue sellado digitalmente. Completá la inspección y el pago
                de la tasa para emitir el CIT oficial con su sello en blockchain.
              </div>
            )}
          </div>
        </div>

        {/* Pie */}
        <div
          style={{
            padding: '12px 28px',
            background: INK,
            color: '#9fb2cc',
            fontSize: 9.5,
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span>RODAID · Registro de Identidad Tecnológica de Rodados</span>
          <span style={{ fontFamily: 'monospace' }}>
            {sellado ? urlVerificacion(data.hashSHA256 as string) : 'documento sin valor oficial'}
          </span>
        </div>
      </div>
    </div>
  )
}

function Campo({
  etiqueta,
  valor,
  mono,
}: {
  etiqueta: string
  valor: string
  mono?: boolean
}) {
  return (
    <div>
      <div style={{ fontSize: 10, color: INK_SOFT, marginBottom: 3 }}>{etiqueta}</div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: INK,
          fontFamily: mono ? 'monospace' : undefined,
        }}
      >
        {valor}
      </div>
    </div>
  )
}

export default CertificadoCIT
