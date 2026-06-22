// ─── RODAID · Auditoría de Seguridad RodaidCIT.sol ────────
// Ejecutar ANTES del deploy en mainnet.
// Verifica el contrato en Hardhat local o testnet.
//
// Uso:
//   npx hardhat run scripts/audit.js --network hardhat
//   npx hardhat run scripts/audit.js --network bfaTestnet

const { ethers, network } = require("hardhat")
const crypto = require("crypto")

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex")
}

function randomHash() {
  return crypto.randomBytes(32).toString("hex")
}

function printSeparator(char = "═", len = 60) {
  console.log(char.repeat(len))
}

function checkResult(suite, label, ok, detail = "") {
  const status = ok ? "✓ PASS" : "✗ FAIL"
  console.log(`  ${status}: ${label}${detail ? ` (${detail})` : ""}`)
  suite.passed += ok ? 1 : 0
  suite.failed += ok ? 0 : 1
}

// ════════════════════════════════════════════════════════
// SUITE 1: Despliegue y configuración inicial
// ════════════════════════════════════════════════════════

async function auditDeploy(contract, deployer, operator) {
  const suite = { name: "Despliegue", passed: 0, failed: 0 }
  console.log(`\n── ${suite.name} ──────────────────────────────────────`)

  checkResult(suite, "name() = RODAID CIT",
    await contract.name() === "RODAID CIT")

  checkResult(suite, "symbol() = RCIT",
    await contract.symbol() === "RCIT")

  checkResult(suite, "VERSION() = 2",
    Number(await contract.VERSION()) === 2)

  checkResult(suite, "LEY() incluye N9556",
    (await contract.LEY()).includes("N9556"))

  checkResult(suite, "owner() = deployer",
    (await contract.owner()).toLowerCase() === deployer.address.toLowerCase())

  checkResult(suite, "operator() = operator esperado",
    (await contract.operator()).toLowerCase() === operator.toLowerCase())

  checkResult(suite, "totalEmitidos() = 0 inicial",
    Number(await contract.totalEmitidos()) === 0)

  checkResult(suite, "paused() = false inicial",
    await contract.paused() === false)

  return suite
}

// ════════════════════════════════════════════════════════
// SUITE 2: Control de acceso (solo operador puede emitir)
// ════════════════════════════════════════════════════════

async function auditAccessControl(contract, deployer, operator, attacker) {
  const suite = { name: "Control de Acceso", passed: 0, failed: 0 }
  console.log(`\n── ${suite.name} ────────────────────────────────────────`)

  const hash1 = randomHash()

  // Atacante no puede mintear
  try {
    await contract.connect(attacker).mint(attacker.address, hash1, "RCIT-ATK", "SN-ATK")
    checkResult(suite, "Atacante NO puede mint()", false, "debería revertir")
  } catch (e) {
    checkResult(suite, "Atacante NO puede mint()", e.message.includes("operador"))
  }

  // Operador SÍ puede mintear
  try {
    await contract.connect(operator).mint(deployer.address, hash1, "RCIT-0001", "SN-VALID")
    checkResult(suite, "Operador SÍ puede mint()", true)
  } catch (e) {
    checkResult(suite, "Operador SÍ puede mint()", false, e.message)
  }

  // Atacante no puede pausar
  try {
    await contract.connect(attacker).pausar()
    checkResult(suite, "Atacante NO puede pausar()", false)
  } catch (e) {
    checkResult(suite, "Atacante NO puede pausar()", true)
  }

  // Atacante no puede cambiar operador
  try {
    await contract.connect(attacker).setOperador(attacker.address)
    checkResult(suite, "Atacante NO puede setOperador()", false)
  } catch (e) {
    checkResult(suite, "Atacante NO puede setOperador()", true)
  }

  // Operador no puede cambiar owner
  try {
    await contract.connect(operator).transferOwnership(attacker.address)
    checkResult(suite, "Operador NO puede transferOwnership()", false)
  } catch (e) {
    checkResult(suite, "Operador NO puede transferOwnership()", true)
  }

  return suite
}

