DEMO rodaid-demo\_\_15\_ (11).jsx





Tareas a ejecutar





0 Frontend · UI / UX

Reemplazar todos los setTimeout por llamadas reales a API

Conectar estados de error reales (network, 4xx, 5xx)

Implementar skeleton loaders durante fetches reales

Futuras — escala y diferenciación

Optimización de bundle size — separar base64 images a CDN

Internacionalización i18n para escala nacional

Responsive mobile-first audit completo



1 Backend · API REST



\+ Scaffolding inicial: Node.js + Express + TypeScript

\+ Base de datos: PostgreSQL con esquema de usuarios, bicicletas, CITs, inspectores

\+ Autenticación JWT: generación, validación, refresh tokens

\+ Endpoints CIT: POST /iniciar, /finalizar, /validar, GET /:id

\+ Endpoints Marketplace: CRUD publicaciones, escrow, transferencia

\+ Endpoint denuncia: POST /seguridad/denunciar con cross-reference

\+ Sistema de colas (Bull/Redis) para validación diferida de 72 hs

\+ Deploy: Railway / Render / AWS con CI/CD básico

\* Necesarias — calidad y completitud

\+ Rate limiting y throttling por IP/usuario

\+ Logging estructurado (Pino/Winston)

\+ Health checks y monitoring (UptimeRobot)



2 Autenticación · Auth





\+ Sistema de registro: email + contraseña + verificación

\+ Login con generación real de JWT (access + refresh token)

\+ Integración MxM OAuth 2.0 como proveedor primario de identidad

\+ Roles: ciclista / inspector / aliado / admin

\+ Middleware de autorización por rol en todos los endpoints

Necesarias — calidad y completitud

\+2FA opcional para inspectores

\+Recuperación de contraseña con email

+Sesiones en Redis con expiración configurable

\* Necesarias — calidad y completitud

*2FA opcional para inspectores*

*Recuperación de contraseña con email*

*Sesiones en Redis con expiración configurable*



3 BFA · Blockchain

Simulado — SHA-256 y NFT hardcodeados

\+Solicitar acceso a nodo BFA (Blockchain Federal Argentina — ONTI)

\+Desarrollar smart contract RodaidCIT.sol (ERC-721 + OpenZeppelin)

\+Función mint: serial + inspectorId + hash SHA-256 → tokenId

\+Función lock/unlock: para denuncia de robo en tiempo real

+Función transfer: para compraventa en Marketplace

+Deploy en testnet BFA → auditoría → mainnet BFA

\+Backend service: ethers.js para firmar transacciones con wallet privada

Necesarias — calidad y completitud

\+Indexer de eventos on-chain para el Verificador público

+IPFS para metadata del NFT (foto, PDF del CIT)

\* Necesarias — calidad y completitud

*Indexer de eventos on-chain para el Verificador público*

*IPFS para metadata del NFT (foto, PDF del CIT)*



4  CIT · Certificación



+Conectar POST /api/cit/iniciar con validación real de serial en DB

+Pipeline de validación 72 hs: queue → cross-reference → activate

\+Generación real del hash SHA-256 del payload del CIT

+Acuñación del NFT en BFA al aprobar la validación

+Notificación de resultado (aprobado/rechazado) al ciclista

+Integración con base de datos policial del Ministerio de Seguridad

Necesarias — calidad y completitud

\+OCR del número de serie desde foto del cuadro

+Detección de anomalías GPS en inspecciones del Aliado

\* Necesarias — calidad y completitud

*OCR del número de serie desde foto del cuadro*

*Detección de anomalías GPS en inspecciones del Aliado*





5 PDF · Documentos

+Integrar react-to-pdf o html2canvas + jsPDF para descarga client-side

+Alternativamente: endpoint backend POST /api/cit/pdf con Puppeteer

+Firma digital embebida: PKCS#7 detached signature sobre el PDF

+QR code real: qrcode.js apuntando a /verificar/:serialHash

\* Necesarias — calidad y completitud

\+Template PDF con tipografía Bianco Sport embebida

+Código de verificación con sello temporal del Gobierno de Mendoza





6 Verificador Público



+GET /api/verificar/:serial → consulta real en DB de CITs

\+Consulta paralela en BFA para validar que el hash on-chain coincide

\+Estado real: activo / en validación / bloqueado / sin registro

+Lector de QR con jsQR o QuaggaJS para escaneo desde cámara

\* Necesarias — calidad y completitud

\+Endpoint público sin autenticación (rate-limited por IP)

+Historial de verificaciones anónimas para analítica



7 Marketplace



+CRUD real de publicaciones: POST /api/marketplace/publicar

+Filtros y búsqueda con query params reales

