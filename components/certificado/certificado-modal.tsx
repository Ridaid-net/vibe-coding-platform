'use client'

// Overlay que muestra el documento del Certificado de Identidad Tecnologica
// sobre el Garaje Digital. Se cierra con el boton, con la tecla Escape o al
// hacer clic fuera del documento.

import { useEffect } from 'react'
import { CertificadoCIT, type CertificadoData } from './certificado-cit'
import { C } from '@/components/garaje/theme'

export function CertificadoModal({
  data,
  onClose,
}: {
  data: CertificadoData
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Certificado ${data.numeroCIT}`}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(8,15,28,.78)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '32px 16px',
        overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 620, position: 'relative' }}
      >
        <button
          onClick={onClose}
          aria-label="Cerrar"
          style={{
            position: 'absolute',
            top: -10,
            right: -6,
            width: 34,
            height: 34,
            borderRadius: 99,
            background: C.card,
            color: '#F8FAFC',
            border: `1px solid ${C.border}`,
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            zIndex: 1,
          }}
        >
          ✕
        </button>
        <CertificadoCIT data={data} />
      </div>
    </div>
  )
}

export default CertificadoModal
