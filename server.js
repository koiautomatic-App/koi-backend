// ============================================================
//  KOI-FACTURA · Backend Multi-Usuario (PRO Edition)
//  Node/Express + MongoDB Atlas + Google OAuth + Multi-Plataforma
// ============================================================

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
// Registra esta URL en cron-job.org cada 14 min para evitar el sleep de Render
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
  apellido:     { type: String, trim: true },
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:     { type: String },
  googleId:     { type: String },
  avatar:       { type: String },
  plan:         { type: String, default: 'free', enum: ['free', 'pro'] },
  creadoEn:     { type: Date, default: Date.now },
  ultimoAcceso: { type: Date, default: Date.now },
});

// Encriptación para Tokens
const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY || 'koi0000000000000000000000000000k', 'utf8').slice(0, 32);
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
}
function decrypt(payload) {
  const [iv, tag, enc] = payload.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(enc, 'hex')), decipher.final()]).toString('utf8');
}

const IntegrationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  platform: { type: String, required: true, enum: ['woocommerce', 'tiendanube', 'empretienda', 'mercadolibre', 'rappi'] },
  storeId:   { type: String, required: true },
  storeName: { type: String },
  storeUrl:  { type: String },
  status: { type: String, default: 'active', enum: ['active', 'error', 'revoked', 'pending', 'syncing'] },
  credentials: {
    consumerKey:    { type: String },
    consumerSecret: { type: String },
    accessToken:    { type: String },
    apiToken:       { type: String }
  },
  webhookSecret: { type: String, default: () => crypto.randomBytes(24).toString('hex') },
  lastSyncAt: { type: Date },
  createdAt:  { type: Date, default: Date.now }
});

const Integration = mongoose.model('Integration', IntegrationSchema);

const OrderSchema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  integrationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Integration' },
  platform:      { type: String, required: true },
  externalId:    { type: String, required: true },
  customerName:  { type: String },
  customerEmail: { type: String },
  customerDoc:   { type: String },
  amount:        { type: Number },
  currency:      { type: String, default: 'ARS' },
  status:        { type: String, default: 'pending_invoice' },
  createdAt:     { type: Date, default: Date.now },
});
OrderSchema.index({ userId: 1, platform: 1, externalId: 1 }, { unique: true });
const Order = mongoose.model('Order', OrderSchema);

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

      const orders = response.data;

      if (orders && orders.length > 0) {
        for (const rawOrder of orders) {
          const normalized = normalizeOrder('woocommerce', rawOrder);
          if (normalized) {
            // Guardamos usando upsert para evitar duplicados si el webhook ya captó algo
            await Order.findOneAndUpdate(
              { userId: integration.userId, platform: 'woocommerce', externalId: normalized.externalId },
              { ...normalized, userId: integration.userId, integrationId: integration._id, platform: 'woocommerce' },
              { upsert: true }
            );
            totalSincronizado++;
          }
        }
        console.log(`📦 [SYNC] Página ${page} procesada (${totalSincronizado} órdenes acumuladas)`);
        page++;
      } else {
        hasMore = false;
      }
    } catch (error) {
      console.error(`❌ [SYNC] Error en página ${page}:`, error.message);
      hasMore = false;
    }
  }

  await Integration.findByIdAndUpdate(integration._id, { lastSyncAt: new Date(), status: 'active' });
  console.log(`✅ [SYNC] Finalizado. ${totalSincronizado} ventas succionadas de ${storeUrl}.`);
}

function normalizeOrder(platform, rawPayload) {
  if (platform === 'woocommerce') {
    const b = rawPayload.billing || {};
    let doc = (b.dni || b.identification || '').replace(/\D/g, '');
    return {
      externalId:    rawPayload.id?.toString(),
      customerName:  `${b.first_name || ''} ${b.last_name || ''}`.trim(),
      customerEmail: b.email || '',
      customerDoc:   doc || '0',
      amount:        parseFloat(rawPayload.total) || 0,
      currency:      rawPayload.currency || 'ARS',
      createdAt:     new Date(rawPayload.date_created)
    };
  }
  return null;
}

// ════════════════════════════════════════════════════════════
//  CALLBACK WOOCOMMERCE CON DISPARO DE SUCCIÓN
// ════════════════════════════════════════════════════════════

app.post('/auth/woo/callback', async (req, res) => {
  res.status(200).json({ status: 'success' }); // Responder rápido a Woo

  const { state } = req.query;
  const keys = req.body; 

  try {
    const decoded = jwt.verify(state, JWT_SECRET);
    const { userId, storeUrl } = decoded;

    const integration = await Integration.findOneAndUpdate(
      { userId, platform: 'woocommerce', storeId: storeUrl },
      {
        userId, platform: 'woocommerce', storeId: storeUrl,
        storeName: storeUrl.replace(/^https?:\/\//, ''),
        storeUrl, status: 'syncing',
        'credentials.consumerKey': encrypt(keys.consumer_key),
        'credentials.consumerSecret': encrypt(keys.consumer_secret),
      },
      { upsert: true, new: true }
    );

    // 1. Webhook para el futuro
    await _registrarWebhookWoo(integration, keys.consumer_key, keys.consumer_secret, storeUrl);

    // 2. Disparar succión del PASADO (Background)
    _sincronizarHistorialWoo(integration, keys.consumer_key, keys.consumer_secret, storeUrl)
      .catch(err => console.error("❌ Error en succión:", err));

    console.log(`🚀 KOI: Integración exitosa. Succionando historial de ${storeUrl}...`);
  } catch(e) {
    console.error('❌ Callback error:', e.message);
  }
});

async function _registrarWebhookWoo(integration, consumerKey, consumerSecret, storeUrl) {
  const webhookUrl = `${BASE}/webhook/woocommerce/${integration.webhookSecret}`;
  try {
    await axios.post(`${storeUrl}/wp-json/wc/v3/webhooks`, {
      name: 'KOI - Facturación', topic: 'order.created',
      delivery_url: webhookUrl, status: 'active', secret: integration.webhookSecret,
    }, { auth: { username: consumerKey, password: consumerSecret } });
    console.log(`🔌 Webhook registrado para ${storeUrl}`);
  } catch(e) {
    console.warn(`⚠️ Webhook Woo: Probablemente ya existía en ${storeUrl}`);
  }
}

// ── INICIO DEL SERVIDOR ───────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  🎏 KOI-FACTURA LIVE
  -------------------
  Puerto: ${PORT}
  Base:   ${BASE}
  -------------------
  `);
});
