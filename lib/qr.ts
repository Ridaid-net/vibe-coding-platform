// ─── RODAID · Generacion de codigo QR ──────────────────────────────────
//
// Genera el codigo QR real que se imprime en el Certificado de Identidad
// Tecnologica. El QR codifica la URL publica de verificacion
// (/verificar/:serialHash), de modo que cualquiera pueda escanearlo y
// confirmar la autenticidad del certificado.
//
// Se apoya en `qrcode` (solo cliente). El import es dinamico para no sumar la
// libreria al bundle inicial: solo se carga cuando se renderiza un certificado.

/** URL publica de verificacion para un serialHash dado. */
export function urlVerificacion(serialHash: string): string {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : ''
  return `${origin}/verificar/${serialHash}`
}

/**
 * Genera un data URL (PNG) con el QR que apunta a la URL de verificacion del
 * serialHash. Nivel de correccion de error "M" para tolerar el reescalado y
 * la impresion del certificado.
 */
export async function generarQrVerificacion(serialHash: string): Promise<string> {
  const { default: QRCode } = await import('qrcode')
  return QRCode.toDataURL(urlVerificacion(serialHash), {
    margin: 1,
    width: 320,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#0F1E35',
      light: '#FFFFFF',
    },
  })
}
