const { Pool } = require('pg');
const types = require('pg').types;

// --- MENGATASI BUG TIMEZONE/DATE MUNDUR ---
// Memaksa Node.js 'pg' untuk mengembalikan tipe data DATE (OID 1082) sebagai string polos 
// alih-alih mengubahnya menjadi objek JavaScript Date yang rentan bergeser UTC.
types.setTypeParser(1082, (val) => {
    return val; // Mengembalikan string apa adanya dari database (contoh: "2026-10-05")
});

// Menggunakan format Connection Pooler Supabase yang terbukti stabil
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Jika menggunakan SSL di production (seperti Supabase), aktifkan baris di bawah ini:
    /*
    ssl: {
        rejectUnauthorized: false
    }
    */
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