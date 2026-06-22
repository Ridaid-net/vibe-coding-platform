#!/usr/bin/env node
// ─── RODAID · Deploy RodaidCIT.sol en BFA ────────────────
// Uso:
//   node infra/bfa/deploy.js testnet    → BFA Testnet (Chain 4338)
//   node infra/bfa/deploy.js mainnet    → BFA Mainnet (Chain 4337)
//
// Variables de entorno requeridas:
//   BFA_RPC_URL             URL del nodo RPC provisto por ONTI
//   BFA_WALLET_PRIVATE_KEY  Clave privada del wallet operador
//   RODAID_BACKEND_URL      URL del backend RODAID (para tokenURI)

'use strict'
const { ethers } = require('ethers')
const fs         = require('fs')
const path       = require('path')

// ── Configuración ─────────────────────────────────────────

const REDES = {
  testnet: {
    chainId: 4338,
    nombre:  'BFA Testnet',
    rpc:     process.env.BFA_TESTNET_RPC_URL || 'http://public.testnet.bfa.ar:8545',
  },
  mainnet: {
    chainId: 4337,
    nombre:  'BFA Mainnet',
    rpc:     process.env.BFA_RPC_URL,
  },
}

// ABI + bytecode del contrato compilado (simplificado para deploy sin Hardhat)
// En producción: compilar con solc 0.8.20 o Hardhat
const CONTRACT_ABI = [
  'constructor(address _operator, string memory _baseURI)',
  'function mint(address to, string calldata hashCIT, string calldata numeroCIT) external returns (uint256)',
  'function lockToken(uint256 tokenId, string calldata motivo) external',
  'function unlockToken(uint256 tokenId) external',
  'function transferToken(uint256 tokenId, address newOwner) external',
  'function tokenData(uint256 tokenId) external view returns (string, string, address, bool, string, uint256)',
  'function getTokenByHash(string calldata hashCIT) external view returns (uint256)',
  'function verificarIntegridad(string calldata hashCIT) external view returns (bool, bool, uint256)',
  'function totalSupply() external view returns (uint256)',
  'function setOperator(address newOperator) external',
  'function owner() external view returns (address)',
  'function operator() external view returns (address)',
  'event CITMinted(uint256 indexed tokenId, address indexed owner, string hashCIT, string numeroCIT)',
  'event CITLocked(uint256 indexed tokenId, string motivo, uint256 timestamp)',
]

