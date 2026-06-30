import { z } from 'zod'

/**
 * Esquema de validacion en el cliente del formulario de publicacion.
 *
 * Refleja las mismas reglas que valida el backend en
 * `POST /api/v1/marketplace/publicar`, de modo que los errores de formato
 * basicos (precio, titulo, descripcion) se detecten antes de hacer la llamada y
 * se ahorren peticiones innecesarias. El backend sigue siendo la autoridad
 * final; esto es una primera linea de defensa para mejorar la experiencia.
 */
export const publicarFormSchema = z.object({
  titulo: z
    .string()
    .trim()
    .min(5, 'El título debe tener al menos 5 caracteres.')
    .max(120, 'El título no puede superar 120 caracteres.'),
  descripcion: z
    .string()
    .trim()
    .min(20, 'La descripción debe tener al menos 20 caracteres.')
    .max(5000, 'La descripción no puede superar 5000 caracteres.'),
  precioARS: z
    .number({ invalid_type_error: 'Ingresá un precio en pesos válido.' })
    .positive('El precio debe ser mayor a cero.')
    .max(1_000_000_000, 'El precio ingresado es demasiado alto.'),
  precioUSD: z
    .number({ invalid_type_error: 'El precio en dólares debe ser un número.' })
    .positive('El precio en dólares debe ser mayor a cero.')
    .max(100_000_000, 'El precio en dólares es demasiado alto.')
    .nullable()
    .optional(),
})

export type PublicarFormValues = z.infer<typeof publicarFormSchema>

/** Errores por campo, tal como los consume el formulario. */
export type PublicarFormErrors = Partial<
  Record<keyof PublicarFormValues, string>
>

/**
 * Valida los valores del formulario y devuelve un mapa de errores por campo
 * (vacio si todo es valido). Mas comodo para la UI que el ZodError crudo.
 */
export function validarPublicarForm(values: {
  titulo: string
  descripcion: string
  precioARS: number | null
  precioUSD: number | null
}): PublicarFormErrors {
  const result = publicarFormSchema.safeParse({
    titulo: values.titulo,
    descripcion: values.descripcion,
    precioARS: values.precioARS ?? Number.NaN,
    precioUSD: values.precioUSD ?? undefined,
  })
  if (result.success) {
    return {}
  }
  const errores: PublicarFormErrors = {}
  for (const issue of result.error.issues) {
    const campo = issue.path[0] as keyof PublicarFormValues | undefined
    if (campo && !errores[campo]) {
      errores[campo] = issue.message
    }
  }
  return errores
}
