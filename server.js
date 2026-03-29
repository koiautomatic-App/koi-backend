// ============================================================
//  KOI-FACTURA · Server Maestro (PRO)
// ============================================================

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const BASE = process.env.BASE_URL || `https://koi-backend-zzoc.onrender.com`;
const JWT_SECRET = process.env.JWT_SECRET || 'koi-jwt-secret-2026';

// ── MIDDLEWARES ───────────────────────────────────────────────
app.use(express.json());
app.use(cors());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ── MONGODB ───────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('🐟 KOI: Conectado a MongoDB Atlas'))
  .catch(err => console.error('❌ Error MongoDB:', err));

// ── MODELOS ───────────────────────────────────────────────────
const User = mongoose.model('User', new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  nombre: String,
  creadoEn: { type: Date, default: Date.now }
}));

const Integration = mongoose.model('Integration', new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  platform: { type: String, default: 'woocommerce' },
  storeUrl: String,
  status: { type: String, default: 'active' },
  credentials: { consumerKey: String, consumerSecret: String }
}));

const Order = mongoose.model('Order', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  externalId: String,
  customerName: String,
  amount: Number,
  createdAt: { type: Date, default: Date.now }
}));

// ── SEGURIDAD (Middleware) ────────────────────────────────────
const requireAuth = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    if (req.accepts('html')) return res.redirect('/login');
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (e) {
    res.clearCookie('token');
    res.redirect('/login');
  }
};

// ── RUTAS DE NAVEGACIÓN ───────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/dashboard', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── AUTENTICACIÓN ─────────────────────────────────────────────

// Login simple (usado por tu formulario actual)
app.post('/auth/login', async (req, res) => {
  try {
    const { email } = req.body;
    let user = await User.findOne({ email: email.toLowerCase() });
    if (!user) user = await User.create({ email: email.toLowerCase(), nombre: 'Usuario KOI' });

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'none', maxAge: 7*24*60*60*1000 });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Error en acceso' }); }
});

// Mock de Google (para evitar el error "Cannot GET /auth/google")
app.get('/auth/google', (req, res) => {
  res.send('Redirigiendo a Google... (Configura tus credenciales en el .env)');
});

app.get('/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/login');
});

// ── CONEXIÓN WOOCOMMERCE ───────────────────────────────────────
app.get('/auth/woo/connect', requireAuth, (req, res) => {
  const { store_url } = req.query;
  if (!store_url) return res.status(400).send('Falta la URL de la tienda');

  const stateToken = jwt.sign({ userId: req.userId, storeUrl: store_url }, JWT_SECRET, { expiresIn: '15m' });
  const callback_url = `${BASE}/auth/woo/callback?state=${encodeURIComponent(stateToken)}`;
  
  const auth_url = `${store_url}/wc-auth/v1/authorize?app_name=KOI-Factura&scope=read_write&user_id=${req.userId}&return_url=${encodeURIComponent(BASE + '/dashboard')}&callback_url=${encodeURIComponent(callback_url)}`;
  res.redirect(auth_url);
});

app.post('/auth/woo/callback', async (req, res) => {
  res.status(200).send('OK');
  const { state } = req.query;
  const keys = req.body; 

  try {
    const { userId, storeUrl } = jwt.verify(state, JWT_SECRET);
    await Integration.findOneAndUpdate(
      { userId, storeUrl },
      { userId, storeUrl, status: 'active', 'credentials.consumerKey': keys.consumer_key, 'credentials.consumerSecret': keys.consumer_secret },
      { upsert: true }
    );
    console.log(`✅ Tienda vinculada: ${storeUrl}`);
  } catch(e) { console.error('❌ Error en Callback:', e.message); }
});

// ── API DATA (DASHBOARD) ──────────────────────────────────────
app.get('/api/stats/dashboard', requireAuth, async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.userId }).sort({ createdAt: -1 });
    const total = orders.reduce((acc, curr) => acc + curr.amount, 0);
    res.json({ ok: true, totalFacturadoMes: total, ventas: orders.slice(0, 5) });
  } catch (e) { res.status(500).json({ error: 'Error al obtener datos' }); }
});

app.listen(PORT, () => console.log(`🎏 KOI LIVE: Puerto ${PORT}`));
