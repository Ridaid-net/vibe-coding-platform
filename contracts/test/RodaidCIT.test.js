// ─── RODAID · Tests RodaidCIT.sol ────────────────────────
// Tests completos del contrato ERC-721 con OpenZeppelin
// Ejecutar: npx hardhat test (requiere nodo local)
// Para tests sin nodo: node test/RodaidCIT.test.js (modo standalone)

const { ethers }  = require("hardhat")
const { expect }  = require("chai")
const crypto      = require("crypto")

// Helper: generar hash SHA-256 de 64 chars
function sha256hex(content) {
  return crypto.createHash("sha256").update(content).digest("hex")
}

// Helper: dirección aleatoria válida
function randomAddress() {
  return ethers.Wallet.createRandom().address
}

describe("RodaidCIT — ERC-721 en BFA", function () {

  let contract
  let deployer, operator, inspector, propietario, otroUsuario

  const BASE_URI = "https://api.rodaid.com.ar/api/v1/cit/metadata"

  beforeEach(async function () {
    [deployer, operator, inspector, propietario, otroUsuario] = await ethers.getSigners()

    const RodaidCIT = await ethers.getContractFactory("src/RodaidCIT.sol:RodaidCIT")
    contract = await RodaidCIT.deploy(operator.address, BASE_URI)
    await contract.waitForDeployment()
  })

  // ══════════════════════════════════════════════════════
  // DESPLIEGUE
  // ══════════════════════════════════════════════════════

  describe("Despliegue", function () {
    it("nombre y símbolo correctos", async function () {
      expect(await contract.name()).to.equal("RODAID CIT")
      expect(await contract.symbol()).to.equal("RCIT")
    })

    it("version y ley correctas", async function () {
      expect(await contract.VERSION()).to.equal(2n)
      expect(await contract.LEY()).to.include("N9556")
    })

    it("owner y operador iniciales", async function () {
      expect(await contract.owner()).to.equal(deployer.address)
      expect(await contract.operator()).to.equal(operator.address)
    })

    it("totalEmitidos = 0 inicial", async function () {
      expect(await contract.totalEmitidos()).to.equal(0n)
    })

    it("no pausado al desplegar", async function () {
      expect(await contract.paused()).to.equal(false)
    })

    it("revierte con operador zero address", async function () {
      const RodaidCIT = await ethers.getContractFactory("src/RodaidCIT.sol:RodaidCIT")
      await expect(
        RodaidCIT.deploy(ethers.ZeroAddress, BASE_URI)
      ).to.be.revertedWith("RodaidCIT: operador no puede ser address cero")
    })
  })

  // ══════════════════════════════════════════════════════
  // MINT
  // ══════════════════════════════════════════════════════

  describe("mint()", function () {
    const hash1   = sha256hex("CIT-RCIT-2026-00001-contenido-unico")
    const numero1 = "RCIT-2026-00001"
    const serial1 = "SN-R84MK-TMIA-MZA"

    it("operador puede emitir un CIT", async function () {
      const tx = await contract.connect(operator).mint(
        propietario.address, hash1, numero1, serial1
      )
      const receipt = await tx.wait()

      // Verificar evento CITMinted
      const event = receipt.logs
        .map(log => { try { return contract.interface.parseLog(log) } catch { return null } })
        .find(e => e?.name === "CITMinted")

      expect(event).to.not.be.null
      expect(event.args.propietario).to.equal(propietario.address)
      expect(event.args.hashSHA256).to.equal(hash1)
      expect(event.args.numeroCIT).to.equal(numero1)
      expect(event.args.serialBicicleta).to.equal(serial1)
    })

    it("owner también puede emitir (admin)", async function () {
      await expect(
        contract.connect(deployer).mint(propietario.address, hash1, numero1, serial1)
      ).to.not.be.reverted
    })

    it("tokenId retornado es 1", async function () {
      const tokenId = await contract.connect(operator).mint.staticCall(
        propietario.address, hash1, numero1, serial1
      )
      expect(tokenId).to.equal(1n)
    })

    it("totalEmitidos incrementa", async function () {
      await contract.connect(operator).mint(propietario.address, hash1, numero1, serial1)
      expect(await contract.totalEmitidos()).to.equal(1n)
    })

    it("propietario tiene balance de 1", async function () {
      await contract.connect(operator).mint(propietario.address, hash1, numero1, serial1)
      expect(await contract.balanceOf(propietario.address)).to.equal(1n)
    })

    it("ownerOf retorna el propietario correcto", async function () {
      await contract.connect(operator).mint(propietario.address, hash1, numero1, serial1)
      expect(await contract.ownerOf(1n)).to.equal(propietario.address)
    })

    it("hash duplicado → revertir", async function () {
      await contract.connect(operator).mint(propietario.address, hash1, numero1, serial1)
      const hash2   = sha256hex("otro-contenido-diferente")
      await expect(
        contract.connect(operator).mint(propietario.address, hash1, "RCIT-2026-00002", "SN-OTRO")
      ).to.be.revertedWith("RodaidCIT: este hash ya fue registrado (CIT duplicado)")
    })

    it("numeroCIT duplicado → revertir", async function () {
      await contract.connect(operator).mint(propietario.address, hash1, numero1, serial1)
      const hash2 = sha256hex("contenido-diferente")
      await expect(
        contract.connect(operator).mint(propietario.address, hash2, numero1, "SN-OTRO")
      ).to.be.revertedWith("RodaidCIT: este numero de CIT ya existe")
    })

    it("hash con longitud incorrecta → revertir", async function () {
      await expect(
        contract.connect(operator).mint(propietario.address, "abc123", numero1, serial1)
      ).to.be.revertedWith("RodaidCIT: hashSHA256 debe ser 64 chars (SHA-256 hex)")
    })

    it("propietario zero address → revertir", async function () {
      await expect(
        contract.connect(operator).mint(ethers.ZeroAddress, hash1, numero1, serial1)
      ).to.be.revertedWith("RodaidCIT: propietario no puede ser address cero")
    })

    it("tercero sin rol → revertir", async function () {
      await expect(
        contract.connect(otroUsuario).mint(propietario.address, hash1, numero1, serial1)
      ).to.be.revertedWith("RodaidCIT: acceso restringido al operador o owner")
    })

    it("tokenURI correcto", async function () {
      await contract.connect(operator).mint(propietario.address, hash1, numero1, serial1)
      const uri = await contract.tokenURI(1n)
      expect(uri).to.include(BASE_URI)
      expect(uri).to.include("1")
    })
  })

  // ══════════════════════════════════════════════════════
  // DATOS DEL CIT
  // ══════════════════════════════════════════════════════

  describe("datosCIT() y búsquedas", function () {
    const hash = sha256hex("datos-test-cit")
    const num  = "RCIT-2026-TEST"
    const ser  = "SN-TEST-0001"

    beforeEach(async function () {
      await contract.connect(operator).mint(propietario.address, hash, num, ser)
    })

    it("datosCIT retorna estructura completa", async function () {
      const datos = await contract.datosCIT(1n)
      expect(datos.hashSHA256).to.equal(hash)
      expect(datos.numeroCIT).to.equal(num)
      expect(datos.serialBicicleta).to.equal(ser)
      expect(datos.propietario).to.equal(propietario.address)
      expect(datos.bloqueado).to.equal(false)
      expect(datos.motivoBloqueo).to.equal("")
      expect(datos.emitidoEn).to.be.gt(0n)
      expect(datos.bloqueadoEn).to.equal(0n)
    })

    it("tokenPorHash retorna tokenId correcto", async function () {
      expect(await contract.tokenPorHash(hash)).to.equal(1n)
    })

    it("tokenPorNumero retorna tokenId correcto", async function () {
      expect(await contract.tokenPorNumero(num)).to.equal(1n)
    })

    it("historialPorSerial retorna array con tokenId", async function () {
      const hist = await contract.historialPorSerial(ser)
      expect(hist).to.include(1n)
    })

    it("hash inexistente → 0", async function () {
      const notFound = await contract.tokenPorHash("a".repeat(64))
      expect(notFound).to.equal(0n)
    })
  })

  // ══════════════════════════════════════════════════════
  // VERIFICAR INTEGRIDAD
  // ══════════════════════════════════════════════════════

  describe("verificarIntegridad()", function () {
    const hash = sha256hex("verificacion-test")
    const num  = "RCIT-2026-VER"
    const ser  = "SN-VER-001"

    it("hash registrado y no bloqueado → {valido:true, bloqueado:false}", async function () {
      await contract.connect(operator).mint(propietario.address, hash, num, ser)
      const [valido, bloqueado, tokenId] = await contract.verificarIntegridad(hash)
      expect(valido).to.equal(true)
      expect(bloqueado).to.equal(false)
      expect(tokenId).to.equal(1n)
    })

    it("hash no registrado → {valido:false}", async function () {
      const [valido, bloqueado, tokenId] = await contract.verificarIntegridad("b".repeat(64))
      expect(valido).to.equal(false)
      expect(bloqueado).to.equal(false)
      expect(tokenId).to.equal(0n)
    })

    it("hash bloqueado → {valido:true, bloqueado:true}", async function () {
      await contract.connect(operator).mint(propietario.address, hash, num, ser)
      await contract.connect(operator).bloquear(1n, "Denuncia policial #2026-001")
      const [valido, bloqueado] = await contract.verificarIntegridad(hash)
      expect(valido).to.equal(true)
      expect(bloqueado).to.equal(true)
    })
  })

  // ══════════════════════════════════════════════════════
  // BLOQUEO Y DESBLOQUEO
  // ══════════════════════════════════════════════════════

  describe("bloquear() / desbloquear()", function () {
    const hash   = sha256hex("bloqueo-test")
    const motivo = "Denuncia policial MZA #2026-001-PMZ"

    beforeEach(async function () {
      await contract.connect(operator).mint(propietario.address, hash, "RCIT-BLQ", "SN-BLQ")
    })

    it("operador puede bloquear", async function () {
      const tx = await contract.connect(operator).bloquear(1n, motivo)
      const receipt = await tx.wait()
      const event = receipt.logs
        .map(log => { try { return contract.interface.parseLog(log) } catch { return null } })
        .find(e => e?.name === "CITBloqueado")
      expect(event).to.not.be.null
      expect(event.args.tokenId).to.equal(1n)
      expect(event.args.motivo).to.equal(motivo)
      expect(event.args.timestamp).to.be.gt(0n)
    })

    it("datosCIT refleja bloqueo", async function () {
      await contract.connect(operator).bloquear(1n, motivo)
      const datos = await contract.datosCIT(1n)
      expect(datos.bloqueado).to.equal(true)
      expect(datos.motivoBloqueo).to.equal(motivo)
      expect(datos.bloqueadoEn).to.be.gt(0n)
    })

    it("bloquear dos veces → revertir", async function () {
      await contract.connect(operator).bloquear(1n, motivo)
      await expect(
        contract.connect(operator).bloquear(1n, "otro motivo")
      ).to.be.revertedWith("RodaidCIT: ya esta bloqueado")
    })

    it("bloquear sin motivo → revertir", async function () {
      await expect(
        contract.connect(operator).bloquear(1n, "")
      ).to.be.revertedWith("RodaidCIT: motivo requerido")
    })

    it("desbloquear limpia el estado", async function () {
      await contract.connect(operator).bloquear(1n, motivo)
      await expect(contract.connect(operator).desbloquear(1n))
        .to.emit(contract, "CITDesbloqueado")

      const datos = await contract.datosCIT(1n)
      expect(datos.bloqueado).to.equal(false)
      expect(datos.motivoBloqueo).to.equal("")
      expect(datos.bloqueadoEn).to.equal(0n)
    })

    it("desbloquear sin estar bloqueado → revertir", async function () {
      await expect(
        contract.connect(operator).desbloquear(1n)
      ).to.be.revertedWith("RodaidCIT: no estaba bloqueado")
    })

    it("tercero no puede bloquear", async function () {
      await expect(
        contract.connect(otroUsuario).bloquear(1n, motivo)
      ).to.be.revertedWith("RodaidCIT: acceso restringido al operador o owner")
    })
  })

  // ══════════════════════════════════════════════════════
  // TRANSFERENCIA (VENTA EN MARKETPLACE)
  // ══════════════════════════════════════════════════════

  describe("transferirCIT()", function () {
    const hash = sha256hex("transfer-test")

    beforeEach(async function () {
      await contract.connect(operator).mint(propietario.address, hash, "RCIT-TRF", "SN-TRF")
    })

    it("operador puede transferir a nuevo propietario", async function () {
      await expect(
        contract.connect(operator).transferirCIT(1n, otroUsuario.address)
      ).to.emit(contract, "CITTransferido").withArgs(1n, propietario.address, otroUsuario.address, "RCIT-TRF")

      expect(await contract.ownerOf(1n)).to.equal(otroUsuario.address)
    })

    it("transferir CIT bloqueado → revertir", async function () {
      await contract.connect(operator).bloquear(1n, "robo")
      await expect(
        contract.connect(operator).transferirCIT(1n, otroUsuario.address)
      ).to.be.revertedWith("RodaidCIT: no se puede transferir un CIT bloqueado")
    })

    it("transferir a zero address → revertir", async function () {
      await expect(
        contract.connect(operator).transferirCIT(1n, ethers.ZeroAddress)
      ).to.be.revertedWith("RodaidCIT: nuevoPropietario no puede ser address cero")
    })

    it("usuario directo no puede transferir (override ERC-721)", async function () {
      await expect(
        contract.connect(propietario).transferFrom(
          propietario.address, otroUsuario.address, 1n
        )
      ).to.be.revertedWith("RodaidCIT: transferencias directas no permitidas, usar transferirCIT()")
    })
  })

  // ══════════════════════════════════════════════════════
  // PAUSA
  // ══════════════════════════════════════════════════════

  describe("pausar() / reanudar()", function () {
    it("owner puede pausar", async function () {
      await contract.connect(deployer).pausar()
      expect(await contract.paused()).to.equal(true)
    })

    it("mint falla en pausa", async function () {
      await contract.connect(deployer).pausar()
      const hash = sha256hex("pause-test")
      await expect(
        contract.connect(operator).mint(propietario.address, hash, "RCIT-PAU", "SN-PAU")
      ).to.be.revertedWithCustomError(contract, "EnforcedPause")
    })

    it("reanudar permite operar", async function () {
      await contract.connect(deployer).pausar()
      await contract.connect(deployer).reanudar()
      expect(await contract.paused()).to.equal(false)
    })

    it("no owner → revertir pausar", async function () {
      await expect(
        contract.connect(operator).pausar()
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount")
    })
  })

  // ══════════════════════════════════════════════════════
  // ADMIN
  // ══════════════════════════════════════════════════════

  describe("Admin — setOperador / setInspector", function () {
    it("setOperador actualiza el operador", async function () {
      await expect(
        contract.connect(deployer).setOperador(otroUsuario.address)
      ).to.emit(contract, "OperadorActualizado")
        .withArgs(operator.address, otroUsuario.address)

      expect(await contract.operator()).to.equal(otroUsuario.address)
    })

    it("setOperador zero address → revertir", async function () {
      await expect(
        contract.connect(deployer).setOperador(ethers.ZeroAddress)
      ).to.be.revertedWith("RodaidCIT: address cero")
    })

    it("setInspector habilita un inspector", async function () {
      await expect(
        contract.connect(deployer).setInspector(inspector.address, true)
      ).to.emit(contract, "InspectorActualizado")
        .withArgs(inspector.address, true)

      expect(await contract.inspectores(inspector.address)).to.equal(true)
    })

    it("transferOwnership funciona", async function () {
      await contract.connect(deployer).transferOwnership(otroUsuario.address)
      expect(await contract.owner()).to.equal(otroUsuario.address)
    })

    it("no owner → revertir setOperador", async function () {
      await expect(
        contract.connect(operator).setOperador(randomAddress())
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount")
    })
  })

  // ══════════════════════════════════════════════════════
  // HISTORIAL POR SERIAL (múltiples CITs por bicicleta)
  // ══════════════════════════════════════════════════════

  describe("Historial por serial", function () {
    it("una bicicleta puede tener múltiples CITs", async function () {
      const serial = "SN-HIST-001"
      await contract.connect(operator).mint(
        propietario.address, sha256hex("cit-v1"), "RCIT-2025-001", serial
      )
      await contract.connect(operator).mint(
        propietario.address, sha256hex("cit-v2"), "RCIT-2026-001", serial
      )

      const hist = await contract.historialPorSerial(serial)
      expect(hist.length).to.equal(2)
      expect(hist[0]).to.equal(1n)
      expect(hist[1]).to.equal(2n)
    })
  })

  // ══════════════════════════════════════════════════════
  // ERC-165 supportsInterface
  // ══════════════════════════════════════════════════════

  describe("supportsInterface (ERC-165)", function () {
    it("soporta ERC-721", async function () {
      const ERC721_ID = "0x80ac58cd"
      expect(await contract.supportsInterface(ERC721_ID)).to.equal(true)
    })

    it("soporta ERC-721Metadata", async function () {
      const ERC721META_ID = "0x5b5e139f"
      expect(await contract.supportsInterface(ERC721META_ID)).to.equal(true)
    })

    it("soporta ERC-165", async function () {
      const ERC165_ID = "0x01ffc9a7"
      expect(await contract.supportsInterface(ERC165_ID)).to.equal(true)
    })
  })
})
