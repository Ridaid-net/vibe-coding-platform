// ─── RODAID · PDF Service — Puppeteer (Headless Chrome) ──
// Genera el PDF del CIT renderizando HTML en Chrome/Chromium
// headless vía puppeteer-core.
//
// Ventajas vs PDFKit (server-side nativo):
//   · Texto vectorial → búscable, seleccionable, mejor impresión
//   · CSS completo: Flexbox, Grid, @media print, custom properties
//   · Fuentes del sistema / Google Fonts cargadas por Chrome
//   · Inspección visual del HTML antes de imprimir
//   · Exactamente lo que el ciclista/inspector ve en el navegador
//
// Ventajas vs html2canvas (client-side):
//   · Sin peso en el bundle del frontend (~650KB menos)
//   · No requiere que el usuario tenga Chrome/Firefox
//   · Calidad superior: vectorial vs raster
//   · Generación batch (email, IPFS) directamente desde el servidor
//
// Arquitectura:
//   BrowserPool — gestiona una instancia única de Chrome reutilizada
//     entre requests. Abre nueva página por request, cierra al terminar.
//   PdfPuppeteerService — construye el HTML, llama a page.pdf(), retorna Buffer.
//   Fallback — si Chrome no está disponible, delega a PDFKit (pdf.service.ts).
//
// Instalación en producción:
//   npm install puppeteer-core
//   # Ubuntu/Debian:
//   apt-get install -y chromium-browser
//   # macOS:
//   brew install chromium
//   # Docker (recomendado para producción):
//   FROM ghcr.io/puppeteer/puppeteer:latest
//
// Variables de entorno:
//   PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
//   PUPPETEER_TIMEOUT_MS=30000
//   PUPPETEER_MAX_CONCURRENT=3

import puppeteer, { Browser, Page } from 'puppeteer-core'
import { getRedis }   from '../config/redis'
import crypto    from 'crypto'
import { log }   from '../middleware/logger'
import { env }   from '../config/env'
import { queryOne } from '../config/database'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export interface CITPdfInput {
  numeroCIT:         string
  hashSHA256:        string
  serial:            string
  marca:             string
  modelo:            string
  anio:              number
  tipo:              string
  color:             string
  propietarioNombre: string
  propietarioDNI:    string
  inspectorNombre:   string
  inspectorApellido: string
  tallerNombre:      string
  tallerLocalidad:   string
  puntos:            Record<string, boolean>
  totalPuntos:       number
  fechaEmision:      string
  fechaVencimiento:  string
  nftTokenId?:       number
  bfaTxHash?:        string
  fotosUrls:         string[]
  codigoVerif?:     string
  selladoEn?:       string
  selloModo?:       string
}

export interface PdfResult {
  buffer:    Buffer
  bytes:     number
  motor:     'PUPPETEER' | 'PDFKIT'
  duracionMs: number
  hash:      string    // SHA-256 del PDF generado
}

// ══════════════════════════════════════════════════════════
// BROWSER POOL
// ══════════════════════════════════════════════════════════

class BrowserPool {
  private browser: Browser | null = null
  private concurrentes = 0
  private readonly maxConcurrentes: number
  private readonly timeoutMs: number
  private readonly execPath: string | null

  constructor() {
    this.maxConcurrentes = parseInt(process.env.PUPPETEER_MAX_CONCURRENT ?? '3')
    this.timeoutMs       = parseInt(process.env.PUPPETEER_TIMEOUT_MS    ?? '30000')
    this.execPath        = process.env.PUPPETEER_EXECUTABLE_PATH
      ?? this.detectarChrome()
  }

  /** Detectar Chrome/Chromium instalado en el sistema */
  private detectarChrome(): string | null {
    const candidates = [
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ]
    const fs = require('fs')
    return candidates.find(p => { try { fs.accessSync(p); return true } catch { return false } }) ?? null
  }

  get disponible(): boolean {
    return this.execPath !== null
  }

  get rutaChrome(): string | null {
    return this.execPath
  }

