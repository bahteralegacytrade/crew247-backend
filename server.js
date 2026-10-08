const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware untuk membaca format JSON dari request body
app.use(express.json());

// --- PENYEDIAAN HALAMAN FRONTEND (STATIC FILES) ---
app.use(express.static('public'));

// --- PENDAFTARAN ROUTER BACKEND API YANG SUDAH DIBUAT ---
app.use(require('./routes/auth'));
app.use(require('./routes/crew'));
app.use(require('./routes/schedule'));
app.use(require('./routes/directory'));
app.use(require('./routes/events'));
app.use(require('./routes/applications'));
app.use(require('./routes/ratings'));
app.use(require('./routes/organizer'));

// Jalankan server di port 3000
app.listen(PORT, () => {
    console.log(`[Crew247.id] Server utama berjalan di http://localhost:3000`);
});