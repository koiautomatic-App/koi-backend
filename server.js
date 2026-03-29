// ============================================================
//  KOI-FACTURA · Backend Multi-Usuario (PRO Edition)
//  Node/Express + MongoDB Atlas + Multi-Plataforma
// ============================================================

require('dotenv').config();

const express       = require('express');
const mongoose      = require('mongoose');
const cors          = require('cors');
const axios         = require('axios');
const jwt           = require('jsonwebtoken');
const cookieParser  = require('cookie-parser');
const session       = require('express-session');
const passport      = require('passport');
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
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret:            process.env.SESSION_SECRET || 'koi-session-dev',
  resave:            false,
  saveUninitialized: false,
  cookie: { secure: true, maxAge: 7*24*60*60*1000, sameSite: 'none' }
}));

// ── MONGODB ───────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('🐟 KOI: MongoDB conectado con éxito'))
  .catch(err => console.error('❌ MongoDB error:', err));

// ════════════════════════════════════════════════════════════
//  MODELOS DE DATOS
// ════════════════════════════════════════════════════════════

const UserSchema = new mongoose.Schema({
  nombre:       { type: String, trim: true },
  email:        { type: String, required: true, unique: true, lowercase: true },
  plan:         { type: String, default: 'free' },
  creadoEn:     { type: Date, default: Date.now },
});
const User = mongoose.model('User', UserSchema);

const IntegrationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  platform: { type: String, required: true },
  storeId:   { type: String, required: true },
  storeUrl:  { type: String },
  status: { type: String, default: 'active' },
  credentials: {
    consumerKey:    { type: String },
    consumerSecret: { type: String }
  },
  webhookSecret: { type: String, default: () => crypto.randomBytes(24).toString('hex') },
  createdAt:  { type: Date, default: Date.now }
});
const Integration = mongoose.model('Integration', IntegrationSchema);

const OrderSchema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  platform:      { type: String, required: true },
  externalId:    { type: String, required: true },
  customerName:  { type: String },
  customerDoc:   { type: String },
  amount:        { type: Number },
  createdAt:     { type: Date, default: Date.now },
});
OrderSchema.index({ userId: 1, platform: 1, externalId: 1 }, { unique: true });
const Order = mongoose.model('Order', OrderSchema);

// ── ENCRIPTACIÓN ──────────────────────────────────────────────
const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY || 'koi0000000000000000000000000000k', 'utf8').slice(0, 32);

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
}

// ── MIDDLEWARE DE AUTENTICACIÓN ───────────────────────────────
const requireAuth = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (e) { res.status(401).json({ error: 'Sesión expirada' }); }
};

// ════════════════════════════════════════════════════════════
//  RUTAS DE AUTENTICACIÓN (Para tu HTML)
// ════════════════════════════════════════════════════════════

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
    res.json({ ok: true, user: { nombre: user.nombre } });
  } catch (e) { res.status(500).json({ error: 'Error en login' }); }
});

app.get('/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
//  INTEGRACIÓN WOOCOMMERCE & SUCCIÓN
// ════════════════════════════════════════════════════════════

// Iniciador de conexión
app.get('/auth/woo/connect', requireAuth, (req, res) => {
  const { store_url } = req.query;
  if (!store_url) return res.status(400).send('Falta store_url');

  const stateToken = jwt.sign({ userId: req.userId, storeUrl: store_url }, JWT_SECRET, { expiresIn: '15m' });
  const callback_url = `${BASE}/auth/woo/callback?state=${encodeURIComponent(stateToken)}`;
  
  const auth_url = `${store_url}/wc-auth/v1/authorize?app_name=KOI-Factura&scope=read_write&user_id=${req.userId}&return_url=${encodeURIComponent(BASE + '/dashboard')}&callback_url=${encodeURIComponent(callback_url)}`;
  
  res.redirect(auth_url);
});

// Callback (Recibe llaves)
app.post('/auth/woo/callback', async (req, res) => {
  res.status(200).json({ status: 'success' });
  const { state } = req.query;
  const keys = req.body; 

  try {
    const { userId, storeUrl } = jwt.verify(state, JWT_SECRET);
    
    const integration = await Integration.findOneAndUpdate(
      { userId, platform: 'woocommerce', storeId: storeUrl },
      {
        userId, platform: 'woocommerce', storeId: storeUrl,
        storeUrl, status: 'syncing',
        'credentials.consumerKey': encrypt(keys.consumer_key),
        'credentials.consumerSecret': encrypt(keys.consumer_secret),
      },
      { upsert: true, new: true }
    );

    _sincronizarHistorialWoo(integration, keys.consumer_key, keys.consumer_secret, storeUrl)
      .catch(err => console.error("❌ Error en succión:", err));

  } catch(e) { console.error('❌ Error en Callback:', e.message); }
});

// MOTOR DE SUCCIÓN
async function _sincronizarHistorialWoo(integration, consumerKey, consumerSecret, storeUrl) {
  let page = 1;
  let hasMore = true;
  let totalSincronizado = 0;
  console.log(`⏳ [SYNC] Succionando: ${storeUrl}`);

  while (hasMore) {
    try {
      const response = await axios.get(`${storeUrl}/wp-json/wc/v3/orders`, {
        auth: { username: consumerKey, password: consumerSecret },
        params: { per_page: 100, page: page, status: 'completed,processing' }
      });

      if (response.data && response.data.length > 0) {
        for (const raw of response.data) {
          const b = raw.billing || {};
          const doc = (b.dni || b.identification || '').replace(/\D/g, '');
          
          await Order.findOneAndUpdate(
            { userId: integration.userId, platform: 'woocommerce', externalId: raw.id.toString() },
            { 
              customerName: `${b.first_name || ''} ${b.last_name || ''}`.trim(),
              customerDoc: doc || '0',
              amount: parseFloat(raw.total) || 0,
              createdAt: new Date(raw.date_created)
            },
            { upsert: true }
          );
          totalSincronizado++;
        }
        page++;
      } else { hasMore = false; }
    } catch (error) { hasMore = false; }
  }
  await Integration.findByIdAndUpdate(integration._id, { status: 'active' });
  console.log(`✅ [SYNC] Finalizado: ${totalSincronizado} ventas.`);
}

// ════════════════════════════════════════════════════════════
//  API DASHBOARD & SPA
// ════════════════════════════════════════════════════════════

app.get('/api/stats/dashboard', requireAuth, async (req, res) => {
  try {
    const hoy = new Date();
    const inicioDia = new Date(new Date().setHours(0,0,0,0));
    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

    const statsHoy = await Order.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(req.userId), createdAt: { $gte: inicioDia } }},
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const statsMes = await Order.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(req.userId), createdAt: { $gte: inicioMes } }},
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const ultimasVentas = await Order.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(10);
    const integration = await Integration.findOne({ userId: req.userId });

    res.json({
      ok: true,
      emitidoHoy: statsHoy[0]?.total || 0,
      totalFacturadoMes: statsMes[0]?.total || 0,
      limiteCategoria: 1500000,
      isSyncing: integration?.status === 'syncing',
      ventas: ultimasVentas
    });
  } catch (e) { res.status(500).json({ error: 'Error API Stats' }); }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`🎏 KOI-FACTURA LIVE EN PUERTO ${PORT}`));
