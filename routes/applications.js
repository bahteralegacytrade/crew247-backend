const express = require('express');
const pool = require('../db');
const router = express.Router();

// 1. ENDPOINT: Membuat Aplikasi Baru (Lamaran atau Colek Langsung)
router.post('/api/applications', async (req, res) => {
    const { job_position_id, crew_id, sumber } = req.body;

    if (!job_position_id || !crew_id || !sumber) {
        return res.status(400).json({ error: 'Data job_position_id, crew_id, dan sumber wajib diisi!' });
    }

    if (!['lamaran', 'colek_langsung'].includes(sumber)) {
        return res.status(400).json({ error: 'Sumber aplikasi tidak valid.' });
    }

    try {
        const posCheck = await pool.query('SELECT * FROM job_positions WHERE id = $1', [job_position_id]);
        if (posCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Posisi pekerjaan tidak ditemukan.' });
        }

        const insertQuery = `
            INSERT INTO applications (job_position_id, crew_id, sumber, status, created_at, updated_at)
            VALUES ($1, $2, $3, 'menunggu', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING *;
        `;

        const result = await pool.query(insertQuery, [job_position_id, crew_id, sumber]);
        const newApp = result.rows[0];

        console.log(`[Crew247.id] Aplikasi baru dibuat via ${sumber} untuk crew_id: ${crew_id}`);

        return res.status(201).json({
            success: true,
            message: 'Tawaran/lamaran berhasil dikirim.',
            data: newApp
        });

    } catch (error) {
        console.error('[Crew247.id] Gagal membuat aplikasi:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server saat memproses aplikasi.' });
    }
});

// 2. ENDPOINT BARU: Mengambil Daftar Tawaran Berstatus 'Menunggu' untuk Kru Tertentu
router.get('/api/applications/crew/:crew_id', async (req, res) => {
    const { crew_id } = req.params;

    try {
        const query = `
            SELECT 
                a.id AS application_id,
                a.status,
                a.created_at,
                jp.id AS job_position_id,
                jp.posisi,
                jp.budget_per_orang,
                ej.id AS event_job_id,
                ej.nama_acara,
                ej.tanggal_mulai,
                ej.tanggal_selesai,
                ej.lokasi,
                ej.kota,
                ej.zona_waktu
            FROM applications a
            JOIN job_positions jp ON a.job_position_id = jp.id
            JOIN event_jobs ej ON jp.event_job_id = ej.id
            WHERE a.crew_id = $1 AND a.status = 'menunggu'
            ORDER BY a.created_at DESC;
        `;

        const result = await pool.query(query, [crew_id]);

        return res.status(200).json({
            success: true,
            data: result.rows
        });

    } catch (error) {
        console.error('[Crew247.id] Gagal mengambil daftar aplikasi kru:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server saat memuat tawaran.' });
    }
});

// 3. ENDPOINT: Respons Kru (Terima / Tolak Tawaran)
router.patch('/api/applications/:id/respond', async (req, res) => {
    const { id } = req.params;
    const { status_keputusan } = req.body;

    if (!['diterima', 'ditolak'].includes(status_keputusan)) {
        return res.status(400).json({ error: 'Keputusan tidak valid!' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const appQuery = `
            SELECT a.*, jp.event_job_id, ej.tanggal_mulai, ej.tanggal_selesai
            FROM applications a
            JOIN job_positions jp ON a.job_position_id = jp.id
            JOIN event_jobs ej ON jp.event_job_id = ej.id
            WHERE a.id = $1 AND a.status = 'menunggu'
        `;
        const appResult = await client.query(appQuery, [id]);

        if (appResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Aplikasi tidak ditemukan atau sudah merespons sebelumnya.' });
        }

        const appData = appResult.rows[0];

        const createdAtTime = new Date(appData.created_at).getTime();
        const nowTime = new Date().getTime();
        const diffHours = (nowTime - createdAtTime) / (1000 * 60 * 60);

        if (diffHours > 24) {
            await client.query(
                `UPDATE applications SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, 
                [id]
            );
            await client.query('COMMIT');
            return res.status(400).json({ error: 'Maaf, batas waktu respons 24 jam telah habis.' });
        }

        if (status_keputusan === 'diterima') {
            await client.query(
                `UPDATE applications SET status = 'diterima', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [id]
            );
            await client.query(
                `UPDATE job_positions SET jumlah_terisi = jumlah_terisi + 1 WHERE id = $1`,
                [appData.job_position_id]
            );
            await client.query(
                `INSERT INTO schedule_entries (crew_id, tanggal_mulai, tanggal_selesai, sumber, event_id) VALUES ($1, $2, $3, 'otomatis_gig', $4)`,
                [appData.crew_id, appData.tanggal_mulai, appData.tanggal_selesai, appData.event_job_id]
            );
        } else {
            await client.query(
                `UPDATE applications SET status = 'ditolak', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [id]
            );
        }

        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: `Respons berhasil disimpan: ${status_keputusan}`
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[Crew247.id] Gagal memproses respons aplikasi:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    } finally {
        client.release();
    }
});

// 4. ENDPOINT: Pembatalan Gig oleh Pembuat Event
router.patch('/api/applications/:id/cancel', async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const appQuery = `
            SELECT a.*, jp.event_job_id, ej.tanggal_mulai, ej.tanggal_selesai
            FROM applications a
            JOIN job_positions jp ON a.job_position_id = jp.id
            JOIN event_jobs ej ON jp.event_job_id = ej.id
            WHERE a.id = $1
        `;
        const appResult = await client.query(appQuery, [id]);

        if (appResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Data aplikasi tidak ditemukan.' });
        }

        const appData = appResult.rows[0];

        if (appData.status !== 'diterima') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Hanya aplikasi berstatus "diterima" yang dapat dibatalkan.' });
        }

        await client.query(`UPDATE applications SET status = 'dibatalkan', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
        await client.query(`UPDATE job_positions SET jumlah_terisi = GREATEST(0, jumlah_terisi - 1) WHERE id = $1`, [appData.job_position_id]);
        await client.query(`DELETE FROM schedule_entries WHERE crew_id = $1 AND event_id = $2 AND sumber = 'otomatis_gig'`, [appData.crew_id, appData.event_job_id]);
        await client.query(`UPDATE crew_profiles SET jumlah_pembatalan = jumlah_pembatalan + 1 WHERE user_id = $1`, [appData.crew_id]);

        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: 'Gig berhasil dibatalkan dan jadwal kru dikembalikan.'
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[Crew247.id] Gagal membatalkan gig:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    } finally {
        client.release();
    }
});

module.exports = router;