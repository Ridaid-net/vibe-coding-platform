'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Carga perezosa de Leaflet (+ heatmap) desde el CDN, una sola vez por sesion de
 * navegador, sin sumar dependencias al bundle. Compartido por los mapas del
 * proyecto (analitica de seguridad y mapa de calor personal del Garaje).
 */

const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
const LEAFLET_HEAT_JS =
  'https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js'

let leafletPromise: Promise<any> | null = null

function cargarScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve()
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`No se pudo cargar ${src}`))
    document.head.appendChild(s)
  })
}

function cargarCss(href: string) {
  if (document.querySelector(`link[href="${href}"]`)) return
  const l = document.createElement('link')
  l.rel = 'stylesheet'
  l.href = href
  document.head.appendChild(l)
}

/** Devuelve el objeto global `L` de Leaflet con el plugin de heatmap cargado. */
export function cargarLeaflet(): Promise<any> {
  if (leafletPromise) return leafletPromise
  leafletPromise = (async () => {
    cargarCss(LEAFLET_CSS)
    await cargarScript(LEAFLET_JS)
    await cargarScript(LEAFLET_HEAT_JS)
    return (window as any).L
  })()
  return leafletPromise
}
