// Pembatas percobaan sederhana (disimpan di memori server).
// Cukup untuk satu server. Kalau nanti dijalankan di banyak server, ganti ke penyimpanan bersama (mis. Redis).

function createLimiter({ windowMs, max, keyFn, message }) {
    const hits = new Map(); // key -> { count, resetAt }

    // Bersihkan catatan yang sudah lewat jendela waktunya
    const timer = setInterval(() => {
        const now = Date.now();
        for (const [k, v] of hits) {
            if (v.resetAt <= now) hits.delete(k);
        }
    }, 60 * 1000);
    timer.unref(); // jangan menahan server supaya tidak bisa berhenti

    return function limiter(req, res, next) {
        const key = keyFn(req);
        const now = Date.now();

        let entry = hits.get(key);
        if (!entry || entry.resetAt <= now) {
            entry = { count: 0, resetAt: now + windowMs };
            hits.set(key, entry);
        }

        entry.count++;

        if (entry.count > max) {
            const detik = Math.ceil((entry.resetAt - now) / 1000);
            res.set('Retry-After', String(detik));
            return res.status(429).json({
                error: `${message} Coba lagi dalam ${Math.ceil(detik / 60)} menit.`
            });
        }

        // Login yang BERHASIL tidak dihitung sebagai percobaan
        res.on('finish', () => {
            if (res.statusCode === 200) {
                entry.count = Math.max(0, entry.count - 1);
            }
        });

        next();
    };
}

// Maksimal 8 percobaan gagal per 15 menit untuk kombinasi perangkat + nomor HP
const loginPerAkun = createLimiter({
    windowMs: 15 * 60 * 1000,
    max: 8,
    keyFn: (req) => `${req.ip}|${String((req.body && req.body.no_hp) || '').trim()}`,
    message: 'Terlalu banyak percobaan login untuk nomor ini.'
});

// Maksimal 40 percobaan gagal per 15 menit dari satu perangkat (mencegah mencoba banyak nomor sekaligus)
const loginPerIp = createLimiter({
    windowMs: 15 * 60 * 1000,
    max: 40,
    keyFn: (req) => String(req.ip),
    message: 'Terlalu banyak percobaan login dari perangkat ini.'
});

function loginLimiter(req, res, next) {
    loginPerIp(req, res, (err) => {
        if (err) return next(err);
        loginPerAkun(req, res, next);
    });
}

module.exports = { loginLimiter, createLimiter };