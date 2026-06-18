// ─── RODAID · i18n Service ────────────────────────────────
// Locales: es-AR (completo), pt-BR (parcial), en-US (parcial)
// Provincias: MZA, CBA, SJN, BAS con config desde DB + Redis

import { query, queryOne } from '../config/database'
import { getRedis }        from '../config/redis'
import type { Response, NextFunction } from 'express'

export interface ProvinciaConfig {
  codigo:           string; nombre:           string; pais:             string
  leyNumero:        string; leyNombre:        string; leyUrl:           string
  canalPago:        string; canalPagoUrl:     string; canalPagoNombre:  string
  tasaCITCentavos:  number; tasaCITFormatted: string; moneda:           string
  bbox: { latMin: number; latMax: number; lngMin: number; lngMax: number }
  locale:           string; zonaHoraria:      string; activa:           boolean
}

export interface I18nContext {
  locale:     string
  provincia?: ProvinciaConfig
  t:          (key: string, params?: Record<string, string | number>) => string
  fmt:        typeof fmt
}

type Locale  = 'es-AR' | 'pt-BR' | 'en-US'
type Catalog = Record<string, Partial<Record<Locale, string>>>

const CATALOG: Catalog = {
  'cit.estado.ACTIVO':             { 'es-AR': 'CIT vigente',                'pt-BR': 'CIT válido',              'en-US': 'Active CIT'                  },
  'cit.estado.EXPIRADO':           { 'es-AR': 'CIT vencido',                'pt-BR': 'CIT expirado',            'en-US': 'Expired CIT'                 },
  'cit.estado.BORRADOR':           { 'es-AR': 'Inspección incompleta',      'pt-BR': 'Inspeção incompleta',     'en-US': 'Incomplete inspection'       },
  'cit.estado.VIGENTE_SIN_TASA':   { 'es-AR': 'Tasa pendiente',             'pt-BR': 'Taxa pendente',           'en-US': 'Fee pending'                 },
  'cit.estado.VIGENTE_SIN_NFT':    { 'es-AR': 'NFT pendiente de mint',      'pt-BR': 'NFT pendente',            'en-US': 'NFT mint pending'            },
  'cit.estado.VENCE_PRONTO':       { 'es-AR': 'Vence pronto',               'pt-BR': 'Vence em breve',          'en-US': 'Expiring soon'               },
  'cit.estado.BLOQUEADO':          { 'es-AR': 'CIT bloqueado',              'pt-BR': 'CIT bloqueado',           'en-US': 'CIT blocked'                 },
  'cit.tasa.label':                { 'es-AR': 'Tasa provincial CIT',        'pt-BR': 'Taxa estadual CIT',       'en-US': 'Provincial CIT fee'          },
  'cit.tasa.pendiente':            { 'es-AR': 'Tasa pendiente de pago',     'pt-BR': 'Taxa pendente',           'en-US': 'Fee pending payment'         },
  'cit.tasa.pagada':               { 'es-AR': 'Tasa abonada',               'pt-BR': 'Taxa paga',               'en-US': 'Fee paid'                    },
  'cit.pago.iniciar':              { 'es-AR': 'Pagar tasa en {canal}',      'pt-BR': 'Pagar taxa via {canal}',  'en-US': 'Pay fee via {canal}'         },
  'cit.pago.completado':           { 'es-AR': '✓ Tasa abonada en {canal}.', 'pt-BR': '✓ Taxa paga.',            'en-US': '✓ Fee paid via {canal}.'     },
  'bfa.mint.pendiente':            { 'es-AR': 'NFT pendiente de mint en BFA','pt-BR':'NFT pendente na BFA',     'en-US': 'NFT mint pending on BFA'     },
  'bfa.mint.completado':           { 'es-AR': 'NFT acuñado en BFA',         'pt-BR': 'NFT cunhado na BFA',      'en-US': 'NFT minted on BFA'           },
  'marketplace.escrow.retenido':   { 'es-AR': 'Fondos retenidos en escrow', 'pt-BR': 'Fundos retidos em escrow','en-US': 'Funds held in escrow'        },
  'marketplace.escrow.liberado':   { 'es-AR': 'Fondos liberados al vendedor','pt-BR':'Fundos liberados',        'en-US': 'Funds released to seller'    },
  'marketplace.comision':          { 'es-AR': 'Comisión RODAID: {pct}%',    'pt-BR': 'Comissão RODAID: {pct}%', 'en-US': 'RODAID fee: {pct}%'          },
  'aliado.plan.PIONERO':           { 'es-AR': 'Plan Pionero ({pct}%)',       'pt-BR': 'Plano Pioneiro ({pct}%)', 'en-US': 'Pioneer plan ({pct}%)'       },
  'aliado.plan.CONSTRUCTOR':       { 'es-AR': 'Plan Constructor ({pct}%)',   'pt-BR': 'Plano Construtor ({pct}%)','en-US':'Builder plan ({pct}%)'      },
  'aliado.plan.ESCALADOR':         { 'es-AR': 'Plan Escalador ({pct}%)',     'pt-BR': 'Plano Escalador ({pct}%)','en-US': 'Scaler plan ({pct}%)'       },
  'aliado.retribucion.acreditada': { 'es-AR': '{monto} acreditados en tu cuenta MP','pt-BR':'{monto} creditados no seu MP','en-US':'{monto} credited to your MP' },
  'seguridad.alerta.activada':     { 'es-AR': 'Alerta activada. Notificado a {ministerio}.','pt-BR':'Alerta ativado.','en-US':'Alert activated. {ministerio} notified.'},
  'seguridad.ministerio.MZA':      { 'es-AR': 'Ministerio de Seguridad de Mendoza','pt-BR':'MinSeg Mendoza','en-US':'Mendoza Security Ministry'       },
  'seguridad.ministerio.CBA':      { 'es-AR': 'Ministerio de Seguridad de Córdoba','pt-BR':'MinSeg Córdoba','en-US':'Córdoba Security Ministry'       },
  'seguridad.ministerio.SJN':      { 'es-AR': 'Ministerio de Seguridad de San Juan','pt-BR':'MinSeg San Juan','en-US':'San Juan Security Ministry'    },
  'seguridad.ministerio.BAS':      { 'es-AR': 'Policía de la Ciudad de Buenos Aires','pt-BR':'Polícia de Buenos Aires','en-US':'Buenos Aires City Police'},
  'ley.referencia':                { 'es-AR': 'Bajo Ley N° {numero} de {provincia}','pt-BR':'Lei Estadual N° {numero}','en-US':'Under Law No. {numero} of {provincia}'},
  'ley.obligatoriedad':            { 'es-AR': 'Certificación obligatoria para talleres','pt-BR':'Certificação obrigatória','en-US':'Mandatory certification'},
  'gpt.plan.LIBRE':                { 'es-AR': 'Plan Libre (30 consultas/mes)','pt-BR':'Plano Gratuito (30/mês)','en-US':'Free plan (30 queries/mo)'     },
  'gpt.plan.ESTANDAR':             { 'es-AR': 'Plan Estándar (200/mes)',     'pt-BR': 'Plano Padrão (200/mês)', 'en-US': 'Standard plan (200/mo)'      },
  'gpt.plan.PREMIUM':              { 'es-AR': 'Plan Premium (1.000/mes)',    'pt-BR': 'Plano Premium (1.000/mês)','en-US':'Premium plan (1,000/mo)'    },
  'gpt.limite.alcanzado':          { 'es-AR': 'Límite alcanzado. Resetea el {fecha}.','pt-BR':'Limite atingido. Renova em {fecha}.','en-US':'Limit reached. Resets on {fecha}.'},
  'error.cit_not_found':           { 'es-AR': 'No encontramos un CIT con ese número.','pt-BR':'CIT não encontrado.','en-US':'CIT not found.'           },
  'error.rate_limited':            { 'es-AR': 'Demasiadas consultas. Esperá un momento.','pt-BR':'Aguarde um momento.','en-US':'Too many requests.'     },
  'error.sin_conexion':            { 'es-AR': 'Sin conexión. Revisá tu internet.','pt-BR':'Sem conexão.','en-US':'No connection.'                      },
  'error.servidor':                { 'es-AR': 'Error del servidor. Ya lo estamos viendo.','pt-BR':'Erro do servidor.','en-US':'Server error.'           },
  'notif.cit.por_vencer':          { 'es-AR': 'Tu CIT de {bici} vence en {dias} días.','pt-BR':'Seu CIT de {bici} vence em {dias} dias.','en-US':'Your CIT for {bici} expires in {dias} days.'},
  'notif.pago.recibido':           { 'es-AR': 'Recibiste {monto} por la venta de {bici}.','pt-BR':'Você recebeu {monto} pela venda de {bici}.','en-US':'You received {monto} for the sale of {bici}.'},
  'notif.inspeccion.completada':   { 'es-AR': 'Inspección completa · {puntos}/20 pts. Pagá la tasa para activar el CIT.','pt-BR':'Inspeção completa · {puntos}/20 pts.','en-US':'Inspection complete · {puntos}/20 pts. Pay the fee to activate.'},
}

