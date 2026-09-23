const express = require('express');
const pool = require('../db'); // Menggunakan koneksi pooler Supabase
const router = express.Router();

// ENDPOINT: Pembuat event memposting lowongan acara baru beserta posisi yang dibutuhkan
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

    // Kita menggunakan TRANSAKSI DATABASE (BEGIN, COMMIT, ROLLBACK)
    // Kenapa? Karena kita akan memasukkan data ke DUA tabel sekaligus (event_jobs dan job_positions).
    // Jika salah satu gagal di tengah jalan, semua perubahan dibatalkan agar data tidak setengah-setengah.
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

module.exports = router;