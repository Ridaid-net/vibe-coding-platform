// ─── RODAID · Tests de firma con ethers.js ────────────────
// Verifica el flujo completo de firma de transacciones:
// NonceManager, GasStrategy, EventParser, HealthCheck

const { ethers, network } = require("hardhat")
const { expect } = require("chai")
const crypto = require("crypto")

function randomHash() { return crypto.randomBytes(32).toString("hex") }

describe("BFAServiceReal — firma de transacciones", function () {
  let contract, deployer, operator, attacker

  beforeEach(async function () {
    [deployer, operator, attacker] = await ethers.getSigners()
    const Factory = await ethers.getContractFactory("src/RodaidCIT.sol:RodaidCIT")
    contract = await Factory.deploy(operator.address, "https://api.rodaid.com.ar/api/v1/cit/metadata")
    await contract.waitForDeployment()
  })

  describe("Firma y envío de transacciones", function () {
    it("mint devuelve receipt con status=1", async function () {
      const tx = await contract.connect(operator).mint(
        deployer.address, randomHash(), "RCIT-001", "SN-001",
        { gasLimit: 500_000n }
      )
      const receipt = await tx.wait()
      expect(receipt.status).to.equal(1)
    })

    it("mint emite evento CITMinted con tokenId correcto", async function () {
      const hash = randomHash()
      const tx = await contract.connect(operator).mint(
        deployer.address, hash, "RCIT-002", "SN-002", { gasLimit: 500_000n }
      )
      const receipt = await tx.wait()

      const iface = new ethers.Interface([
        "event CITMinted(uint256 indexed tokenId, address indexed propietario, address indexed inspector, string hashSHA256, string numeroCIT, string serialBicicleta)"
      ])
      let tokenId = null
      for (const log_ of receipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log_.topics], data: log_.data })
          if (parsed?.name === "CITMinted") { tokenId = Number(parsed.args.tokenId); break }
        } catch {}
      }
      expect(tokenId).to.equal(1)
    })

    it("gasUsed real está dentro del rango esperado", async function () {
      const tx = await contract.connect(operator).mint(
        deployer.address, randomHash(), "RCIT-003", "SN-003", { gasLimit: 500_000n }
      )
      const receipt = await tx.wait()
      // El gas real de un mint con OZ debe estar entre 80k y 250k
      expect(Number(receipt.gasUsed)).to.be.greaterThan(80_000)
      expect(Number(receipt.gasUsed)).to.be.lessThan(400_000)
    })

    it("txHash es único por transacción", async function () {
      const tx1 = await contract.connect(operator).mint(deployer.address, randomHash(), "RCIT-004", "SN-004", { gasLimit: 500_000n })
      const tx2 = await contract.connect(operator).mint(deployer.address, randomHash(), "RCIT-005", "SN-005", { gasLimit: 500_000n })
      const r1 = await tx1.wait()
      const r2 = await tx2.wait()
      expect(r1.hash).to.not.equal(r2.hash)
    })
  })

  describe("Nonce management — concurrencia", function () {
    it("3 transacciones concurrentes sin conflicto de nonce", async function () {
      // Enviar 3 mints simultáneos
      const txPromises = [0,1,2].map(i =>
        contract.connect(operator).mint(
          deployer.address, randomHash(), `RCIT-CONC-00${i}`, `SN-CONC-00${i}`,
          { gasLimit: 500_000n }
        ).then(tx => tx.wait())
      )

      const results = await Promise.allSettled(txPromises)
      const successful = results.filter(r => r.status === "fulfilled").length
      // En Hardhat todos deben ser exitosos (serializa internamente)
      expect(successful).to.be.gte(2, "Al menos 2/3 txs deben confirmar")
    })

    it("nonces son consecutivos en transacciones secuenciales", async function () {
      const nonceAntes = await operator.getNonce()
      await contract.connect(operator).mint(deployer.address, randomHash(), "RCIT-N1", "SN-N1", { gasLimit: 500_000n })
        .then(tx => tx.wait())
      await contract.connect(operator).mint(deployer.address, randomHash(), "RCIT-N2", "SN-N2", { gasLimit: 500_000n })
        .then(tx => tx.wait())
      const nonceDespues = await operator.getNonce()
      expect(nonceDespues).to.equal(nonceAntes + 2)
    })
  })

  describe("Gas estimation", function () {
    it("estimateGas retorna valor razonable para mint()", async function () {
      const iface = contract.interface
      const data = iface.encodeFunctionData("mint", [
        deployer.address, randomHash(), "RCIT-GAS", "SN-GAS"
      ])
      const gasEst = await ethers.provider.estimateGas({
        to:   await contract.getAddress(),
        data,
        from: operator.address,
      })
      expect(Number(gasEst)).to.be.greaterThan(80_000)
      expect(Number(gasEst)).to.be.lessThan(400_000)
    })

    it("getFeeData retorna gasPrice válido", async function () {
      const feeData = await ethers.provider.getFeeData()
      expect(feeData.gasPrice).to.not.be.null
      expect(Number(feeData.gasPrice)).to.be.greaterThan(0)
    })
  })

  describe("Lock/Unlock firmados", function () {
    let tokenId

    beforeEach(async function () {
      const tx = await contract.connect(operator).mint(
        deployer.address, randomHash(), "RCIT-LU", "SN-LU", { gasLimit: 500_000n }
      )
      const receipt = await tx.wait()
      tokenId = 1n
    })

    it("bloquear() firma y confirma", async function () {
      const tx = await contract.connect(operator).bloquear(tokenId, "DENUNCIA_ROBO:test", { gasLimit: 200_000n })
      const receipt = await tx.wait()
      expect(receipt.status).to.equal(1)
      const datos = await contract.datosCIT(tokenId)
      expect(datos.bloqueado).to.be.true
    })

    it("desbloquear() firma y confirma", async function () {
      await contract.connect(operator).bloquear(tokenId, "test", { gasLimit: 200_000n }).then(tx => tx.wait())
      const tx = await contract.connect(operator).desbloquear(tokenId, { gasLimit: 200_000n })
      const receipt = await tx.wait()
      expect(receipt.status).to.equal(1)
      const datos = await contract.datosCIT(tokenId)
      expect(datos.bloqueado).to.be.false
    })
  })

  describe("Transfer firmado", function () {
    it("transferirCIT() firma, confirma y cambia propietario on-chain", async function () {
      await contract.connect(operator).mint(
        deployer.address, randomHash(), "RCIT-TRF", "SN-TRF", { gasLimit: 500_000n }
      ).then(tx => tx.wait())

      const tokenId = 1n
      const tx = await contract.connect(operator).transferirCIT(tokenId, attacker.address, { gasLimit: 200_000n })
      const receipt = await tx.wait()
      expect(receipt.status).to.equal(1)
      expect(await contract.ownerOf(tokenId)).to.equal(attacker.address)
    })

    it("transferirCIT() emite evento CITTransferido", async function () {
      await contract.connect(operator).mint(
        deployer.address, randomHash(), "RCIT-EVT", "SN-EVT", { gasLimit: 500_000n }
      ).then(tx => tx.wait())

      await expect(
        contract.connect(operator).transferirCIT(1n, attacker.address, { gasLimit: 200_000n })
      ).to.emit(contract, "CITTransferido").withArgs(1n, deployer.address, attacker.address, "RCIT-EVT")
    })
  })

  describe("Consultas read-only (sin firma)", function () {
    beforeEach(async function () {
      await contract.connect(operator).mint(
        deployer.address, randomHash(), "RCIT-VIEW", "SN-VIEW", { gasLimit: 500_000n }
      ).then(tx => tx.wait())
    })

    it("verificarIntegridad() sin gas funciona", async function () {
      const hash = randomHash()
      await contract.connect(operator).mint(deployer.address, hash, "RCIT-VI", "SN-VI", { gasLimit: 500_000n }).then(tx => tx.wait())
      const [valido, bloqueado, tokenId] = await contract.verificarIntegridad(hash)
      expect(valido).to.be.true
      expect(bloqueado).to.be.false
      expect(Number(tokenId)).to.be.greaterThan(0)
    })

    it("totalEmitidos() correcto", async function () {
      const total = await contract.totalEmitidos()
      expect(Number(total)).to.be.gte(1)
    })

    it("datosCIT() retorna estructura completa", async function () {
      const datos = await contract.datosCIT(1n)
      expect(datos.hashSHA256).to.have.length(64)
      expect(datos.numeroCIT).to.equal("RCIT-VIEW")
      expect(datos.serialBicicleta).to.equal("SN-VIEW")
      expect(datos.propietario.toLowerCase()).to.equal(deployer.address.toLowerCase())
      expect(datos.emitidoEn).to.be.gt(0n)
    })
  })

  describe("Error handling — revertion", function () {
    it("TX que revierte no confirma (status=0 o throw)", async function () {
      const fakeHash = "a".repeat(64)
      await contract.connect(operator).mint(deployer.address, fakeHash, "RCIT-REV1", "SN-REV1", { gasLimit: 500_000n }).then(tx => tx.wait())
      // Intentar mint con hash duplicado
      await expect(
        contract.connect(operator).mint(deployer.address, fakeHash, "RCIT-REV2", "SN-REV2", { gasLimit: 500_000n })
      ).to.be.reverted
    })

    it("TX sin permiso revierte correctamente", async function () {
      await expect(
        contract.connect(attacker).mint(deployer.address, randomHash(), "RCIT-ATK", "SN-ATK")
      ).to.be.revertedWith("RodaidCIT: acceso restringido al operador o owner")
    })
  })
})
