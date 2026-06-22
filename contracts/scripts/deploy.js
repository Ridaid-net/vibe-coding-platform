// ─── RODAID · Deploy RodaidCIT.sol en BFA ─────────────────
// Uso:
//   npx hardhat run scripts/deploy.js --network bfaTestnet
//   npx hardhat run scripts/deploy.js --network bfaMainnet
//
// Variables de entorno requeridas:
//   BFA_WALLET_PRIVATE_KEY   Clave privada del deployer
//   BFA_TESTNET_RPC_URL      URL nodo BFA testnet (provisto por ONTI)
//   BFA_RPC_URL              URL nodo BFA mainnet (provisto por ONTI)
//   RODAID_BACKEND_URL       URL del backend (para tokenURI)
//   RODAID_OPERATOR_ADDRESS  Dirección del backend que puede emitir CITs
//                            (puede ser la misma del deployer en testnet)

const { ethers, network } = require("hardhat")
const fs   = require("fs")
const path = require("path")

// ── Configuración por red ─────────────────────────────────

const DEPLOY_CONFIG = {
  bfaTestnet: {
    chainId:        4338,
    nombre:         "BFA Testnet",
    confirmaciones: 2,      // esperar 2 bloques antes de considerar exitoso
    gasLimit:       2_000_000n,
    descripcion:    "Deploy de prueba — NO usar en producción",
  },
  bfaMainnet: {
    chainId:        4337,
    nombre:         "BFA Mainnet",
    confirmaciones: 5,      // más confirmaciones en producción
    gasLimit:       2_000_000n,
    descripcion:    "Deploy PRODUCCIÓN — irreversible",
  },
  hardhat: {
    chainId:        31337,
    nombre:         "Hardhat Local",
    confirmaciones: 1,
    gasLimit:       2_000_000n,
    descripcion:    "Red local de desarrollo",
  },
}

// ── Helpers ───────────────────────────────────────────────

function formatEther(wei) {
  return ethers.formatEther(wei)
}

function printSeparator(char = "═", len = 60) {
  console.log(char.repeat(len))
}

async function waitForInput(prompt) {
  if (process.env.CI || process.env.SKIP_CONFIRM) return
  return new Promise(resolve => {
    process.stdout.write(`\n${prompt} [Enter para continuar, Ctrl+C para cancelar] `)
    process.stdin.once("data", () => resolve())
  })
}

// ── Deploy principal ──────────────────────────────────────

