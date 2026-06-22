// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ─── RODAID · Contrato RodaidCIT v2 ──────────────────────
// ERC-721 para Certificados de Identidad Técnica de Bicicletas
// Ley Provincial Mendoza N° 9556 — Arts. 15-18
//
// Ancla el hash SHA-256 de cada CIT en la Blockchain Federal
// Argentina (BFA, ONTI) como prueba de existencia e integridad.
//
// Basado en OpenZeppelin Contracts v5 (ERC-721 + Ownable + Pausable)
// Compilar: solidity ^0.8.20, optimizer runs=200
// Deploy:   BFA Testnet (4338) / Mainnet (4337)

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/// @title  RodaidCIT — Certificado de Identidad Técnica en BFA
/// @author RODAID (rodaid.com.ar) — Federico De Gea
/// @notice Implementa ERC-721 para anclar CITs en la Blockchain Federal Argentina
/// @dev    Compatible con OpenZeppelin v5. Usa ERC721URIStorage para metadatos off-chain.
contract RodaidCIT is ERC721URIStorage, Ownable, Pausable, ReentrancyGuard {

    using Strings for uint256;

    // ══════════════════════════════════════════════════════
    // CONSTANTES
    // ══════════════════════════════════════════════════════

    uint256 public constant VERSION = 2;
    string  public constant LEY     = "Ley Provincial Mendoza N9556";

    // ══════════════════════════════════════════════════════
    // ROLES
    // ══════════════════════════════════════════════════════

    /// @dev El operador es el backend de RODAID autorizado a emitir CITs
    address public operator;

    /// @dev El inspector puede iniciar la emisión (requiere confirmación del operador)
    mapping(address => bool) public inspectores;

    // ══════════════════════════════════════════════════════
    // ESTADO DEL CONTRATO
    // ══════════════════════════════════════════════════════

    uint256 private _tokenIdCounter;   // próximo tokenId a emitir
    string  private _baseTokenURI;     // URI base para metadatos

    /// @notice Datos completos de un CIT almacenados on-chain
    struct CITData {
        string  hashSHA256;       // SHA-256 del PDF del CIT (64 chars hex)
        string  numeroCIT;        // Número único: "RCIT-2026-00001"
        string  serialBicicleta;  // Número de serie de la unidad
        bool    bloqueado;        // true = denuncia de robo activa
        string  motivoBloqueo;    // descripción del motivo de bloqueo
        uint256 emitidoEn;        // block.timestamp del mint
        uint256 bloqueadoEn;      // block.timestamp del bloqueo (0 = libre)
        address inspector;        // address del inspector que emitió
    }

    /// @dev tokenId → datos del CIT
    mapping(uint256 => CITData) private _cits;

    /// @dev hashSHA256 → tokenId (para verificación por hash, sin duplicados)
    mapping(string => uint256) private _hashToToken;

    /// @dev numeroCIT → tokenId (para búsqueda por número)
    mapping(string => uint256) private _numeroToToken;

    /// @dev serialBicicleta → historial de tokenIds (una bici puede tener varios CITs en el tiempo)
    mapping(string => uint256[]) private _serialToCITs;

    // ══════════════════════════════════════════════════════
    // EVENTOS
    // ══════════════════════════════════════════════════════

    /// @notice Emitido cada vez que se acuña un nuevo CIT
    event CITMinted(
        uint256 indexed tokenId,
        address indexed propietario,
        address indexed inspector,
        string  hashSHA256,
        string  numeroCIT,
        string  serialBicicleta
    );

    /// @notice Emitido cuando se bloquea un CIT por robo
    event CITBloqueado(
        uint256 indexed tokenId,
        string  motivo,
        uint256 timestamp
    );

    /// @notice Emitido cuando se desbloquea un CIT
    event CITDesbloqueado(
        uint256 indexed tokenId,
        uint256 timestamp
    );

    /// @notice Emitido cuando el CIT se transfiere (venta en marketplace)
    event CITTransferido(
        uint256 indexed tokenId,
        address indexed de,
        address indexed para,
        string  numeroCIT
    );

    /// @notice Emitido cuando se agrega o quita un inspector
    event InspectorActualizado(address indexed inspector, bool habilitado);

    /// @notice Emitido cuando cambia el operador
    event OperadorActualizado(address indexed anterior, address indexed nuevo);

    // ══════════════════════════════════════════════════════
    // MODIFICADORES
    // ══════════════════════════════════════════════════════

    modifier soloOperador() {
        require(
            msg.sender == operator || msg.sender == owner(),
            "RodaidCIT: acceso restringido al operador o owner"
        );
        _;
    }

    modifier tokenValido(uint256 tokenId) {
        require(ownerOf(tokenId) != address(0), "RodaidCIT: token no existe");
        _;
    }

    // ══════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ══════════════════════════════════════════════════════

    /// @param _operator   Dirección del backend RODAID (puede emitir CITs)
    /// @param baseURIInit URI base para los metadatos JSON (ej: https://api.rodaid.com.ar/api/v1/cit/metadata)
    constructor(address _operator, string memory baseURIInit)
        ERC721("RODAID CIT", "RCIT")
        Ownable(msg.sender)
    {
        require(_operator != address(0), "RodaidCIT: operador no puede ser address cero");
        operator       = _operator;
        _baseTokenURI  = baseURIInit;
        _tokenIdCounter = 1;  // IDs desde 1
    }

    // ══════════════════════════════════════════════════════
    // EMISIÓN DE CIT
    // ══════════════════════════════════════════════════════

    /// @notice Acuña un nuevo CIT y lo ancla en la BFA
    /// @param  propietario     Dirección wallet del dueño de la bicicleta
    /// @param  hashSHA256      Hash SHA-256 del PDF del CIT (64 chars hexadecimales)
    /// @param  numeroCIT       Número único del CIT (ej: "RCIT-2026-00001")
    /// @param  serialBicicleta Número de serie de la unidad certificada
    /// @return tokenId         ID del NFT emitido
    function mint(
        address propietario,
        string  calldata hashSHA256,
        string  calldata numeroCIT,
        string  calldata serialBicicleta
    )
        external
        soloOperador
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        // Validaciones
        require(propietario != address(0),       "RodaidCIT: propietario no puede ser address cero");
        require(bytes(hashSHA256).length == 64,  "RodaidCIT: hashSHA256 debe ser 64 chars (SHA-256 hex)");
        require(bytes(numeroCIT).length > 0,     "RodaidCIT: numeroCIT requerido");
        require(bytes(serialBicicleta).length > 0,"RodaidCIT: serial de bicicleta requerido");
        require(_hashToToken[hashSHA256]   == 0, "RodaidCIT: este hash ya fue registrado (CIT duplicado)");
        require(_numeroToToken[numeroCIT]  == 0, "RodaidCIT: este numero de CIT ya existe");

        uint256 tokenId = _tokenIdCounter++;

        // Almacenar datos on-chain
        _cits[tokenId] = CITData({
            hashSHA256:      hashSHA256,
            numeroCIT:       numeroCIT,
            serialBicicleta: serialBicicleta,
            bloqueado:       false,
            motivoBloqueo:   "",
            emitidoEn:       block.timestamp,
            bloqueadoEn:     0,
            inspector:       msg.sender
        });

        // Índices para búsqueda eficiente
        _hashToToken[hashSHA256]    = tokenId;
        _numeroToToken[numeroCIT]   = tokenId;
        _serialToCITs[serialBicicleta].push(tokenId);

        // Mint ERC-721 (OpenZeppelin)
        _safeMint(propietario, tokenId);

        // Metadata URI = baseURI + "/" + tokenId
        _setTokenURI(tokenId, tokenId.toString());

        emit CITMinted(tokenId, propietario, msg.sender, hashSHA256, numeroCIT, serialBicicleta);

        return tokenId;
    }

    // ══════════════════════════════════════════════════════
    // BLOQUEO Y DESBLOQUEO (DENUNCIA DE ROBO)
    // ══════════════════════════════════════════════════════

    /// @notice Bloquea un CIT por denuncia de robo o irregularidad
    /// @dev    El token bloqueado no puede transferirse
    function bloquear(uint256 tokenId, string calldata motivo)
        external
        soloOperador
        tokenValido(tokenId)
        whenNotPaused
    {
        require(!_cits[tokenId].bloqueado, "RodaidCIT: ya esta bloqueado");
        require(bytes(motivo).length > 0,  "RodaidCIT: motivo requerido");

        _cits[tokenId].bloqueado     = true;
        _cits[tokenId].motivoBloqueo = motivo;
        _cits[tokenId].bloqueadoEn   = block.timestamp;

        emit CITBloqueado(tokenId, motivo, block.timestamp);
    }

    /// @notice Desbloquea un CIT (bicicleta recuperada / error resuelto)
    function desbloquear(uint256 tokenId)
        external
        soloOperador
        tokenValido(tokenId)
    {
        require(_cits[tokenId].bloqueado, "RodaidCIT: no estaba bloqueado");

        _cits[tokenId].bloqueado     = false;
        _cits[tokenId].motivoBloqueo = "";
        _cits[tokenId].bloqueadoEn   = 0;

        emit CITDesbloqueado(tokenId, block.timestamp);
    }

    // ══════════════════════════════════════════════════════
    // TRANSFERENCIA (VENTA EN MARKETPLACE)
    // ══════════════════════════════════════════════════════

    /// @notice Transfiere el CIT al nuevo propietario (venta de bicicleta)
    /// @dev    Solo el operador puede transferir (no el ERC-721 estándar)
    ///         para mantener trazabilidad y prevenir transferencias de tokens robados
    function transferirCIT(uint256 tokenId, address nuevoPropietario)
        external
        soloOperador
        tokenValido(tokenId)
        whenNotPaused
        nonReentrant
    {
        require(nuevoPropietario != address(0), "RodaidCIT: nuevoPropietario no puede ser address cero");
        require(!_cits[tokenId].bloqueado,      "RodaidCIT: no se puede transferir un CIT bloqueado");

        address propietarioActual = ownerOf(tokenId);
        string memory numero = _cits[tokenId].numeroCIT;

        // Usar _transfer interno de ERC-721
        _transfer(propietarioActual, nuevoPropietario, tokenId);

        emit CITTransferido(tokenId, propietarioActual, nuevoPropietario, numero);
    }

    // ══════════════════════════════════════════════════════
    // OVERRIDES — prevenir transferencias no autorizadas
    // ══════════════════════════════════════════════════════

    /// @dev Bloquear transferencias ERC-721 estándar (approve, transferFrom, safeTransferFrom)
    ///      Solo se permite transferir vía transferirCIT() del operador
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override whenNotPaused returns (address) {
        address from = _ownerOf(tokenId);

        // Solo el operador puede hacer transferencias directas vía ERC-721
        // (transferFrom / safeTransferFrom del estándar).
        // Las transferencias internas del contrato (transferirCIT → _transfer)
        // pasan auth=address(0) y no son bloqueadas.
        if (from != address(0) && auth != address(0)) {
            require(
                auth == operator,
                "RodaidCIT: transferencias directas no permitidas, usar transferirCIT()"
            );
        }

        return super._update(to, tokenId, auth);
    }

    // ══════════════════════════════════════════════════════
    // CONSULTAS PÚBLICAS (sin costo de gas — view)
    // ══════════════════════════════════════════════════════

    /// @notice Verifica si un hash SHA-256 corresponde a un CIT válido
    /// @return valido    true si el hash está registrado en BFA
    /// @return bloqueado true si el CIT tiene una denuncia de robo activa
    /// @return tokenId   ID del token (0 si no existe)
    function verificarIntegridad(string calldata hashSHA256)
        external
        view
        returns (bool valido, bool bloqueado, uint256 tokenId)
    {
        tokenId  = _hashToToken[hashSHA256];
        valido   = tokenId != 0;
        bloqueado = valido ? _cits[tokenId].bloqueado : false;
    }

    /// @notice Retorna todos los datos de un CIT por tokenId
    function datosCIT(uint256 tokenId)
        external
        view
        tokenValido(tokenId)
        returns (
            string  memory hashSHA256,
            string  memory numeroCIT,
            string  memory serialBicicleta,
            address        propietario,
            bool           bloqueado,
            string  memory motivoBloqueo,
            uint256        emitidoEn,
            uint256        bloqueadoEn,
            address        inspector
        )
    {
        CITData storage c = _cits[tokenId];
        return (
            c.hashSHA256,
            c.numeroCIT,
            c.serialBicicleta,
            ownerOf(tokenId),
            c.bloqueado,
            c.motivoBloqueo,
            c.emitidoEn,
            c.bloqueadoEn,
            c.inspector
        );
    }

    /// @notice Busca el tokenId por hash SHA-256 del CIT
    function tokenPorHash(string calldata hashSHA256) external view returns (uint256) {
        return _hashToToken[hashSHA256];
    }

    /// @notice Busca el tokenId por número de CIT (ej: "RCIT-2026-00001")
    function tokenPorNumero(string calldata numeroCIT) external view returns (uint256) {
        return _numeroToToken[numeroCIT];
    }

    /// @notice Lista todos los tokenIds de CITs para una bicicleta (historial)
    function historialPorSerial(string calldata serial)
        external
        view
        returns (uint256[] memory)
    {
        return _serialToCITs[serial];
    }

    /// @notice Total de CITs emitidos
    function totalEmitidos() external view returns (uint256) {
        return _tokenIdCounter - 1;
    }

    // ══════════════════════════════════════════════════════
    // ADMIN — solo owner (multisig en producción)
    // ══════════════════════════════════════════════════════

    /// @notice Actualiza el operador autorizado a emitir CITs
    function setOperador(address nuevoOperador) external onlyOwner {
        require(nuevoOperador != address(0), "RodaidCIT: address cero");
        emit OperadorActualizado(operator, nuevoOperador);
        operator = nuevoOperador;
    }

    /// @notice Habilita o deshabilita un inspector
    function setInspector(address inspector, bool habilitado) external onlyOwner {
        require(inspector != address(0), "RodaidCIT: address cero");
        inspectores[inspector] = habilitado;
        emit InspectorActualizado(inspector, habilitado);
    }

    /// @notice Actualiza la URI base para los metadatos
    function setBaseURI(string calldata nuevaURI) external onlyOwner {
        _baseTokenURI = nuevaURI;
    }

    /// @notice Pausa todas las operaciones (emergencia)
    function pausar() external onlyOwner { _pause(); }

    /// @notice Reanuda las operaciones
    function reanudar() external onlyOwner { _unpause(); }

    // ══════════════════════════════════════════════════════
    // OVERRIDES REQUERIDOS POR SOLIDITY (OpenZeppelin)
    // ══════════════════════════════════════════════════════

    function tokenURI(uint256 tokenId)
        public view override(ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }
}