  /** Lanzar browser si no está activo */
  async iniciar(): Promise<void> {
    if (this.browser?.connected) return
    if (!this.execPath) {
      throw new Error(
        `Chrome/Chromium no encontrado. ` +
        `Instalar con: apt-get install chromium-browser ` +
        `y configurar PUPPETEER_EXECUTABLE_PATH`
      )
    }

    log.pdf.info({ execPath: this.execPath }, '🚀 Iniciando Chrome headless')

    this.browser = await puppeteer.launch({
      executablePath: this.execPath,
      headless:       true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',   // crucial en Docker/CI
        '--disable-gpu',
        '--disable-extensions',
        '--disable-software-rasterizer',
        '--font-render-hinting=none',
        '--run-all-compositor-stages-before-draw',
        '--window-size=1200,900',
      ],
    })

    // Reiniciar si Chrome muere inesperadamente
    this.browser.on('disconnected', () => {
      log.pdf.warn('Chrome desconectado — se reconectará en el próximo request')
      this.browser = null
    })

    log.pdf.info({ pid: this.browser.process()?.pid }, '✓ Chrome headless listo')
  }

  /** Obtener una página nueva (maneja concurrencia máxima) */
  async obtenerPagina(): Promise<Page> {
    if (this.concurrentes >= this.maxConcurrentes) {
      throw new Error(
        `Límite de ${this.maxConcurrentes} PDFs concurrentes alcanzado. ` +
        `Reintentar en unos segundos.`
      )
    }

    await this.iniciar()
    this.concurrentes++

    const page = await this.browser!.newPage()

    // Interceptar recursos innecesarios para acelerar
    await page.setRequestInterception(true)
    page.on('request', req => {
      const tipo = req.resourceType()
      if (['stylesheet', 'font', 'image', 'media'].includes(tipo) &&
          !req.url().startsWith('data:')) {
        // Solo bloquear externos — permitir inline (data: URIs)
        req.abort()
      } else {
        req.continue()
      }
    })

    return page
  }

  /** Liberar página después de usarla */
  async liberarPagina(page: Page): Promise<void> {
    try {
      await page.close()
    } catch { /* ya cerrada */ }
    this.concurrentes = Math.max(0, this.concurrentes - 1)
  }

  /** Cerrar browser (al apagar el servidor) */
  async cerrar(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {})
      this.browser = null
      log.pdf.info('Chrome headless cerrado')
    }
  }

  /** Estado actual del pool para health checks */
  status(): {
    disponible: boolean
    rutaChrome: string | null
    concurrentes: number
    maxConcurrentes: number
    browserConectado: boolean
  } {
    return {
      disponible:       this.execPath !== null,
      rutaChrome:       this.execPath,
      concurrentes:     this.concurrentes,
      maxConcurrentes:  this.maxConcurrentes,
      browserConectado: this.browser?.connected ?? false,
    }
  }
}

export const browserPool = new BrowserPool()

// ══════════════════════════════════════════════════════════
// TEMPLATE HTML DEL CIT
// ══════════════════════════════════════════════════════════

const PUNTOS_LABELS: Record<string, string> = {
  serial:           '1. N° de serie visible y coincidente',
  cuadro:           '2. Estado del cuadro (fisuras, soldaduras)',
  horquilla:        '3. Estado de la horquilla',
  manubrio:         '4. Manubrio y potencia',
  freno_delantero:  '5. Freno delantero funcional',
  freno_trasero:    '6. Freno trasero funcional',
  cables:           '7. Cables y fundas en buen estado',
  cambio_delantero: '8. Cambio delantero',
  cambio_trasero:   '9. Cambio trasero',
  cassette:         '10. Cassette / piñones',
  cadena:           '11. Cadena sin estiramiento excesivo',
  bielas:           '12. Bielas y pedalier',
  pedales:          '13. Pedales',
  rueda_delantera:  '14. Rueda delantera centrada y sin juego',
  rueda_trasera:    '15. Rueda trasera centrada y sin juego',
  cubiertas:        '16. Cubiertas y cámaras',
  asiento:          '17. Asiento y tija del asiento',
  luces:            '18. Luces delanteras y traseras (si aplica)',
  accesorios:       '19. Accesorios de seguridad reglamentarios',
  prueba_funcional: '20. Prueba funcional completa (marcha en pista)',
}

