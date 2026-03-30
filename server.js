// ============================================================
//  KOI-FACTURA · SaaS Multi-Tenant Engine v4.7 (FIX CALLBACK)
// ============================================================

'use strict';

require('dotenv').config();
const express        = require('express');
const mongoose       = require('mongoose');
const cors           = require('cors');
const axios          = require('axios');
const jwt            = require('jsonwebtoken');
const cookieParser   = require('cookie-parser');
const crypto         = require('crypto');
const path           = require('path');

const app  = express();
const PORT = process.env.PORT || 10000;
const BASE = (process.env.BASE_URL || `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`).replace(/\/$/, '');
const JWT_SECRET = process.env.JWT_SECRET || 'koi-jwt-dev-secret';

// ── MIDDLEWARES ──────────────────────────────────────────────
app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── DB CONNECTION ───────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI).then(() => console.log('🐟 KOI: Conectado'));

// ── ENCRYPTION ───────────────────────────────────────────────
const ENC_KEY = Buffer.from((process.env.ENCRYPTION_KEY || 'koi0000000000000000000000000000k').padEnd(32, '0').slice(0, 32), 'utf8');

const encrypt = (text) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
};

const decrypt = (p) => {
  try {
    const [i, t, e] = p.split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(i, 'hex'));
    d.setAuthTag(Buffer.from(t, 'hex'));
    return Buffer.concat([d.update(Buffer.from(e, 'hex')), d.final()]).toString('utf8');
  } catch { return null; }
};

// ── SCHEMAS ──────────────────────────────────────────────────
const Integration = mongoose.model('Integration', new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  platform: String, storeUrl: String, status: String,
  credentials: { type: mongoose.Schema.Types.Mixed },
  lastSyncAt: Date
}));

const Order = mongoose.model('Order', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  amount: Number, externalId: String, customerName: String, createdAt: Date
}).index({ userId: 1, externalId: 1 }, { unique: true }));

// ── SYNC ENGINE ──────────────────────────────────────────────
const syncWoo = async (integration) => {
  const key = decrypt(integration.credentials.consumerKey);
  const secret = decrypt(integration.credentials.consumerSecret);
  let page = 1;
  while (page <= 10) {
    try {
      const { data: orders } = await axios.get(`${integration.storeUrl}/wp-json/wc/v3/orders`, {
        auth: { username: key, password: secret }, params: { per_page: 50, page }
      });
      if (!orders?.length) break;
      for (const o of orders) {
        await Order.findOneAndUpdate(
          { userId: integration.userId, externalId: String(o.id) },
          { $set: { amount: parseFloat(o.total), customerName: o.billing?.first_name || 'Cliente', createdAt: new Date(o.date_created) } },
          { upsert: true }
        );
      }
      page++;
    } catch (e) { break; }
  }
  await Integration.findByIdAndUpdate(integration._id, { lastSyncAt: new Date() });
};

// ── API ROUTES ───────────────────────────────────────────────

app.get('/api/stats/dashboard', async (req, res) => {
  const token = req.cookies.koi_token;
  if (!token) return res.status(401).json({ error: '401' });
  try {
    const { id: userId } = jwt.verify(token, JWT_SECRET);
    const count = await Order.countDocuments({ userId });
    
    // Si ya hay órdenes, el frontend asumirá que está conectado
    const stats = await Order.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    res.json({
        ok: true,
        totalFacturado: stats[0]?.total || 0,
        totalVentas: count,
        ventas: await Order.find({ userId }).sort({ createdAt: -1 }).limit(10)
    });
  } catch (e) { res.status(401).json({ error: '401' }); }
});

// MODIFICADO: Ahora el return_url incluye el parámetro que el frontend busca
app.get('/auth/woo/connect', (req, res) => {
  const { store_url } = req.query;
  const token = req.cookies.koi_token;
  if (!store_url || !token) return res.status(400).send('Faltan datos');

  const cleanUrl = store_url.replace(/\/$/, '');
  const callbackUrl = `${BASE}/auth/woo/callback`;
  
  // EL FIX: return_url ahora tiene ?woo=connected
  const authUrl = `${cleanUrl}/wc-auth/v1/authorize?` +
    `app_name=KOI-Factura&` +
    `scope=read_write&` +
    `user_id=${token}&` +
    `return_url=${BASE}/dashboard?woo=connected&` + 
    `callback_url=${callbackUrl}`;
  
  res.redirect(authUrl);
});

app.post('/auth/woo/callback', async (req, res) => {
  const { user_id: token, consumer_key, consumer_secret, store_url } = req.body;
  try {
    const { id: userId } = jwt.verify(token, JWT_SECRET);
    const integration = await Integration.findOneAndUpdate(
      { userId, platform: 'woocommerce' },
      { $set: { status: 'active', storeUrl: store_url, credentials: { consumerKey: encrypt(consumer_key), consumerSecret: encrypt(consumer_secret) } } },
      { upsert: true, new: true }
    );
    // Disparamos la descarga de @sono.handmade
    setImmediate(() => syncWoo(integration));
    res.status(200).send('OK');
  } catch (e) { res.status(500).send('Error'); }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`🚀 KOI v4.7 Listo`));
