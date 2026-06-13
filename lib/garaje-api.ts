// ─── RODAID · API Client Tipado — Garaje Digital ─────────
//
// Cliente de API tipado para el Garaje Digital. Centraliza el manejo del
// token, el refresh transparente ante 401 y el contrato de respuesta del
// backend ({ data } | { error: { code, message } }).
//
// Uso:
//   import { garajeApi, type BicicletaGaraje } from '@/lib/garaje-api'

export type EstadoCIT =
  | 'ACTIVO'
  | 'EXPIRADO'
  | 'BORRADOR'
  | 'PENDIENTE_PAGO'
  | 'SIN_CIT'

export interface CITResumen {
  id:               string
  numeroCIT:        string
  estado:           EstadoCIT
  puntosTotal:      number
  puntajeMax:       number
  hasHashBFA:       boolean
  nftTokenId:       string | null
  tasaPagada:       boolean
  fechaEmision:     string | null
  fechaVencimiento: string | null
  diasRestantes:    number | null
  hashSHA256:       string | null
}

export interface CertAsegResumen {
  numero:     string
  score:      number
  nivel:      'EXCELENTE' | 'BUENO' | 'REGULAR' | 'INSUFICIENTE'
  asegurable: boolean
}

export interface PolizaResumen {
  numeroPoliza:  string
  aseguradora:   string
  primaFinalARS: string
  estado:        string
  finVigencia:   string
}

export interface BicicletaGaraje {
  id:          string
  marca:       string
  modelo:      string
  numeroSerie: string
  cit:         CITResumen | null
  certAseg:    CertAsegResumen | null
  poliza:      PolizaResumen | null
  scoreSalud:  number
}

export interface GarajeResumen {
  bicicletas: BicicletaGaraje[]
  resumen: {
    totalBicicletas:    number
    citsActivos:        number
    citsBorrador:       number
    polizasActivas:     number
    scorePromedioSalud: number
  }
}

export interface ApiClientError extends Error {
  status?: number
  code?: string
}

// ─── Base client ─────────────────────────────────────────

const API_BASE  = '/api/v1'
const TOKEN_KEY = 'rodaid_token'
const REFRESH_KEY = 'rodaid_refresh'

async function apiCall<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = typeof window !== 'undefined'
    ? localStorage.getItem(TOKEN_KEY)
    : null

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((opts.headers as Record<string,string>) ?? {}),
  }

  let res = await fetch(`${API_BASE}${path}`, { ...opts, headers })

  if (res.status === 401 && typeof window !== 'undefined') {
    const refresh = localStorage.getItem(REFRESH_KEY)
    if (refresh) {
      const rr = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refresh }),
      })
      if (rr.ok) {
        const rd = await rr.json()
        localStorage.setItem(TOKEN_KEY, rd.data.token)
        ;(headers as Record<string,string>).Authorization = `Bearer ${rd.data.token}`
        res = await fetch(`${API_BASE}${path}`, { ...opts, headers })
      }
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }))
    throw Object.assign(
      new Error(err.error?.message ?? `HTTP ${res.status}`),
      { status: res.status, code: err.error?.code }
    ) as ApiClientError
  }

  const json = await res.json()
  return json.data as T
}

// ─── Garaje API ───────────────────────────────────────────

export const garajeApi = {
  /**
   * GET /garaje/resumen
   * Carga el Garaje Digital completo (bicicletas + CIT + cert. aseg. + poliza).
   * Cache 30s en el servidor. Ideal para el primer render.
   */
  getResumen(): Promise<GarajeResumen> {
    return apiCall<GarajeResumen>('/garaje/resumen')
  },

  /**
   * GET /usuario/bicicletas
   * Alias legacy — devuelve solo el array de bicicletas.
   */
  getBicicletas(): Promise<BicicletaGaraje[]> {
    return apiCall<BicicletaGaraje[]>('/usuario/bicicletas')
  },

  /**
   * GET /cit/:id
   * Estado real de un CIT especifico, incluyendo diasRestantes.
   */
  getCIT(citId: string): Promise<CITResumen & { bicicleta: { marca:string; modelo:string; numeroSerie:string } }> {
    return apiCall(`/cit/${citId}`)
  },

  /**
   * POST /seguros/cotizar desde el Garaje — un clic desde la BicicletaCard.
   */
  cotizarDesdeGaraje(bicicletaId: string, citId: string) {
    return apiCall('/seguros/cotizar', {
      method: 'POST',
      body: JSON.stringify({ bicicletaId, citId, tipoBici: 'URBANA', tipoCobVert: 'ROBO' }),
    })
  },
}
