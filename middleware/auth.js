// middleware/auth.js
const jwt = require('jsonwebtoken');
const config = require('../config');
const User = require('../models/User');

// ============================================================
// AUTH HELPERS (estaban en el monolítico)
// ============================================================

const signToken = (user) => {
  return jwt.sign({ id: user._id, email: user.email }, config.JWT_SECRET, { expiresIn: '7d' });
};

const setTokenCookie = (res, token) => {
  res.cookie('koi_token', token, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
};

// ============================================================
// MIDDLEWARES
// ============================================================

const requireAuth = (req, res, next) => {
  try {
    const decoded = jwt.verify(req.cookies.koi_token, config.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    res.clearCookie('koi_token');
    res.redirect('/login');
  }
};

const requireAuthAPI = (req, res, next) => {
  const token = req.cookies.koi_token || (req.headers.authorization || '').replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'No autenticado: token faltante' });
  }
  
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    if (!decoded.id) {
      return res.status(401).json({ error: 'Token inválido: id no encontrado' });
    }
    req.userId = decoded.id;
    next();
  } catch (err) {
    console.error('❌ requireAuthAPI error:', err.message);
    res.status(401).json({ error: 'No autenticado: ' + err.message });
  }
};

// ============================================================
// ADMIN MIDDLEWARE (estaba en el monolítico)
// ============================================================

const requireAdmin = async (req, res, next) => {
  try {
    const token = req.cookies.koi_token;
    if (!token) {
      return res.status(403).send('Acceso denegado: no autenticado');
    }
    
    const decoded = jwt.verify(token, config.JWT_SECRET);
    const user = await User.findById(decoded.id).select('email');
    
    if (user?.email === 'koi.automatic@gmail.com') {
      req.userId = decoded.id;
      next();
    } else {
      res.status(403).send('Acceso denegado: se requieren permisos de administrador');
    }
  } catch (error) {
    console.error('❌ Error en requireAdmin:', error.message);
    res.status(403).send('Acceso denegado: error de verificación');
  }
};

module.exports = {
  signToken,
  setTokenCookie,
  requireAuth,
  requireAuthAPI,
  requireAdmin,
};