async function buildHTML(d: CITPdfInput, qrDataURI?: string, fontFaceCSS?: string): Promise<string> {
  const aprobado     = d.totalPuntos >= 15
  const fechaEmision = new Date(d.fechaEmision).toLocaleDateString('es-AR', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Argentina/Mendoza',
  })
  const fechaVence = new Date(d.fechaVencimiento).toLocaleDateString('es-AR', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Argentina/Mendoza',
  })

  const puntosKeys    = Object.keys(PUNTOS_LABELS)
  const puntosHTML    = puntosKeys.map(key => {
    const ok = d.puntos[key] !== false
    return `<div class="punto ${ok ? 'ok' : 'no'}">
      <span class="dot"></span>
      <span>${PUNTOS_LABELS[key]}</span>
    </div>`
  }).join('')

  // fontFaceCSS is passed in or fallback to empty string
  const fontCSS = fontFaceCSS ?? ''
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CIT ${d.numeroCIT} — RODAID</title>
<style>
  ${fontCSS}

  /* Variables — RODAID Design System */
  :root {
    --navy:   #0F1E35;
    --orange: #F97316;
    --teal:   #0D9488;
    --gray:   #6B7280;
    --gray-lt:#9CA3AF;
    --light:  #F3F4F6;
    --font:   'BiancoSport', 'Rajdhani', 'DejaVu Sans', sans-serif;
    --mono:   'Courier New', Courier, monospace;
  }

  /* Reset */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--font);
    font-size: 10pt;
    font-weight: 400;
    color: #111;
    background: white;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    letter-spacing: 0.01em;
  }

  /* Layout */
  .doc { width: 210mm; min-height: 297mm; background: white; }

  /* Header */
  .header {
    background: var(--navy);
    padding: 18px 28px 14px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
  }
  .logo-name { font-family: var(--font); font-size: 24pt; font-weight: 600; color: white; letter-spacing: 3px; text-transform: uppercase; }
  .logo-sub  { font-family: var(--font); font-size: 7pt; font-weight: 300; color: #94A3B8; margin-top: 3px; letter-spacing: 0.08em; }
  .cert-title{ font-family: var(--font); font-size: 10pt; font-weight: 500; color: var(--orange); margin-top: 6px; letter-spacing: 0.12em; text-transform: uppercase; }
  .num-cit   { font-family: var(--font); font-size: 14pt; font-weight: 600; color: white; text-align: right; letter-spacing: 0.06em; }
  .fecha-cit { font-family: var(--font); font-size: 7.5pt; font-weight: 300; color: #94A3B8; text-align: right; margin-top: 3px; }

  /* Body */
  .body { padding: 16px 28px; }

  /* Section title */
  .sec-title {
    background: var(--navy);
    color: white;
    font-family: var(--font);
    font-size: 7pt;
    font-weight: 600;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    padding: 5px 10px;
    margin-bottom: 9px;
    margin-top: 13px;
  }
  .sec-title:first-child { margin-top: 0; }

  /* Fields grid */
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 4px; }
  .field-label { font-family: var(--font); font-size: 7pt; font-weight: 400; color: var(--gray); margin-bottom: 2px; letter-spacing: 0.04em; text-transform: uppercase; }
  .field-val   { font-family: var(--font); font-size: 10.5pt; font-weight: 500; color: #111; letter-spacing: 0.01em; }

  /* 20 puntos */
  .puntos-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px 16px;
    margin-bottom: 4px;
  }
  .punto {
    display: flex;
    align-items: center;
    gap: 5px;
    font-family: var(--font);
    font-size: 8pt;
    font-weight: 400;
    padding: 2px 0;
    letter-spacing: 0.01em;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .punto.ok .dot { background: var(--teal); }
  .punto.no .dot { background: #E5E7EB; border: 1px solid #D1D5DB; }
  .punto.no span:last-child { color: #9CA3AF; font-style: italic; }

  /* Resultado */
  .resultado {
    border-radius: 6px;
    padding: 8px 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 10px 0;
  }
  .resultado.aprobado { background: #DCFCE7; }
  .resultado.rechazado{ background: #FEE2E2; }
  .res-text {
    font-family: var(--font);
    font-size: 13pt;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .resultado.aprobado .res-text { color: #166534; }
  .resultado.rechazado .res-text{ color: #991B1B; }
  .res-pts { font-family: var(--font); font-size: 8.5pt; font-weight: 400; }
  .resultado.aprobado .res-pts  { color: #166534; }
  .resultado.rechazado .res-pts { color: #991B1B; }

  /* Hash box */
  .hash-box {
    background: #F8FAFC;
    border: 0.5px solid #E2E8F0;
    border-radius: 6px;
    padding: 10px 12px;
    margin-top: 10px;
  }
  .hash-title { font-family: var(--font); font-size: 7pt; font-weight: 600; color: var(--navy);
    letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 4px; }
  .hash-val   { font-family: var(--mono); font-size: 6.5pt; color: var(--gray); word-break: break-all; letter-spacing: 0.02em; }
  .hash-nft   { font-family: var(--font); font-size: 8.5pt; color: var(--teal); font-weight: 600; margin-top: 4px; letter-spacing: 0.04em; }

  /* Verify */
  .verify { text-align: center; font-size: 7pt; font-family: var(--font); color: var(--gray); padding: 8px 0 4px; }

  /* Sello Temporal — Gobierno de Mendoza */
  .sello-wrap {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 12px;
    background: #F8FAFC;
    border: 0.5px solid #E2E8F0;
    border-radius: 6px;
    margin-top: 10px;
  }
  .sello-svg-wrap { flex-shrink: 0; }
  .sello-text-wrap { flex: 1; }
  .sello-titulo {
    font-family: var(--font);
    font-size: 7pt;
    font-weight: 600;
    color: #0F1E35;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    margin-bottom: 2px;
  }
  .sello-codigo {
    font-family: var(--mono);
    font-size: 8pt;
    font-weight: 700;
    color: #1D4ED8;
    letter-spacing: 0.04em;
  }
  .sello-meta {
    font-family: var(--font);
    font-size: 6.5pt;
    color: #6B7280;
    margin-top: 2px;
  }
  .sello-valido {
    font-family: var(--font);
    font-size: 6pt;
    font-weight: 600;
    color: #0D9488;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-top: 3px;
  }

  /* Footer */
  .footer {
    background: var(--navy);
    padding: 10px 28px;
    text-align: center;
    margin-top: auto;
  }
  .footer p { font-family: var(--font); font-size: 6.5pt; font-weight: 300; color: #94A3B8; line-height: 1.6; letter-spacing: 0.03em; }

  /* Print media */
  @media print {
    body { margin: 0; }
    .doc { width: 100%; }
    @page { margin: 0; size: A4 portrait; }
  }
</style>
</head>
<body>
<div class="doc">

  <div class="header">
    <div>
      <div class="logo-name">RODAID</div>
      <div class="logo-sub">Certificación de Bicicletas · Ley N° 9556 · Mendoza, Argentina</div>
      <div class="cert-title">Certificado de Identidad Técnica</div>
    </div>
    <div>
      <div class="num-cit">${d.numeroCIT}</div>
      <div class="fecha-cit">${fechaEmision}</div>
    </div>
  </div>

  <div class="body">

    <div class="sec-title">DATOS DE LA BICICLETA</div>
    <div class="grid-2">
      <div><div class="field-label">Número de serie</div><div class="field-val">${d.serial}</div></div>
      <div><div class="field-label">Marca / Modelo / Año</div><div class="field-val">${d.marca} ${d.modelo} ${d.anio}</div></div>
      <div><div class="field-label">Tipo</div><div class="field-val">${d.tipo.toUpperCase()}</div></div>
      <div><div class="field-label">Color</div><div class="field-val">${d.color}</div></div>
    </div>

    <div class="sec-title">PROPIETARIO AL MOMENTO DE LA EMISIÓN</div>
    <div class="grid-2">
      <div><div class="field-label">Nombre completo</div><div class="field-val">${d.propietarioNombre}</div></div>
      <div><div class="field-label">DNI</div><div class="field-val">${d.propietarioDNI}</div></div>
    </div>

    <div class="sec-title">INSPECCIÓN TÉCNICA — 20 PUNTOS (Ley N° 9556 Art. 12)</div>
    <div class="puntos-grid">${puntosHTML}</div>

    <div class="resultado ${aprobado ? 'aprobado' : 'rechazado'}">
      <span class="res-text">${aprobado ? '✓ APROBADO' : '✗ RECHAZADO'}</span>
      <span class="res-pts">${d.totalPuntos} / 20 puntos · Vence: ${fechaVence}</span>
    </div>

    <div class="sec-title">INSPECTOR Y TALLER ALIADO</div>
    <div class="grid-2">
      <div><div class="field-label">Inspector</div><div class="field-val">${d.inspectorNombre} ${d.inspectorApellido}</div></div>
      <div><div class="field-label">Taller Aliado</div><div class="field-val">${d.tallerNombre} · ${d.tallerLocalidad}, Mendoza</div></div>
    </div>

    <div class="hash-box">
      <div class="hash-title">ANCLAJE BLOCKCHAIN — BLOCKCHAIN FEDERAL ARGENTINA (BFA · ONTI)</div>
      <div class="hash-val">SHA-256: ${d.hashSHA256}</div>
      ${d.nftTokenId ? `<div class="hash-nft">NFT Token ID: #${d.nftTokenId}${d.bfaTxHash ? ` · TX: ${d.bfaTxHash}` : ''}</div>` : ''}
    </div>

    ${d.codigoVerif ? `
    <div class="sello-wrap">
      <div class="sello-svg-wrap">
        <svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
          <!-- Sello circular exterior -->
          <circle cx="32" cy="32" r="30" fill="none" stroke="#0F1E35" stroke-width="2"/>
          <circle cx="32" cy="32" r="24" fill="none" stroke="#0F1E35" stroke-width="0.8"/>
          <!-- Texto circular "GOBIERNO DE MENDOZA" -->
          <path id="top-arc" d="M 6,32 A 26,26 0 0,1 58,32" fill="none"/>
          <text font-family="var(--font),sans-serif" font-size="4.5" font-weight="600" fill="#0F1E35" letter-spacing="1.2">
            <textPath href="#top-arc" startOffset="8%">GOBIERNO DE MENDOZA</textPath>
          </text>
          <path id="bot-arc" d="M 6,32 A 26,26 0 0,0 58,32" fill="none"/>
          <text font-family="var(--font),sans-serif" font-size="4.5" font-weight="600" fill="#0F1E35" letter-spacing="0.8">
            <textPath href="#bot-arc" startOffset="8%">SELLO TEMPORAL · LEY 9556</textPath>
          </text>
          <!-- Estrella de 8 puntas -->
          <path d="M32,14 L33.5,28.5 L47,27 L35,31.5 L44,42 L31.5,34.5 L28,48 L28.5,33.5 L15,36 L27,30 L18,20 L30.5,27 Z"
                fill="#F97316" opacity="0.85"/>
          <!-- RODAID centrado -->
          <text x="32" y="36" text-anchor="middle" font-family="var(--font),sans-serif"
                font-size="6" font-weight="600" fill="white" letter-spacing="0.5">RODAID</text>
        </svg>
      </div>
      <div class="sello-text-wrap">
        <div class="sello-titulo">Código de Verificación</div>
        <div class="sello-codigo">${d.codigoVerif}</div>
        <div class="sello-meta">
          Sellado: ${d.selladoEn ? new Date(d.selladoEn).toLocaleString('es-AR', { timeZone: 'America/Argentina/Mendoza', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'}
          · ${d.selloModo === 'GOB_MENDOZA' ? 'Gobierno de Mendoza' : d.selloModo === 'RFC3161' ? 'TSA RFC 3161' : 'RODAID Stub'}
        </div>
        <div class="sello-valido">✓ Sello temporal activo</div>
      </div>
    </div>` : ''}

    <div class="verify">
      ${qrDataURI
        ? `<div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:4px">
            <img src="${qrDataURI}" alt="QR verificador RODAID" width="72" height="72" style="display:block;image-rendering:pixelated" />
            <div style="text-align:left">
              <div style="font-size:7pt;font-weight:700;color:#0F1E35;margin-bottom:2px">VERIFICAR AUTENTICIDAD</div>
              <div style="font-size:6.5pt;color:#6B7280;word-break:break-all">${d.serial ? `rodaid.com.ar/verificar/${d.serial}` : 'rodaid.com.ar/verificar'}</div>
              <div style="font-size:6pt;color:#9CA3AF;margin-top:1px">Escaneá el QR para ver el estado en BFA</div>
            </div>
          </div>`
        : `<div>Verificar en: rodaid.com.ar/verificar/${d.serial}</div>`
      }
    </div>

  </div>

  <div class="footer">
    <p>Certificado emitido conforme a la Ley Provincial de Mendoza N° 9556.
    El hash SHA-256 está anclado en la Blockchain Federal Argentina (BFA, ONTI) como prueba de integridad.
    RODAID · rodaid.com.ar · Mendoza, Argentina</p>
  </div>

</div>
</body>
</html>`
}

// ══════════════════════════════════════════════════════════
// GENERACIÓN CON PUPPETEER
// ══════════════════════════════════════════════════════════

/** Exportar el HTML para preview (GET /cit/pdf/preview/:citId) */
export async function getHTMLParaPreview(d: CITPdfInput): Promise<string> {
  let qrDataURI: string | undefined
  try {
    const { generarQR: genQR } = await import('./qr.service')
    const qr = await genQR(d.serial)
    qrDataURI = qr.dataUriPNG
  } catch { /* QR opcional */ }
  let fontFaceCSS: string | undefined
  try {
    const { getFontFaceCSS: getFont } = await import('./font.service')
    fontFaceCSS = await getFont()
  } catch { /* font is optional */ }
  return buildHTML(d, qrDataURI, fontFaceCSS)
}

async function generarConPuppeteer(d: CITPdfInput): Promise<Buffer> {
  const t0   = Date.now()
  const page = await browserPool.obtenerPagina()

  try {
    // Generar QR antes de construir el HTML
    let qrDataURI: string | undefined
    try {
      const { generarQR: genQR } = await import('./qr.service')
      const qr = await genQR(d.serial)
      qrDataURI = qr.dataUriPNG
    } catch (err) {
      log.pdf.warn({ err: (err as Error).message }, 'QR generation failed — PDF sin QR')
    }
    // Cargar CSS de fuentes (@font-face con Bianco Sport o Rajdhani)
    let fontFaceCSS: string | undefined
    try {
      const { getFontFaceCSS: getFont } = await import('./font.service')
      fontFaceCSS = await getFont()
    } catch (err) {
      log.pdf.warn({ err: (err as Error).message }, 'Font CSS load failed — usando fuente del sistema')
    }
    const html = await buildHTML(d, qrDataURI, fontFaceCSS)

    await page.setContent(html, {
      waitUntil: 'domcontentloaded',
      timeout:   parseInt(process.env.PUPPETEER_TIMEOUT_MS ?? '30000'),
    })

    // Esperar a que las fuentes carguen (monospace es sistema, instantáneo)
    await page.evaluateHandle('document.fonts.ready')

    const pdf = await page.pdf({
      format:             'A4',
      printBackground:    true,       // incluir backgrounds de color (navy, teal, etc.)
      preferCSSPageSize:  false,
      displayHeaderFooter: false,
      margin:             { top: '0', right: '0', bottom: '0', left: '0' },
      timeout:            parseInt(process.env.PUPPETEER_TIMEOUT_MS ?? '30000'),
    })

    const ms = Date.now() - t0
    log.pdf.info({ numeroCIT: d.numeroCIT, bytes: pdf.length, ms }, '✓ PDF generado con Puppeteer')

    return Buffer.from(pdf)

  } finally {
    await browserPool.liberarPagina(page)
  }
}

// ══════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL — con fallback a PDFKit
// ══════════════════════════════════════════════════════════

export async function generarPDFPuppeteer(d: CITPdfInput): Promise<PdfResult> {
  const t0 = Date.now()

  // Intentar Puppeteer primero
  if (browserPool.disponible) {
    try {
      const buffer = await generarConPuppeteer(d)
      return {
        buffer,
        bytes:      buffer.length,
        motor:      'PUPPETEER',
        duracionMs: Date.now() - t0,
        hash:       crypto.createHash('sha256').update(buffer).digest('hex'),
      }
    } catch (err) {
      log.pdf.warn({ err: (err as Error).message }, 'Puppeteer falló — usando PDFKit como fallback')
    }
  } else {
    log.pdf.warn({
      hint: 'apt-get install chromium-browser',
      ejecutable: browserPool.rutaChrome ?? 'no encontrado',
    }, 'Chrome no disponible — usando PDFKit (fallback)')
  }

  // Fallback: PDFKit
  const { generarPDFCIT } = await import('./pdf.service')
  const buffer = await generarPDFCIT({
    ...d,
    fotosUrls: d.fotosUrls,
    propietarioApellido: '',
    inspectorApellido: d.inspectorApellido,
  } as Parameters<typeof generarPDFCIT>[0])

  return {
    buffer,
    bytes:      buffer.length,
    motor:      'PDFKIT',
    duracionMs: Date.now() - t0,
    hash:       crypto.createHash('sha256').update(buffer).digest('hex'),
  }
}

// ══════════════════════════════════════════════════════════
// CARGAR DATOS DEL CIT DESDE DB
// ══════════════════════════════════════════════════════════

export async function cargarCITParaPDF(citId: string): Promise<CITPdfInput | null> {
  return queryOne<CITPdfInput>(
    `SELECT
       c.numero_cit        AS "numeroCIT",
       c.hash_sha256       AS "hashSHA256",
       b.numero_serie      AS serial,
       b.marca, b.modelo, b.anio,
       b.tipo::text        AS tipo,
       b.color,
       u.nombre||' '||u.apellido AS "propietarioNombre",
       u.dni               AS "propietarioDNI",
       ui.nombre           AS "inspectorNombre",
       ui.apellido         AS "inspectorApellido",
       ta.nombre           AS "tallerNombre",
       ta.localidad        AS "tallerLocalidad",
       c.punto_detalle     AS puntos,
       c.puntos            AS "totalPuntos",
       c.fecha_emision     AS "fechaEmision",
       c.fecha_vencimiento AS "fechaVencimiento",
       c.nft_token_id      AS "nftTokenId",
       c.bfa_tx_hash       AS "bfaTxHash",
       c.fotos             AS "fotosUrls"
     FROM cits c
     JOIN bicicletas       b  ON b.id  = c.bicicleta_id
     JOIN usuarios         u  ON u.id  = c.propietario_id
     JOIN inspectores      i  ON i.id  = c.inspector_id
     JOIN usuarios         ui ON ui.id = i.usuario_id
     JOIN talleres_aliados ta ON ta.id = c.taller_aliado_id
     WHERE c.id = $1`,
    [citId]
  )
}