// ════════════════════════════════════════════════════════
// SUITE 3: Integridad del hash SHA-256
// ════════════════════════════════════════════════════════

async function auditHashIntegrity(contract, operator, deployer) {
  const suite = { name: "Integridad SHA-256", passed: 0, failed: 0 }
  console.log(`\n── ${suite.name} ────────────────────────────────────────`)

  // Hash demasiado corto → revertir
  try {
    await contract.connect(operator).mint(deployer.address, "abc123", "RCIT-SHORT", "SN-X")
    checkResult(suite, "Hash <64 chars → revertir", false)
  } catch (e) {
    checkResult(suite, "Hash <64 chars → revertir", true, "revertido correctamente")
  }

  // Hash de 64 chars → OK
  const validHash = randomHash()
  try {
    await contract.connect(operator).mint(deployer.address, validHash, "RCIT-HASH", "SN-Y")
    checkResult(suite, "Hash 64 chars → OK", true)
  } catch (e) {
    checkResult(suite, "Hash 64 chars → OK", false, e.message)
  }

  // Hash duplicado → revertir
  try {
    await contract.connect(operator).mint(deployer.address, validHash, "RCIT-DUP", "SN-Z")
    checkResult(suite, "Hash duplicado → revertir", false)
  } catch (e) {
    checkResult(suite, "Hash duplicado → revertir", true, "revertido correctamente")
  }

  // Número CIT duplicado → revertir
  const hash2 = randomHash()
  try {
    await contract.connect(operator).mint(deployer.address, hash2, "RCIT-HASH", "SN-W")
    checkResult(suite, "NumeroCIT duplicado → revertir", false)
  } catch (e) {
    checkResult(suite, "NumeroCIT duplicado → revertir", true, "revertido correctamente")
  }

  // verificarIntegridad() funciona
  const [valido, bloqueado, tokenId] = await contract.verificarIntegridad(validHash)
  checkResult(suite, "verificarIntegridad() valido=true", valido === true)
  checkResult(suite, "verificarIntegridad() bloqueado=false", bloqueado === false)
  checkResult(suite, "verificarIntegridad() tokenId>0", Number(tokenId) > 0)

  // Hash inexistente → valido=false
  const [v2] = await contract.verificarIntegridad(randomHash())
  checkResult(suite, "Hash inexistente → valido=false", v2 === false)

  return suite
}

// ════════════════════════════════════════════════════════
// SUITE 4: Bloqueo de transferencias ERC-721 directas
// ════════════════════════════════════════════════════════

async function auditTransferRestrictions(contract, operator, deployer, attacker) {
  const suite = { name: "Restricciones de Transferencia", passed: 0, failed: 0 }
  console.log(`\n── ${suite.name} ─────────────────────────────────────────`)

  const hash = randomHash()
  await contract.connect(operator).mint(deployer.address, hash, "RCIT-TRF", "SN-TRF")
  const tokenId = await contract.tokenPorHash(hash)

  // transferFrom directo → revertir
  try {
    await contract.connect(deployer).transferFrom(deployer.address, attacker.address, tokenId)
    checkResult(suite, "transferFrom directo → revertir", false)
  } catch (e) {
    checkResult(suite, "transferFrom directo → revertir", true, "revertido correctamente")
  }

  // safeTransferFrom directo → revertir
  try {
    await contract.connect(deployer)["safeTransferFrom(address,address,uint256)"](
      deployer.address, attacker.address, tokenId
    )
    checkResult(suite, "safeTransferFrom directo → revertir", false)
  } catch (e) {
    checkResult(suite, "safeTransferFrom directo → revertir", true)
  }

  // Operador SÍ puede transferir
  try {
    await contract.connect(operator).transferirCIT(tokenId, attacker.address)
    const newOwner = await contract.ownerOf(tokenId)
    checkResult(suite, "Operador SÍ puede transferirCIT()", 
      newOwner.toLowerCase() === attacker.address.toLowerCase())
  } catch (e) {
    checkResult(suite, "Operador SÍ puede transferirCIT()", false, e.message)
  }

  return suite
}

