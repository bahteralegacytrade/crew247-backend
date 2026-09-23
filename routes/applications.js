const express = require('express');
const pool = require('../db'); // Menggunakan koneksi pooler Supabase (naik satu tingkat ke luar folder routes)
const router = express.Router();

// 1. ENDPOINT: Membuat Aplikasi Baru (Jalur Kru Melamar ATAU Pembuat Event "Colek Langsung")
router.post('/api/applications', async (req, res) => {
    const { job_position_id, crew_id, sumber } = req.body; // sumber bisa 'lamaran' atau 'colek_langsung'

    if (!job_position_id || !crew_id || !sumber) {
        return res.status(400).json({ error: 'Data job_position_id, crew_id, dan sumber wajib diisi!' });
    }

    if (!['lamaran', 'colek_langsung'].includes(sumber)) {
        return res.status(400).json({ error: 'Sumber aplikasi tidak valid (harus "lamaran" atau "colek_langsung").' });
    }

    try {
        // Cek apakah posisi pekerjaan tersebut masih ada
        const posCheck = await pool.query('SELECT * FROM job_positions WHERE id = $1', [job_position_id]);
        if (posCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Posisi pekerjaan tidak ditemukan.' });
        }

        // KETENTUAN UTAMA: Status awal SELALU 'menunggu', tidak ada yang langsung diterima otomatis
        const insertQuery = `
            INSERT INTO applications (job_position_id, crew_id, sumber, status, created_at, updated_at)
            VALUES ($1, $2, $3, 'menunggu', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING *;
        `;

        const result = await pool.query(insertQuery, [job_position_id, crew_id, sumber]);
        const newApp = result.rows[0];

        console.log(`[Crew247.id] Aplikasi baru dibuat via ${sumber} untuk crew_id: ${crew_id} pada posisi ${job_position_id}`);

        return res.status(201).json({
            success: true,
            message: 'Tawaran/lamaran berhasil dikirim dan menunggu respons dari kru.',
            data: newApp
        });

    } catch (error) {
        console.error('[Crew247.id] Gagal membuat aplikasi:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server saat memproses aplikasi.' });
    }
});

// 2. ENDPOINT: Respons Kru (Terima / Tolak Tawaran) dengan Penguncian Jadwal Otomatis
router.patch('/api/applications/:id/respond', async (req, res) => {
    const { id } = req.params; // ID dari tabel applications
    const { status_keputusan } = req.body; // Harus 'diterima' atau 'ditolak'

    if (!['diterima', 'ditolak'].includes(status_keputusan)) {
        return res.status(400).json({ error: 'Keputusan tidak valid! Pilih "diterima" atau "ditolak".' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Ambil data aplikasi beserta informasi event terkait untuk validasi waktu & slot
        const appQuery = `
            SELECT a.*, jp.event_job_id, ej.tanggal_mulai, ej.tanggal_selesai, jp.jumlah_dibutuhkan, jp.jumlah_terisi
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

        // CEK TIMEOUT 24 JAM: Apakah sudah lebih dari 24 jam sejak aplikasi dibuat?
        const createdAtTime = new Date(appData.created_at).getTime();
        const nowTime = new Date().getTime();
        const diffHours = (nowTime - createdAtTime) / (1000 * 60 * 60);

        if (diffHours > 24) {
            // Ubah status menjadi expired otomatis
            await client.query(
                `UPDATE applications SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, 
                [id]
            );
            await client.query('COMMIT');
            return res.status(400).json({ error: 'Maaf, batas waktu respons 24 jam telah habis. Aplikasi ini sudah kedaluwarsa.' });
        }

        // Jika kru MEMILIH DITERIMA
        if (status_keputusan === 'diterima') {
            // 1. Update status aplikasi jadi 'diterima'
            await client.query(
                `UPDATE applications SET status = 'diterima', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [id]
            );

            // 2. Tambah jumlah terisi pada posisi pekerjaan tersebut
            await client.query(
                `UPDATE job_positions SET jumlah_terisi = jumlah_terisi + 1 WHERE id = $1`,
                [appData.job_position_id]
            );

            // 3. KUNCI JADWAL: Masukkan ke schedule_entries dengan sumber 'otomatis_gig'
            const scheduleQuery = `
                INSERT INTO schedule_entries (crew_id, tanggal_mulai, tanggal_selesai, sumber, event_id)
                VALUES ($1, $2, $3, 'otomatis_gig', $4)
            `;
            await client.query(scheduleQuery, [
                appData.crew_id, 
                appData.tanggal_mulai, 
                appData.tanggal_selesai, 
                appData.event_job_id
            ]);

            console.log(`[Crew247.id] Kru ${appData.crew_id} MENERIMA gig. Jadwal dikunci dari ${appData.tanggal_mulai} s/d ${appData.tanggal_selesai}`);

        } else {
            // Jika kru MEMILIH DITOLAK
            await client.query(
                `UPDATE applications SET status = 'ditolak', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [id]
            );
            console.log(`[Crew247.id] Kru ${appData.crew_id} MENOLAK gig.`);
        }

        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: `Respons berhasil disimpan dengan status: ${status_keputusan}`
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[Crew247.id] Gagal memproses respons aplikasi:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server saat memproses respons.' });
    } finally {
        client.release();
    }
});

module.exports = router;