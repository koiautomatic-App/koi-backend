// ============================================================
//  KOI-FACTURA · Backend con Control de Acceso Forzado
// ============================================================

require('dotenv').config();
const express       = require('express');
const mongoose      = require('mongoose');
const cors          = require('cors');
const axios         = require('axios');
const jwt           = require('jsonwebtoken');
const cookieParser  = require('cookie-parser');
const crypto        = require('crypto');
const path          = require('path');

const app  = express();
const PORT = process.env.PORT || 10000;
const BASE = process.env.BASE_URL || `https://koi-backend-zzoc.onrender.com`;
const JWT_SECRET = process.env.JWT_SECRET || 'koi-jwt-dev';

// ── MIDDLEWARES ───────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(cookieParser());

// ── MONGODB ───────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('🐟 KOI: Base de datos lista'))
  .catch(err => console.error('❌ Error MongoDB:', err));

// ── MODELOS (User, Integration, Order) ────────────────────────
// [Se mantienen igual que en tu versión anterior]
const User = mongoose.model('User', new mongoose.Schema({
  nombre: String, email: { type: String, unique: true }, creadoEn: { type: Date, default: Date.now }
}));

const Integration = mongoose.model('Integration', new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId, platform: String, storeId: String, storeUrl: String, status: String,
  credentials: { consumerKey: String, consumerSecret: String }
}));

const Order = mongoose.model('Order', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  platform: String, externalId: String, customerName: String, amount: Number, createdAt: Date
}));

// ── MIDDLEWARE DE PROTECCIÓN ──────────────────────────────────
const requireAuth = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    // Si no hay token y pide una página, lo mandamos al login
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

// ── RUTAS DE AUTENTICACIÓN ────────────────────────────────────

app.post('/auth/register', async (req, res) => {
  try {
    const { nombre, email } = req.body;
    let user = await User.findOne({ email: email.toLowerCase() });
    if (user) return res.status(400).json({ error: 'Email ya registrado' });
    user = await User.create({ nombre, email: email.toLowerCase() });
    res.status(201).json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'none', maxAge: 7*24*60*60*1000 });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Error login' }); }
});

app.get('/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/login');
});

// ── RUTAS DE PÁGINAS (EL CAMBIO CLAVE) ─────────────────────────

// 1. La raíz ahora entrega el LOGIN (acceso.html)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'acceso.html')); 
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'acceso.html'));
});

// 2. El Dashboard ahora está PROTEGIDO
app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── WOOCOMMERCE & API ─────────────────────────────────────────
// [Mantené aquí tus rutas de /auth/woo/connect, /auth/woo/callback y /api/stats/dashboard]

app.get('/auth/woo/connect', requireAuth, (req, res) => {
    const { store_url } = req.query;
    const stateToken = jwt.sign({ userId: req.userId, storeUrl: store_url }, JWT_SECRET, { expiresIn: '15m' });
    const callback_url = `${BASE}/auth/woo/callback?state=${encodeURIComponent(stateToken)}`;
    const auth_url = `${store_url}/wc-auth/v1/authorize?app_name=KOI-Factura&scope=read_write&user_id=${req.userId}&return_url=${encodeURIComponent(BASE + '/dashboard')}&callback_url=${encodeURIComponent(callback_url)}`;
    res.redirect(auth_url);
});

// ── INICIO ────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`🎏 KOI: Protegido y Live`));
