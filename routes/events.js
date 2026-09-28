const express = require('express');
const pool = require('../db'); // Menggunakan koneksi pooler Supabase
const router = express.Router();

// ENDPOINT 1: Pembuat event memposting lowongan acara baru beserta posisi yang dibutuhkan (Yang sudah berhasil sebelumnya)
router.post('/api/events', async (req, res) => {
    const { 
        pembuat_event_id, 
        nama_acara, 
        tanggal_mulai, 
        tanggal_selesai, 
        jam_call_time, 
        zona_waktu, 
        lokasi, 
        kota, 
        posisi_dibutuhkan // Berupa array object, contoh: [{ posisi: 'FOH Audio', jumlah_dibutuhkan: 2, budget_per_orang: 1500000 }]
    } = req.body;

    // Validasi data wajib dasar
    if (!pembuat_event_id || !nama_acara || !tanggal_mulai || !tanggal_selesai || !jam_call_time || !zona_waktu || !lokasi || !kota || !posisi_dibutuhkan || posisi_dibutuhkan.length === 0) {
        return res.status(400).json({ error: 'Data lowongan acara belum lengkap! Mohon isi semua informasi utama dan minimal satu posisi.' });
    }

    // Validasi logis tanggal
    if (tanggal_mulai > tanggal_selesai) {
        return res.status(400).json({ error: 'Tanggal selesai acara tidak boleh lebih awal dari tanggal mulai.' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Masukkan data ke tabel event_jobs
        const eventQuery = `
            INSERT INTO event_jobs (
                pembuat_event_id, nama_acara, tanggal_mulai, tanggal_selesai, 
                jam_call_time, zona_waktu, lokasi, kota, status_event
            ) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'aktif')
            RETURNING *;
        `;
        const eventValues = [
            pembuat_event_id, nama_acara, tanggal_mulai, tanggal_selesai, 
            jam_call_time, zona_waktu, lokasi, kota
        ];
        const eventResult = await client.query(eventQuery, eventValues);
        const newEvent = eventResult.rows[0];

        // 2. Masukkan rincian posisi ke tabel job_positions satu per satu dari array
        const createdPositions = [];
        for (const item of posisi_dibutuhkan) {
            const positionQuery = `
                INSERT INTO job_positions (event_job_id, posisi, jumlah_dibutuhkan, budget_per_orang)
                VALUES ($1, $2, $3, $4)
                RETURNING *;
            `;
            const positionValues = [newEvent.id, item.posisi, item.jumlah_dibutuhkan, item.budget_per_orang];
            const positionResult = await client.query(positionQuery, positionValues);
            createdPositions.push(positionResult.rows[0]);
        }

        // Jika semua sukses, simpan permanen ke database
        await client.query('COMMIT');

        console.log(`[Crew247.id] Event baru berhasil diposting: ${nama_acara} oleh pembuat: ${pembuat_event_id}`);

        return res.status(201).json({
            success: true,
            message: 'Lowongan acara berhasil diposting!',
            data: {
                event: newEvent,
                posisi: createdPositions
            }
        });

    } catch (error) {
        // Jika ada error di tengah jalan, batalkan semua (rollback)
        await client.query('ROLLBACK');
        console.error('[Crew247.id] Gagal memposting event:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server saat memposting lowongan.' });
    } finally {
        // Kembalikan koneksi ke pool
        client.release();
    }
});

// ENDPOINT 2 (TAMBAHAN BARU): Mengambil Daftar Gig Selesai (Tanggal Lewat) yang Belum Dirating
router.get('/api/events/pembuat/:pembuat_event_id/selesai', async (req, res) => {
    const { pembuat_event_id } = req.params;

    try {
        const today = new Date().toISOString().split('T')[0];

        const query = `
            SELECT 
                ej.id AS job_id,
                ej.nama_acara,
                ej.tanggal_mulai,
                ej.tanggal_selesai,
                ej.lokasi,
                ej.kota,
                cp.user_id AS crew_id,
                cp.nama_lengkap,
                cp.nama_panggung,
                cp.peran_utama
            FROM event_jobs ej
            JOIN job_positions jp ON ej.id = jp.event_job_id
            JOIN applications a ON jp.id = a.job_position_id
            JOIN crew_profiles cp ON a.crew_id = cp.user_id
            WHERE ej.pembuat_event_id = $1
              AND ej.tanggal_selesai < $2
              AND a.status = 'diterima'
              AND NOT EXISTS (
                  SELECT 1 FROM ratings r 
                  WHERE r.job_id = ej.id AND r.crew_id = cp.user_id AND r.pembuat_event_id = ej.pembuat_event_id
              )
            ORDER BY ej.tanggal_selesai DESC;
        `;

        const result = await pool.query(query, [pembuat_event_id, today]);

        return res.status(200).json({
            success: true,
            data: result.rows
        });

    } catch (error) {
        console.error('[Crew247.id] Gagal mengambil daftar gig selesai untuk rating:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server saat memuat data rating.' });
    }
});

// ENDPOINT BARU: semua event milik pembuat event + posisi + pelamar
router.get('/api/events/pembuat/:pembuat_event_id', async (req, res) => {
    const { pembuat_event_id } = req.params;
    try {
        const ev = await pool.query(
            `SELECT id, nama_acara, tanggal_mulai, tanggal_selesai, lokasi, kota, status_event
             FROM event_jobs WHERE pembuat_event_id = $1 ORDER BY tanggal_mulai DESC`,
            [pembuat_event_id]
        );
        if (ev.rows.length === 0) return res.status(200).json({ success: true, data: [] });

        const eventIds = ev.rows.map(e => e.id);
        const pos = await pool.query(
            `SELECT * FROM job_positions WHERE event_job_id = ANY($1::uuid[]) ORDER BY posisi`,
            [eventIds]
        );
        const posIds = pos.rows.map(p => p.id);
        const apps = posIds.length === 0 ? { rows: [] } : await pool.query(
            `SELECT a.id, a.job_position_id, a.crew_id, a.sumber, a.status, a.created_at,
                    cp.nama_lengkap, cp.nama_panggung
             FROM applications a JOIN crew_profiles cp ON a.crew_id = cp.user_id
             WHERE a.job_position_id = ANY($1::uuid[]) ORDER BY a.created_at DESC`,
            [posIds]
        );

        const data = ev.rows.map(e => ({
            ...e,
            posisi: pos.rows.filter(p => p.event_job_id === e.id).map(p => ({
                ...p,
                pelamar: apps.rows.filter(a => a.job_position_id === p.id)
            }))
        }));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('[Crew247.id] Gagal memuat dashboard event:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server saat memuat dashboard event.' });
    }
});

module.exports = router;