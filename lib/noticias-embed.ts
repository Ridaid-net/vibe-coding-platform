export interface EmbedVideoSeguro {
  plataforma: 'youtube' | 'instagram'
  embedUrl: string
}

const HOSTS_YOUTUBE = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'])
const HOSTS_INSTAGRAM = new Set(['instagram.com', 'www.instagram.com'])
const ID_VALIDO = /^[A-Za-z0-9_-]+$/

function extraerIdYoutube(url: URL): string | null {
  if (url.hostname === 'youtu.be') {
    const id = url.pathname.replace(/^\/+/, '')
    return ID_VALIDO.test(id) ? id : null
  }
  if (url.pathname === '/watch') {
    const id = url.searchParams.get('v')
    return id && ID_VALIDO.test(id) ? id : null
  }
  const match = url.pathname.match(/^\/(embed|shorts)\/([A-Za-z0-9_-]+)/)
  return match ? match[2] : null
}

function extraerInstagram(url: URL): { tipo: string; id: string } | null {
  const match = url.pathname.match(/^\/(p|reel|tv)\/([A-Za-z0-9_-]+)/)
  return match ? { tipo: match[1], id: match[2] } : null
}

/**
 * Valida que el link pegado sea realmente de YouTube o Instagram y devuelve la
 * URL de embed segura, armada desde nuestro propio template — nunca se inserta
 * el string pegado por el admin directo en un iframe. Devuelve null si no
 * matchea ningun patron conocido (link invalido o dominio no permitido).
 */
export function extraerEmbedSeguro(linkCrudo: string): EmbedVideoSeguro | null {
  let url: URL
  try {
    url = new URL(linkCrudo)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null

  if (HOSTS_YOUTUBE.has(url.hostname)) {
    const id = extraerIdYoutube(url)
    return id ? { plataforma: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/${id}` } : null
  }
  if (HOSTS_INSTAGRAM.has(url.hostname)) {
    const parsed = extraerInstagram(url)
    return parsed
      ? { plataforma: 'instagram', embedUrl: `https://www.instagram.com/${parsed.tipo}/${parsed.id}/embed` }
      : null
  }
  return null
}
