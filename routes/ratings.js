const express = require('express');
const pool = require('../db'); // Menggunakan koneksi pooler Supabase
const router = express.Router();

// ENDPOINT: Pembuat event memberikan rating & ulasan pasca-gig kepada kru
router.post('/api/ratings', async (req, res) => {
    const { job_id, crew_id, pembuat_event_id, skor, komentar } = req.body;

    // Validasi input dasar
    if (!job_id || !crew_id || !pembuat_event_id || !skor) {
        return res.status(400).json({ error: 'Data job_id, crew_id, pembuat_event_id, dan skor wajib diisi!' });
    }

    if (skor < 1 || skor > 5) {
        return res.status(400).json({ error: 'Skor rating harus bernilai antara 1 sampai 5.' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Validasi Keamanan: Pastikan event benar-benar berstatus 'selesai' atau tanggalnya sudah lewat
        // Ini mencegah rating dari transaksi fiktif
        const eventCheck = await client.query(
            `SELECT * FROM event_jobs WHERE id = $1 AND pembuat_event_id = $2`,
            [job_id, pembuat_event_id]
        );

        if (eventCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Event tidak ditemukan atau Anda tidak berhak menilai event ini.' });
        }

        const eventData = eventCheck.rows[0];
        const today = new Date().toISOString().split('T')[0];

        // Validasi tambahan: Tanggal selesai event harus sudah lewat dari hari ini
        if (eventData.tanggal_selesai > today) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Rating hanya bisa diberikan setelah tanggal event selesai/lewat.' });
        }

        // 2. Simpan data rating ke tabel ratings
        const insertRatingQuery = `
            INSERT INTO ratings (job_id, crew_id, pembuat_event_id, skor, komentar)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *;
        `;
        const ratingResult = await client.query(insertRatingQuery, [
            job_id, crew_id, pembuat_event_id, skor, komentar || null
        ]);

        // 3. KALKULASI OTOMATIS: Update rating_avg dan total_gig_selesai di tabel crew_profiles
        // Menghitung rata-rata skor baru dan menambah jumlah gig selesai kru secara otomatis
        const updateProfileQuery = `
            UPDATE crew_profiles 
            SET 
                total_gig_selesai = total_gig_selesai + 1,
                rating_avg = (
                    SELECT ROUND(AVG(skor)::numeric, 2) 
                    FROM ratings 
                    WHERE crew_id = $1
                )
            WHERE user_id = $1
            RETURNING user_id, rating_avg, total_gig_selesai;
        `;
        const profileUpdateResult = await client.query(updateProfileQuery, [crew_id]);

        await client.query('COMMIT');

        console.log(`[Crew247.id] Rating berhasil diberikan untuk crew_id: ${crew_id}. Rata-rata baru diperbarui.`);

        return res.status(201).json({
            success: true,
            message: 'Rating dan ulasan berhasil disimpan! Reputasi kru telah diperbarui otomatis oleh sistem.',
            data: {
                rating: ratingResult.rows[0],
                updated_profile: profileUpdateResult.rows[0]
            }
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[Crew247.id] Gagal menyimpan rating:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server saat memproses rating.' });
    } finally {
        client.release();
    }
});

module.exports = router;