// ============================================================
//  KOI-FACTURA · SaaS Multi-Tenant Engine v3.6
//  Node/Express · MongoDB Atlas · Google OAuth · JWT
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
const BASE = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const JWT_SECRET = process.env.JWT_SECRET || 'koi-jwt-dev-secret';

// ── MIDDLEWARES ──────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: BASE, credentials: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'koi-session-dev',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));
app.use(passport.initialize());
app.use(passport.session());

// ── MONGODB ──────────────────────────────────────────────────
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('🐟 KOI: MongoDB conectado');
  } catch (err) {
    console.error('❌ MongoDB error:', err.message);
    setTimeout(connectDB, 5000);
  }
};
connectDB();

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
const UserSchema = new mongoose.Schema({
  nombre: String, apellido: String, email: { type: String, unique: true }, password: { type: String, select: false },
  googleId: String, avatar: String, settings: { factAuto: Boolean, cuit: String, categoria: String }
});
const User = mongoose.model('User', UserSchema);

const IntegrationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  platform: String, storeId: String, storeName: String, storeUrl: String, status: String,
  credentials: { type: mongoose.Schema.Types.Mixed, default: {} },
  webhookSecret: { type: String, default: () => crypto.randomBytes(24).toString('hex'), index: true },
  lastSyncAt: Date
});
IntegrationSchema.methods.getKey = function(field) { return decrypt(this.credentials?.[field]); };
const Integration = mongoose.model('Integration', IntegrationSchema);

const OrderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  integrationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Integration' },
  platform: String, externalId: { type: String, required: true },
  customerName: String, customerEmail: String, customerDoc: String,
  amount: { type: Number, required: true }, currency: { type: String, default: 'ARS' },
  status: { type: String, default: 'pending_invoice' }, 
  createdAt: { type: Date, default: Date.now }
});
OrderSchema.index({ userId: 1, platform: 1, externalId: 1 }, { unique: true });
const Order = mongoose.model('Order', OrderSchema);

// ── NORMALIZER ───────────────────────────────────────────────
const normalize = {
  woocommerce(raw) {
    const b = raw.billing || {};
    return {
      externalId: String(raw.id),
      customerName: `${b.first_name || ''} ${b.last_name || ''}`.trim(),
      customerEmail: b.email || '',
      customerDoc: b.dni || b.identification || '99999999',
      amount: parseFloat(raw.total) || 0,
      currency: raw.currency || 'ARS',
      createdAt: new Date(raw.date_created)
    };
  }
};

// ── UPSERT ENGINE ────────────────────────────────────────────
async function upsertOrder(integration, canonical) {
  if (!canonical) return;
  try {
    await Order.findOneAndUpdate(
      { userId: integration.userId, platform: integration.platform, externalId: canonical.externalId },
      { $set: { ...canonical, integrationId: integration._id } },
      { upsert: true }
    );
  } catch (err) { 
    if (err.code !== 11000) console.error("❌ Error en Upsert:", err.message); 
  }
}

// ── MOTOR DE HISTÓRICO (BULK SYNC) ───────────────────────────
const BULK_SYNC = {
  async woocommerce(integration) {
    const key = integration.getKey('consumerKey');
    const secret = integration.getKey('consumerSecret');
    const base = integration.storeUrl;
    let page = 1, total = 0;

    console.log(`⏳ Iniciando carga de historial para: ${base}`);

    while (true) {
      try {
        const { data: orders } = await axios.get(`${base}/wp-json/wc/v3/orders`, {
          auth: { username: key, password: secret },
          params: { per_page: 50, page, status: 'any' },
        });
        
        if (!orders?.length) break;

        for (const raw of orders) {
          await upsertOrder(integration, normalize.woocommerce(raw));
        }
        
        total += orders.length;
        if (orders.length < 50) break;
        page++;
      } catch (err) {
        console.error(`❌ Error en página ${page}:`, err.message);
        break;
      }
    }
    return total;
  }
};

