const express = require('express');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const router = express.Router();

function makeToken(user) {
    return jwt.sign(
        { user_id: user.id, role: user.role, no_hp: user.no_hp },
        process.env.JWT_SECRET,
        { expiresIn: '30d' }
    );
}

// 1. ENDPOINT: Minta OTP (dipakai untuk Daftar PERTAMA KALI dan Lupa Password)
router.post('/api/auth/otp/request', async (req, res) => {
    const { no_hp, role } = req.body;

    if (!no_hp || !role) {
        return res.status(400).json({ error: 'Nomor HP dan role wajib diisi!' });
    }

    try {
        const checkLimitQuery = `
            SELECT COUNT(*) AS total_request 
            FROM otp_codes 
            WHERE no_hp = $1 
              AND created_at >= NOW() - INTERVAL '15 minutes'
        `;
        const limitResult = await pool.query(checkLimitQuery, [no_hp]);
        const requestCount = parseInt(limitResult.rows[0].total_request);

        if (requestCount >= 3) {
            return res.status(429).json({
                error: 'Terlalu banyak percobaan. Silakan coba lagi dalam 15 menit.'
            });
        }

        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiredAt = new Date(Date.now() + 5 * 60 * 1000);

        await pool.query(
            `INSERT INTO otp_codes (no_hp, kode_otp, expired_at, sudah_dipakai) 
             VALUES ($1, $2, $3, FALSE)`,
            [no_hp, otpCode, expiredAt]
        );

        const waMessage = `Halo dari Crew247.id! Kode OTP Anda adalah: *${otpCode}*. Berlaku 5 menit. Jangan berikan kode ini ke siapa pun.`;

        // (Pengiriman WA asli nanti disambungkan di sini via Fonnte)
        console.log(`[Crew247.id] OTP ${otpCode} berhasil disimpan & dikirim ke ${no_hp}`);

        return res.status(200).json({
            success: true,
            message: 'Kode OTP berhasil dikirim ke WhatsApp Anda.'
        });

    } catch (error) {
        console.error('[Crew247.id] Gagal memproses permintaan OTP:', error);
        return res.status(500).json({ error: 'Gagal mengirim pesan WhatsApp. Silakan coba lagi.' });
    }
});

// 2. ENDPOINT: Verifikasi OTP (TIDAK langsung login — lanjut ke set-password)
router.post('/api/auth/otp/verify', async (req, res) => {
    const { no_hp, otp_code, role } = req.body;

    if (!no_hp || !otp_code || !role) {
        return res.status(400).json({ error: 'Nomor HP, kode OTP, dan role wajib diisi!' });
    }

    try {
        const queryCheckOtp = `
            SELECT * FROM otp_codes 
            WHERE no_hp = $1 AND kode_otp = $2 AND sudah_dipakai = FALSE AND expired_at > CURRENT_TIMESTAMP
            ORDER BY expired_at DESC LIMIT 1
        `;
        const otpResult = await pool.query(queryCheckOtp, [no_hp, otp_code]);

        if (otpResult.rows.length === 0) {
            return res.status(400).json({ error: 'Kode OTP salah, sudah kadaluarsa, atau tidak valid.' });
        }

        await pool.query(`UPDATE otp_codes SET sudah_dipakai = TRUE WHERE id = $1`, [otpResult.rows[0].id]);

        let userResult = await pool.query('SELECT * FROM users WHERE no_hp = $1', [no_hp]);
        let user;

        if (userResult.rows.length === 0) {
            const newUserQuery = `
                INSERT INTO users (no_hp, role) VALUES ($1, $2) 
                RETURNING id, no_hp, role, created_at
            `;
            const newUserResult = await pool.query(newUserQuery, [no_hp, role]);
            user = newUserResult.rows[0];
        } else {
            user = userResult.rows[0];
        }

        // TIDAK mengeluarkan token di sini — frontend wajib lanjut ke set-password
        return res.status(200).json({
            success: true,
            message: 'OTP terverifikasi. Silakan buat password.',
            data: {
                user_id: user.id,
                no_hp: user.no_hp,
                role: user.role
            }
        });

    } catch (error) {
        console.error('[Crew247.id] Database Error saat Verifikasi OTP:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server Crew247.id.' });
    }
});

// 3. ENDPOINT BARU: Buat/Reset Password (dipanggil setelah OTP terverifikasi)
router.post('/api/auth/set-password', async (req, res) => {
    const { no_hp, password } = req.body;

    if (!no_hp || !password) {
        return res.status(400).json({ error: 'Nomor HP dan password wajib diisi!' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Password minimal 6 karakter.' });
    }

    try {
        // Keamanan: pastikan ada OTP milik nomor ini yang BARU SAJA diverifikasi (15 menit terakhir)
        const recentOtp = await pool.query(
            `SELECT 1 FROM otp_codes 
             WHERE no_hp = $1 AND sudah_dipakai = TRUE AND created_at >= NOW() - INTERVAL '15 minutes'
             ORDER BY created_at DESC LIMIT 1`,
            [no_hp]
        );
        if (recentOtp.rows.length === 0) {
            return res.status(403).json({ error: 'Verifikasi OTP terlebih dahulu sebelum membuat password.' });
        }

        const userResult = await pool.query('SELECT * FROM users WHERE no_hp = $1', [no_hp]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Akun tidak ditemukan.' });
        }
        const user = userResult.rows[0];

        const passwordHash = await bcrypt.hash(password, 10);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, user.id]);

        const token = makeToken(user);

        return res.status(200).json({
            success: true,
            message: 'Password berhasil dibuat!',
            data: { user_id: user.id, no_hp: user.no_hp, role: user.role, token }
        });

    } catch (error) {
        console.error('[Crew247.id] Gagal membuat password:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server saat membuat password.' });
    }
});

// 4. ENDPOINT BARU: Login pakai Nomor HP + Password (TANPA OTP)
router.post('/api/auth/login', async (req, res) => {
    const { no_hp, password } = req.body;

    if (!no_hp || !password) {
        return res.status(400).json({ error: 'Nomor HP dan password wajib diisi!' });
    }

    try {
        const userResult = await pool.query('SELECT * FROM users WHERE no_hp = $1', [no_hp]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Nomor HP belum terdaftar. Silakan daftar dulu via OTP.' });
        }
        const user = userResult.rows[0];

        if (!user.password_hash) {
            return res.status(400).json({ error: 'Akun ini belum punya password. Gunakan menu "Daftar / Lupa Password" untuk membuatnya.' });
        }

        const cocok = await bcrypt.compare(password, user.password_hash);
        if (!cocok) {
            return res.status(401).json({ error: 'Nomor HP atau password salah.' });
        }

        const token = makeToken(user);

        return res.status(200).json({
            success: true,
            message: 'Login berhasil!',
            data: { user_id: user.id, no_hp: user.no_hp, role: user.role, token }
        });

    } catch (error) {
        console.error('[Crew247.id] Gagal login:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server saat login.' });
    }
});

module.exports = router;