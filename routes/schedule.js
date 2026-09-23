const express = require('express');
const pool = require('../db'); // Menggunakan koneksi pooler Supabase
const router = express.Router();

// ENDPOINT: Kru memblokir rentang tanggal secara manual
router.post('/api/schedule/manual-block', async (req, res) => {
    const { crew_id, tanggal_mulai, tanggal_selesai } = req.body;

    if (!crew_id || !tanggal_mulai || !tanggal_selesai) {
        return res.status(400).json({ error: 'Crew ID, tanggal mulai, dan tanggal selesai wajib diisi!' });
    }

    if (tanggal_mulai > tanggal_selesai) {
        return res.status(400).json({ error: 'Tanggal selesai tidak boleh lebih awal dari tanggal mulai.' });
    }

    try {
        const insertQuery = `
            INSERT INTO schedule_entries (crew_id, tanggal_mulai, tanggal_selesai, sumber, event_id)
            VALUES ($1, $2, $3, 'manual_blokir', NULL)
            RETURNING *;
        `;

        const result = await pool.query(insertQuery, [crew_id, tanggal_mulai, tanggal_selesai]);

        console.log(`[Crew247.id] Kru ${crew_id} berhasil memblokir tanggal ${tanggal_mulai} sampai ${tanggal_selesai}`);

        return res.status(200).json({
            success: true,
            message: 'Kalender berhasil diblokir untuk tanggal tersebut.',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('[Crew247.id] Gagal memblokir kalender:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server saat memblokir tanggal.' });
    }
});

module.exports = router;