// ── AUTH HELPERS ─────────────────────────────────────────────
const requireAuthAPI = (req, res, next) => {
  const token = req.cookies.koi_token;
  try { req.userId = jwt.verify(token, JWT_SECRET).id; next(); }
  catch { res.status(401).json({ error: 'No autenticado' }); }
};

// ── API & AUTH ROUTES ────────────────────────────────────────

// Callback de WooCommerce: Dispara Sync Automático
app.post('/auth/woo/callback', async (req, res) => {
  res.status(200).json({ status: 'ok' });

  const { state } = req.query;
  const { consumer_key, consumer_secret } = req.body;

  try {
    const { userId, storeUrl } = jwt.verify(state, JWT_SECRET);

    const integration = await Integration.findOneAndUpdate(
      { userId, platform: 'woocommerce', storeId: storeUrl },
      {
        $set: {
          storeName: storeUrl.replace(/^https?:\/\//, ''),
          storeUrl,
          status: 'active',
          credentials: {
            consumerKey: encrypt(consumer_key),
            consumerSecret: encrypt(consumer_secret),
          },
          updatedAt: new Date(),
        },
        $setOnInsert: { userId, platform: 'woocommerce', storeId: storeUrl, createdAt: new Date() },
      },
      { upsert: true, new: true }
    );

    // Registro de Webhook
    await _registerWebhookWoo(integration, consumer_key, consumer_secret, storeUrl);

    // SYNC AUTOMÁTICO (Background)
    BULK_SYNC.woocommerce(integration)
      .then(t => console.log(`✨ Historial cargado: ${t} órdenes.`))
      .catch(e => console.error(`⚠️ Error sync inicial:`, e.message));

  } catch (e) { console.error('Woo callback error:', e.message); }
});

// Conexión genérica (TiendaNube, etc): Dispara Sync Automático
app.post('/api/integrations/:platform', requireAuthAPI, async (req, res) => {
  const { platform } = req.params;
  try {
    const { storeId, storeName, storeUrl, apiToken } = req.body;
    
    const integration = await Integration.findOneAndUpdate(
      { userId: req.userId, platform, storeId: String(storeId) },
      {
        $set: {
          storeName: storeName || `${platform} ${storeId}`,
          storeUrl: storeUrl || '',
          status: 'active',
          credentials: { apiToken: encrypt(apiToken) },
          updatedAt: new Date(),
        },
        $setOnInsert: { userId: req.userId, platform, storeId: String(storeId), createdAt: new Date() },
      },
      { upsert: true, new: true }
    );

    // SYNC AUTOMÁTICO si la plataforma está soportada
    if (BULK_SYNC[platform]) {
      BULK_SYNC[platform](integration).catch(console.error);
    }

    res.json({ ok: true, message: `${platform} conectado. Sincronizando historial...` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Stats para el Dashboard
app.get('/api/stats/dashboard', requireAuthAPI, async (req, res) => {
  try {
    const stats = await Order.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(req.userId) } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    res.json({
      ok: true,
      totalFacturado: stats[0]?.total || 0,
      totalVentas: await Order.countDocuments({ userId: req.userId }),
      ventas: await Order.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(10)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Funciones auxiliares (Webhooks)
async function _registerWebhookWoo(integration, key, secret, storeUrl) {
  const webhookUrl = `${BASE}/webhook/woocommerce/${integration.webhookSecret}`;
  try {
    await axios.post(`${storeUrl}/wp-json/wc/v3/webhooks`, {
      name: 'KOI-Factura', topic: 'order.created',
      delivery_url: webhookUrl, status: 'active',
    }, { auth: { username: key, password: secret } });
  } catch (e) { console.warn('Webhook error:', e.message); }
}

app.listen(PORT, () => console.log(`🚀 KOI v3.6 - Background Sync Activo en ${BASE}`));
