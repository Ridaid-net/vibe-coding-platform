"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redis = void 0;
let redis;
const mockRedis = {
    get: async (key) => null,
    set: async (key, value, mode, duration) => 'OK',
    del: async (key) => 1,
    quit: async () => { },
    on: () => { }
};
if (process.env.REDIS_URL) {
    try {
        const Redis = require('ioredis');
        exports.redis = redis = new Redis(process.env.REDIS_URL);
        console.log("✅ Conexión a Redis configurada correctamente.");
    }
    catch (error) {
        console.warn("⚠ Error al inicializar Redis, usando modo MOCK.");
        exports.redis = redis = mockRedis;
    }
}
else {
    console.warn("⚠ REDIS_URL no encontrada. Usando modo MOCK para desarrollo.");
    exports.redis = redis = mockRedis;
}
