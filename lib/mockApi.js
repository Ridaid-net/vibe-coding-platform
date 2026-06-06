// ─── RODAID · mockApi (capa de datos) ─────────────────────────────────────
//
// Capa de persistencia "mock" para el Verificador Público (Tarea 6).
//
// Reemplaza el PostgreSQL + Redis del backend Express original por una capa
// liviana respaldada por **Netlify Blobs**, apta para el modelo serverless de
// Netlify. Los CIT (Certificados de Inspección Técnica) se guardan como
// documentos JSON completos, indexados por número de serie de la bicicleta.
//
// Diseño:
//   · El store de Netlify Blobs es la fuente de verdad y persiste entre deploys.
//   · La constante SEED contiene datos iniciales de demostración. La primera
//     lectura siembra el store si está vacío (patrón de seeding, no de memoria).
//   · Si Netlify Blobs no está disponible (p. ej. type-check local sin runtime),
//     se degrada con elegancia leyendo directamente del SEED — el verificador
//     nunca rompe por una dependencia de infraestructura.
//
// Nota: es una capa de datos de demostración. La estructura de los registros
// imita el resultado del JOIN del verificador real (CIT + bicicleta +
// propietario + inspector + sello + firma + BFA).

import { getStore } from '@netlify/blobs'

const STORE_NAME = 'rodaid-cits'