// ════════════════════════════════════════════════════════
// SUITE 5: Lock/Unlock de CITs
// ════════════════════════════════════════════════════════

async function auditLockUnlock(contract, operator, deployer, attacker) {
  const suite = { name: "Lock / Unlock", passed: 0, failed: 0 }
  console.log(`\n── ${suite.name} ──────────────────────────────────────────`)

  const hash = randomHash()
  await contract.connect(operator).mint(deployer.address, hash, "RCIT-LCK", "SN-LCK")
  const tokenId = await contract.tokenPorHash(hash)

  // Bloquear
  await contract.connect(operator).bloquear(tokenId, "DENUNCIA_ROBO:test-denuncia-001:SN-LCK")
  const datos = await contract.datosCIT(tokenId)
  checkResult(suite, "bloquear() cambia estado", datos.bloqueado === true)
  checkResult(suite, "bloquear() guarda motivo", datos.motivoBloqueo.includes("DENUNCIA_ROBO"))

  // Transfer de token bloqueado → revertir
  try {
    await contract.connect(operator).transferirCIT(tokenId, attacker.address)
    checkResult(suite, "Transfer bloqueado → revertir", false)
  } catch (e) {
    checkResult(suite, "Transfer bloqueado → revertir", true, "revertido correctamente")
  }

  // Doble bloqueo → revertir
  try {
    await contract.connect(operator).bloquear(tokenId, "segundo bloqueo")
    checkResult(suite, "Doble bloqueo → revertir", false)
  } catch (e) {
    checkResult(suite, "Doble bloqueo → revertir", true, "revertido correctamente")
  }

  // Desbloquear
  await contract.connect(operator).desbloquear(tokenId)
  const datos2 = await contract.datosCIT(tokenId)
  checkResult(suite, "desbloquear() limpia estado", datos2.bloqueado === false)
  checkResult(suite, "desbloquear() limpia motivo", datos2.motivoBloqueo === "")
  checkResult(suite, "desbloquear() limpia timestamp", Number(datos2.bloqueadoEn) === 0)

  // Transfer después de desbloqueo → OK
  try {
    await contract.connect(operator).transferirCIT(tokenId, attacker.address)
    checkResult(suite, "Transfer post-unlock → OK", true)
  } catch (e) {
    checkResult(suite, "Transfer post-unlock → OK", false, e.message)
  }

  // Atacante no puede bloquear
  const hash2 = randomHash()
  await contract.connect(operator).mint(deployer.address, hash2, "RCIT-ATK2", "SN-ATK2")
  const tokenId2 = await contract.tokenPorHash(hash2)
  try {
    await contract.connect(attacker).bloquear(tokenId2, "ataque")
    checkResult(suite, "Atacante NO puede bloquear()", false)
  } catch (e) {
    checkResult(suite, "Atacante NO puede bloquear()", true, "revertido correctamente")
  }

  return suite
}

// ════════════════════════════════════════════════════════
// SUITE 6: Pausa de emergencia
// ════════════════════════════════════════════════════════

async function auditPause(contract, deployer, operator, attacker) {
  const suite = { name: "Pausa de Emergencia", passed: 0, failed: 0 }
  console.log(`\n── ${suite.name} ──────────────────────────────────────────`)

  await contract.connect(deployer).pausar()
  checkResult(suite, "paused() = true tras pausar()", await contract.paused() === true)

  const hashPaused = randomHash()
  try {
    await contract.connect(operator).mint(deployer.address, hashPaused, "RCIT-PAU", "SN-PAU")
    checkResult(suite, "mint() falla durante pausa", false)
  } catch (e) {
    checkResult(suite, "mint() falla durante pausa", true)
  }

  await contract.connect(deployer).reanudar()
  checkResult(suite, "paused() = false tras reanudar()", await contract.paused() === false)

  const hashPost = randomHash()
  try {
    await contract.connect(operator).mint(deployer.address, hashPost, "RCIT-POST", "SN-POST")
    checkResult(suite, "mint() funciona post-reanudación", true)
  } catch (e) {
    checkResult(suite, "mint() funciona post-reanudación", false, e.message)
  }

  return suite
}

