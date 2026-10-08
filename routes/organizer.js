const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// ENDPOINT: Lihat profil pembuat event — BISA DIAKSES SIAPA SAJA yang login (bukan cuma pemiliknya)
router.get('/api/pembuat-event/profile/:user_id', requireAuth, async (req, res) => {
    const { user_id } = req.params;
    try {
        const query = `SELECT * FROM pembuat_event_profiles WHERE user_id = $1`;
        const result = await pool.query(query, [user_id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Profil pembuat event belum dibuat.' });
        }

        return res.status(200).json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('[Crew247.id] Gagal mengambil profil pembuat event:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server saat mengambil profil.' });
    }
});

// ENDPOINT: Buat/perbarui profil pembuat event (hanya pemiliknya sendiri)
router.post('/api/pembuat-event/profile', requireAuth, async (req, res) => {
    const user_id = req.user.user_id;
    const { nama_organisasi, jenis, kota, logo_url, bio } = req.body;

    if (!nama_organisasi || !jenis || !kota) {
        return res.status(400).json({ error: 'Nama organisasi, jenis, dan kota wajib diisi!' });
    }

    try {
        const upsertQuery = `
            INSERT INTO pembuat_event_profiles (user_id, nama_organisasi, jenis, kota, logo_url, bio)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (user_id)
            DO UPDATE SET
                nama_organisasi = EXCLUDED.nama_organisasi,
                jenis = EXCLUDED.jenis,
                kota = EXCLUDED.kota,
                logo_url = EXCLUDED.logo_url,
                bio = EXCLUDED.bio
            RETURNING *;
        `;
        const result = await pool.query(upsertQuery, [user_id, nama_organisasi, jenis, kota, logo_url || null, bio || null]);

        return res.status(200).json({ success: true, message: 'Profil organisasi berhasil disimpan!', data: result.rows[0] });
    } catch (error) {
        console.error('[Crew247.id] Gagal menyimpan profil pembuat event:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server saat menyimpan profil.' });
    }
});

module.exports = router;