async function main() {
  const networkName = network.name
  const config      = DEPLOY_CONFIG[networkName]

  if (!config) {
    console.error(`❌ Red desconocida: "${networkName}"`)
    console.error(`   Redes soportadas: ${Object.keys(DEPLOY_CONFIG).join(", ")}`)
    process.exit(1)
  }

  printSeparator()
  console.log(`\n  RODAID · Deploy RodaidCIT.sol`)
  console.log(`  Red:     ${config.nombre} (Chain ID: ${config.chainId})`)
  console.log(`  ${config.descripcion}`)
  printSeparator()

  // ── 1. Verificar configuración ───────────────────────────
  const [deployer] = await ethers.getSigners()
  const balance     = await ethers.provider.getBalance(deployer.address)
  const networkInfo = await ethers.provider.getNetwork()

  console.log(`\n📍 Deployer:     ${deployer.address}`)
  console.log(`💰 Balance:      ${formatEther(balance)} ETH`)
  console.log(`🔗 Chain ID:     ${networkInfo.chainId}`)

  if (Number(networkInfo.chainId) !== config.chainId) {
    console.error(`\n❌ Chain ID incorrecto.`)
    console.error(`   Esperado: ${config.chainId}`)
    console.error(`   Conectado a: ${networkInfo.chainId}`)
    process.exit(1)
  }

  // Verificar balance mínimo para gas (en testnet ONTI no tiene costo)
  const MIN_BALANCE = ethers.parseEther("0.001")
  if (networkName === "bfaMainnet" && balance < MIN_BALANCE) {
    console.warn(`\n⚠️  Balance bajo (${formatEther(balance)} ETH). Solicitar fondos a ONTI.`)
  }

  // ── 2. Parámetros del contrato ────────────────────────────
  const backendUrl = process.env.RODAID_BACKEND_URL || "https://api.rodaid.com.ar/api/v1"
  const baseURI    = `${backendUrl}/cit/metadata`
  const operator   = process.env.RODAID_OPERATOR_ADDRESS || deployer.address

  console.log(`\n📄 Parámetros del contrato:`)
  console.log(`   operator:  ${operator}`)
  console.log(`   baseURI:   ${baseURI}`)

  // ── 3. Estimación de gas ──────────────────────────────────
  const RodaidCIT  = await ethers.getContractFactory("src/RodaidCIT.sol:RodaidCIT")
  const deployTx   = await RodaidCIT.getDeployTransaction(operator, baseURI)
  const gasEstimate = await ethers.provider.estimateGas(deployTx).catch(() => config.gasLimit)
  const feeData     = await ethers.provider.getFeeData()
  const gasPrice    = feeData.gasPrice || 1_000_000_000n
  const costEstimate = gasEstimate * gasPrice

  console.log(`\n⛽ Estimación de gas:`)
  console.log(`   Gas estimado:  ${gasEstimate.toLocaleString()}`)
  console.log(`   Gas price:     ${ethers.formatUnits(gasPrice, "gwei")} gwei`)
  console.log(`   Costo:         ${formatEther(costEstimate)} ETH`)

  // ── 4. Confirmación en mainnet ────────────────────────────
  if (networkName === "bfaMainnet") {
    console.log(`\n⚠️  ATENCIÓN: Estás desplegando en BFA MAINNET`)
    console.log(`   Esta operación es IRREVERSIBLE.`)
    console.log(`   El contrato quedará permanentemente en la blockchain.`)
    await waitForInput("¿Confirmás el deploy en MAINNET?")
  }

  // ── 5. Deploy ──────────────────────────────────────────────
  console.log(`\n🚀 Desplegando RodaidCIT...`)
  const deployStart = Date.now()

  const contract = await RodaidCIT.deploy(operator, baseURI, {
    gasLimit: gasEstimate + 100_000n,
  })

  console.log(`   TX enviada: ${contract.deploymentTransaction()?.hash}`)
  console.log(`   Esperando ${config.confirmaciones} confirmación/es...`)

  await contract.waitForDeployment()
  const deployMs = Date.now() - deployStart

  const contractAddress = await contract.getAddress()
  const receipt = await contract.deploymentTransaction()?.wait(config.confirmaciones)

  printSeparator()
  console.log(`\n✅ CONTRATO DESPLEGADO EXITOSAMENTE`)
  console.log(`\n   Dirección:     ${contractAddress}`)
  console.log(`   TX hash:       ${receipt?.hash}`)
  console.log(`   Bloque:        ${receipt?.blockNumber}`)
  console.log(`   Gas usado:     ${receipt?.gasUsed?.toLocaleString()}`)
  console.log(`   Tiempo:        ${(deployMs / 1000).toFixed(1)}s`)

  // ── 6. Verificación post-deploy ────────────────────────────
  console.log(`\n🔍 Verificando contrato...`)
  const deployed = new ethers.Contract(contractAddress, [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function owner() view returns (address)",
    "function operator() view returns (address)",
    "function totalEmitidos() view returns (uint256)",
    "function VERSION() view returns (uint256)",
    "function LEY() view returns (string)",
    "function paused() view returns (bool)",
  ], deployer)

  const [name, symbol, owner, op, total, version, ley, paused] = await Promise.all([
    deployed.name(),
    deployed.symbol(),
    deployed.owner(),
    deployed.operator(),
    deployed.totalEmitidos(),
    deployed.VERSION(),
    deployed.LEY(),
    deployed.paused(),
  ])

  console.log(`   name():         "${name}"`)
  console.log(`   symbol():       "${symbol}"`)
  console.log(`   owner():        ${owner}`)
  console.log(`   operator():     ${op}`)
  console.log(`   totalEmitidos():${total}`)
  console.log(`   VERSION():      ${version}`)
  console.log(`   LEY():          "${ley}"`)
  console.log(`   paused():       ${paused}`)

  const checks = [
    ["name == RODAID CIT",     name === "RODAID CIT"],
    ["symbol == RCIT",         symbol === "RCIT"],
    ["owner == deployer",      owner.toLowerCase() === deployer.address.toLowerCase()],
    ["operator correcto",      op.toLowerCase() === operator.toLowerCase()],
    ["totalEmitidos == 0",     Number(total) === 0],
    ["VERSION == 2",           Number(version) === 2],
    ["LEY tiene N9556",        ley.includes("N9556")],
    ["paused == false",        paused === false],
  ]

  let allOk = true
  for (const [label, ok] of checks) {
    console.log(`   ${ok ? "✓" : "✗"} ${label}`)
    if (!ok) allOk = false
  }

  if (!allOk) {
    console.error("\n❌ Verificación FALLIDA — revisar antes de usar el contrato")
    process.exit(1)
  }

  // ── 7. Guardar artefacto de deploy ─────────────────────────
  const deployInfo = {
    contractName:    "RodaidCIT",
    address:         contractAddress,
    network:         networkName,
    chainId:         Number(networkInfo.chainId),
    deployer:        deployer.address,
    operator,
    baseURI,
    txHash:          receipt?.hash,
    blockNumber:     receipt?.blockNumber,
    gasUsed:         receipt?.gasUsed?.toString(),
    deployedAt:      new Date().toISOString(),
    version:         Number(version),
    abi:             JSON.parse(
      fs.readFileSync(path.join(__dirname, "../artifacts/src/RodaidCIT.sol/RodaidCIT.json"), "utf8")
    ).abi,
  }

  const outDir  = path.join(__dirname, "../deployments")
  const outFile = path.join(outDir, `${networkName}.json`)
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify(deployInfo, null, 2))

  console.log(`\n📁 Deploy info guardado en: contracts/deployments/${networkName}.json`)

  // ── 8. Variables de entorno a configurar ───────────────────
  printSeparator()
  console.log(`\n🔧 Variables de entorno a configurar en RODAID API:`)
  console.log(`\n   BFA_CONTRACT_ADDRESS=${contractAddress}`)
  if (networkName === "bfaTestnet") {
    console.log(`   BFA_TESTNET_RPC_URL=<provisto por ONTI>`)
    console.log(`   BFA_CHAIN_ID=4338`)
  } else if (networkName === "bfaMainnet") {
    console.log(`   BFA_RPC_URL=<provisto por ONTI>`)
    console.log(`   BFA_CHAIN_ID=4337`)
  }
  console.log(`   BFA_WALLET_PRIVATE_KEY=<SECRETO — nunca compartir>`)
  console.log(`\n✅ Deploy completado exitosamente`)
  printSeparator()

  return deployInfo
}

main()
  .then(info => {
    console.log(`\nContrato: ${info.address}`)
    process.exit(0)
  })
  .catch(err => {
    console.error(`\n❌ Deploy FALLIDO:`, err.message)
    process.exit(1)
  })
