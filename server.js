const path = require('path');
// Baca .env dari folder aplikasi ini (bukan dari folder tempat server dijalankan),
// supaya tetap benar saat dijalankan lewat cPanel/Passenger. Variabel yang sudah diisi di panel tidak ditimpa.
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Pengaman: jangan jalan kalau pengaturan rahasia belum diisi (kesalahan paling umum saat deploy)
const wajib = ['DATABASE_URL', 'JWT_SECRET'];
const kurang = wajib.filter((k) => !process.env[k]);
if (kurang.length > 0) {
    console.error(`[Crew247.id] Server tidak dijalankan. Variabel lingkungan belum diisi: ${kurang.join(', ')}`);
    process.exit(1);
}

// Di belakang reverse proxy (cPanel/Passenger, Render, Railway, dll) pakai IP asli pengunjung.
// Tanpa ini, pembatas percobaan login melihat semua pengunjung sebagai satu IP yang sama.
app.set('trust proxy', 1);

// Membaca body JSON dari request (harus SEBELUM semua router)
app.use(express.json({ limit: '1mb' }));

// Halaman frontend. Pakai jalur absolut supaya tidak bergantung dari folder mana server dijalankan.
app.use(express.static(path.join(__dirname, 'public')));

// Pengecekan sederhana "aplikasi hidup" (tanpa menyentuh database)
app.get('/health', (req, res) => {
    res.status(200).json({ ok: true });
});

// SEMENTARA - diagnosis koneksi database. Hanya menampilkan alamat server database dan kode kesalahan
// (tanpa nama pengguna atau password). HAPUS blok ini setelah koneksi beres.
app.get('/health/db', async (req, res) => {
    let host = null;
    let port = null;
    try {
        const u = new URL(process.env.DATABASE_URL);
        host = u.hostname;
        port = u.port || '5432';
    } catch (e) {
        return res.status(500).json({
            ok: false,
            masalah: 'Format DATABASE_URL tidak valid (biasanya ada karakter khusus di password yang belum di-encode)'
        });
    }

    let timer;
    try {
        const pool = require('./db');
        const batas = new Promise((_, reject) => {
            timer = setTimeout(() => {
                const err = new Error('timeout');
                err.code = 'TIMEOUT_8_DETIK';
                reject(err);
            }, 8000);
        });
        const r = await Promise.race([pool.query('SELECT NOW() AS waktu'), batas]);
        return res.status(200).json({ ok: true, host, port, waktu: r.rows[0].waktu });
    } catch (e) {
        return res.status(500).json({ ok: false, host, port, kode: e.code || null, jenis: e.name || null });
    } finally {
        clearTimeout(timer);
    }
});

// Router API
app.use(require('./routes/auth'));
app.use(require('./routes/crew'));
app.use(require('./routes/schedule'));
app.use(require('./routes/directory'));
app.use(require('./routes/events'));
app.use(require('./routes/applications'));
app.use(require('./routes/ratings'));
app.use(require('./routes/organizer'));

app.listen(PORT, () => {
    console.log(`[Crew247.id] Server berjalan di port ${PORT}`);
});