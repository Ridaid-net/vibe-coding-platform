"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.query = query;
exports.queryOne = queryOne;
exports.transaction = transaction;
// ─── RODAID · PostgreSQL Pool (pg) ────────────────────────
const pg_1 = require("pg");
exports.pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: {
        rejectUnauthorized: false
    }
});
exports.pool.on('error', (err) => {
    console.error('PostgreSQL pool error:', err);
});
// Helper: Ejecutar consulta en el pool
async function query(text, params) {
    const result = await exports.pool.query(text, params);
    return result.rows;
}
// Helper: get a single row
async function queryOne(text, params) {
    const rows = await query(text, params);
    return rows[0] ?? null;
}
// Helper: transaction
async function transaction(fn) {
    const client = await exports.pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    }
    catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
    finally {
        client.release();
    }
}
