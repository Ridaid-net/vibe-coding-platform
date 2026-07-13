/**
 * Corpus legal de RODAID — única base de conocimiento del Asistente Oficial de
 * Soporte y Consultoría Legal, y fuente de la página pública de Términos
 * (`/terminos`).
 *
 * Es DATA PURA (sin dependencias de servidor) para que tanto la página pública
 * como el servicio del asistente la compartan sin arrastrar el SDK del modelo.
 * Cada cláusula tiene un identificador estable para que el asistente la cite con
 * precisión. Si una consulta trata sobre algo que NO está acá, el asistente NO
 * debe inventarlo (regla de no-alucinaciones).
 */

export interface ClausulaLegal {
  id: string
  titulo: string
  texto: string
}

export interface SeccionLegal {
  id: string
  titulo: string
  resumen: string
  clausulas: ClausulaLegal[]
}

export const CORPUS_LEGAL: SeccionLegal[] = [
  {
    id: 'tyc',
    titulo: 'Términos y Condiciones de Uso',
    resumen:
      'Marco general del servicio RODAID, naturaleza de la plataforma, derechos y ' +
      'obligaciones del usuario y alcance de la responsabilidad.',
    clausulas: [
      {
        id: 'TYC-1',
        titulo: 'Objeto y naturaleza del servicio',
        texto:
          'RODAID es una herramienta de REGISTRO y PREVENCIÓN de la identidad de ' +
          'rodados (la Cédula de Identidad Tecnológica, "CIT"), operada en ' +
          'colaboración institucional con el Ministerio de Seguridad de la ' +
          'Provincia de Mendoza. RODAID NO es una compañía de seguros: no ' +
          'indemniza, no asegura el bien y no garantiza la imposibilidad de hechos ' +
          'delictivos. Su función es dotar al rodado de una identidad verificable y ' +
          'trazable que desincentive el robo y facilite la recuperación.',
      },
      {
        id: 'TYC-2',
        titulo: 'Aceptación y autorización del usuario',
        texto:
          'Al aceptar estos Términos y Condiciones el usuario declara haber leído y ' +
          'comprendido el Protocolo de Emisión del CIT y la normativa de seguridad, ' +
          'y autoriza el tratamiento de sus datos conforme a la Ley 25.326 para los ' +
          'fines de prevención del delito y recuperación de propiedad descriptos en ' +
          'este corpus.',
      },
      {
        id: 'TYC-3',
        titulo: 'Derechos del usuario',
        texto:
          'El usuario tiene derecho a: (a) consultar en todo momento el estado de ' +
          'su validación y de su CIT desde el Garaje Digital; (b) obtener el ' +
          'certificado de propiedad una vez aprobada la validación; (c) ejercer los ' +
          'derechos de acceso, rectificación y supresión de sus datos personales ' +
          'conforme a la Ley 25.326; y (d) recibir asistencia a través del canal de ' +
          'soporte oficial.',
      },
      {
        id: 'TYC-4',
        titulo: 'Obligaciones del usuario',
        texto:
          'El usuario se obliga a: (a) aportar datos veraces y completos; (b) ' +
          'suscribir la Declaración Jurada de Licitud sobre la procedencia lícita ' +
          'del bien; (c) no registrar bienes de procedencia ilícita ni documentación ' +
          'falsa o adulterada; y (d) no efectuar denuncias falsas dentro de la ' +
          'plataforma. El incumplimiento puede acarrear las consecuencias penales ' +
          'detalladas en la sección de Régimen Sancionatorio.',
      },
      {
        id: 'TYC-5',
        titulo: 'Alcance y límite de responsabilidad',
        texto:
          'RODAID provee un servicio de registro y prevención "tal cual" (best ' +
          'effort). No asume responsabilidad por el robo, hurto, pérdida o daño del ' +
          'bien, ni garantiza su recuperación. La validación de un CIT acredita la ' +
          'identidad registrada del rodado y la integridad de su registro, no la ' +
          'ausencia futura de hechos delictivos.',
      },
    ],
  },
  {
    id: 'protocolo-cit',
    titulo: 'Protocolo de Emisión del CIT',
    resumen:
      'Proceso de validación de la Cédula de Identidad Tecnológica, plazos, la ' +
      'Regla de las 72 horas y sus excepciones, y la Declaración Jurada de Licitud.',
    clausulas: [
      {
        id: 'CIT-1',
        titulo: 'Inicio del proceso de validación',
        texto:
          'Al registrar un rodado, el usuario inicia el proceso de emisión del CIT, ' +
          'que comprende la carga de los datos del bien (número de serie del cuadro, ' +
          'marca, modelo, documentación de respaldo) y la suscripción de la ' +
          'Declaración Jurada de Licitud. El estado del proceso se sigue en tiempo ' +
          'real desde el Garaje Digital.',
      },
      {
        id: 'CIT-2',
        titulo: 'Regla de las 72 horas (auditoría de seguridad)',
        texto:
          'La emisión del CIT NO es inmediata: el proceso incluye una AUDITORÍA DE ' +
          '72 HORAS HÁBILES durante la cual RODAID contrasta el registro con el ' +
          'Ministerio de Seguridad de la Provincia de Mendoza (cruce con bases de ' +
          'rodados denunciados y verificación de la documentación). Recién al cierre ' +
          'favorable de esa auditoría el CIT queda APROBADO; en caso de ' +
          'inconsistencias, queda BLOQUEADO o EN REVISIÓN. Este plazo es una medida ' +
          'de seguridad: previene que un bien de procedencia dudosa obtenga una ' +
          'identidad verificada de forma instantánea.',
      },
      {
        id: 'CIT-3',
        titulo: 'Excepción 0KM con factura electrónica validada',
        texto:
          'Se exceptúan de la Regla de las 72 horas los rodados 0KM (nuevos) cuya ' +
          'factura electrónica de compra sea validada electrónicamente contra el ' +
          'emisor. En ese supuesto, al confirmarse la factura, el CIT puede emitirse ' +
          'de forma anticipada, sin esperar las 72 horas hábiles, porque la ' +
          'trazabilidad de origen ya queda acreditada por el comprobante fiscal.',
      },
      {
        id: 'CIT-4',
        titulo: 'Declaración Jurada de Licitud — naturaleza jurídica',
        texto:
          'La Declaración Jurada de Licitud es una manifestación bajo juramento por ' +
          'la cual el usuario declara, con carácter de DECLARACIÓN JURADA y bajo su ' +
          'exclusiva responsabilidad, que el bien que registra es de su legítima ' +
          'propiedad o posesión y de PROCEDENCIA LÍCITA. No es una mera casilla ' +
          'formal: tiene efectos jurídicos, integra el expediente del CIT y queda ' +
          'asentada de forma inmutable. Declarar falsamente compromete la ' +
          'responsabilidad penal del declarante (ver Régimen Sancionatorio).',
      },
      {
        id: 'CIT-5',
        titulo: 'Resultado de la validación',
        texto:
          'Cerrada la auditoría, el CIT puede quedar: APROBADO (identidad ' +
          'verificada y anclada de forma inmutable), EN REVISIÓN (requiere ' +
          'documentación o aclaración adicional) o BLOQUEADO (inconsistencias o ' +
          'coincidencia con un bien denunciado). El usuario es notificado del ' +
          'resultado y puede consultarlo en el Garaje Digital.',
      },
    ],
  },
  {
    id: 'seguridad-datos',
    titulo: 'Normativa de Seguridad y Protección de Datos',
    resumen:
      'Tratamiento de datos personales bajo la Ley 25.326, finalidad del uso y ' +
      'colaboración institucional con el Ministerio de Seguridad de Mendoza.',
    clausulas: [
      {
        id: 'SEG-1',
        titulo: 'Tratamiento de datos bajo la Ley 25.326',
        texto:
          'Los datos personales del usuario son tratados conforme a la Ley 25.326 ' +
          'de Protección de los Datos Personales de la República Argentina. RODAID ' +
          'adopta las medidas técnicas y organizativas para resguardar su ' +
          'confidencialidad e integridad.',
      },
      {
        id: 'SEG-2',
        titulo: 'Finalidad y autorización de uso',
        texto:
          'Al aceptar los Términos y Condiciones, el usuario AUTORIZA el uso de sus ' +
          'datos de forma EXCLUSIVA para la prevención del delito y la recuperación ' +
          'de la propiedad, en colaboración con el Ministerio de Seguridad de la ' +
          'Provincia de Mendoza. Los datos no se utilizan para finalidades ajenas a ' +
          'estos fines.',
      },
      {
        id: 'SEG-3',
        titulo: 'Derechos del titular de los datos',
        texto:
          'El titular de los datos puede ejercer en cualquier momento los derechos ' +
          'de acceso, rectificación, actualización y supresión previstos en la Ley ' +
          '25.326, a través del canal de soporte oficial de RODAID.',
      },
    ],
  },
  {
    id: 'sancionatorio',
    titulo: 'Régimen Sancionatorio y Consecuencias Legales',
    resumen:
      'Consecuencias penales del fraude, la falsedad documental y las denuncias ' +
      'falsas dentro de la plataforma.',
    clausulas: [
      {
        id: 'PEN-277',
        titulo: 'Encubrimiento — Art. 277 del Código Penal',
        texto:
          'Registrar o intentar legitimar un bien de procedencia ilícita puede ' +
          'configurar el delito de ENCUBRIMIENTO previsto en el Art. 277 del Código ' +
          'Penal de la Nación.',
      },
      {
        id: 'PEN-292',
        titulo: 'Falsificación de documentos — Art. 292 del Código Penal',
        texto:
          'Aportar documentación falsa o adulterada (facturas, comprobantes, datos ' +
          'del bien) puede configurar el delito de FALSIFICACIÓN DE DOCUMENTOS del ' +
          'Art. 292 del Código Penal de la Nación.',
      },
      {
        id: 'PEN-172',
        titulo: 'Estafa — Art. 172 del Código Penal',
        texto:
          'El uso de la plataforma con ardid o engaño para obtener un beneficio ' +
          'indebido en perjuicio de terceros puede configurar el delito de ESTAFA ' +
          'del Art. 172 del Código Penal de la Nación.',
      },
      {
        id: 'PEN-DJ',
        titulo: 'Falsedad en la Declaración Jurada y denuncias falsas',
        texto:
          'La falsedad en la Declaración Jurada de Licitud y la formulación de ' +
          'denuncias falsas dentro de la plataforma comprometen la responsabilidad ' +
          'penal del usuario y habilitan, además del bloqueo del CIT, la ' +
          'comunicación de los hechos a la autoridad competente.',
      },
    ],
  },
  {
    id: 'talleres-aliados',
    titulo: 'Talleres Aliados',
    resumen:
      'Naturaleza voluntaria de la vinculación como Taller Aliado y su relación ' +
      'con las obligaciones regulatorias propias del rubro.',
    clausulas: [
      {
        id: 'ALIADO-1',
        titulo: 'Carácter voluntario y no sustitutivo de obligaciones regulatorias',
        texto:
          'El uso de RODAID es un complemento voluntario y no reemplaza ninguna ' +
          'obligación de registro que la normativa vigente (incluida la Ley ' +
          'Provincial N° 9.556) exija al Taller Aliado ante organismos estatales. ' +
          'El Taller Aliado es responsable de cumplir con sus obligaciones ' +
          'regulatorias de forma independiente.',
      },
    ],
  },
]

/** Respuesta EXACTA exigida ante consultas fuera de alcance (regla de restricción). */
export const RESPUESTA_FUERA_DE_ALCANCE =
  'Mi función es asistir exclusivamente sobre los protocolos y términos de uso de ' +
  'RODAID. Por favor, contacta a nuestro soporte especializado para otros temas.'

/**
 * Texto canónico de la Declaración Jurada de Licitud (CIT-4) que el usuario
 * suscribe en el formulario de carga. Se mantiene junto al corpus para que la
 * UI y el asistente usen exactamente la misma redacción.
 */
export const DECLARACION_JURADA_LICITUD =
  'Declaro bajo juramento que el rodado que registro es de mi legítima propiedad o ' +
  'posesión y de procedencia lícita, y que los datos y la documentación que aporto ' +
  'son veraces. Comprendo que esta Declaración Jurada tiene efectos jurídicos y que ' +
  'su falsedad compromete mi responsabilidad penal (Arts. 277, 292 y 172 del Código ' +
  'Penal), conforme al Protocolo de Emisión del CIT.'
