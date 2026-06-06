// ─── RODAID · Página pública /verificar ───────────────────────────────────
// Monta el lector de QR del Verificador Público (Tarea 6).

import { QRScannerVerificador } from '@/components/scanner/QRScannerVerificador'

export const metadata = {
  title: 'Verificador RODAID — Certificación de Bicicletas',
  description:
    'Verificá el estado del Certificado de Inspección Técnica (CIT) de una bicicleta — Ley 9556 Mendoza.',
}

export default function VerificarPage() {
  return (
    <main className="min-h-screen bg-background py-8">
      <QRScannerVerificador />
    </main>
  )
}