// ════════════════════════════════════════════════════════
// SUITE 7: ERC-165 interfaces
// ════════════════════════════════════════════════════════

async function auditInterfaces(contract) {
  const suite = { name: "ERC-165 Interfaces", passed: 0, failed: 0 }
  console.log(`\n── ${suite.name} ────────────────────────────────────────`)

  const checks = [
    ["ERC-721",         "0x80ac58cd"],
    ["ERC-721Metadata", "0x5b5e139f"],
    ["ERC-165",         "0x01ffc9a7"],
  ]

  for (const [name, iface] of checks) {
    const supported = await contract.supportsInterface(iface)
    checkResult(suite, `supportsInterface(${name})`, supported)
  }

  return suite
}

// ════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════

async function main() {
  const [deployer, operatorSigner, attacker] = await ethers.getSigners()
  const operator = operatorSigner.address

  printSeparator()
  console.log(`\n  RODAID · Auditoría de Seguridad RodaidCIT v2`)
  console.log(`  Red: ${network.name}`)
  console.log(`  Deployer:  ${deployer.address}`)
  console.log(`  Operator:  ${operator}`)
  console.log(`  Attacker:  ${attacker.address}`)
  printSeparator()

  // Deploy en red local para auditoría
  const RodaidCIT = await ethers.getContractFactory("src/RodaidCIT.sol:RodaidCIT")
  const baseURI   = "https://api.rodaid.com.ar/api/v1/cit/metadata"
  const contract  = await RodaidCIT.deploy(operator, baseURI)
  await contract.waitForDeployment()

  const addr = await contract.getAddress()
  console.log(`\n✓ Contrato desplegado en: ${addr}`)

  // Ejecutar suites secuencialmente (cada una modifica estado)
  const suites = []
  suites.push(await auditDeploy(contract, deployer, operator))
  suites.push(await auditAccessControl(contract, deployer, operatorSigner, attacker))
  suites.push(await auditHashIntegrity(contract, operatorSigner, deployer))
  suites.push(await auditTransferRestrictions(contract, operatorSigner, deployer, attacker))
  suites.push(await auditLockUnlock(contract, operatorSigner, deployer, attacker))
  suites.push(await auditPause(contract, deployer, operatorSigner, attacker))
  suites.push(await auditInterfaces(contract))

  // Resumen
  const totalPassed = suites.reduce((a, s) => a + s.passed, 0)
  const totalFailed = suites.reduce((a, s) => a + s.failed, 0)
  const total       = totalPassed + totalFailed

  printSeparator()
  console.log(`\n  RESUMEN DE AUDITORÍA`)
  printSeparator("-")
  for (const suite of suites) {
    const ok  = suite.failed === 0
    const pct = Math.round((suite.passed / (suite.passed + suite.failed)) * 100)
    console.log(`  ${ok ? "✓" : "✗"} ${suite.name.padEnd(32)} ${suite.passed}/${suite.passed + suite.failed} (${pct}%)`)
  }
  printSeparator("-")
  console.log(`  TOTAL: ${totalPassed}/${total} tests · ${totalFailed === 0 ? "✅ APROBADO" : "❌ RECHAZADO"}`)
  printSeparator()

  if (totalFailed > 0) {
    console.error(`\n❌ AUDITORÍA RECHAZADA — ${totalFailed} test/s fallaron.`)
    console.error(`   NO desplegar en mainnet hasta resolver los fallos.`)
    process.exit(1)
  } else {
    console.log(`\n✅ AUDITORÍA APROBADA — contrato seguro para mainnet.`)
    console.log(`   Próximo paso: npx hardhat run scripts/deploy.js --network bfaTestnet`)
  }
}

main().catch(e => {
  console.error("\n❌ Auditoría fallida:", e.message)
  process.exit(1)
})
