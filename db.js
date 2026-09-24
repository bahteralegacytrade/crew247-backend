const { Pool } = require('pg');
const types = require('pg').types;
require('dotenv').config();

// --- MENGATASI BUG TIMEZONE/DATE MUNDUR ---
types.setTypeParser(1082, (val) => {
    return val;
});

// Menggunakan format Connection Pooler Supabase yang terbukti stabil
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Tes koneksi sederhana saat file pertama kali dimuat
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('[Crew247.id] Gagal terhubung ke Database PostgreSQL:', err);
    } else {
        console.log('[Crew247.id] Berhasil terhubung ke Database Supabase (Pooler Mode)');
    }
});

module.exports = pool;