const express = require('express');
const pool = require('../db'); // Menggunakan koneksi pooler Supabase
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// ENDPOINT: Kru memblokir rentang tanggal secara manual
router.post('/api/schedule/manual-block', requireAuth, async (req, res) => {
    const crew_id = req.user.user_id;
    const { tanggal_mulai, tanggal_selesai } = req.body;

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

// ENDPOINT BARU: Ambil jadwal kru untuk satu bulan tertentu
router.get('/api/schedule/:crew_id', requireAuth, async (req, res) => {
    const { crew_id } = req.params;
    if (crew_id !== req.user.user_id) {
        return res.status(403).json({ error: 'Anda tidak berhak melihat jadwal ini.' });
    }
    const { bulan } = req.query; // format: YYYY-MM

    try {
        let query = `
            SELECT s.id, s.tanggal_mulai, s.tanggal_selesai, s.sumber, s.event_id, ej.nama_acara
            FROM schedule_entries s
            LEFT JOIN event_jobs ej ON s.event_id = ej.id
            WHERE s.crew_id = $1
        `;
        const params = [crew_id];

        if (bulan) {
            query += ` AND s.tanggal_mulai <= ($2 || '-28')::date + interval '10 days'
                       AND s.tanggal_selesai >= ($2 || '-01')::date - interval '10 days'`;
            params.push(bulan);
        }

        const result = await pool.query(query, params);
        return res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        console.error('[Crew247.id] Gagal mengambil jadwal kru:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server saat memuat jadwal.' });
    }
});

// ENDPOINT BARU: Hapus blokir manual (TIDAK BOLEH untuk jadwal dari gig yang diterima)
router.delete('/api/schedule/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    try {
        const check = await pool.query('SELECT * FROM schedule_entries WHERE id = $1', [id]);
        if (check.rows.length === 0) {
            return res.status(404).json({ error: 'Data jadwal tidak ditemukan.' });
        }
        if (check.rows[0].crew_id !== req.user.user_id) {
            return res.status(403).json({ error: 'Anda tidak berhak menghapus jadwal ini.' });
        }
        if (check.rows[0].sumber !== 'manual_blokir') {
            return res.status(400).json({ error: 'Jadwal dari gig yang diterima tidak bisa dihapus di sini. Gunakan pembatalan gig oleh pembuat event.' });
        }
        await pool.query('DELETE FROM schedule_entries WHERE id = $1', [id]);
        return res.status(200).json({ success: true, message: 'Blokir tanggal berhasil dihapus.' });
    } catch (error) {
        console.error('[Crew247.id] Gagal menghapus blokir jadwal:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server saat menghapus blokir.' });
    }
});

module.exports = router;