+RODAID PAY escrow: depósito del comprador → hold → release al confirmar

\+Transferencia del NFT ERC-721 al nuevo propietario al cerrar la venta

Sistema de mensajería comprador/vendedor 

\* Necesarias — calidad y completitud

Integración MercadoPago como gateway de pago primario

Comisión automática: 2.5% retenido por RODAID al cerrar



8 MxM · Mendoza por Mí





Solicitar credenciales OAuth 2.0 al equipo MxM (Gobierno de Mendoza)

Implementar redirect OAuth: /auth/mxm → callback → token exchange

GET /mxm/identidad: obtener nivel de verificación del usuario

POST /mxm/pagos: iniciar pago de tasa CIT vía gateway oficial

POST /mxm/notificaciones: enviar alertas por canal gubernamental

POST /mxm/tramites: crear expediente CIT en sistema provincial

\* Necesarias — calidad y completitud

Renovación automática del token MxM antes de expirar

Fallback a auth nativo RODAID si MxM tiene downtime



9  Notificaciones





Configurar Firebase Cloud Messaging (FCM) para web y Android

APNs para iOS (cuando se desarrolle app nativa)

Backend: tabla device\_tokens + servicio de envío

Triggers: CIT aprobado, CIT rechazado, alerta de robo, vencimiento próximo

Canal MxM: llamar endpoint oficial de notificaciones gubernamentales

\* Necesarias — calidad y completitud

Plantillas de email transaccional (Resend / SendGrid)

Centro de preferencias: qué notificaciones recibir y por qué canal



10 Inspector · Aliados





Auth real de inspector: JWT con rol 'inspector' + taller\_id

Firma digital real: PKCS#12 / Web Crypto API — firmar el payload del CIT

POST /api/inspector/cit: subir fotos a S3, serial, puntos, firma

Validación server-side de la firma antes de emitir el hash BFA

Panel de gestión del Aliado: CITs emitidos, retribución acumulada

Necesarias — calidad y completitud

Auditoría automática: detectar anomalías GPS en validaciones

Sistema de capacitación con examen online para certificar inspectores





11 Ministerio de Seguridad





Firmar convenio técnico con Ministerio de Seguridad de Mendoza

Definir protocolo de intercambio: formato, frecuencia, seguridad

Endpoint seguro (mTLS): POST /seguridad/cross-reference con serial + propietario

Respuesta: alerta\_activa: boolean + tipo\_alerta + expediente

Webhook inverso: Ministerio notifica a RODAID cuando se recupera una bici registrada

\* Necesarias — calidad y completitud

SLA de respuesta del cruce: < 2s para el período de 72 hs

Cifrado de datos en tránsito y en reposo (AES-256)



12 RODAID PAY · Pagos



Cuenta MercadoPago Business para RODAID SAS

SDK MP: crear preferencia de pago → redirect → webhook de confirmación

Lógica de escrow: fondos retenidos hasta confirmación de entrega

Liberación automática: comprador confirma → transferencia al vendedor - comisión

Tasa CIT: POST /mxm/pagos para pago vía canal oficial del Gobierno

\* Necesarias — calidad y completitud

Dashboard de pagos pendientes / completados / en disputa

Retribución automática a Aliados: pago por CIT emitido vía MP



13 Garaje Digital · Dashboard



GET /api/usuario/bicicletas: cargar rodados reales desde DB

GET /api/cit/:id: estado real del CIT (activo/pendiente/expirado)

GET /api/marketplace/mis-publicaciones: listings activos del usuario

WebSocket o polling para actualizar estado de validación de 72 hs en tiempo real

Necesarias — calidad y completitud

Mapa de calor: Google Maps JS API + HeatmapLayer con datos GPS reales

Analítica personal: km auditados, frecuencia de mantenimiento



14 RODAID-GPT



Cuenta Anthropic API para claude-sonnet

Endpoint backend POST /api/gpt/consulta (nunca exponer API key al cliente)

System prompt con contexto del usuario: km, CITs, historial, zona

Streaming de respuesta al frontend con SSE

\* Necesarias — calidad y completitud

Rate limiting: N consultas/mes según plan

Caché de sugerencias frecuentes para reducir costo de tokens



15 Entidad Legal · SAS





Constitución SAS con escribano Guillermo Chamorro y Contador Bernabé (San Martín)

Registro en AFIP: CUIT + monotributo o responsable inscripto

Cuenta bancaria corporativa (Banco Nación / Mercado Pago Business)

Registro INPI: marca RODAID + software CIT

Contrato formalizado con Matías Valdivia (fee fijo, sin equity)

\* Necesarias — calidad y completitud

Libro de actas digital

Estructura de dos clases de acciones según diseño original















