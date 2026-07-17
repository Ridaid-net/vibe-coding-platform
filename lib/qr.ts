import QRCode from 'qrcode'

/**
 * RODAID — Generador de QR compartido.
 *
 * Extraido de pdf.service.ts (donde nacio para el QR del certificado CIT) para
 * reusarlo tambien en el Historial Clinico publico (Hito "Score de Confianza"
 * / compartir). Misma configuracion visual en los dos usos.
 */
export async function generarQrPng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 1,
    scale: 8,
    color: { dark: '#14160eff', light: '#ffffffff' },
  })
}
