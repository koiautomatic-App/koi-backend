// ============================================================
//  KOI-FACTURA · SaaS Multi-Tenant Engine v4.2 (IRONCLAD)
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
const crypto         = require('crypto');
const path           = require('path');

const app  = express();
const PORT = process.env.PORT || 10000;
const BASE = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const JWT_SECRET = process.env.JWT_SECRET || 'koi-jwt-dev-secret';

// ── MIDDLEWARES ──────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: BASE, credentials: true }));
app.use(cookieParser());

// IMPORTANTE: Primero servimos los archivos estáticos de la carpeta public
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'koi-session-dev',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// ── MONGODB ──────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI).then(() => console.log('🐟 KOI: MongoDB conectado'));

// ── ENCRYPTION ───────────────────────────────────────────────
const ENC_KEY = Buffer.from((process.env.ENCRYPTION_KEY || 'koi0000000000000000000000000000k').padEnd(32, '0').slice(0, 32), 'utf8');
const encrypt = (text) => {
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
};
const decrypt = (payload) => {
  if (!payload) return null;
  try {
    const [ivHex, tagHex, encHex] = payload.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
  } catch { return null; }
};

// ── SCHEMAS ──────────────────────────────────────────────────
const Integration = mongoose.model('Integration', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, index: true },
  platform: String, storeId: String, storeName: String, storeUrl: String, status: String,
  credentials: { type: mongoose.Schema.Types.Mixed, default: {} },
  webhookSecret: { type: String, default: () => crypto.randomBytes(24).toString('hex') },
  lastSyncAt: Date
}));

const Order = mongoose.model('Order', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  integrationId: mongoose.Schema.Types.ObjectId,
  platform: String, externalId: { type: String, required: true },
  customerName: String, customerEmail: String, amount: Number, currency: String,
  createdAt: { type: Date, default: Date.now }
}).index({ userId: 1, platform: 1, externalId: 1 }, { unique: true }));

// ── SYNC ENGINE ──────────────────────────────────────────────
const BULK_SYNC = {
  async woocommerce(integration) {
    const key = decrypt(integration.credentials.consumerKey);
    const secret = decrypt(integration.credentials.consumerSecret);
    let page = 1;
    while (true) {
      try {
        const { data: orders } = await axios.get(`${integration.storeUrl}/wp-json/wc/v3/orders`, {
          auth: { username: key, password: secret }, params: { per_page: 50, page }
        });
        if (!orders?.length) break;
        for (const o of orders) {
            const canonical = {
                externalId: String(o.id),
                customerName: `${o.billing?.first_name || ''} ${o.billing?.last_name || ''}`.trim(),
                customerEmail: o.billing?.email || '',
                amount: parseFloat(o.total) || 0,
                currency: o.currency || 'ARS',
                createdAt: new Date(o.date_created)
            };
            await Order.findOneAndUpdate(
                { userId: integration.userId, platform: 'woocommerce', externalId: canonical.externalId },
                { $set: { ...canonical, integrationId: integration._id } },
                { upsert: true }
            );
        }
        if (orders.length < 50) break;
        page++;
        await new Promise(r => setTimeout(r, 500));
      } catch (e) { break; }
    }
    await Integration.findByIdAndUpdate(integration._id, { lastSyncAt: new Date() });
  }
};

const requireAuthAPI = (req, res, next) => {
  try { req.userId = jwt.verify(req.cookies.koi_token, JWT_SECRET).id; next(); }
  catch { res.status(401).json({ error: 'Unauthorized' }); }
};

// ── API ROUTES ───────────────────────────────────────────────

app.get('/auth/woo/connect', (req, res) => {
  const { store_url } = req.query;
  const token = req.cookies.koi_token;
  if (!store_url || !token) return res.status(400).send('Faltan credenciales o URL');

  const cleanUrl = store_url.replace(/\/$/, '');
  const callbackUrl = `${BASE}/auth/woo/callback`;
  const authUrl = `${cleanUrl}/wc-auth/v1/authorize?app_name=KOI-Factura&scope=read_write&user_id=${token}&return_url=${BASE}/dashboard&callback_url=${callbackUrl}`;
  
  res.redirect(authUrl);
});

app.post('/auth/woo/callback', async (req, res) => {
  res.status(200).json({ status: 'ok' });
  const { user_id: token, consumer_key, consumer_secret, store_url } = req.body;
  try {
    const { id: userId } = jwt.verify(token, JWT_SECRET);
    const integration = await Integration.findOneAndUpdate(
      { userId, platform: 'woocommerce' },
      { $set: { status: 'active', storeUrl: store_url, credentials: { consumerKey: encrypt(consumer_key), consumerSecret: encrypt(consumer_secret) } } },
      { upsert: true, new: true }
    );
    setImmediate(() => BULK_SYNC.woocommerce(integration));
  } catch (e) { console.error('Callback error:', e); }
});

app.get('/api/stats/dashboard', requireAuthAPI, async (req, res) => {
  try {
    const count = await Order.countDocuments({ userId: req.userId });
    const stats = await Order.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(req.userId) } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    res.json({
      ok: true,
      totalFacturado: stats[0]?.total || 0,
      totalVentas: count,
      ventas: await Order.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(10)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── FRONTEND ROUTES (SOLUCIÓN A "NOT FOUND") ─────────────────

// 1. Ruta específica para el dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// 2. Ruta para cualquier otra cosa (fallback al index)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`🚀 KOI v4.2 - Online en ${BASE}`));