// ── Datos de demostración (seed inicial) ──────────────────────────────────
// Las claves son el número de serie normalizado (MAYÚSCULAS, sin espacios).
const SEED = {
  'RODAID-MZA-0001': {
    serial: 'RODAID-MZA-0001',
    numeroCIT: 'CIT-2025-000001',
    hashSHA256:
      'a3f1c0b9e8d7264f5a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778',
    estado: 'ACTIVO',
    puntoDetalle: {
      cuadro: true, manubrio: true, frenoDel: true, frenoTras: true,
      ruedaDel: true, ruedaTras: true, transmision: true, pedales: true,
      asiento: true, luces: true, reflectivos: true, timbre: true,
      cadena: true, neumaticos: true, suspension: true, rodamientos: true,
      grabadoSerial: true, candado: true, documentacion: true, generales: true,
    },
    puntos: 20,
    fechaEmision: '2025-09-15T13:00:00.000Z',
    fechaVencimiento: '2027-09-15T13:00:00.000Z',
    bicicleta: { marca: 'Trek', modelo: 'Marlin 7', anio: 2024, tipo: 'MTB', color: 'Azul' },
    propietario: { nombre: 'Federico', apellido: 'Alvarez Domínguez', dni: '30123456' },
    inspector: { nombre: 'Lucía', apellido: 'Romero', taller: 'Taller Aliado Godoy Cruz', localidad: 'Godoy Cruz' },
    nftTokenId: 1042,
    bfaTxHash: '0x9af2c1d7e6b504833a1f0c9d8e7b6a5f4039281706e5d4c3b2a190817263544f',
    codigoVerif: 'RDA-7F3K-92QX',
    selloSelladoEn: '2025-09-15T13:05:00.000Z',
    selloModo: 'GOB_MENDOZA',
    firmaFirmadoEn: '2025-09-15T13:06:00.000Z',
    firmaCertSubject: 'CN=RODAID Mendoza, O=Gobierno de Mendoza, C=AR',
    firmaValidaHasta: '2027-09-15T13:06:00.000Z',
    bfa: { indexado: true, tokenId: 1042, transferencias: 1, bloqueado: false },
    denuncias: [],
  },

  'RODAID-MZA-0002': {
    serial: 'RODAID-MZA-0002',
    numeroCIT: 'CIT-2025-000002',
    hashSHA256:
      'b7e2d1a0c9f836152e3d4c5b6a798071625344f5e6d7c8b9a0112233445566aa',
    estado: 'ACTIVO',
    puntoDetalle: {
      cuadro: true, manubrio: true, frenoDel: true, frenoTras: true,
      ruedaDel: true, ruedaTras: true, transmision: true, pedales: true,
      asiento: true, luces: true, reflectivos: true, timbre: true,
      cadena: true, neumaticos: true, suspension: true, rodamientos: true,
      grabadoSerial: true, candado: false, documentacion: true, generales: true,
    },
    puntos: 18,
    // Vencido a propósito para ejercitar el estado EXPIRADO.
    fechaEmision: '2023-01-10T10:00:00.000Z',
    fechaVencimiento: '2025-01-10T10:00:00.000Z',
    bicicleta: { marca: 'Specialized', modelo: 'Rockhopper', anio: 2022, tipo: 'MTB', color: 'Rojo' },
    propietario: { nombre: 'María Sol', apellido: 'Gutiérrez', dni: '28987654' },
    inspector: { nombre: 'Diego', apellido: 'Fernández', taller: 'Bici Center Capital', localidad: 'Ciudad de Mendoza' },
    nftTokenId: 1043,
    bfaTxHash: '0x1c4b7a9f2e6d508371a0b9c8d7e6f5a4938271605e4d3c2b1a09f8e7d6c5b4a3',
    codigoVerif: 'RDA-2H8M-41ZP',
    selloSelladoEn: '2023-01-10T10:05:00.000Z',
    selloModo: 'RFC3161',
    firmaFirmadoEn: '2023-01-10T10:06:00.000Z',
    firmaCertSubject: 'CN=RODAID Mendoza, O=Gobierno de Mendoza, C=AR',
    firmaValidaHasta: '2026-01-10T10:06:00.000Z',
    bfa: { indexado: true, tokenId: 1043, transferencias: 0, bloqueado: false },
    denuncias: [],
  },

  'RODAID-MZA-0003': {
    serial: 'RODAID-MZA-0003',
    numeroCIT: 'CIT-2025-000003',
    hashSHA256:
      'c1d0b9a8e7f635241d2c3b4a5968077162534455e6d7c8b9a0112233445566bb',
    // Estado base ACTIVO, pero con denuncia de robo activa → debe ganar BLOQUEADO.
    estado: 'ACTIVO',
    puntoDetalle: {
      cuadro: true, manubrio: true, frenoDel: true, frenoTras: true,
      ruedaDel: true, ruedaTras: true, transmision: true, pedales: true,
      asiento: true, luces: true, reflectivos: true, timbre: true,
      cadena: true, neumaticos: true, suspension: true, rodamientos: true,
      grabadoSerial: true, candado: true, documentacion: true, generales: true,
    },
    puntos: 20,
    fechaEmision: '2025-03-20T12:00:00.000Z',
    fechaVencimiento: '2027-03-20T12:00:00.000Z',
    bicicleta: { marca: 'Giant', modelo: 'Talon 1', anio: 2023, tipo: 'MTB', color: 'Negro' },
    propietario: { nombre: 'Juan Cruz', apellido: 'Pérez Lucero', dni: '35456789' },
    inspector: { nombre: 'Lucía', apellido: 'Romero', taller: 'Taller Aliado Godoy Cruz', localidad: 'Godoy Cruz' },
    nftTokenId: 1044,
    bfaTxHash: '0x7e1a4c9b2f6d503871c0a9b8d7e6f5a4938271605e4d3c2b1a09f8e7d6c5b4c5',
    codigoVerif: 'RDA-9K1L-77BV',
    selloSelladoEn: '2025-03-20T12:05:00.000Z',
    selloModo: 'GOB_MENDOZA',
    firmaFirmadoEn: '2025-03-20T12:06:00.000Z',
    firmaCertSubject: 'CN=RODAID Mendoza, O=Gobierno de Mendoza, C=AR',
    firmaValidaHasta: '2027-03-20T12:06:00.000Z',
    bfa: { indexado: true, tokenId: 1044, transferencias: 2, bloqueado: true, bloqueoMotivo: 'Denuncia de robo Ley 9556' },
    denuncias: [{ estado: 'ACTIVA', creadoEn: '2026-02-01T08:30:00.000Z' }],
  },

  'RODAID-MZA-0004': {
    serial: 'RODAID-MZA-0004',
    numeroCIT: 'CIT-2026-000004',
    hashSHA256:
      'd9c8b7a6f5e423140c1b2a3958607716253445566e7d8c9b0a112233445566cc',
    // Certificado en proceso de validación → PENDIENTE.
    estado: 'PENDIENTE',
    puntoDetalle: {},
    puntos: 0,
    fechaEmision: null,
    fechaVencimiento: null,
    bicicleta: { marca: 'Venzo', modelo: 'Loky', anio: 2025, tipo: 'Urbana', color: 'Blanco' },
    propietario: { nombre: 'Carla', apellido: 'Méndez', dni: '40222333' },
    inspector: { nombre: '', apellido: '', taller: '', localidad: '' },
    nftTokenId: null,
    bfaTxHash: null,
    codigoVerif: null,
    selloSelladoEn: null,
    selloModo: null,
    firmaFirmadoEn: null,
    firmaCertSubject: null,
    firmaValidaHasta: null,
    bfa: { indexado: false, transferencias: 0, bloqueado: false },
    denuncias: [],
  },

  'RODAID-MZA-0005': {
    serial: 'RODAID-MZA-0005',
    numeroCIT: 'CIT-2026-000005',
    hashSHA256:
      'e1f0d9c8b7a635241e2d3c4b5a69708716253445566d7e8c9b0a1122334455dd',
    // Inspección rechazada (menos de 15 puntos) → RECHAZADO.
    estado: 'RECHAZADO',
    puntoDetalle: {
      cuadro: true, manubrio: false, frenoDel: false, frenoTras: false,
      ruedaDel: true, ruedaTras: true, transmision: false, pedales: true,
      asiento: true, luces: false, reflectivos: false, timbre: false,
      cadena: true, neumaticos: false, suspension: false, rodamientos: true,
      grabadoSerial: true, candado: false, documentacion: false, generales: true,
    },
    puntos: 9,
    fechaEmision: '2026-04-01T11:00:00.000Z',
    fechaVencimiento: null,
    bicicleta: { marca: 'Mercurio', modelo: 'Kaized', anio: 2020, tipo: 'Paseo', color: 'Verde' },
    propietario: { nombre: 'Roberto', apellido: 'Sosa', dni: '22111000' },
    inspector: { nombre: 'Diego', apellido: 'Fernández', taller: 'Bici Center Capital', localidad: 'Ciudad de Mendoza' },
    nftTokenId: null,
    bfaTxHash: null,
    codigoVerif: null,
    selloSelladoEn: null,
    selloModo: null,
    firmaFirmadoEn: null,
    firmaCertSubject: null,
    firmaValidaHasta: null,
    bfa: { indexado: false, transferencias: 0, bloqueado: false },
    denuncias: [],
  },

  // CIT minteado en la BFA cuyo documento de la base de datos fue MANIPULADO:
  // el `hashSHA256` almacenado aquí (DB) ya NO coincide con el hash original
  // grabado al mint (índice local de eventos + on-chain). Ejercita la alerta
  // crítica HASH_MISMATCH_ONCHAIN (422). El hash original sigue intacto en
  // EVENTO_INDEX y en el ledger on-chain del bfaService.
  'RODAID-MZA-0666': {
    serial: 'RODAID-MZA-0666',
    numeroCIT: 'CIT-2025-000099',
    // Hash manipulado en la DB (no es el que se grabó al mint).
    hashSHA256:
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    estado: 'ACTIVO',
    puntoDetalle: {
      cuadro: true, manubrio: true, frenoDel: true, frenoTras: true,
      ruedaDel: true, ruedaTras: true, transmision: true, pedales: true,
      asiento: true, luces: true, reflectivos: true, timbre: true,
      cadena: true, neumaticos: true, suspension: true, rodamientos: true,
      grabadoSerial: true, candado: true, documentacion: true, generales: true,
    },
    puntos: 20,
    fechaEmision: '2025-06-10T12:00:00.000Z',
    fechaVencimiento: '2027-06-10T12:00:00.000Z',
    bicicleta: { marca: 'Cannondale', modelo: 'Trail 6', anio: 2024, tipo: 'MTB', color: 'Gris' },
    propietario: { nombre: 'Esteban', apellido: 'Quiroga', dni: '33444555' },
    inspector: { nombre: 'Lucía', apellido: 'Romero', taller: 'Taller Aliado Godoy Cruz', localidad: 'Godoy Cruz' },
    nftTokenId: 1099,
    bfaTxHash: '0x5a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0',
    codigoVerif: 'RDA-6X4N-58TM',
    selloSelladoEn: '2025-06-10T12:05:00.000Z',
    selloModo: 'GOB_MENDOZA',
    firmaFirmadoEn: '2025-06-10T12:06:00.000Z',
    firmaCertSubject: 'CN=RODAID Mendoza, O=Gobierno de Mendoza, C=AR',
    firmaValidaHasta: '2027-06-10T12:06:00.000Z',
    bfa: { indexado: true, tokenId: 1099, transferencias: 1, bloqueado: false },
    denuncias: [],
  },
}

