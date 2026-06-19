"use strict";
// ─── RODAID · PDF Service — Generación del CIT ───────────
// Genera el PDF oficial del Certificado de Identidad Técnica
// según el formato establecido por Ley Provincial Mendoza N° 9556.
//
// El PDF incluye:
//   · Datos de la bicicleta (marca, modelo, serie, color)
//   · Datos del propietario (nombre, DNI)
//   · Los 20 puntos de inspección con resultado
//   · Datos del inspector y el taller aliado
//   · Hash SHA-256 del CIT (prueba de integridad en BFA)
//   · QR code con la URL de verificación
//   · Firma digital del inspector
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generarPDFCIT = generarPDFCIT;
exports.hashPDFBuffer = hashPDFBuffer;
const pdfkit_1 = __importDefault(require("pdfkit"));
const crypto_1 = __importDefault(require("crypto"));
// ══════════════════════════════════════════════════════════
// ETIQUETAS DE LOS 20 PUNTOS
// ══════════════════════════════════════════════════════════
const PUNTOS_LABELS = {
    serial: '1.  Número de serie visible y coincidente',
    cuadro: '2.  Estado del cuadro (fisuras, soldaduras)',
    horquilla: '3.  Estado de la horquilla',
    manubrio: '4.  Manubrio y potencia',
    freno_delantero: '5.  Freno delantero funcional',
    freno_trasero: '6.  Freno trasero funcional',
    cables: '7.  Cables y fundas en buen estado',
    cambio_delantero: '8.  Cambio delantero',
    cambio_trasero: '9.  Cambio trasero',
    cassette: '10. Cassette / piñones',
    cadena: '11. Cadena sin estiramiento excesivo',
    bielas: '12. Bielas y pedalier',
    pedales: '13. Pedales',
    rueda_delantera: '14. Rueda delantera centrada y sin juego',
    rueda_trasera: '15. Rueda trasera centrada y sin juego',
    cubiertas: '16. Cubiertas y cámaras',
    asiento: '17. Asiento y tija',
    luces: '18. Luces (si aplica)',
    accesorios: '19. Accesorios de seguridad reglamentarios',
    prueba_funcional: '20. Prueba funcional completa (marcha en pista)',
};
// Colores RODAID
const NAVY = '#0F1E35';
const ORANGE = '#F97316';
const TEAL = '#0D9488';
const GRAY = '#6B7280';
const LIGHT = '#F3F4F6';
// ══════════════════════════════════════════════════════════
// GENERACIÓN DEL PDF
// ══════════════════════════════════════════════════════════
async function generarPDFCIT(data) {
    return new Promise((resolve, reject) => {
        const doc = new pdfkit_1.default({
            size: 'A4',
            margins: { top: 40, bottom: 40, left: 50, right: 50 },
            info: {
                Title: `CIT ${data.numeroCIT} — RODAID`,
                Author: `${data.inspectorNombre} ${data.inspectorApellido} · ${data.tallerNombre}`,
                Subject: `Certificado de Identidad Técnica · Ley N° 9556 · Mendoza`,
                Keywords: `bicicleta,certificado,RODAID,ley9556,${data.serial}`,
                Creator: 'RODAID API v2.0',
            },
        });
        const chunks = [];
        doc.on('data', c => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        const pageW = doc.page.width;
        const L = 50, R = pageW - 50; // márgenes
        // ── Encabezado ──────────────────────────────────────────
        doc.rect(0, 0, pageW, 90).fill(NAVY);
        doc.fill('white')
            .fontSize(22).font('Helvetica-Bold')
            .text('RODAID', L, 18);
        doc.fontSize(9).font('Helvetica')
            .text('Certificación técnica de bicicletas · Ley Provincial N° 9556 · Mendoza', L, 44);
        doc.fontSize(14).font('Helvetica-Bold').fill(ORANGE)
            .text('Certificado de Identidad Técnica', L, 60);
        // Número CIT (derecha del header)
        doc.fill('white').fontSize(10).font('Helvetica-Bold')
            .text(data.numeroCIT, R - 110, 20, { width: 120, align: 'right' });
        doc.fontSize(8).font('Helvetica').fill('#94A3B8')
            .text(new Date(data.fechaEmision).toLocaleDateString('es-AR', {
            year: 'numeric', month: 'long', day: 'numeric',
        }), R - 110, 34, { width: 120, align: 'right' });
        doc.y = 105;
        // ── Sección: Bicicleta ──────────────────────────────────
        sectionTitle(doc, 'DATOS DE LA BICICLETA', L, R);
        const halfW = (R - L) / 2 - 5;
        infoGrid(doc, [
            ['Número de serie', data.serial],
            ['Marca / Modelo', `${data.marca} ${data.modelo} ${data.anio}`],
            ['Tipo', data.tipo.toUpperCase()],
            ['Color', data.color],
        ], L, halfW);
        // ── Sección: Propietario ────────────────────────────────
        doc.moveDown(0.5);
        sectionTitle(doc, 'PROPIETARIO AL MOMENTO DE LA EMISIÓN', L, R);
        infoGrid(doc, [
            ['Nombre completo', data.propietarioNombre],
            ['DNI', data.propietarioDNI],
        ], L, halfW);
        // ── Sección: 20 puntos de inspección ───────────────────
        doc.moveDown(0.5);
        sectionTitle(doc, 'INSPECCIÓN TÉCNICA — 20 PUNTOS (Ley N° 9556 Art. 12)', L, R);
        const pointKeys = Object.keys(PUNTOS_LABELS);
        const col1 = pointKeys.slice(0, 10);
        const col2 = pointKeys.slice(10);
        const startY = doc.y;
        let currentY = startY;
        // Columna izquierda
        col1.forEach((key, i) => {
            const ok = data.puntos[key] !== false;
            const y = currentY + i * 16;
            const dot = ok ? '●' : '○';
            const col = ok ? TEAL : '#EF4444';
            doc.fill(col).font('Helvetica-Bold').fontSize(8).text(dot, L, y);
            doc.fill(ok ? '#111827' : '#6B7280').font(ok ? 'Helvetica' : 'Helvetica-Oblique')
                .fontSize(7.5).text(PUNTOS_LABELS[key], L + 12, y, { width: halfW - 12 });
        });
        // Columna derecha
        col2.forEach((key, i) => {
            const ok = data.puntos[key] !== false;
            const y = currentY + i * 16;
            const dot = ok ? '●' : '○';
            const col = ok ? TEAL : '#EF4444';
            doc.fill(col).font('Helvetica-Bold').fontSize(8).text(dot, L + halfW + 15, y);
            doc.fill(ok ? '#111827' : '#6B7280').font(ok ? 'Helvetica' : 'Helvetica-Oblique')
                .fontSize(7.5).text(PUNTOS_LABELS[key], L + halfW + 27, y, { width: halfW - 27 });
        });
        doc.y = currentY + 10 * 16 + 8;
        // Resultado total
        const aprobado = data.totalPuntos >= 15;
        doc.rect(L, doc.y, R - L, 22)
            .fill(aprobado ? '#DCFCE7' : '#FEE2E2');
        doc.fill(aprobado ? '#166534' : '#991B1B').font('Helvetica-Bold').fontSize(10)
            .text(`${aprobado ? '✓ APROBADO' : '✗ RECHAZADO'} — ${data.totalPuntos}/20 puntos`, L + 8, doc.y + 6);
        doc.moveDown(1.5);
        // ── Inspector y Taller ──────────────────────────────────
        sectionTitle(doc, 'INSPECTOR Y TALLER ALIADO', L, R);
        infoGrid(doc, [
            ['Inspector', `${data.inspectorNombre} ${data.inspectorApellido}`],
            ['Taller', `${data.tallerNombre} · ${data.tallerLocalidad}, Mendoza`],
        ], L, halfW);
        // ── Integridad BFA ──────────────────────────────────────
        doc.moveDown(0.5);
        doc.rect(L, doc.y, R - L, 52).fill(LIGHT);
        const bfaY = doc.y + 6;
        doc.fill(NAVY).font('Helvetica-Bold').fontSize(9)
            .text('ANCLAJE BLOCKCHAIN — BFA (Blockchain Federal Argentina)', L + 8, bfaY);
        doc.fill(GRAY).font('Courier').fontSize(7)
            .text(`SHA-256: ${data.hashSHA256}`, L + 8, bfaY + 14, { width: R - L - 16 });
        if (data.nftTokenId) {
            doc.fill(TEAL).font('Helvetica-Bold').fontSize(8)
                .text(`NFT Token ID: ${data.nftTokenId}`, L + 8, bfaY + 27);
        }
        if (data.bfaTxHash) {
            doc.fill(GRAY).font('Courier').fontSize(6.5)
                .text(`TX: ${data.bfaTxHash}`, L + 8, bfaY + 39, { width: R - L - 16 });
        }
        doc.y = doc.y + 52 + 8;
        // ── QR de verificación ──────────────────────────────────
        const verifyUrl = `https://rodaid.com.ar/verificar/${data.serial}`;
        doc.fill(GRAY).font('Helvetica').fontSize(7)
            .text(`Verificar en: ${verifyUrl}`, L, doc.y, { align: 'center', width: R - L });
        doc.moveDown(0.5);
        doc.fill(GRAY).font('Helvetica').fontSize(7)
            .text(`Escaneá el QR en la app RODAID o visitá ${verifyUrl}`, L, doc.y, { align: 'center', width: R - L });
        // ── Pie de página ───────────────────────────────────────
        const footerY = doc.page.height - 60;
        doc.rect(0, footerY - 8, pageW, 68).fill(NAVY);
        doc.fill('white').font('Helvetica').fontSize(7)
            .text(`Este certificado fue emitido conforme a la Ley Provincial de Mendoza N° 9556. ` +
            `El hash SHA-256 está anclado en la Blockchain Federal Argentina (BFA, ONTI) como prueba de integridad. ` +
            `Hash: ${data.hashSHA256.slice(0, 32)}...`, L, footerY, { width: R - L, align: 'center' });
        doc.fill('#94A3B8').fontSize(7)
            .text(`RODAID · rodaid.com.ar · Mendoza, Argentina`, L, footerY + 18, { width: R - L, align: 'center' });
        doc.end();
    });
}
// ── Helpers de layout ──────────────────────────────────────
function sectionTitle(doc, title, L, R) {
    doc.rect(L, doc.y, R - L, 18).fill(NAVY);
    doc.fill('white').font('Helvetica-Bold').fontSize(8)
        .text(title, L + 6, doc.y + 5);
    doc.moveDown(0.3);
}
function infoGrid(doc, rows, L, colW) {
    rows.forEach(([label, value]) => {
        doc.fill(GRAY).font('Helvetica').fontSize(7).text(label + ':', L, doc.y);
        doc.fill(NAVY).font('Helvetica-Bold').fontSize(8).text(value, L + colW * 0.45, doc.y - 8);
        doc.moveDown(0.35);
    });
}
// ── Hash del contenido del PDF (para verificación) ────────
function hashPDFBuffer(buf) {
    return crypto_1.default.createHash('sha256').update(buf).digest('hex');
}
