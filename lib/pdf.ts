// ─── RODAID · Descarga de documentos PDF (client-side) ──────────────────
//
// Convierte un nodo del DOM (el certificado renderizado) en un PDF descargable
// usando html2canvas + jsPDF. Todo ocurre en el navegador: no se envia el
// documento a ningun servidor. Los imports son dinamicos para mantener ambas
// librerias fuera del bundle inicial; solo se cargan al pulsar "Descargar PDF".

export interface DescargarPdfOpts {
  /** Nombre del archivo resultante (se le agrega .pdf si falta). */
  filename: string
  /** Color de fondo para las zonas transparentes del recorte. */
  backgroundColor?: string
}

/**
 * Rasteriza `el` y lo guarda como PDF A4 vertical, paginando si el documento
 * es mas alto que una pagina. Devuelve cuando la descarga fue disparada.
 */
export async function descargarElementoComoPdf(
  el: HTMLElement,
  opts: DescargarPdfOpts
): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ])

  const canvas = await html2canvas(el, {
    scale: 2,
    backgroundColor: opts.backgroundColor ?? '#FFFFFF',
    useCORS: true,
    logging: false,
  })

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()

  // Ajusta el ancho de la imagen al ancho de la pagina y conserva la relacion.
  const imgW = pageW
  const imgH = (canvas.height * imgW) / canvas.width
  const imgData = canvas.toDataURL('image/png')

  let heightLeft = imgH
  let position = 0

  pdf.addImage(imgData, 'PNG', 0, position, imgW, imgH)
  heightLeft -= pageH

  // Documentos mas altos que una pagina se reparten en paginas sucesivas.
  while (heightLeft > 0) {
    position -= pageH
    pdf.addPage()
    pdf.addImage(imgData, 'PNG', 0, position, imgW, imgH)
    heightLeft -= pageH
  }

  const filename = opts.filename.endsWith('.pdf')
    ? opts.filename
    : `${opts.filename}.pdf`
  pdf.save(filename)
}
