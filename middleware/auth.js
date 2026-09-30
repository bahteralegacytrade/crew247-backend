const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Anda belum login atau sesi sudah berakhir. Silakan login ulang.' });
    }

    const token = header.slice(7);
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        req.user = payload; // { user_id, role, no_hp }
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Sesi tidak valid atau sudah kadaluarsa. Silakan login ulang.' });
    }
}

module.exports = { requireAuth };