// Samakan zona waktu proses ini dengan database (UTC). Server hosting berjalan di WIB (UTC+7);
// tanpa ini, waktu kedaluwarsa OTP dan batas respons tawaran 24 jam bergeser 7 jam.
process.env.TZ = 'UTC';

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

// Beranda aplikasi bernama beranda.html (bukan index.html) supaya tidak bentrok dengan halaman
// coming soon di folder situs hosting, yang selalu dilayani Apache lebih dulu untuk "/" dan "/index.html".
// Rute ini baru berlaku saat halaman coming soon sudah dipindahkan dari folder situs.
app.get(['/', '/index.html'], (req, res) => {
    res.redirect('/beranda.html');
});

// Pengecekan sederhana "aplikasi hidup" (tanpa menyentuh database)
app.get('/health', (req, res) => {
    res.status(200).json({ ok: true });
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