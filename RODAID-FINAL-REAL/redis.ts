let redis: any;
const mockRedis = {
    get: async (key: string) => null,
    set: async (key: string, value: string, mode?: string, duration?: number) => 'OK',
    del: async (key: string) => 1,
    quit: async () => {},
    on: () => {}
};
if (process.env.REDIS_URL) {
    try {
        const Redis = require('ioredis');
        redis = new Redis(process.env.REDIS_URL);
        console.log("✅ Conexión a Redis configurada correctamente.");
    } catch (error) {
        console.warn("⚠ Error al inicializar Redis, usando modo MOCK.");
        redis = mockRedis;
    }
} else {
    console.warn("⚠ REDIS_URL no encontrada. Usando modo MOCK para desarrollo.");
    redis = mockRedis;
}
export { redis };