// ── Índice local de eventos BFA (bfa_eventos) ──────────────────────────────
//
// Réplica local del hash grabado al mint de cada CIT. Es la segunda pata de la
// comparación triple de integridad (DB ↕ índice local ↕ on-chain). Para un CIT
// íntegro coincide con el `hashSHA256` de la DB; si el documento de la DB fue
// manipulado, este índice conserva el hash ORIGINAL, igual que la cadena.
const EVENTO_INDEX = Object.fromEntries(
  Object.values(SEED)
    .filter((c) => c.bfa && c.bfa.indexado)
    .map((c) => [c.serial, c.hashSHA256])
)
// Hash original (intacto) del CIT cuyo documento de DB fue manipulado.
EVENTO_INDEX['RODAID-MZA-0666'] =
  '6447a415ab2f983c0e1d2b3a4958607182930a1b2c3d4e5f60718293a4b5c6d7'

// ── Acceso al store ────────────────────────────────────────────────────────

function normalizar(serial) {
  return String(serial ?? '').trim().toUpperCase()
}

function getCitStore() {
  // getStore puede lanzar si el entorno de Blobs no está configurado.
  return getStore(STORE_NAME)
}

/**
 * Devuelve el registro crudo del CIT para un número de serie, o null.
 *
 * Estrategia:
 *   1. Intenta leer de Netlify Blobs (fuente de verdad).
 *   2. Si la clave no existe pero está en el SEED, la siembra y la devuelve.
 *   3. Si Blobs no está disponible, degrada al SEED en memoria.
 */
