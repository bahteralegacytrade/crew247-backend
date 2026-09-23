const express = require('express');
const pool = require('../db'); // Menggunakan koneksi pooler Supabase yang benar (naik satu tingkat ke luar folder routes)
const router = express.Router();

// ENDPOINT: Direktori Kru dengan Filter Otomatis Tanggal & Transparansi Jumlah Disembunyikan
router.get('/api/crew/directory', async (req, res) => {
    const { tanggal_mulai, tanggal_selesai, peran_utama, kota } = req.query;

    // Validasi wajib: Pembuat event harus memasukkan tanggal acara yang dicari
    if (!tanggal_mulai || !tanggal_selesai) {
        return res.status(400).json({ 
            error: 'Parameter tanggal_mulai dan tanggal_selesai wajib diisi untuk melakukan filter direktori!' 
        });
    }

    // Validasi logis tanggal
    if (tanggal_mulai > tanggal_selesai) {
        return res.status(400).json({ 
            error: 'Tanggal selesai acara tidak boleh lebih awal dari tanggal mulai.' 
        });
    }

    try {
        // 1. QUERY UTAMA: Mendapatkan kru yang KOSONG (Available) pada rentang tanggal tersebut
        let availableQuery = `
            SELECT c.* 
            FROM crew_profiles c
            WHERE NOT EXISTS (
                SELECT 1 
                FROM schedule_entries s
                WHERE s.crew_id = c.user_id
                  -- Rumus Overlap: Jadwal sibuk kru beririsan dengan tanggal acara
                  AND s.tanggal_mulai <= $2 
                  AND s.tanggal_selesai >= $1
            )
        `;
        let queryParams = [tanggal_mulai, tanggal_selesai];
        let paramIndex = 3;

        // Tambahan filter opsional: Peran Utama (jika dipilih)
        if (peran_utama) {
            availableQuery += ` AND c.peran_utama = $${paramIndex}`;
            queryParams.push(peran_utama);
            paramIndex++;
        }

        // Tambahan filter opsional: Kota (jika dipilih)
        if (kota) {
            availableQuery += ` AND c.kota = $${paramIndex}`;
            queryParams.push(kota);
            paramIndex++;
        }

        const availableResult = await pool.query(availableQuery, queryParams);

        // 2. QUERY PENDUKUNG: Menghitung jumlah kru yang DISEMBUNYIKAN karena bentrok jadwal
        let hiddenQuery = `
            SELECT COUNT(*) AS total_disembunyikan
            FROM crew_profiles c
            WHERE EXISTS (
                SELECT 1 
                FROM schedule_entries s
                WHERE s.crew_id = c.user_id
                  AND s.tanggal_mulai <= $2 
                  AND s.tanggal_selesai >= $1
            )
        `;
        let hiddenParams = [tanggal_mulai, tanggal_selesai];
        let hiddenParamIndex = 3;

        if (peran_utama) {
            hiddenQuery += ` AND c.peran_utama = $${hiddenParamIndex}`;
            hiddenParams.push(peran_utama);
            hiddenParamIndex++;
        }

        if (kota) {
            hiddenQuery += ` AND c.kota = $${hiddenParamIndex}`;
            hiddenParams.push(kota);
            hiddenParamIndex++;
        }

        const hiddenResult = await pool.query(hiddenQuery, hiddenParams);
        const totalDisembunyikan = parseInt(hiddenResult.rows[0].total_disembunyikan);

        // Pesan log berhasil menggunakan backtick yang benar
        console.log(`[Crew247.id] Pencarian direktori sukses untuk ${tanggal_mulai} s/d ${tanggal_selesai}. Kru tersedia: ${availableResult.rows.length}, Disembunyikan: ${totalDisembunyikan}`);

        return res.status(200).json({
            success: true,
            filter: {
                tanggal_mulai,
                tanggal_selesai,
                peran_utama: peran_utama || 'Semua Peran',
                kota: kota || 'Semua Kota'
            },
            meta: {
                total_kru_tersedia: availableResult.rows.length,
                total_kru_disembunyikan_karena_bentrok: totalDisembunyikan
            },
            data: availableResult.rows
        });

    } catch (error) {
        console.error('[Crew247.id] Gagal memuat direktori kru:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server saat memuat direktori kru.' });
    }
});

module.exports = router;