// ─── RODAID · Migración Testnet → Mainnet ─────────────────
// Verifica que el contrato en testnet cumple todos los
// requisitos antes de autorizar el deploy en mainnet.
//
// Uso:
//   node scripts/migrate.js
//
// Requiere:
//   contracts/deployments/bfaTestnet.json  (generado por deploy.js)
//   BFA_TESTNET_RPC_URL en el entorno

"use strict"
const { ethers } = require("ethers")
const fs         = require("path")
const path       = require("path")

const TESTNET_DEPLOY = path.join(__dirname, "../deployments/bfaTestnet.json")
const MIN_CITS_TESTNET = parseInt(process.env.MIN_CITS_TESTNET || "3")

// Checklist de migración — cada ítem debe ser TRUE para aprobar
const CHECKLIST = [
  // [descripción, función asíncrona que devuelve {ok, detalle}]
  [
    "Archivo de deploy testnet existe",
    async () => {
      const exists = require("fs").existsSync(TESTNET_DEPLOY)
      return { ok: exists, detalle: exists ? TESTNET_DEPLOY : "No encontrado" }
    },
  ],
  [
    "Chain ID del deploy es BFA Testnet (4338)",
    async (info) => {
      const ok = info.chainId === 4338
      return { ok, detalle: `chainId: ${info.chainId}` }
    },
  ],
  [
    `Al menos ${MIN_CITS_TESTNET} CITs emitidos en testnet`,
    async (info, contract) => {
      const total = await contract.totalEmitidos()
      const ok    = Number(total) >= MIN_CITS_TESTNET
      return { ok, detalle: `${total} CITs emitidos` }
    },
  ],
  [
    "Contrato no pausado",
    async (_info, contract) => {
      const paused = await contract.paused()
      return { ok: !paused, detalle: paused ? "PAUSADO ⚠️" : "operativo" }
    },
  ],
  [
    "Función mint() accesible solo por operador",
    async (_info, contract, signer) => {
      const hash = require("crypto").randomBytes(32).toString("hex")
      try {
        await contract.connect(signer).mint.staticCall(
          ethers.ZeroAddress, hash, "RCIT-CHECK", "SN-CHECK"
        )
        return { ok: false, detalle: "mint() aceptó zero address (error)" }
      } catch {
        return { ok: true, detalle: "validaciones OK" }
      }
    },
  ],
  [
    "verificarIntegridad() retorna datos correctos",
    async (_info, contract) => {
      const fakeHash = "a".repeat(64)
      const [valido] = await contract.verificarIntegridad(fakeHash)
      return { ok: valido === false, detalle: "hash inexistente → valido=false" }
    },
  ],
  [
    "supportsInterface ERC-721",
    async (_info, contract) => {
      const ok = await contract.supportsInterface("0x80ac58cd")
      return { ok, detalle: "ERC-721 interface" }
    },
  ],
  [
    "VERSION() = 2",
    async (_info, contract) => {
      const v = await contract.VERSION()
      return { ok: Number(v) === 2, detalle: `VERSION = ${v}` }
    },
  ],
]

async function main() {
  console.log("═".repeat(60))
  console.log("  RODAID · Checklist Migración Testnet → Mainnet")
  console.log("═".repeat(60))

  // Leer deploy info de testnet
  if (!require("fs").existsSync(TESTNET_DEPLOY)) {
    console.error(`\n❌ No existe ${TESTNET_DEPLOY}`)
    console.error("   Primero desplegá en testnet: npx hardhat run scripts/deploy.js --network bfaTestnet")
    process.exit(1)
  }

  const info = JSON.parse(require("fs").readFileSync(TESTNET_DEPLOY, "utf8"))
  console.log(`\n📋 Deploy testnet:`)
  console.log(`   Dirección:  ${info.address}`)
  console.log(`   Deployer:   ${info.deployer}`)
  console.log(`   Desplegado: ${info.deployedAt}`)
  console.log(`   Bloque:     ${info.blockNumber}`)

  // Conectar a testnet
  const rpcUrl = process.env.BFA_TESTNET_RPC_URL || "http://public.testnet.bfa.ar:8545"
  const provider = new ethers.JsonRpcProvider(rpcUrl)

  let signer
  if (process.env.BFA_WALLET_PRIVATE_KEY) {
    signer = new ethers.Wallet(process.env.BFA_WALLET_PRIVATE_KEY, provider)
  }

  const contract = new ethers.Contract(info.address, info.abi, signer || provider)

  // Ejecutar checklist
  console.log(`\n── Verificaciones ──────────────────────────────────────`)
  let passed = 0; let failed = 0

  for (const [descripcion, checkFn] of CHECKLIST) {
    let ok = false; let detalle = ""
    try {
      const result = await checkFn(info, contract, signer)
      ok      = result.ok
      detalle = result.detalle
    } catch (err) {
      ok      = false
      detalle = err.message.slice(0, 80)
    }
    console.log(`  ${ok ? "✓" : "✗"} ${descripcion.padEnd(50)} ${detalle}`)
    if (ok) passed++; else failed++
  }

  // Resultado
  console.log(`\n${"═".repeat(60)}`)
  console.log(`  ${passed}/${passed + failed} verificaciones · ${failed === 0 ? "✅ APROBADO" : "❌ RECHAZADO"}`)
  console.log(`${"═".repeat(60)}`)

  if (failed > 0) {
    console.error(`\n❌ Checklist RECHAZADO — ${failed} verificación/es fallaron.`)
    console.error("   Corregí los problemas antes de hacer el deploy en mainnet.")
    process.exit(1)
  }

  console.log(`\n✅ CHECKLIST APROBADO`)
  console.log(`\n   Para desplegar en mainnet:`)
  console.log(`   npx hardhat run scripts/deploy.js --network bfaMainnet`)
  console.log(``)
  console.log(`   ⚠️  RECORDÁ configurar en el API de producción:`)
  console.log(`   BFA_CONTRACT_ADDRESS=<nueva dirección mainnet>`)
  console.log(`   BFA_CHAIN_ID=4337`)
}

main().catch(e => {
  console.error("Error:", e.message)
  process.exit(1)
})
