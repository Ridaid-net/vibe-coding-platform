"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = __importStar(require("dotenv"));
const path_1 = __importDefault(require("path"));
const url_1 = require("url");
const app_1 = __importDefault(require("./app"));
const pg_1 = require("pg");
const logger_1 = require("./middleware/logger");
// 1. Configuración de rutas para ES Modules
const __filename = (0, url_1.fileURLToPath)(import.meta.url);
const __dirname = path_1.default.dirname(__filename);
// 2. Carga del .env con limpieza de caracteres ocultos
const rutaEnv = path_1.default.resolve(__dirname, '.env');
const result = dotenv.config({ path: rutaEnv });
if (result.error) {
    console.error("✗ ERROR: Archivo .env no encontrado en:", rutaEnv);
}
else {
    console.log("✓ Archivo .env cargado correctamente.");
}
// 3. Limpieza de la URL (Elimina espacios o saltos de línea accidentales)
const dbUrl = (process.env.DATABASE_URL || "").trim().replace(/[\r\n]/g, '');
const pool = new pg_1.Pool({
    connectionString: dbUrl,
    ssl: {
        rejectUnauthorized: false
    }
});
// 4. Función de inicio con diagnóstico detallado
async function start() {
    console.log("--- INICIANDO RODAID API ---");
    if (!dbUrl) {
        console.error("✗ ERROR: DATABASE_URL está vacía. Revisa tu archivo .env");
        process.exit(1);
    }
    try {
        // Intentar consulta simple
        await pool.query('SELECT 1');
        console.log("✓ PostgreSQL conectado correctamente");
    }
    catch (err) {
        console.error("✗ DETALLE DEL ERROR DE POSTGRES:");
        console.error("- Código:", err.code);
        console.error("- Mensaje:", err.message);
        console.error("- ¿Está el proyecto de Neon en estado 'Suspendido'?");
        process.exit(1);
    }
    const port = process.env.PORT || 8100;
    app_1.default.listen(port, () => {
        logger_1.logger.info(`RODAID API corriendo en puerto ${port}`);
    });
}
// 5. Lanzamiento
start().catch(err => {
    console.error("Error fatal en el arranque:", err);
    process.exit(1);
});
