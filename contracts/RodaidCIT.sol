// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RodaidCIT
 * @notice RODAID — Hito 4: Anclaje de Identidad en la BFA (Blockchain Federal Argentina).
 *
 * NFT (ERC-721) que ancla en blockchain la Cedula de Identidad de la bici (CIT).
 * Cada token representa una bicicleta verificada: su `tokenId` es el numero de
 * serie del cuadro (uint256) y guarda la huella SHA-256 del documento del CIT.
 *
 * Roles:
 *  - `minter`: la unica wallet autorizada a mintear (el backend de RODAID). Solo
 *    ella ancla CITs nuevos tras aprobar la validacion de 72hs.
 *  - `owner` (Ownable): la administracion de RODAID. Puede rotar el `minter` y
 *    marcar/desmarcar una bici como 'denunciada' (lock/unlock) ante un robo.
 *
 * Eficiencia de gas (decisiones de diseno):
 *  - `tokenId == serial`: se usa el numero de serie como id del token, sin un
 *    contador autoincremental. Esto evita un SLOAD/SSTORE por minteo y, ademas,
 *    garantiza unicidad on-chain "gratis": re-anclar el mismo serial revierte
 *    porque el token ya existe (ERC721InvalidSender en _mint).
 *  - `_mint` en vez de `_safeMint`: se omite el callback onERC721Received porque
 *    la custodia inicial es una wallet propia del backend (EOA), ahorrando gas.
 *  - Errores `custom error` (revert NotMinter()) en lugar de strings de require.
 *  - El lock se chequea en `_update`, el unico hook por el que pasan todas las
 *    transferencias, sin storage extra mas alla del flag.
 */
contract RodaidCIT is ERC721, Ownable {
    /// @notice Wallet autorizada (backend de RODAID) — unica que puede mintear.
    address public minter;

    /// @notice Huella SHA-256 (hex) del documento del CIT, por numero de serie.
    mapping(uint256 serial => string hashSHA256) private _citHash;

    /// @notice Bicis marcadas como 'denunciada' (robo): sus tokens quedan congelados.
    mapping(uint256 serial => bool locked) public locked;

    event MinterUpdated(address indexed previousMinter, address indexed newMinter);
    event CITAnchored(uint256 indexed serial, address indexed to, string hashSHA256);
    event CITLocked(uint256 indexed serial);
    event CITUnlocked(uint256 indexed serial);

    error NotMinter();
    error ZeroAddress();
    error CITTokenLocked(uint256 serial);

    /**
     * @param initialOwner Administracion de RODAID (rota minter, lock/unlock).
     * @param initialMinter Wallet del backend de RODAID autorizada a mintear.
     */
    constructor(address initialOwner, address initialMinter)
        ERC721("RODAID Cedula de Identidad", "RCIT")
        Ownable(initialOwner)
    {
        if (initialMinter == address(0)) revert ZeroAddress();
        minter = initialMinter;
        emit MinterUpdated(address(0), initialMinter);
    }

    modifier onlyMinter() {
        if (msg.sender != minter) revert NotMinter();
        _;
    }

    /// @notice Rota la wallet autorizada del backend. Solo el owner.
    function setMinter(address newMinter) external onlyOwner {
        if (newMinter == address(0)) revert ZeroAddress();
        emit MinterUpdated(minter, newMinter);
        minter = newMinter;
    }

    /**
     * @notice Ancla un CIT: mintea el NFT de identidad de la bici.
     * @dev Solo la `minter` (backend de RODAID). `tokenId == serial`, por lo que
     *      anclar dos veces el mismo serial revierte (el token ya existe).
     * @param to Wallet que recibe el NFT (custodia del backend o futuro dueno).
     * @param serial Numero de serie del cuadro usado como tokenId.
     * @param hashSHA256 Huella SHA-256 (hex) del payload del CIT.
     */
    function mintCIT(address to, uint256 serial, string memory hashSHA256)
        external
        onlyMinter
    {
        _mint(to, serial);
        _citHash[serial] = hashSHA256;
        emit CITAnchored(serial, to, hashSHA256);
    }

    /// @notice Huella SHA-256 anclada para un serial dado.
    function citHash(uint256 serial) external view returns (string memory) {
        return _citHash[serial];
    }

    /**
     * @notice Marca una bici como 'denunciada' (robo) en la BFA: congela su token.
     * @dev Solo el owner. Mientras este bloqueada, el NFT no puede transferirse.
     */
    function lockCIT(uint256 serial) external onlyOwner {
        _requireOwned(serial); // revierte si el serial no fue anclado
        locked[serial] = true;
        emit CITLocked(serial);
    }

    /// @notice Levanta la marca de 'denunciada'. Solo el owner.
    function unlockCIT(uint256 serial) external onlyOwner {
        _requireOwned(serial);
        locked[serial] = false;
        emit CITUnlocked(serial);
    }

    /**
     * @dev Hook unico de todas las transferencias (OZ v5). Congela los tokens
     *      marcados como denunciados: permite mintear (from == 0) pero bloquea
     *      cualquier transferencia de una bici reportada como robada.
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        if (locked[tokenId] && _ownerOf(tokenId) != address(0)) {
            revert CITTokenLocked(tokenId);
        }
        return super._update(to, tokenId, auth);
    }
}
