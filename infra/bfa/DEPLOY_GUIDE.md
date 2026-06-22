# RODAID · Guía de Deploy BFA — Testnet → Auditoría → Mainnet

## Resumen del proceso

```
Hardhat local  →  BFA Testnet  →  Auditoría  →  BFA Mainnet
   (tests)        (4338)          (scripts)      (4337)
```

**Tiempo estimado:** 3-5 días (incluyendo validación en testnet y proceso ONTI)

---

## Prerequisitos

### 1. Obtener acceso al nodo BFA (ONTI)

Enviar la solicitud en `infra/bfa/solicitud-nodo-bfa.md` a:
- **Email:** bfa@onti.gob.ar
- **Alternativa:** tramitesadistancia.gob.ar → ONTI → Infraestructura Digital

ONTI proveerá:
- URL del nodo RPC testnet (http o https)
- URL del nodo RPC mainnet
- Instrucciones para financiar la wallet en testnet

### 2. Generar wallet de operador

```bash
# Con ethers.js
node -e "
const {ethers} = require('ethers')
const wallet = ethers.Wallet.createRandom()
console.log('Address:', wallet.address)
console.log('Private Key:', wallet.privateKey)
console.log('GUARDAR LA PRIVATE KEY EN UN LUGAR SEGURO')
"
```

**IMPORTANTE:** Nunca guardar la private key en el repositorio. Usar variables de entorno o un secrets manager.

### 3. Configurar variables de entorno

```bash
# .env.contracts (NO commitear al repositorio)
BFA_WALLET_PRIVATE_KEY=0x...      # Clave privada del wallet operador
BFA_TESTNET_RPC_URL=http://...    # Provisto por ONTI
BFA_RPC_URL=http://...            # Provisto por ONTI (mainnet)
RODAID_BACKEND_URL=https://api.rodaid.com.ar/api/v1
RODAID_OPERATOR_ADDRESS=0x...     # Puede ser la misma del deployer en testnet
```

---

## Paso 1: Tests locales con Hardhat

```bash
cd contracts/

# Instalar dependencias
npm install

# Correr todos los tests (50 tests)
npx hardhat test --no-compile

# Correr auditoría de seguridad
npx hardhat run scripts/audit.js --network hardhat
```

**Resultado esperado:** `50 passing` + `AUDITORÍA APROBADA`

---

## Paso 2: Deploy en BFA Testnet (Chain ID: 4338)

```bash
cd contracts/

# Exportar variables
export BFA_WALLET_PRIVATE_KEY=<tu-private-key>
export BFA_TESTNET_RPC_URL=<url-provista-por-onti>
export RODAID_OPERATOR_ADDRESS=<tu-wallet-address>  # puede ser la misma

# Deploy
npx hardhat run scripts/deploy.js --network bfaTestnet
```

**Output esperado:**

```
════════════════════════════════════════════════════════════
  RODAID · Deploy RodaidCIT.sol
  Red:     BFA Testnet (Chain ID: 4338)
  Deploy de prueba — NO usar en producción
════════════════════════════════════════════════════════════

📍 Deployer:     0x742d35Cc...
💰 Balance:      0.5 ETH
🔗 Chain ID:     4338

🚀 Desplegando RodaidCIT...
   TX enviada: 0xabc123...
   Esperando 2 confirmación/es...

✅ CONTRATO DESPLEGADO EXITOSAMENTE
   Dirección:     0x...NUEVA_DIRECCIÓN...
   TX hash:       0x...
   Bloque:        1234567
   Gas usado:     1,245,678

✅ Deploy completado exitosamente
════════════════════════════════════════════════════════════

🔧 Variables de entorno a configurar en RODAID API:
   BFA_CONTRACT_ADDRESS=0x...
   BFA_TESTNET_RPC_URL=<url>
   BFA_CHAIN_ID=4338
```

El deploy info se guarda en `contracts/deployments/bfaTestnet.json`.

---

## Paso 3: Validación en Testnet (mínimo 48 horas)

Configurar el API de RODAID con las variables de testnet y probar:

```bash
# .env (RODAID API — testnet)
BFA_CONTRACT_ADDRESS=<dirección testnet>
BFA_TESTNET_RPC_URL=<url testnet>
BFA_CHAIN_ID=4338
BFA_WALLET_PRIVATE_KEY=<clave privada>
```

### Pruebas mínimas en testnet

```bash
# 1. Emitir 3 CITs de prueba (via API)
curl -X POST http://localhost:8100/api/v1/cit/iniciar \
  -H "Authorization: Bearer $INSPECTOR_TOKEN" \
  -d '{"bicicletaId":"...", "puntos":{...}, ...}'

# 2. Verificar en BFA
curl http://localhost:8100/api/v1/cit/verificar/SN-TEST-001

# 3. Simular denuncia de robo (lock)
curl -X POST http://localhost:8100/api/v1/seguridad/denunciar \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d '{"citId":"...", "descripcion":"..."}'

# 4. Recuperar (unlock)
curl -X POST http://localhost:8100/api/v1/seguridad/denuncias/<id>/recuperar

# 5. Transferencia (marketplace)
# → publicar, iniciar compra, confirmar entrega

# 6. Verificar en explorador BFA
# https://explorer.testnet.bfa.ar/address/<contrato>
```

