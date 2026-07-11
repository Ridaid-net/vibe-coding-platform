export interface ServicioAliado {
  value: string
  label: string
  categoria: string
}

export const CATEGORIAS_SERVICIOS_ALIADO = [
  'Servicio Tecnico y Mecanica Especializada',
  'Venta y Asesoramiento Comercial',
  'Servicios de Ajuste Ergonomico y Configuracion',
  'Servicios de Experiencia y Valor Agregado',
] as const

export const SERVICIOS_ALIADO: ServicioAliado[] = [
  { value: 'tecnico_mantenimiento_lavado', label: 'Mantenimiento general y lavado', categoria: CATEGORIAS_SERVICIOS_ALIADO[0] },
  { value: 'tecnico_service_suspensiones_premium', label: 'Service de suspensiones (Premium)', categoria: CATEGORIAS_SERVICIOS_ALIADO[0] },
  { value: 'tecnico_tubelizacion_ruedas', label: 'Tubelización y mantenimiento de ruedas', categoria: CATEGORIAS_SERVICIOS_ALIADO[0] },
  { value: 'tecnico_reparacion_purgado_frenos', label: 'Reparación y purgado de frenos', categoria: CATEGORIAS_SERVICIOS_ALIADO[0] },
  { value: 'tecnico_diagnostico_ebikes', label: 'Diagnóstico y actualización de E-Bikes', categoria: CATEGORIAS_SERVICIOS_ALIADO[0] },

  { value: 'comercial_venta_bicicletas_nuevas', label: 'Venta de bicicletas nuevas', categoria: CATEGORIAS_SERVICIOS_ALIADO[1] },
  { value: 'comercial_venta_repuestos_originales', label: 'Venta de repuestos y componentes originales', categoria: CATEGORIAS_SERVICIOS_ALIADO[1] },
  { value: 'comercial_equipamiento_seguridad', label: 'Equipamiento y seguridad', categoria: CATEGORIAS_SERVICIOS_ALIADO[1] },
  { value: 'comercial_indumentaria_tecnica', label: 'Indumentaria técnica', categoria: CATEGORIAS_SERVICIOS_ALIADO[1] },

  { value: 'ergonomico_bike_fitting', label: 'Bike Fitting (Estudio Biomecánico)', categoria: CATEGORIAS_SERVICIOS_ALIADO[2] },
  { value: 'ergonomico_personalizacion_armado', label: 'Personalización y armado a la carta', categoria: CATEGORIAS_SERVICIOS_ALIADO[2] },

  { value: 'experiencia_alquiler_bicicletas', label: 'Alquiler de bicicletas (Rentals)', categoria: CATEGORIAS_SERVICIOS_ALIADO[3] },
  { value: 'experiencia_bici_bar_cafeteria', label: 'Bici-Bar / Cafetería ciclista', categoria: CATEGORIAS_SERVICIOS_ALIADO[3] },
  { value: 'experiencia_envios_logistica', label: 'Envíos y logística', categoria: CATEGORIAS_SERVICIOS_ALIADO[3] },
  { value: 'experiencia_logistica_eventos', label: 'Logística para eventos', categoria: CATEGORIAS_SERVICIOS_ALIADO[3] },
]

export function labelServicioAliado(value: string): string {
  return SERVICIOS_ALIADO.find(s => s.value === value)?.label ?? value
}

export function esServicioAliadoValido(value: string): boolean {
  return SERVICIOS_ALIADO.some(s => s.value === value)
}

/**
 * Normaliza un numero de WhatsApp al formato que espera wa.me: solo digitos,
 * codigo de pais + numero (ej. 5492617542335, mismo formato que
 * FooterDefensaConsumidor.tsx). Limpia espacios/guiones/parentesis/el + inicial
 * (formato cosmetico inequivoco), pero NUNCA adivina el codigo de pais, el "9"
 * de celular argentino, ni si hay que sacar un 0/15 de area — si despues de
 * limpiar no matchea el patron esperado, devuelve null (rechazar, no guardar
 * a ciegas un numero que armaria un boton de WhatsApp roto).
 */
export function normalizarWhatsapp(input: string): string | null {
  const limpio = input.replace(/[\s\-()]/g, '').replace(/^\+/, '')
  return /^54\d{10,11}$/.test(limpio) ? limpio : null
}
