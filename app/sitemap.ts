import { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://rodaid.net'
  return [
    { url: base, lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    { url: `${base}/verificar`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/garaje`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/aliados`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/sobre`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/desarrolladores`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.7 },
    { url: `${base}/pago-protegido`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/disputas`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/reembolsos`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/seguimiento`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/academia`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.7 },
    { url: `${base}/eventos`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.8 },
    { url: `${base}/privacidad`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/terminos`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
  ]
}
