# Solicitud de Acceso a Nodo BFA — Blockchain Federal Argentina

**Destinatario:** Oficina Nacional de Tecnologías de Información (ONTI)  
**Email:** bfa@onti.gob.ar  
**Referencia:** Solicitud de nodo BFA para plataforma RODAID  
**Ley base:** Provincial N° 9556 (Mendoza) — Certificación técnica de bicicletas

---

## 1. DATOS DEL SOLICITANTE

| Campo | Valor |
|---|---|
| **Nombre del proyecto** | RODAID — Sistema de Certificación Técnica de Bicicletas |
| **Responsable** | Federico De Gea |
| **Email de contacto** | federico@rodaid.com.ar |
| **Teléfono** | +54 9 261 XXX-XXXX |
| **Sitio web** | https://rodaid.com.ar |
| **Municipio** | San Martín, Mendoza, Argentina |

---

## 2. DESCRIPCIÓN DEL PROYECTO

RODAID es la primera plataforma integrada de certificación técnica, economía circular y trazabilidad de bicicletas en Argentina, con anclaje regulatorio en la **Ley Provincial de Mendoza N° 9556** (Registro e Identificación de Bicicletas).

### Propósito del uso de BFA

El sistema emite **Certificados de Identidad Técnica (CIT)** para bicicletas. Cada CIT es un documento PDF generado por un inspector certificado de RODAID que incluye:

- Identificación técnica de la unidad (tipo, marca, color, medidas)
- 20 puntos de inspección verificados
- Número de serie/chasis
- DNI y firma digital del inspector
- Hash SHA-256 del documento

El **hash SHA-256 de cada CIT se ancla en la Blockchain Federal Argentina** como prueba de existencia e integridad del certificado. Esto permite que cualquier ciudadano pueda verificar la autenticidad de un CIT escaneando un código QR, sin depender de la disponibilidad del servidor de RODAID.

### Base legal

- **Ley Provincial N° 9556** — Arts. 15-18: Registro e Identificación de Bicicletas
- **Decreto Reglamentario XXXX/XX** — Autoridad de Aplicación: Ministerio de Seguridad de Mendoza
- **Respaldo institucional:** Incubadora Municipal N° 145 de San Martín, CFdE Municipalidad de Junín

---

## 3. ESPECIFICACIONES TÉCNICAS

### Tipo de nodo solicitado

- **Red:** BFA Mainnet (Chain ID: 4337)
- **Tipo:** Nodo completo con acceso RPC (JSON-RPC HTTP + WebSocket)
- **Modalidad:** Nodo remoto provisto por BFA (no alojamos infraestructura de validación)

### Stack tecnológico

| Componente | Tecnología |
|---|---|
| Backend API | Node.js 20 + TypeScript |
| Librería blockchain | ethers.js v6 |
| Estándar del contrato | ERC-721 (NFT no fungible) |
| Hash de anclaje | SHA-256 (256 bits) |
| Despliegue | Railway / AWS ECS (Mendoza) |

### Operaciones esperadas en BFA

| Operación | Frecuencia estimada | Gas estimado |
|---|---|---|
| `mint()` — emitir CIT | 50-200 por día (escala) | ~85,000 gas/tx |
| `lockToken()` — denuncia de robo | Puntual (< 5/día) | ~45,000 gas/tx |
| `unlockToken()` — recuperación | Puntual (< 2/día) | ~35,000 gas/tx |
| `transferToken()` — venta | 10-50 por día | ~55,000 gas/tx |
| Lecturas (`tokenData`, `verificarIntegridad`) | Alto (lectura sin costo) | 0 |

### Estimación de transacciones

- **Fase piloto (Zona Este Mendoza):** ~100 tx/mes
- **Escala Mendoza:** ~2,000 tx/mes
- **Escala nacional:** ~50,000 tx/mes

---

## 4. CONTRATO INTELIGENTE

### RodaidCIT.sol (ERC-721)

Archivo: `contracts/RodaidCIT.sol` (incluido en este repositorio)

**Funciones principales:**

