"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = __importDefault(require("./app"));
const env_1 = require("./config/env");
const database_1 = require("./config/database");
const logger_1 = require("./middleware/logger");
const queue_service_1 = require("./services/queue.service");
const rateLimiter_1 = require("./middleware/rateLimiter");
async function main() {
    (0, logger_1.setupProcessLoggers)();
    // 1. PostgreSQL
    try {
        await database_1.pool.query('SELECT 1');
        logger_1.logger.info('✓ PostgreSQL conectado');
    }
    catch (err) {
        logger_1.logger.error({ err }, '✗ PostgreSQL no disponible');
        process.exit(1);
    }
    // 2. Rate limiters (Redis sliding window)
    await (0, rateLimiter_1.initRateLimiters)();
    // 3. Bull/Redis queue — requerido para flujo 72 hs
    await (0, queue_service_1.initQueue)();
    // 3. HTTP server
    const server = app_1.default.listen(env_1.env.PORT, () => {
        logger_1.logger.info(`RODAID API v0.1.0 · :${env_1.env.PORT} · ${env_1.env.NODE_ENV}`);
        logger_1.logger.info(`Health: http://localhost:${env_1.env.PORT}/api/${env_1.env.API_VERSION}/health`);
    });
    const shutdown = async (sig) => {
        logger_1.logger.info({ sig }, 'Apagando...');
        server.close(async () => {
            await (0, rateLimiter_1.closeRateLimiters)();
            await // stopQueue()
             await database_1.pool.end();
            process.exit(0);
        });
        setTimeout(() => process.exit(1), 15_000);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}
main();
