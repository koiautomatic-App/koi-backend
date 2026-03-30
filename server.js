// ============================================================
//  KOI-FACTURA · SaaS Multi-Tenant Engine v3.1 (FULL FILTER)
// ============================================================

'use strict';

require('dotenv').config();

const express        = require('express');
const mongoose       = require('mongoose');
const cors           = require('cors');
const axios          = require('axios');
const bcrypt         = require('bcryptjs');
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

// ── MIDDLEWARES ──────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'koi-session-dev',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

app.use(passport.initialize());
app.use(passport.session());

// ── DB CONNECTION ───────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI).then(() => console.log('🐟 KOI: MongoDB Conectado'));

// ── ENCRYPTION (AES-256-GCM) ─────────────────────────────────
const ENC_KEY = Buffer.from((process.env.ENCRYPTION_KEY || 'koi0000000000000000000000000000k').padEnd(32, '0').slice(0, 32), 'utf8');

const encrypt = (t) => {
  if (!t) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(t), 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
};

const decrypt = (p) => {
  if (!p) return null;
  try {
    const [i, t, e] = p.split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(i, 'hex'));
    d.setAuthTag(Buffer.from(t, 'hex'));
    return Buffer.concat([d.update(Buffer.from(e, 'hex')), d.final()]).toString('utf8');
  } catch { return null; }
};

// ── SCHEMAS ──────────────────────────────────────────────────
const User = mongoose.model('User', new mongoose.Schema({
  nombre: String, email: { type: String, unique: true, lowercase: true }, 
  googleId: String, avatar: String, ultimoAcceso: Date
}));

const Integration = mongoose.model('Integration', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, index: true },
  platform: String, storeId: String, storeUrl: String, status: String,
  credentials: { type: mongoose.Schema.Types.Mixed },
  webhookSecret: { type: String, default: () => crypto.randomBytes(24).toString('hex') }
}));

const Order = mongoose.model('Order', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  externalId: { type: String, required: true },
  amount: { type: Number, required: true },
  customerName: String,
  createdAt: { type: Date, default: Date.now }
}).index({ userId: 1, externalId: 1 }, { unique: true }));

// ── AUTH MIDDLEWARES ─────────────────────────────────────────
const requireAuthAPI = (req, res, next) => {
  const token = req.cookies.koi_token;
  try {
    req.userId = jwt.verify(token, JWT_SECRET).id;
    next();
  } catch { res.status(401).json({ error: 'No autenticado' }); }
};

// ── API: DASHBOARD (EL AJUSTE DE FILTRADO) ───────────────────
app.get('/api/stats/dashboard', requireAuthAPI, async (req, res) => {
  const { period } = req.query; // 'month', 'year', 'all'
  const userId = new mongoose.Types.ObjectId(req.userId);

  try {
    let dateFilter = { userId };
    const ahora = new Date();

    if (period === 'month') {
      const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
      dateFilter.createdAt = { $gte: inicioMes };
    } else if (period === 'year') {
      const inicioAnio = new Date(ahora.getFullYear(), 0, 1);
      dateFilter.createdAt = { $gte: inicioAnio };
    }

    // Agregación de Totales
    const stats = await Order.aggregate([
      { $match: dateFilter },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }
    ]);

    // Ventas para el Calendario/Heatmap
    const ventas = await Order.find(dateFilter)
      .sort({ createdAt: -1 })
      .limit(period === 'all' ? 1000 : 200)
      .select('amount createdAt externalId')
      .lean();

    const integration = await Integration.findOne({ userId, status: 'active' });

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

// ── GOOGLE AUTH ──────────────────────────────────────────────
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

// ── WOOCOMMERCE CONNECTION ───────────────────────────────────
app.get('/auth/woo/connect', (req, res) => {
  const { store_url } = req.query;
  const token = req.cookies.koi_token;
  if (!store_url || !token) return res.status(400).send('Error de sesión');
  const cleanUrl = store_url.replace(/\/$/, '').toLowerCase();
  const state = jwt.sign({ userId: jwt.verify(token, JWT_SECRET).id, storeUrl: cleanUrl }, JWT_SECRET, { expiresIn: '15m' });
  
  const authUrl = `${cleanUrl}/wc-auth/v1/authorize?app_name=KOI-Factura&scope=read_write&user_id=${state}&return_url=${encodeURIComponent(BASE + '/dashboard?woo=connected')}&callback_url=${encodeURIComponent(BASE + '/auth/woo/callback?state=' + state)}`;
  res.redirect(authUrl);
});

app.post('/auth/woo/callback', async (req, res) => {
  res.status(200).send('OK');
  const { state } = req.query;
  const { consumer_key, consumer_secret } = req.body;
  try {
    const { userId, storeUrl } = jwt.verify(state, JWT_SECRET);
    await Integration.findOneAndUpdate(
      { userId, platform: 'woocommerce' },
      { $set: { status: 'active', storeUrl, credentials: { consumerKey: encrypt(consumer_key), consumerSecret: encrypt(consumer_secret) } } },
      { upsert: true }
    );
  } catch (e) { console.error("Woo Callback Error", e); }
});

// ── RUTA FALLBACK FRONTEND ───────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`🚀 KOI v3.1 Activo en puerto ${PORT}`));
