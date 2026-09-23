const express = require('express');
const pool = require('../db');// Menggunakan koneksi pooler Supabase yang sudah terbukti berhasil
const router = express.Router();

// 1. ENDPOINT: Mengambil Data Profil Kru Berdasarkan user_id
router.get('/api/crew/profile/:user_id', async (req, res) => {
    const { user_id } = req.params;

    try {
        const query = `
            SELECT * FROM crew_profiles 
            WHERE user_id = $1
        `;
        const result = await pool.query(query, [user_id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Profil kru tidak ditemukan.' });
        }

        return res.status(200).json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        console.error('[Crew247.id] Gagal mengambil profil kru:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server saat mengambil profil.' });
    }
});

// 2. ENDPOINT: Membuat atau Memperbarui (Upsert) Profil Kru (CV Digital)
router.post('/api/crew/profile', async (req, res) => {
    const { 
        user_id, 
        nama_lengkap, 
        nama_panggung, 
        peran_utama, 
        kota, 
        rate_harian, 
        pengalaman_tahun, 
        keahlian, 
        bio, 
        foto_url 
    } = req.body;

    // Validasi data wajib dasar
    if (!user_id || !nama_lengkap || !nama_panggung || !peran_utama || !kota || !rate_harian) {
        return res.status(400).json({ error: 'Data wajib belum lengkap! Mohon isi semua kolom utama.' });
    }

    try {
        // Query UPSERT: Jika user_id sudah punya profil, maka di-UPDATE. Jika belum, maka di-INSERT baru.
        const upsertQuery = `
            INSERT INTO crew_profiles (
                user_id, nama_lengkap, nama_panggung, peran_utama, 
                kota, rate_harian, pengalaman_tahun, keahlian, bio, foto_url
            ) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (user_id) 
            DO UPDATE SET 
                nama_lengkap = EXCLUDED.nama_lengkap,
                nama_panggung = EXCLUDED.nama_panggung,
                peran_utama = EXCLUDED.peran_utama,
                kota = EXCLUDED.kota,
                rate_harian = EXCLUDED.rate_harian,
                pengalaman_tahun = EXCLUDED.pengalaman_tahun,
                keahlian = EXCLUDED.keahlian,
                bio = EXCLUDED.bio,
                foto_url = EXCLUDED.foto_url
            RETURNING *;
        `;

        const values = [
            user_id, 
            nama_lengkap, 
            nama_panggung, 
            peran_utama, 
            kota, 
            rate_harian, 
            pengalaman_tahun || 0, 
            keahlian || [], 
            bio || null, 
            foto_url || null
        ];

        const result = await pool.query(upsertQuery, values);

        console.log(`[Crew247.id] Profil kru berhasil disimpan untuk user_id: ${user_id}`);

        return res.status(200).json({
            success: true,
            message: 'Profil CV digital kru berhasil disimpan!',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('[Crew247.id] Gagal menyimpan profil kru:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server saat menyimpan profil.' });
    }
});

// Wajib mengekspor router supaya bisa dibaca oleh file utama server (app.js / server.js)
module.exports = router;