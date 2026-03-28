// ============================================================
//  KOI-FACTURA · Backend Multi-Usuario (PRO Edition)
//  Node/Express + MongoDB Atlas + Google OAuth + Multi-Plataforma
// ============================================================

require('dotenv').config();

const express        = require('express');
const mongoose       = require('mongoose');
const cors           = require('cors');
const axios          = require('axios');
const jwt            = require('jsonwebtoken');
const cookieParser   = require('cookie-parser');
const session        = require('express-session');
const passport       = require('passport');
const crypto         = require('crypto');
const path           = require('path');

const app  = express();
const PORT = process.env.PORT || 10000;
const BASE = process.env.BASE_URL || `http://localhost:${PORT}`;
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
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 7*24*60*60*1000 }
}));
app.use(passport.initialize());
app.use(passport.session());

// ── ENDPOINT DE SUPERVIVENCIA (PING) ──────────────────────────
app.get('/ping', (req, res) => {
  console.log('🎏 KOI: Pulso de vida recibido. Servidor Activo.');
  res.status(200).send('KOI-FACTURA está despierto 🎏');
});

// ── MONGODB ───────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('🐟 KOI: MongoDB conectado con éxito'))
  .catch(err => console.error('❌ MongoDB error:', err));

// ════════════════════════════════════════════════════════════
//  SCHEMAS Y MODELOS (Slim Data Strategy)
// ════════════════════════════════════════════════════════════

const UserSchema = new mongoose.Schema({
  nombre:       { type: String, trim: true },
  email:        { type: String, required: true, unique: true, lowercase: true },
  plan:         { type: String, default: 'free' },
  creadoEn:     { type: Date, default: Date.now },
});

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
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (e) { res.status(401).json({ error: 'Sesión expirada' }); }
};

// ════════════════════════════════════════════════════════════
//  LÓGICA DE SUCCIÓN HISTÓRICA RECURSIVA
// ════════════════════════════════════════════════════════════

async function _sincronizarHistorialWoo(integration, consumerKey, consumerSecret, storeUrl) {
  let page = 1;
  let hasMore = true;
  let totalSincronizado = 0;

  console.log(`⏳ [SYNC] Iniciando succión total para: ${storeUrl}`);

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
  console.log(`✅ [SYNC] Finalizado: ${totalSincronizado} ventas de ${storeUrl}.`);
}

// ════════════════════════════════════════════════════════════
//  RUTAS DE INTEGRACIÓN Y API
// ════════════════════════════════════════════════════════════

// Callback de WooCommerce
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

    // Disparar succión en segundo plano
    _sincronizarHistorialWoo(integration, keys.consumer_key, keys.consumer_secret, storeUrl)
      .catch(err => console.error("❌ Error succión:", err));

  } catch(e) { console.error('❌ Callback error:', e.message); }
});

// Endpoint Real para el Dashboard Chic
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

    const ultimasVentas = await Order.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(5);
    const integration = await Integration.findOne({ userId: req.userId, platform: 'woocommerce' });

    res.json({
      ok: true,
      emitidoHoy: statsHoy[0]?.total || 0,
      totalFacturadoMes: statsMes[0]?.total || 0,
      limiteCategoria: 1500000,
      isSyncing: integration?.status === 'syncing',
      ventas: ultimasVentas
    });
  } catch (e) { res.status(500).json({ error: 'Error API' }); }
});

// ── INICIO ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🎏 KOI LIVE | Puerto: ${PORT} | Base: ${BASE}`);
});
