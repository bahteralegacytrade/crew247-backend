const express = require('express');
const pool = require('../db');
const router = express.Router();

function normTag(s) {
    return String(s || '').replace(/^#/, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 30);
}

// ENDPOINT: Direktori kru - filter otomatis tanggal + hashtag peran/pengalaman
router.get('/api/crew/directory', async (req, res) => {
    const { tanggal_mulai, tanggal_selesai, peran_utama, kota, tag } = req.query;

    if (!tanggal_mulai || !tanggal_selesai) {
        return res.status(400).json({
            error: 'Parameter tanggal_mulai dan tanggal_selesai wajib diisi untuk melakukan filter direktori!'
        });
    }

    if (tanggal_mulai > tanggal_selesai) {
        return res.status(400).json({
            error: 'Tanggal selesai acara tidak boleh lebih awal dari tanggal mulai.'
        });
    }

    try {
        // Parameter bersama untuk kedua query (tersedia & disembunyikan)
        const params = [tanggal_mulai, tanggal_selesai];
        let filterSql = '';

        if (peran_utama) {
            params.push(peran_utama);
            filterSql += ` AND c.peran_utama = $${params.length}`;
        }

        if (kota) {
            params.push(`%${kota}%`);
            filterSql += ` AND c.kota ILIKE $${params.length}`;
        }

        const tagNorm = normTag(tag).toLowerCase();
        if (tagNorm) {
            params.push(tagNorm);
            const i = params.length;
            filterSql += `
                AND (
                    EXISTS (SELECT 1 FROM unnest(c.peran_list) AS r WHERE LOWER(r) = $${i})
                    OR EXISTS (SELECT 1 FROM pengalaman_kru pk WHERE pk.crew_id = c.user_id AND LOWER(pk.tag_peran) = $${i})
                )`;
        }

        // 1. Kru yang KOSONG di rentang tanggal tersebut (urut rating tertinggi dulu)
        const availableQuery = `
            SELECT c.*,
                (SELECT COALESCE(json_agg(json_build_object('tag', pk.tag_peran, 'event', pk.nama_event, 'tahun', pk.tahun) ORDER BY pk.tahun DESC), '[]'::json)
                 FROM pengalaman_kru pk WHERE pk.crew_id = c.user_id) AS pengalaman
            FROM crew_profiles c
            WHERE NOT EXISTS (
                SELECT 1 FROM schedule_entries s
                WHERE s.crew_id = c.user_id
                  AND s.tanggal_mulai <= $2
                  AND s.tanggal_selesai >= $1
            )
            ${filterSql}
            ORDER BY c.rating_avg DESC, c.total_gig_selesai DESC, c.nama_lengkap ASC
        `;
        const availableResult = await pool.query(availableQuery, params);

        // 2. Jumlah kru yang DISEMBUNYIKAN karena bentrok (dengan filter yang sama)
        const hiddenQuery = `
            SELECT COUNT(*) AS total_disembunyikan
            FROM crew_profiles c
            WHERE EXISTS (
                SELECT 1 FROM schedule_entries s
                WHERE s.crew_id = c.user_id
                  AND s.tanggal_mulai <= $2
                  AND s.tanggal_selesai >= $1
            )
            ${filterSql}
        `;
        const hiddenResult = await pool.query(hiddenQuery, params);
        const totalDisembunyikan = parseInt(hiddenResult.rows[0].total_disembunyikan);

        console.log(`[Crew247.id] Pencarian direktori sukses untuk ${tanggal_mulai} s/d ${tanggal_selesai}. Kru tersedia: ${availableResult.rows.length}, Disembunyikan: ${totalDisembunyikan}`);

        return res.status(200).json({
            success: true,
            filter: {
                tanggal_mulai,
                tanggal_selesai,
                tag: tagNorm || 'Semua Peran',
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