// ============================================================
//  KOI-FACTURA · SaaS Multi-Tenant Engine v3.1 (ESTABLE)
//  Fusión de Seguridad v3.0 + Filtros de Dashboard
// ============================================================

'use strict';

require('dotenv').config();
const express        = require('express');
const mongoose       = require('mongoose');
const cors           = require('cors');
const axios          = require('axios');
const jwt            = require('jsonwebtoken');
const cookieParser   = require('cookie-parser');
const session        = require('express-session');
const passport       = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const crypto         = require('crypto');
const path           = require('path');

const app  = express();
const PORT = process.env.PORT || 10000;
const BASE = (process.env.BASE_URL || `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`).replace(/\/$/, '');
const JWT_SECRET = process.env.JWT_SECRET || 'koi-jwt-prod-secret';

// --- MIDDLEWARES (Configuración v3.0) ---
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'koi-session-dev',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: true, httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(passport.initialize());
app.use(passport.session());

// --- DATABASE & ENCRYPTION (Tu lógica v3.0) ---
mongoose.connect(process.env.MONGO_URI).then(() => console.log('🐟 KOI: Conectado'));

const ENC_KEY = Buffer.from((process.env.ENCRYPTION_KEY || 'koi0000000000000000000000000000k').padEnd(32, '0').slice(0, 32), 'utf8');

const encrypt = (t) => {
  if (!t) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(t), 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
};

// --- SCHEMAS ---
const User = mongoose.model('User', new mongoose.Schema({
  nombre: String, email: { type: String, unique: true }, googleId: String
}));

const Integration = mongoose.model('Integration', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, index: true },
  platform: String, storeUrl: String, status: String, credentials: { type: mongoose.Schema.Types.Mixed },
  webhookSecret: { type: String, default: () => crypto.randomBytes(24).toString('hex') }
}));

const Order = mongoose.model('Order', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  externalId: { type: String, required: true },
  amount: { type: Number, required: true },
  customerName: String,
  createdAt: { type: Date, default: Date.now }
}));

// --- AUTH MIDDLEWARE ---
const requireAuthAPI = (req, res, next) => {
  const token = req.cookies.koi_token;
  try {
    req.userId = jwt.verify(token, JWT_SECRET).id;
    next();
  } catch { res.status(401).json({ error: 'No autenticado' }); }
};

// ============================================================
//  EL ENDPOINT QUE NO SE ROMPE (Ajustado para index (3).html)
// ============================================================
app.get('/api/stats/dashboard', requireAuthAPI, async (req, res) => {
  const { period } = req.query; // Captura si es 'month', 'year' o 'all'
  const userId = new mongoose.Types.ObjectId(req.userId);

  try {
    let query = { userId };
    const ahora = new Date();

    // Lógica de filtrado por fechas
    if (period === 'month') {
      query.createdAt = { $gte: new Date(ahora.getFullYear(), ahora.getMonth(), 1) };
    } else if (period === 'year') {
      query.createdAt = { $gte: new Date(ahora.getFullYear(), 0, 1) };
    }

    const stats = await Order.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }
    ]);

    const ventas = await Order.find(query).sort({ createdAt: -1 }).limit(100).lean();
    const integration = await Integration.findOne({ userId, status: 'active' });

    // Enviamos la respuesta que el frontend espera exactamente
    res.json({
      ok: true,
      connected: !!integration,
      totalFacturado: stats[0]?.total || 0,
      totalVentas: stats[0]?.count || 0,
      ventas: ventas
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- GOOGLE OAUTH FLOW ---
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: `${BASE}/auth/google/callback`
}, async (_, __, profile, done) => {
  try {
    const email = profile.emails[0].value.toLowerCase();
    let user = await User.findOne({ email });
    if (!user) user = await User.create({ googleId: profile.id, email, nombre: profile.name.givenName });
    done(null, user);
  } catch (e) { done(e); }
}));

passport.serializeUser((u, d) => d(null, u.id));
passport.deserializeUser(async (id, d) => d(null, await User.findById(id)));

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login' }), (req, res) => {
  const token = jwt.sign({ id: req.user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('koi_token', token, { httpOnly: true, secure: true, sameSite: 'lax' });
  res.redirect('/dashboard');
});

// --- FALLBACK ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`🚀 KOI v3.1 Híbrido en puerto ${PORT}`));
