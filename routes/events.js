const express = require('express');
const pool = require('../db'); // Menggunakan koneksi pooler Supabase
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// ENDPOINT 1: Pembuat event memposting lowongan acara baru beserta posisi yang dibutuhkan (Yang sudah berhasil sebelumnya)
router.post('/api/events', requireAuth, async (req, res) => {
    const pembuat_event_id = req.user.user_id;
    const { 
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
router.get('/api/events/pembuat/:pembuat_event_id/selesai', requireAuth, async (req, res) => {
    const { pembuat_event_id } = req.params;
    if (pembuat_event_id !== req.user.user_id) {
        return res.status(403).json({ error: 'Anda tidak berhak mengakses data ini.' });
    }

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
router.get('/api/events/pembuat/:pembuat_event_id', requireAuth, async (req, res) => {
    const { pembuat_event_id } = req.params;
    if (pembuat_event_id !== req.user.user_id) {
        return res.status(403).json({ error: 'Anda tidak berhak mengakses data ini.' });
    }
    try {
        const ev = await pool.query(
            `SELECT id, nama_acara, tanggal_mulai, tanggal_selesai, jam_call_time, zona_waktu, lokasi, kota, status_event
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

// ENDPOINT BARU: Edit info ringan event (BUKAN tanggal)
router.patch('/api/events/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { nama_acara, lokasi, kota, jam_call_time, zona_waktu, tanggal_mulai, tanggal_selesai } = req.body;

    try {
        const check = await pool.query('SELECT pembuat_event_id FROM event_jobs WHERE id = $1', [id]);
        if (check.rows.length === 0) {
            return res.status(404).json({ error: 'Event tidak ditemukan.' });
        }
        if (check.rows[0].pembuat_event_id !== req.user.user_id) {
            return res.status(403).json({ error: 'Anda tidak berhak mengedit event ini.' });
        }

        // Kalau tanggal ikut diubah, pastikan belum ada kru yang DITERIMA di event ini
        if (tanggal_mulai || tanggal_selesai) {
            const acceptedCheck = await pool.query(
                `SELECT 1 FROM applications a 
                 JOIN job_positions jp ON a.job_position_id = jp.id 
                 WHERE jp.event_job_id = $1 AND a.status = 'diterima' LIMIT 1`,
                [id]
            );
            if (acceptedCheck.rows.length > 0) {
                return res.status(400).json({ error: 'Tanggal tidak bisa diubah karena sudah ada kru yang diterima. Batalkan gig tersebut dulu.' });
            }
        }

        const result = await pool.query(
            `UPDATE event_jobs SET 
                nama_acara = $1, lokasi = $2, kota = $3, jam_call_time = $4, zona_waktu = $5,
                tanggal_mulai = COALESCE($6, tanggal_mulai), tanggal_selesai = COALESCE($7, tanggal_selesai)
             WHERE id = $8 RETURNING *`,
            [nama_acara, lokasi, kota, jam_call_time, zona_waktu, tanggal_mulai || null, tanggal_selesai || null, id]
        );

        return res.status(200).json({ success: true, message: 'Event berhasil diperbarui.', data: result.rows[0] });
    } catch (error) {
        console.error('[Crew247.id] Gagal mengedit event:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server saat mengedit event.' });
    }
});

// ENDPOINT BARU: Edit budget & jumlah dibutuhkan pada satu posisi
router.patch('/api/job-positions/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { budget_per_orang, jumlah_dibutuhkan } = req.body;

    try {
        const check = await pool.query(
            `SELECT jp.jumlah_terisi, ej.pembuat_event_id
             FROM job_positions jp JOIN event_jobs ej ON jp.event_job_id = ej.id
             WHERE jp.id = $1`,
            [id]
        );
        if (check.rows.length === 0) {
            return res.status(404).json({ error: 'Posisi tidak ditemukan.' });
        }
        if (check.rows[0].pembuat_event_id !== req.user.user_id) {
            return res.status(403).json({ error: 'Anda tidak berhak mengedit posisi ini.' });
        }
        if (jumlah_dibutuhkan < check.rows[0].jumlah_terisi) {
            return res.status(400).json({ error: `Jumlah dibutuhkan tidak boleh kurang dari ${check.rows[0].jumlah_terisi} (sudah terisi).` });
        }

        const result = await pool.query(
            `UPDATE job_positions SET budget_per_orang = $1, jumlah_dibutuhkan = $2 WHERE id = $3 RETURNING *`,
            [budget_per_orang, jumlah_dibutuhkan, id]
        );

        return res.status(200).json({ success: true, message: 'Posisi berhasil diperbarui.', data: result.rows[0] });
    } catch (error) {
        console.error('[Crew247.id] Gagal mengedit posisi:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server saat mengedit posisi.' });
    }
});

// ENDPOINT BARU: Hapus event sepenuhnya (hanya kalau belum ada kru yang diterima)
router.delete('/api/events/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const check = await client.query('SELECT pembuat_event_id FROM event_jobs WHERE id = $1', [id]);
        if (check.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Event tidak ditemukan.' });
        }
        if (check.rows[0].pembuat_event_id !== req.user.user_id) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Anda tidak berhak menghapus event ini.' });
        }

        const acceptedCheck = await client.query(
            `SELECT 1 FROM applications a 
             JOIN job_positions jp ON a.job_position_id = jp.id 
             WHERE jp.event_job_id = $1 AND a.status = 'diterima' LIMIT 1`,
            [id]
        );
        if (acceptedCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Event tidak bisa dihapus karena masih ada kru yang diterima. Batalkan dulu semua gig di event ini.' });
        }

        await client.query(
            `DELETE FROM applications WHERE job_position_id IN (SELECT id FROM job_positions WHERE event_job_id = $1)`,
            [id]
        );
        await client.query(`DELETE FROM job_positions WHERE event_job_id = $1`, [id]);
        await client.query(`DELETE FROM event_jobs WHERE id = $1`, [id]);

        await client.query('COMMIT');
        return res.status(200).json({ success: true, message: 'Event berhasil dihapus.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[Crew247.id] Gagal menghapus event:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server saat menghapus event.' });
    } finally {
        client.release();
    }
});

module.exports = router;