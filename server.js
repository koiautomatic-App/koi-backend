// ============================================================
//  KOI-FACTURA · Backend Multi-Usuario (PRO Edition)
//  Estructura: login.html (Acceso) + index.html (Dashboard)
// ============================================================

require('dotenv').config();

const express       = require('express');
const mongoose      = require('mongoose');
const cors          = require('cors');
const axios         = require('axios');
const jwt           = require('jsonwebtoken');
const cookieParser  = require('cookie-parser');
const session       = require('express-session');
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

// Servir archivos estáticos (CSS, JS, Imágenes)
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret:            process.env.SESSION_SECRET || 'koi-session-dev',
  resave:            false,
  saveUninitialized: false,
  cookie: { secure: true, maxAge: 7*24*60*60*1000, sameSite: 'none' }
}));

// ── MONGODB ───────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('🐟 KOI: MongoDB Conectado'))
  .catch(err => console.error('❌ MongoDB error:', err));

// ── MODELOS DE DATOS ──────────────────────────────────────────
const User = mongoose.model('User', new mongoose.Schema({
  nombre: { type: String, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  creadoEn: { type: Date, default: Date.now }
}));

const Integration = mongoose.model('Integration', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  platform: { type: String, required: true },
  storeId: { type: String, required: true },
  storeUrl: String,
  status: { type: String, default: 'active' },
  credentials: { consumerKey: String, consumerSecret: String },
  createdAt: { type: Date, default: Date.now }
}));

const Order = mongoose.model('Order', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  platform: { type: String, required: true },
  externalId: { type: String, required: true },
  customerName: String,
  amount: Number,
  createdAt: { type: Date, default: Date.now }
}));

// ── SEGURIDAD Y ENCRIPTACIÓN ──────────────────────────────────
const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY || 'koi0000000000000000000000000000k', 'utf8').slice(0, 32);

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
}

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

// ── RUTAS DE PÁGINAS (FRONTEND) ────────────────────────────────

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── RUTAS DE AUTENTICACIÓN (API) ──────────────────────────────

app.post('/auth/register', async (req, res) => {
  try {
    const { nombre, email } = req.body;
    let user = await User.findOne({ email: email.toLowerCase() });
    if (user) return res.status(400).json({ error: 'El email ya existe' });
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

// ── WOOCOMMERCE & SUCCIÓN ─────────────────────────────────────

app.get('/auth/woo/connect', requireAuth, (req, res) => {
  const { store_url } = req.query;
  if (!store_url) return res.status(400).send('Falta store_url');
  const stateToken = jwt.sign({ userId: req.userId, storeUrl: store_url }, JWT_SECRET, { expiresIn: '15m' });
  const callback_url = `${BASE}/auth/woo/callback?state=${encodeURIComponent(stateToken)}`;
  const auth_url = `${store_url}/wc-auth/v1/authorize?app_name=KOI-Factura&scope=read_write&user_id=${req.userId}&return_url=${encodeURIComponent(BASE + '/dashboard')}&callback_url=${encodeURIComponent(callback_url)}`;
  res.redirect(auth_url);
});

app.post('/auth/woo/callback', async (req, res) => {
  res.status(200).json({ status: 'success' });
  const { state } = req.query;
  const keys = req.body;
  try {
    const { userId, storeUrl } = jwt.verify(state, JWT_SECRET);
    const integration = await Integration.findOneAndUpdate(
      { userId, platform: 'woocommerce', storeId: storeUrl },
      { userId, platform: 'woocommerce', storeId: storeUrl, storeUrl, status: 'syncing',
        'credentials.consumerKey': encrypt(keys.consumer_key),
        'credentials.consumerSecret': encrypt(keys.consumer_secret) },
      { upsert: true, new: true }
    );
    _sincronizarHistorialWoo(integration, keys.consumer_key, keys.consumer_secret, storeUrl);
  } catch(e) { console.error('❌ Error Callback:', e.message); }
});

async function _sincronizarHistorialWoo(integration, consumerKey, consumerSecret, storeUrl) {
  let page = 1; let hasMore = true;
  while (hasMore) {
    try {
      const response = await axios.get(`${storeUrl}/wp-json/wc/v3/orders`, {
        auth: { username: consumerKey, password: consumerSecret },
        params: { per_page: 100, page: page, status: 'completed,processing' }
      });
      if (response.data?.length > 0) {
        for (const raw of response.data) {
          await Order.findOneAndUpdate(
            { userId: integration.userId, platform: 'woocommerce', externalId: raw.id.toString() },
            { customerName: `${raw.billing.first_name} ${raw.billing.last_name}`, amount: parseFloat(raw.total), createdAt: new Date(raw.date_created) },
            { upsert: true }
          );
        }
        page++;
      } else { hasMore = false; }
    } catch (e) { hasMore = false; }
  }
  await Integration.findByIdAndUpdate(integration._id, { status: 'active' });
}

// ── API STATS ─────────────────────────────────────────────────

app.get('/api/stats/dashboard', requireAuth, async (req, res) => {
  try {
    const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const statsMes = await Order.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(req.userId), createdAt: { $gte: inicioMes } }},
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    const ultimasVentas = await Order.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(10);
    const integration = await Integration.findOne({ userId: req.userId });
    res.json({ ok: true, totalFacturadoMes: statsMes[0]?.total || 0, isSyncing: integration?.status === 'syncing', ventas: ultimasVentas });
  } catch (e) { res.status(500).json({ error: 'Error Stats' }); }
});

app.listen(PORT, () => console.log(`🎏 KOI LIVE: Puerto ${PORT}`));