async function deploy(red) {
  console.log(`\n🔗 Deploy en ${red.nombre} (Chain ID: ${red.chainId})`)
  console.log('══════════════════════════════════════════\n')

  if (!red.rpc) {
    console.error('❌ BFA_RPC_URL no configurado. Obtenerlo de ONTI (bfa@onti.gob.ar).')
    process.exit(1)
  }

  const privateKey = process.env.BFA_WALLET_PRIVATE_KEY
  if (!privateKey) {
    console.error('❌ BFA_WALLET_PRIVATE_KEY no configurado.')
    process.exit(1)
  }

  // Conectar al nodo BFA
  const provider = new ethers.JsonRpcProvider(red.rpc)
  const network  = await provider.getNetwork()

  if (Number(network.chainId) !== red.chainId) {
    console.error(`❌ Chain ID incorrecto. Esperado: ${red.chainId}, encontrado: ${network.chainId}`)
    process.exit(1)
  }

  const wallet  = new ethers.Wallet(privateKey, provider)
  const balance = await provider.getBalance(wallet.address)

  console.log(`📍 Deployer:  ${wallet.address}`)
  console.log(`💰 Balance:   ${ethers.formatEther(balance)} ETH`)

  if (balance < ethers.parseEther('0.01')) {
    console.warn('⚠️  Balance bajo. Solicitar fondos a ONTI para cubrir gas.')
  }

  const backendUrl = process.env.RODAID_BACKEND_URL || 'https://api.rodaid.com.ar/api/v1'
  const baseURI    = `${backendUrl}/cit/metadata`
  const operator   = wallet.address  // En producción puede ser una dirección separada

  console.log(`\n📄 Parámetros del contrato:`)
  console.log(`   operator: ${operator}`)
  console.log(`   baseURI:  ${baseURI}`)

  // NOTA: Para deploy real, compilar RodaidCIT.sol con:
  //   npx solc --optimize --bin --abi contracts/RodaidCIT.sol
  // y cargar el bytecode aquí. Estamos usando ABI para simulación.

  // ── Verificar conexión al nodo ─────────────────────────
  const blockNumber = await provider.getBlockNumber()
  const gasPrice    = await provider.getFeeData()

  console.log(`\n🔍 Estado del nodo:`)
  console.log(`   Último bloque: ${blockNumber}`)
  console.log(`   Gas price:     ${ethers.formatUnits(gasPrice.gasPrice || 0n, 'gwei')} gwei`)

  // ── Estimación de costos ───────────────────────────────
  const GAS_DEPLOY     = 800_000n
  const GAS_PRICE      = gasPrice.gasPrice || 1_000_000_000n  // 1 gwei default en BFA
  const COSTO_DEPLOY   = GAS_DEPLOY * GAS_PRICE

  console.log(`\n💵 Estimación de costos:`)
  console.log(`   Deploy:       ~${ethers.formatEther(COSTO_DEPLOY)} ETH (${GAS_DEPLOY.toLocaleString()} gas)`)
  console.log(`   Mint CIT:     ~${ethers.formatEther(85_000n * GAS_PRICE)} ETH/tx`)
  console.log(`   Lock token:   ~${ethers.formatEther(45_000n * GAS_PRICE)} ETH/tx`)

  console.log('\n⚠️  Para deploy real:')
  console.log('   1. Compilar RodaidCIT.sol: npx hardhat compile')
  console.log('   2. Ejecutar: npx hardhat run infra/bfa/deploy.js --network bfa-testnet')
  console.log('   3. Guardar la dirección del contrato en BFA_CONTRACT_ADDRESS')
  console.log('   4. Verificar en explorer.bfa.ar\n')

  // ── Guardar configuración post-deploy ─────────────────
  const config = {
    red:             red.nombre,
    chainId:         red.chainId,
    rpcUrl:          red.rpc,
    deployer:        wallet.address,
    operator,
    baseURI,
    // contractAddress: Se completa post-deploy real
    deployedAt:      new Date().toISOString(),
    version:         '1.0.0',
    abi:             CONTRACT_ABI,
  }

  const outputPath = path.join(__dirname, `deploy-${red.chainId === 4337 ? 'mainnet' : 'testnet'}.json`)
  fs.writeFileSync(outputPath, JSON.stringify(config, null, 2))
  console.log(`✓ Configuración guardada en ${outputPath}`)

  return config
}

// ── Verificar contrato desplegado ─────────────────────────

async function verify(contractAddress, red) {
  console.log(`\n🔍 Verificando contrato ${contractAddress} en ${red.nombre}...`)

  const provider = new ethers.JsonRpcProvider(red.rpc)
  const code     = await provider.getCode(contractAddress)

  if (code === '0x') {
    console.error('❌ No hay contrato en esa dirección')
    return false
  }

  console.log(`✓ Contrato detectado (${code.length / 2 - 1} bytes)`)

  const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, provider)

  try {
    const owner    = await contract.owner()
    const operator = await contract.operator()
    const total    = await contract.totalSupply()

    console.log(`✓ owner:       ${owner}`)
    console.log(`✓ operator:    ${operator}`)
    console.log(`✓ totalSupply: ${total.toString()} CITs`)
    return true
  } catch (e) {
    console.error('❌ Error consultando el contrato:', e.message)
    return false
  }
}

// ── Main ──────────────────────────────────────────────────

async function main() {
  const args    = process.argv.slice(2)
  const comando = args[0] || 'testnet'

  if (comando === 'verify') {
    const address = args[1]
    const redName = args[2] || 'testnet'
    if (!address) {
      console.error('Uso: node deploy.js verify <contractAddress> [testnet|mainnet]')
      process.exit(1)
    }
    await verify(address, REDES[redName] || REDES.testnet)
    return
  }

  const red = REDES[comando]
  if (!red) {
    console.error(`Red desconocida: "${comando}". Usar "testnet" o "mainnet".`)
    process.exit(1)
  }

  await deploy(red)
}

main().catch(e => { console.error('\n❌ Error en deploy:', e.message); process.exit(1) })