// ── t() ─────────────────────────────────────────────────
export function t(
  key:    string,
  params?: Record<string, string | number>,
  locale: Locale | string = 'es-AR'
): string {
  const canon = canonicalizarLocale(locale)
  let   texto = CATALOG[key]?.[canon] ?? CATALOG[key]?.['es-AR'] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params))
      texto = texto.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
  }
  return texto
}

// ── fmt ─────────────────────────────────────────────────
export const fmt = {
  moneda(centavos: number, locale = 'es-AR', monedaCod = 'ARS'): string {
    const can = canonicalizarLocale(locale)
    try {
      return new Intl.NumberFormat(can, { style:'currency', currency:monedaCod, minimumFractionDigits:0, maximumFractionDigits:0 }).format(centavos/100)
    } catch { return `$${(centavos/100).toLocaleString('es-AR')}` }
  },
  fecha(fecha: Date | string, locale = 'es-AR', zona?: string): string {
    const d = typeof fecha==='string' ? new Date(fecha) : fecha
    try { return new Intl.DateTimeFormat(canonicalizarLocale(locale), { day:'2-digit', month:'2-digit', year:'numeric', ...(zona?{timeZone:zona}:{}) }).format(d) }
    catch { return d.toLocaleDateString('es-AR') }
  },
  fechaHora(fecha: Date | string, locale = 'es-AR', zona = 'America/Argentina/Mendoza'): string {
    const d = typeof fecha==='string' ? new Date(fecha) : fecha
    try { return new Intl.DateTimeFormat(canonicalizarLocale(locale), { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:zona }).format(d) }
    catch { return d.toLocaleString('es-AR') }
  },
  relativo(fecha: Date | string, locale = 'es-AR'): string {
    const d    = typeof fecha==='string' ? new Date(fecha) : fecha
    const diff = (d.getTime() - Date.now()) / 1000
    const abs  = Math.abs(diff)
    try {
      const rtf = new Intl.RelativeTimeFormat(canonicalizarLocale(locale), { numeric:'auto' })
      if (abs < 60)       return rtf.format(Math.round(diff), 'second')
      if (abs < 3600)     return rtf.format(Math.round(diff/60), 'minute')
      if (abs < 86400)    return rtf.format(Math.round(diff/3600), 'hour')
      if (abs < 2592000)  return rtf.format(Math.round(diff/86400), 'day')
      if (abs < 31536000) return rtf.format(Math.round(diff/2592000), 'month')
      return rtf.format(Math.round(diff/31536000), 'year')
    } catch { return d.toLocaleDateString('es-AR') }
  },
  numero(n: number, locale = 'es-AR', opts?: Intl.NumberFormatOptions): string {
    try { return new Intl.NumberFormat(canonicalizarLocale(locale), opts).format(n) }
    catch { return n.toLocaleString('es-AR') }
  },
  porcentaje(n: number, locale = 'es-AR'): string {
    try { return new Intl.NumberFormat(canonicalizarLocale(locale), { style:'percent', minimumFractionDigits:0, maximumFractionDigits:1 }).format(n/100) }
    catch { return `${n}%` }
  },
}

