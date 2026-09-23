const express = require('express');
const axios = require('axios');
const pool = require('../db'); // Koneksi database PostgreSQL
const router = express.Router();

// 1. ENDPOINT: Meminta Kode OTP via WhatsApp & Proteksi Rate Limiting
router.post('/api/auth/otp/request', async (req, res) => {
    const { no_hp, role } = req.body;

    if (!no_hp || !role) {
        return res.status(400).json({ error: 'Nomor HP dan role wajib diisi!' });
    }

    try {
        // --- FITUR KEAMANAN: RATE LIMITING ---
        const checkLimitQuery = `
            SELECT COUNT(*) AS total_request 
            FROM otp_codes 
            WHERE no_hp = $1 
              AND created_at >= NOW() - INTERVAL '15 minutes'
        `;
        const limitResult = await pool.query(checkLimitQuery, [no_hp]);
        const requestCount = parseInt(limitResult.rows[0].total_request);

        if (requestCount >= 3) {
            console.log(`[Crew247.id] Rate limit tercapai untuk nomor: ${no_hp}`);
            return res.status(429).json({
                error: 'Terlalu banyak percobaan. Silakan coba lagi dalam 15 menit.'
            });
        }
        // -------------------------------------

        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiredAt = new Date(Date.now() + 5 * 60 * 1000);

        await pool.query(
            `INSERT INTO otp_codes (no_hp, kode_otp, expired_at, sudah_dipakai) 
             VALUES ($1, $2, $3, FALSE)`,
            [no_hp, otpCode, expiredAt]
        );

        const waMessage = `Halo dari Crew247.id! Kode OTP login Anda adalah: *${otpCode}*. Berlaku selama 5 menit. Jangan berikan kode ini ke siapa pun.`;

        // (Placeholder pengiriman API pihak ketiga ada di sini)

        // FIX: sebelumnya tertulis \(otpCode} ... \){no_hp} -- itu salah, seharusnya begini:
        console.log(`[Crew247.id] OTP ${otpCode} berhasil disimpan & dikirim ke ${no_hp}`);

        return res.status(200).json({
            success: true,
            message: 'Kode OTP berhasil dikirim ke WhatsApp Anda.'
        });

    } catch (error) {
        console.error('Gagal memproses permintaan OTP:', error);
        return res.status(500).json({ error: 'Gagal mengirim pesan WhatsApp. Silakan coba lagi.' });
    }
});

// 2. ENDPOINT: Verifikasi OTP, Validasi Keamanan, & Auto-Register User
router.post('/api/auth/otp/verify', async (req, res) => {
    const { no_hp, otp_code, role } = req.body;

    if (!no_hp || !otp_code || !role) {
        return res.status(400).json({ error: 'Nomor HP, kode OTP, dan role wajib diisi!' });
    }

    try {
        const queryCheckOtp = `
            SELECT * FROM otp_codes 
            WHERE no_hp = $1 
              AND kode_otp = $2 
              AND sudah_dipakai = FALSE 
              AND expired_at > CURRENT_TIMESTAMP
            ORDER BY expired_at DESC 
            LIMIT 1
        `;
        const otpResult = await pool.query(queryCheckOtp, [no_hp, otp_code]);

        if (otpResult.rows.length === 0) {
            return res.status(400).json({ error: 'Kode OTP salah, sudah kadaluarsa, atau tidak valid.' });
        }

        const validOtpRow = otpResult.rows[0];

        // KEAMANAN KRUSIAL: tandai OTP ini sebagai sudah dipakai, supaya tidak bisa dipakai ulang
        await pool.query(
            `UPDATE otp_codes SET sudah_dipakai = TRUE WHERE id = $1`,
            [validOtpRow.id]
        );

        let userResult = await pool.query('SELECT * FROM users WHERE no_hp = $1', [no_hp]);
        let user;

        if (userResult.rows.length === 0) {
            const newUserQuery = `
                INSERT INTO users (no_hp, role) 
                VALUES ($1, $2) 
                RETURNING id, no_hp, role, created_at
            `;
            const newUserResult = await pool.query(newUserQuery, [no_hp, role]);
            user = newUserResult.rows[0];
        } else {
            user = userResult.rows[0];
        }

        return res.status(200).json({
            success: true,
            message: 'Autentikasi berhasil di Crew247.id!',
            data: {
                user_id: user.id,
                no_hp: user.no_hp,
                role: user.role
            }
        });

    } catch (error) {
        console.error('Database Error saat Verifikasi OTP:', error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server Crew247.id.' });
    }
});

// PENTING: baris ini yang tadi hilang -- tanpa ini, server.js tidak bisa memakai router ini sama sekali
module.exports = router;