```solidity
// Emitir CIT — solo operador autorizado (RODAID backend)
function mint(address to, string calldata hashCIT, string calldata numeroCIT)
    external onlyOperator returns (uint256 tokenId)

// Bloquear por robo — solo operador
function lockToken(uint256 tokenId, string calldata motivo) external onlyOperator

// Verificación pública — sin costo, sin permiso
function verificarIntegridad(string calldata hashCIT)
    external view returns (bool valido, bool bloqueado, uint256 tokenId)
```

**Auditoría:** El contrato no implementa funciones de retiro de fondos ni almacena datos personales. Todos los hashes son SHA-256 de documentos PDF (no contienen PII directa).

**Repositorio:** https://github.com/rodaid/rodaid-api (acceso bajo solicitud)

---

## 5. CONFIGURACIÓN SOLICITADA

### Variables de entorno necesarias (una vez otorgado el acceso)

```bash
# Nodo BFA
BFA_RPC_URL=https://nodo-bfa.onti.gob.ar:8545         # URL provista por ONTI
BFA_WS_URL=wss://nodo-bfa.onti.gob.ar:8546            # WebSocket (opcional)
BFA_CHAIN_ID=4337                                       # BFA Mainnet

# Wallet del operador (generada por RODAID, solo el hash público se comparte)
BFA_WALLET_ADDRESS=0x...                               # Dirección pública
BFA_WALLET_PRIVATE_KEY=<secreto — nunca compartido>    # Clave privada

# Contrato desplegado
BFA_CONTRACT_ADDRESS=0x...                             # Tras deploy
```

### Proceso propuesto post-aprobación

1. ONTI provisiona acceso RPC al nodo BFA
2. RODAID genera wallet dedicada para el backend
3. ONTI fondea la wallet con saldo suficiente para las transacciones
4. RODAID despliega `RodaidCIT.sol` en BFA Testnet (Chain ID: 4338)
5. Período de prueba de 30 días en testnet
6. Deploy en BFA Mainnet (Chain ID: 4337)
7. Inicio de operaciones certificadas

---

## 6. COMPROMISO DE USO RESPONSABLE

RODAID se compromete a:

- **No usar el nodo para operaciones ajenas** al sistema de certificación de bicicletas
- **Implementar rate limiting** en las llamadas al RPC para no saturar el nodo
- **Notificar a ONTI** ante cualquier incidente de seguridad que afecte la wallet operadora
- **Mantener actualizado** el contrato ante cambios regulatorios
- **Compartir métricas** de uso mensualmente con ONTI/BFA
- **No almacenar datos personales** en la blockchain (solo hashes SHA-256)

---

## 7. RESPALDO INSTITUCIONAL

- **Intendente Mario Abed (Municipio de Junín):** validó la viabilidad del proyecto y propuso acompañamiento legislativo para fortalecer la Ley 9556
- **Incubadora Municipal N° 145 (San Martín):** acredita a RODAID como emprendimiento tecnológico local
- **CFdE Municipalidad de Junín (Lic. Eliana R. Neo):** respalda el componente de innovación digital

---

## 8. DOCUMENTACIÓN ADJUNTA

- [ ] `contracts/RodaidCIT.sol` — código fuente del contrato
- [ ] `infra/bfa/deploy.js` — script de despliegue
- [ ] Carta aval Municipio de San Martín
- [ ] Resolución Incubadora N° 145
- [ ] Resumen ejecutivo RODAID (PDF)

---

**San Martín, Mendoza, [FECHA]**

Federico De Gea  
Fundador y Director — RODAID  
federico@rodaid.com.ar  
+54 9 261 XXX-XXXX

---

*Esta solicitud puede enviarse a:*
- **Email principal:** bfa@onti.gob.ar
- **Email alternativo:** blockchain@onti.gob.ar
- **Portal TAD (Trámites a Distancia):** tramitesadistancia.gob.ar
  - Rubro: Infraestructura Digital
  - Organismo: ONTI
  - Trámite: Acceso a servicios BFA