// ── getProvinciaConfig ───────────────────────────────────
export async function getProvinciaConfig(codigo: string): Promise<ProvinciaConfig|null> {
  const redis    = getRedis()
  const cacheKey = `provincia:config:${codigo.toUpperCase()}`
  try {
    const c = await redis.get(cacheKey)
    if (c) return JSON.parse(c) as ProvinciaConfig
  } catch {}
  const row = await queryOne<any>(
    `SELECT * FROM provincias_config WHERE codigo=$1`,
    [codigo.toUpperCase()]
  )
  if (!row) return null
  const config: ProvinciaConfig = {
    codigo:          row.codigo,     nombre:          row.nombre,     pais:            row.pais,
    leyNumero:       row.ley_numero, leyNombre:       row.ley_nombre, leyUrl:          row.ley_url,
    canalPago:       row.canal_pago, canalPagoUrl:    row.canal_pago_url, canalPagoNombre: row.canal_pago_nombre,
    tasaCITCentavos: row.tasa_cit_centavos, moneda:   row.moneda,
    tasaCITFormatted:fmt.moneda(row.tasa_cit_centavos, row.locale, row.moneda),
    bbox: { latMin:row.bbox_lat_min, latMax:row.bbox_lat_max, lngMin:row.bbox_lng_min, lngMax:row.bbox_lng_max },
    locale:      row.locale, zonaHoraria: row.zona_horaria, activa: row.activa,
  }
  try { await redis.set(cacheKey, JSON.stringify(config), 'EX', '1800') } catch {}
  return config
}

