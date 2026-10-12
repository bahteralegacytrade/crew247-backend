const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// Peta tag -> nama peran (harus sama dengan public/roles.js)
const ROLE_LABELS = {
    FOH: 'FOH Audio Engineer',
    Monitor: 'Monitor Engineer',
    Lighting: 'Lighting Designer',
    StageManager: 'Stage Manager',
    Backline: 'Backline Tech',
    VJ: 'VJ & LED Tech',
    CrowdControl: 'Crowd Control',
    TalentCoordinator: 'Talent Coordinator',
    MC: 'MC / Host',
    Rigger: 'Rigger',
    StageCrew: 'Stage Crew / Runner'
};

function normTag(s) {
    return String(s || '').replace(/^#/, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 30);
}

function canonTag(s) {
    const n = normTag(s);
    const known = Object.keys(ROLE_LABELS).find(k => k.toLowerCase() === n.toLowerCase());
    return known || n;
}

// 1. ENDPOINT: Ambil profil kru milik sendiri (beserta daftar pengalaman)
router.get('/api/crew/profile/:user_id', requireAuth, async (req, res) => {
    const { user_id } = req.params;

    if (user_id !== req.user.user_id) {
        return res.status(403).json({ error: 'Anda tidak berhak mengakses profil ini.' });
    }

    try {
        const result = await pool.query('SELECT * FROM crew_profiles WHERE user_id = $1', [user_id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Profil kru tidak ditemukan.' });
        }

        const pengalaman = await pool.query(
            `SELECT id, tag_peran, nama_event, tahun
             FROM pengalaman_kru WHERE crew_id = $1
             ORDER BY tahun DESC, created_at DESC`,
            [user_id]
        );

        return res.status(200).json({
            success: true,
            data: { ...result.rows[0], pengalaman: pengalaman.rows }
        });

    } catch (error) {
        console.error('[Crew247.id] Gagal mengambil profil kru:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server saat mengambil profil.' });
    }
});

// 2. ENDPOINT: Buat / perbarui profil kru (peran multi-pilihan + pengalaman)
router.post('/api/crew/profile', requireAuth, async (req, res) => {
    const user_id = req.user.user_id; // diambil dari token, bukan dari body
    const {
        nama_lengkap, nama_panggung, kota, rate_harian, pengalaman_tahun,
        keahlian, bio, foto_url, peran_list, pengalaman
    } = req.body;

    if (!nama_lengkap || !nama_panggung || !kota || !rate_harian) {
        return res.status(400).json({ error: 'Data wajib belum lengkap! Mohon isi semua kolom utama.' });
    }

    // Peran: hanya tag standar, tanpa duplikat, urutan klik dipertahankan
    const perans = [...new Set(
        (Array.isArray(peran_list) ? peran_list : []).map(canonTag).filter(t => ROLE_LABELS[t])
    )];
    if (perans.length === 0) {
        return res.status(400).json({ error: 'Pilih minimal satu peran.' });
    }
    const peran_utama = ROLE_LABELS[perans[0]]; // peran pertama = peran utama (dipakai halaman lain)

    // Pengalaman: bersihkan dan batasi
    const pengalamanBersih = (Array.isArray(pengalaman) ? pengalaman : [])
        .map(p => ({
            tag: canonTag(p.tag_peran),
            event: String(p.nama_event || '').trim().slice(0, 100),
            tahun: parseInt(p.tahun)
        }))
        .filter(p => p.tag && p.event && p.tahun >= 1990 && p.tahun <= 2100)
        .slice(0, 50);

    // Foto: hanya gambar hasil upload (data URL) atau link http(s)
    let foto = foto_url || null;
    if (foto) {
        const dataUrlOk = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(foto);
        const linkOk = /^https?:\/\/[^\s"'<>]+$/.test(foto);
        if ((!dataUrlOk && !linkOk) || foto.length > 300000) {
            return res.status(400).json({ error: 'Format foto tidak valid atau ukurannya terlalu besar.' });
        }
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const upsertQuery = `
            INSERT INTO crew_profiles (
                user_id, nama_lengkap, nama_panggung, peran_utama, peran_list,
                kota, rate_harian, pengalaman_tahun, keahlian, bio, foto_url
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (user_id)
            DO UPDATE SET
                nama_lengkap = EXCLUDED.nama_lengkap,
                nama_panggung = EXCLUDED.nama_panggung,
                peran_utama = EXCLUDED.peran_utama,
                peran_list = EXCLUDED.peran_list,
                kota = EXCLUDED.kota,
                rate_harian = EXCLUDED.rate_harian,
                pengalaman_tahun = EXCLUDED.pengalaman_tahun,
                keahlian = EXCLUDED.keahlian,
                bio = EXCLUDED.bio,
                foto_url = EXCLUDED.foto_url
            RETURNING *;
        `;

        const result = await client.query(upsertQuery, [
            user_id, nama_lengkap, nama_panggung, peran_utama, perans,
            kota, rate_harian, pengalaman_tahun || 0, keahlian || [], bio || null, foto
        ]);

        // Daftar pengalaman diganti seluruhnya sesuai kiriman terbaru dari form
        await client.query('DELETE FROM pengalaman_kru WHERE crew_id = $1', [user_id]);
        for (const p of pengalamanBersih) {
            await client.query(
                `INSERT INTO pengalaman_kru (crew_id, tag_peran, nama_event, tahun) VALUES ($1, $2, $3, $4)`,
                [user_id, p.tag, p.event, p.tahun]
            );
        }

        await client.query('COMMIT');

        console.log(`[Crew247.id] Profil kru berhasil disimpan untuk user_id: ${user_id}`);

        return res.status(200).json({
            success: true,
            message: 'Profil CV digital kru berhasil disimpan!',
            data: result.rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[Crew247.id] Gagal menyimpan profil kru:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server saat menyimpan profil.' });
    } finally {
        client.release();
    }
});

module.exports = router;