### Checklist de validación testnet

- [ ] Al menos 3 CITs emitidos y verificables on-chain
- [ ] Lock/unlock de NFT funciona (con denuncia y recuperación)
- [ ] Transfer de NFT funciona (venta en marketplace)
- [ ] `verificarIntegridad()` retorna datos correctos desde BFA
- [ ] Sin errores en los logs del API
- [ ] Tokens visible en explorer.testnet.bfa.ar

---

## Paso 4: Auditoría de seguridad (contra testnet)

```bash
# Auditoría automatizada contra el contrato en testnet
export BFA_TESTNET_RPC_URL=<url>
node contracts/scripts/audit.js   # modo standalone

# O con Hardhat (más completo)
npx hardhat run scripts/audit.js --network bfaTestnet
```

### Auditorías manuales adicionales recomendadas

| Herramienta | Tipo | Descripción |
|---|---|---|
| [Slither](https://github.com/crytic/slither) | Análisis estático | Detecta vulnerabilidades comunes |
| [Mythril](https://github.com/ConsenSys/mythril) | Análisis simbólico | Vulnerabilidades EVM |
| Revisión manual | Visual | Revisar lógica de negocio |

```bash
# Slither (requiere pip install slither-analyzer)
slither contracts/src/RodaidCIT.sol --solc-remaps @openzeppelin=contracts/node_modules/@openzeppelin

# Mythril (requiere Docker)
docker run -v $(pwd)/contracts:/src mythril/myth analyze /src/src/RodaidCIT.sol
```

### Resultado esperado de auditoría

```
══════════════════════════════════════════════════════════
  RESUMEN DE AUDITORÍA
──────────────────────────────────────────────────────────
  ✓ Despliegue                     8/8 (100%)
  ✓ Control de Acceso              5/5 (100%)
  ✓ Integridad SHA-256             7/7 (100%)
  ✓ Restricciones de Transferencia 4/4 (100%)
  ✓ Lock / Unlock                  7/7 (100%)
  ✓ Pausa de Emergencia            4/4 (100%)
  ✓ ERC-165 Interfaces             3/3 (100%)
──────────────────────────────────────────────────────────
  TOTAL: 38/38 tests · ✅ APROBADO
══════════════════════════════════════════════════════════
```

---

## Paso 5: Checklist de migración

```bash
# Verificar que testnet cumple los requisitos para mainnet
node contracts/scripts/migrate.js
```

```
═══════════════════════════════════════════════════
  RODAID · Checklist Migración Testnet → Mainnet
═══════════════════════════════════════════════════
  ✓ Archivo de deploy testnet existe       ...
  ✓ Chain ID = 4338                        chainId: 4338
  ✓ Al menos 3 CITs emitidos               5 CITs emitidos
  ✓ Contrato no pausado                   operativo
  ✓ mint() validaciones OK                validaciones OK
  ✓ verificarIntegridad() correcto         hash inexistente → valido=false
  ✓ supportsInterface ERC-721             ERC-721 interface
  ✓ VERSION() = 2                          VERSION = 2

  8/8 verificaciones · ✅ APROBADO
```

---

## Paso 6: Deploy en BFA Mainnet (Chain ID: 4337)

**⚠️ IRREVERSIBLE. Revisar dos veces antes de ejecutar.**

```bash
cd contracts/

export BFA_WALLET_PRIVATE_KEY=<clave-mainnet>
export BFA_RPC_URL=<url-mainnet-provista-por-onti>
export RODAID_OPERATOR_ADDRESS=<dirección-backend-producción>
export RODAID_BACKEND_URL=https://api.rodaid.com.ar/api/v1

# El script pedirá confirmación antes de proceder
npx hardhat run scripts/deploy.js --network bfaMainnet
```

El deploy guarda el resultado en `contracts/deployments/bfaMainnet.json`.

---

## Paso 7: Configurar producción

```bash
# Variables de entorno en producción (Railway / Render / AWS)
BFA_CONTRACT_ADDRESS=<dirección mainnet>
BFA_RPC_URL=<url mainnet>
BFA_CHAIN_ID=4337
BFA_WALLET_PRIVATE_KEY=<clave privada — usar secrets manager>
RODAID_CUSTODIAL_WALLET=<wallet para NFTs de usuarios sin wallet propia>
```

### Verificar en explorer

```
https://explorer.bfa.ar/address/<BFA_CONTRACT_ADDRESS>
```

---

## Operaciones post-deploy

### Agregar inspectores habilitados

```javascript
// Via API RODAID
await contract.setInspector("0xINSPECTOR_ADDRESS", true)
```

### Monitoreo

- Subscripción a eventos `CITMinted`, `CITBloqueado`, `CITTransferido`
- Alertas si el balance del wallet del operador baja de 0.01 ETH
- Health check en `/health/deep` incluye verificación del contrato BFA

### Pausa de emergencia

```javascript
// Solo el owner puede pausar
await contract.pausar()
// Desbloquear:
await contract.reanudar()
```

---

## Contactos

| Rol | Contacto |
|---|---|
| Soporte técnico BFA | bfa@onti.gob.ar |
| Emergencias RODAID | ops@rodaid.com.ar |
| Contratos inteligentes | Federico De Gea — federico@rodaid.com.ar |
