import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import app from './app';
import { Pool } from 'pg';
import { logger } from './middleware/logger';

// 1. Configuración de rutas para ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 2. Carga del .env con limpieza de caracteres ocultos
const rutaEnv = path.resolve(__dirname, '.env');
const result = dotenv.config({ path: rutaEnv });

if (result.error) {
  console.error("✗ ERROR: Archivo .env no encontrado en:", rutaEnv);
} else {
  console.log("✓ Archivo .env cargado correctamente.");
}

// 3. Limpieza de la URL (Elimina espacios o saltos de línea accidentales)
const dbUrl = (process.env.DATABASE_URL || "").trim().replace(/[\r\n]/g, '');

const pool = new Pool({
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
  } catch (err: any) {
    console.error("✗ DETALLE DEL ERROR DE POSTGRES:");
    console.error("- Código:", err.code);
    console.error("- Mensaje:", err.message);
    console.error("- ¿Está el proyecto de Neon en estado 'Suspendido'?");
    process.exit(1);
  }

  const port = process.env.PORT || 8100;
  app.listen(port, () => {
    logger.info(`RODAID API corriendo en puerto ${port}`);
  });
}

// 5. Lanzamiento
start().catch(err => {
  console.error("Error fatal en el arranque:", err);
  process.exit(1);
});