// ── inferirProvinciaDesdeGPS ─────────────────────────────
export async function inferirProvinciaDesdeGPS(lat: number, lng: number): Promise<ProvinciaConfig|null> {
  const rows = await query<any>('SELECT codigo,bbox_lat_min,bbox_lat_max,bbox_lng_min,bbox_lng_max FROM provincias_config WHERE activa=TRUE',[])
  for (const r of rows) {
    if (lat>=r.bbox_lat_min && lat<=r.bbox_lat_max && lng>=r.bbox_lng_min && lng<=r.bbox_lng_max)
      return getProvinciaConfig(r.codigo)
  }
  return null
}

// ── detectarLocale ───────────────────────────────────────
export function detectarLocale(acceptLanguage?: string): Locale {
  if (!acceptLanguage) return 'es-AR'
  const langs = acceptLanguage.split(',').map(s => {
    const [lang,q]=s.trim().split(';q=')
    return { lang:lang.trim(), q:q?parseFloat(q):1.0 }
  }).sort((a,b)=>b.q-a.q)
  for (const {lang} of langs) {
    if (lang.startsWith('es-AR')) return 'es-AR'
    if (lang.startsWith('pt'))    return 'pt-BR'
    if (lang.startsWith('es'))    return 'es-AR'
    if (lang.startsWith('en'))    return 'en-US'
  }
  return 'es-AR'
}

// ── i18nMiddleware ───────────────────────────────────────
export function i18nMiddleware() {
  return async (req: any, _res: Response, next: NextFunction): Promise<void> => {
    const locale   = detectarLocale(req.headers['accept-language'] as string)
    const codigoProv = (req.query.provincia as string | undefined)?.toUpperCase()
    let   prov: ProvinciaConfig | undefined

    if (codigoProv) {
      prov = await getProvinciaConfig(codigoProv).then(c=>c??undefined)
    } else if (req.user?.geoLat && req.user?.geoLng) {
      prov = await inferirProvinciaDesdeGPS(req.user.geoLat, req.user.geoLng).then(c=>c??undefined)
    }
    if (!prov) prov = await getProvinciaConfig('MZA').then(c=>c??undefined)

    req.i18n = {
      locale, provincia: prov,
      t:   (key: string, params?: Record<string,string|number>) => t(key, params, prov?.locale ?? locale),
      fmt,
    } satisfies I18nContext
    next()
  }
}

// ── renderProvinciaParaGPT ───────────────────────────────
export async function renderProvinciaParaGPT(usuarioId: string): Promise<string> {
  const gpsRow = await queryOne<{avg_lat:number;avg_lng:number}>(
    `SELECT AVG(insp_geo_lat)::float AS avg_lat, AVG(insp_geo_lng)::float AS avg_lng
     FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id
     WHERE b.propietario_id=$1::uuid AND c.insp_geo_lat IS NOT NULL`,
    [usuarioId]
  )
  let prov = gpsRow?.avg_lat ? await inferirProvinciaDesdeGPS(gpsRow.avg_lat, gpsRow.avg_lng) : null
  if (!prov) prov = await getProvinciaConfig('MZA')
  if (!prov) return 'Provincia: Mendoza (default)'
  return [
    `PROVINCIA: ${prov.nombre} (${prov.codigo})`,
    `LEY: ${prov.leyNombre} N° ${prov.leyNumero}`,
    `TASA CIT: ${prov.tasaCITFormatted} ${prov.moneda}`,
    `CANAL DE PAGO: ${prov.canalPagoNombre} (${prov.canalPago})`,
    `ZONA HORARIA: ${prov.zonaHoraria}`,
    `MINISTERIO SEGURIDAD: ${t('seguridad.ministerio.'+prov.codigo,{},prov.locale)}`,
  ].join('\n')
}

// ── helpers ──────────────────────────────────────────────
function canonicalizarLocale(locale: string): Locale {
  if (locale.startsWith('es-AR')||locale.startsWith('es')) return 'es-AR'
  if (locale.startsWith('pt-BR')||locale.startsWith('pt')) return 'pt-BR'
  if (locale.startsWith('en'))                               return 'en-US'
  return 'es-AR'
}
export { canonicalizarLocale }
