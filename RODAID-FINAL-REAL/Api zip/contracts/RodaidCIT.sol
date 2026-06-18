// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ─── RODAID · Contrato RodaidCIT ─────────────────────────
// ERC-721 para Certificados de Identidad Técnica de Bicicletas
// Ley Provincial Mendoza N° 9556 — Art. 15-18
//
// Cada token representa un CIT emitido por un inspector
// habilitado de RODAID. El hash SHA-256 del CIT se ancla
// en la Blockchain Federal Argentina (BFA) como prueba
// de existencia e integridad del certificado.
//
// Despliegue en BFA:
//   Red:      BFA Mainnet (Chain ID 4337) / BFA Testnet (Chain ID 4338)
//   Estándar: ERC-721 (NFT no fungible)
//   Acceso:   nodo BFA provisto por ONTI (solicitud: bfa@onti.gob.ar)
//
// Eventos clave:
//   CITMinted(tokenId, owner, hashCIT, numeroCIT)
//   CITLocked(tokenId, motivo)         — denuncia de robo
//   CITUnlocked(tokenId)               — recuperación
//   CITTransferred(tokenId, from, to)  — venta en marketplace

/// @title RodaidCIT — Certificado de Identidad Técnica en BFA
/// @author RODAID — Federico De Gea (rodaid.com.ar)
/// @notice Ancla los CIT de bicicletas en la Blockchain Federal Argentina
contract RodaidCIT {

    // ══════════════════════════════════════════════════════
    // ESTADO
    // ══════════════════════════════════════════════════════

    address public owner;               // RODAID deployer
    address public operator;            // Backend autorizado a emitir

    uint256 private _tokenCounter;      // Auto-incremento de tokenId
    string  public  baseURI;            // URI base para metadatos CIT

    // Datos de cada CIT on-chain
    struct CITData {
        string  hashCIT;       // SHA-256 del PDF del CIT (hex sin 0x)
        string  numeroCIT;     // "RCIT-2026-00001"
        address propietario;   // wallet del ciclista
        bool    bloqueado;     // true si hay denuncia de robo activa
        string  motivoBloqueo; // descripción del bloqueo
        uint256 emitidoEn;     // block.timestamp del mint
        uint256 bloqueadoEn;   // block.timestamp del bloqueo (0 si libre)
    }

    mapping(uint256 => CITData)  private _cits;          // tokenId → CITData
    mapping(string  => uint256)  private _hashToToken;   // hashCIT → tokenId
    mapping(string  => uint256)  private _numeroToToken; // numeroCIT → tokenId
    mapping(uint256 => address)  private _owners;        // tokenId → owner
    mapping(address => uint256)  private _balances;      // owner → balance

    // ══════════════════════════════════════════════════════
    // EVENTOS (ERC-721 + RODAID específicos)
    // ══════════════════════════════════════════════════════

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event CITMinted(uint256 indexed tokenId, address indexed owner, string hashCIT, string numeroCIT);
    event CITLocked(uint256 indexed tokenId, string motivo, uint256 timestamp);
    event CITUnlocked(uint256 indexed tokenId, uint256 timestamp);
    event CITTransferred(uint256 indexed tokenId, address indexed from, address indexed to);
    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);

    // ══════════════════════════════════════════════════════
    // MODIFICADORES
    // ══════════════════════════════════════════════════════

    modifier onlyOwner() {
        require(msg.sender == owner, "RodaidCIT: solo el owner");
        _;
    }

    modifier onlyOperator() {
        require(
            msg.sender == operator || msg.sender == owner,
            "RodaidCIT: solo el operador autorizado"
        );
        _;
    }

    modifier tokenExists(uint256 tokenId) {
        require(_owners[tokenId] != address(0), "RodaidCIT: token no existe");
        _;
    }

    // ══════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ══════════════════════════════════════════════════════

    constructor(address _operator, string memory _baseURI) {
        owner    = msg.sender;
        operator = _operator;
        baseURI  = _baseURI;
        _tokenCounter = 1;  // IDs desde 1
    }

    // ══════════════════════════════════════════════════════
    // ERC-721 BÁSICO
    // ══════════════════════════════════════════════════════

    function name()   external pure returns (string memory) { return "RODAID CIT"; }
    function symbol() external pure returns (string memory) { return "RCIT"; }

    function balanceOf(address addr) external view returns (uint256) {
        require(addr != address(0), "RodaidCIT: address cero");
        return _balances[addr];
    }

    function ownerOf(uint256 tokenId) external view tokenExists(tokenId) returns (address) {
        return _owners[tokenId];
    }

    function tokenURI(uint256 tokenId) external view tokenExists(tokenId) returns (string memory) {
        return string(abi.encodePacked(baseURI, "/", _uint2str(tokenId)));
    }

    // ══════════════════════════════════════════════════════
    // MINT — emitir nuevo CIT
    // ══════════════════════════════════════════════════════

    /// @notice Emite un nuevo CIT en la blockchain
    /// @param to        Dirección wallet del propietario de la bicicleta
    /// @param hashCIT   SHA-256 del PDF del CIT (64 chars hex)
    /// @param numeroCIT Número único del CIT (ej: "RCIT-2026-00001")
    /// @return tokenId  ID del token NFT emitido
    function mint(
        address to,
        string calldata hashCIT,
        string calldata numeroCIT
    ) external onlyOperator returns (uint256) {
        require(to != address(0), "RodaidCIT: address cero");
        require(bytes(hashCIT).length == 64, "RodaidCIT: hashCIT debe ser SHA-256 de 64 chars");
        require(bytes(numeroCIT).length > 0, "RodaidCIT: numeroCIT requerido");
        require(_hashToToken[hashCIT] == 0, "RodaidCIT: hashCIT ya existe (CIT duplicado)");
        require(_numeroToToken[numeroCIT] == 0, "RodaidCIT: numeroCIT ya existe");

        uint256 tokenId = _tokenCounter++;

        _cits[tokenId] = CITData({
            hashCIT:       hashCIT,
            numeroCIT:     numeroCIT,
            propietario:   to,
            bloqueado:     false,
            motivoBloqueo: "",
            emitidoEn:     block.timestamp,
            bloqueadoEn:   0
        });

        _owners[tokenId]   = to;
        _balances[to]     += 1;
        _hashToToken[hashCIT]    = tokenId;
        _numeroToToken[numeroCIT] = tokenId;

        emit Transfer(address(0), to, tokenId);
        emit CITMinted(tokenId, to, hashCIT, numeroCIT);

        return tokenId;
    }

    // ══════════════════════════════════════════════════════
    // BLOQUEO — denuncia de robo
    // ══════════════════════════════════════════════════════

    /// @notice Bloquea un CIT por robo o irregularidad
    /// @param tokenId  Token a bloquear
    /// @param motivo   Descripción del motivo (ej: "Denuncia policial #2026-001")
    function lockToken(uint256 tokenId, string calldata motivo)
        external onlyOperator tokenExists(tokenId)
    {
        require(!_cits[tokenId].bloqueado, "RodaidCIT: ya bloqueado");
        _cits[tokenId].bloqueado     = true;
        _cits[tokenId].motivoBloqueo = motivo;
        _cits[tokenId].bloqueadoEn   = block.timestamp;
        emit CITLocked(tokenId, motivo, block.timestamp);
    }

    /// @notice Desbloquea un CIT (bicicleta recuperada / error resuelto)
    function unlockToken(uint256 tokenId)
        external onlyOperator tokenExists(tokenId)
    {
        require(_cits[tokenId].bloqueado, "RodaidCIT: no estaba bloqueado");
        _cits[tokenId].bloqueado     = false;
        _cits[tokenId].motivoBloqueo = "";
        _cits[tokenId].bloqueadoEn   = 0;
        emit CITUnlocked(tokenId, block.timestamp);
    }

    // ══════════════════════════════════════════════════════
    // TRANSFERENCIA — marketplace
    // ══════════════════════════════════════════════════════

    /// @notice Transfiere el CIT a un nuevo propietario (venta)
    function transferToken(uint256 tokenId, address newOwner)
        external onlyOperator tokenExists(tokenId)
    {
        require(newOwner != address(0), "RodaidCIT: address cero");
        require(!_cits[tokenId].bloqueado, "RodaidCIT: token bloqueado, no se puede transferir");

        address oldOwner = _owners[tokenId];
        _balances[oldOwner]   -= 1;
        _balances[newOwner]   += 1;
        _owners[tokenId]       = newOwner;
        _cits[tokenId].propietario = newOwner;

        emit Transfer(oldOwner, newOwner, tokenId);
        emit CITTransferred(tokenId, oldOwner, newOwner);
    }

    // ══════════════════════════════════════════════════════
    // CONSULTAS — verificación pública
    // ══════════════════════════════════════════════════════

    /// @notice Retorna todos los datos de un CIT
    function tokenData(uint256 tokenId)
        external view tokenExists(tokenId)
        returns (
            string memory hashCIT,
            string memory numeroCIT,
            address propietario,
            bool bloqueado,
            string memory motivoBloqueo,
            uint256 emitidoEn
        )
    {
        CITData storage c = _cits[tokenId];
        return (c.hashCIT, c.numeroCIT, c.propietario, c.bloqueado, c.motivoBloqueo, c.emitidoEn);
    }

    /// @notice Buscar tokenId por hash SHA-256 del CIT
    function getTokenByHash(string calldata hashCIT) external view returns (uint256) {
        return _hashToToken[hashCIT];
    }

    /// @notice Buscar tokenId por número de CIT
    function getTokenByNumero(string calldata numeroCIT) external view returns (uint256) {
        return _numeroToToken[numeroCIT];
    }

    /// @notice Verificar integridad: retorna true si el hash está registrado y no bloqueado
    function verificarIntegridad(string calldata hashCIT)
        external view
        returns (bool valido, bool bloqueado, uint256 tokenId)
    {
        tokenId = _hashToToken[hashCIT];
        if (tokenId == 0) return (false, false, 0);
        valido   = true;
        bloqueado = _cits[tokenId].bloqueado;
    }

    /// @notice Total de CITs emitidos
    function totalSupply() external view returns (uint256) {
        return _tokenCounter - 1;
    }

    // ══════════════════════════════════════════════════════
    // ADMIN
    // ══════════════════════════════════════════════════════

    function setOperator(address newOperator) external onlyOwner {
        emit OperatorUpdated(operator, newOperator);
        operator = newOperator;
    }

    function setBaseURI(string calldata newURI) external onlyOwner {
        baseURI = newURI;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "RodaidCIT: address cero");
        owner = newOwner;
    }

    // ── Helper interno ────────────────────────────────────
    function _uint2str(uint256 n) internal pure returns (string memory) {
        if (n == 0) return "0";
        uint256 temp = n;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (n != 0) { digits--; buffer[digits] = bytes1(uint8(48 + n % 10)); n /= 10; }
        return string(buffer);
    }
}
