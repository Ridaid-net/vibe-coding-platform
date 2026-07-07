import { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://rodaid.net'
  const ahora = new Date()

  return [
    { url: base, lastModified: ahora, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/marketplace`, lastModified: ahora, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${base}/verificar`, lastModified: ahora, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${base}/aliados`, lastModified: ahora, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/servicios`, lastModified: ahora, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/academia`, lastModified: ahora, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/academia/mecanica-emergencia`, lastModified: ahora, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/academia/seguridad-vial`, lastModified: ahora, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/academia/anticipo-robo`, lastModified: ahora, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/academia/mantenimiento-preventivo`, lastModified: ahora, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/academia/usar-rodaid`, lastModified: ahora, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/eventos`, lastModified: ahora, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${base}/eventos/rodada-nocturna`, lastModified: ahora, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${base}/eventos/taller-mecanica`, lastModified: ahora, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${base}/eventos/feria-bicicletas`, lastModified: ahora, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${base}/eventos/gran-vuelta-zona-este`, lastModified: ahora, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${base}/sobre`, lastModified: ahora, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/ingresar`, lastModified: ahora, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/registro`, lastModified: ahora, changeFrequency: 'monthly', priority: 0.4 },
  ]
}
