"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRedis = getRedis;
exports.pingRedis = pingRedis;
exports.closeRedis = closeRedis;
// ─── RODAID · Redis Connection ────────────────────────────
const ioredis_1 = __importDefault(require("ioredis"));
const env_1 = require("./env");
const logger_1 = require("../middleware/logger");
let redisInstance = null;
function getRedis() {
    if (redisInstance)
        return redisInstance;
    redisInstance = new ioredis_1.default(env_1.env.REDIS_URL, {
        maxRetriesPerRequest: null, // requerido por BullMQ
        enableReadyCheck: false, // idem
        lazyConnect: false,
        retryStrategy: (times) => {
            const delay = Math.min(times * 500, 5000); // back-off hasta 5 s
            logger_1.logger.warn({ times, delay }, 'Redis: reintentando conexión');
            return delay;
        },
    });
    redisInstance.on('connect', () => logger_1.logger.info('✓ Redis conectado'));
    redisInstance.on('error', (err) => logger_1.logger.error({ err }, 'Redis error'));
    redisInstance.on('close', () => logger_1.logger.warn('Redis: conexión cerrada'));
    return redisInstance;
}
async function pingRedis() {
    try {
        const reply = await getRedis().ping();
        return reply === 'PONG';
    }
    catch {
        return false;
    }
}
async function closeRedis() {
    if (redisInstance) {
        await redisInstance.quit();
        redisInstance = null;
        logger_1.logger.info('Redis: conexión cerrada correctamente');
    }
}