export async function getCITBySerial(serial) {
  const key = normalizar(serial)
  if (!key) return null

  try {
    const store = getCitStore()
    const existente = await store.get(key, { type: 'json' })
    if (existente) return existente

    // Seed perezoso: si el registro existe en los datos de demo, persistirlo.
    if (SEED[key]) {
      await store.setJSON(key, SEED[key])
      return SEED[key]
    }
    return null
  } catch {
    // Degradación elegante: sin runtime de Blobs, usar el seed directo.
    return SEED[key] ?? null
  }
}

/**
 * Inserta o actualiza un registro de CIT. Pensado para otras tareas
 * (emisión, bloqueo) que mutan el estado del certificado.
 */
export async function upsertCIT(record) {
  const key = normalizar(record?.serial)
  if (!key) throw new Error('upsertCIT: serial requerido')
  const store = getCitStore()
  await store.setJSON(key, { ...record, serial: key })
  return record
}

/**
 * Devuelve las denuncias ACTIVAS de un serial (query B del cruce paralelo).
 *
 * Modela la "tabla de denuncias" como una consulta independiente de la del CIT,
 * de modo que el controlador pueda ejecutarla en paralelo (Promise.all) junto a
 * la lectura del CIT y la consulta on-chain. Resiliente: ante cualquier fallo
 * de la capa de datos devuelve `[]` en lugar de romper la verificación.
 */
export async function getDenunciasActivas(serial) {
  try {
    const registro = await getCITBySerial(serial)
    const denuncias = (registro && registro.denuncias) || []
    return denuncias.filter((d) => d && d.estado === 'ACTIVA')
  } catch {
    return []
  }
}

/**
 * Hash registrado en el índice local de eventos (bfa_eventos) al mint del CIT.
 * Segunda pata de la comparación triple de integridad. Devuelve null si el
 * serial no fue minteado / no tiene evento local.
 */
export function getEventoIndexHash(serial) {
  const key = normalizar(serial)
  return EVENTO_INDEX[key] ?? null
}

/** Lista los seriales sembrados (útil para demos y diagnósticos). */
export function listSeedSeriales() {
  return Object.keys(SEED)
}

export { SEED as MOCK_SEED, EVENTO_INDEX as MOCK_EVENTO_INDEX }
