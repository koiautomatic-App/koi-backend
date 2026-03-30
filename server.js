// ============================================================
//  KOI-FACTURA · SaaS Multi-Tenant Engine v3.0
//  Node/Express · MongoDB Atlas · Google OAuth · JWT
// ============================================================
//  ENV VARS (Render → Environment):
//
//  MONGO_URI              mongodb+srv://...
//  JWT_SECRET             random 64-char string
//  SESSION_SECRET         random 32-char string
//  ENCRYPTION_KEY         exactly 32 chars
//  GOOGLE_CLIENT_ID       Google Cloud Console
//  GOOGLE_CLIENT_SECRET   Google Cloud Console
//  ML_CLIENT_ID           MercadoLibre Developers
//  ML_CLIENT_SECRET       MercadoLibre Developers
//  BASE_URL               https://koi-backend-zzoc.onrender.com
//  PORT                   (Render sets this automatically)
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
const JWT_SECRET = process.env.JWT_SECRET || 'koi-jwt-dev-change-in-production';

// ════════════════════════════════════════════════════════════
//  MIDDLEWARES
// ════════════════════════════════════════════════════════════
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: BASE, credentials: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret:            process.env.SESSION_SECRET || 'koi-session-dev',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge:   7 * 24 * 60 * 60 * 1000,
  },
}));
app.use(passport.initialize());
app.use(passport.session());

// ════════════════════════════════════════════════════════════
//  MONGODB — conexión con retry automático
// ════════════════════════════════════════════════════════════
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize:     10,
      serverSelectionTimeoutMS: 5000,
    });
    console.log('🐟 KOI: MongoDB conectado');
  } catch (err) {
    console.error('❌ MongoDB error:', err.message);
    setTimeout(connectDB, 5000); // retry en 5s
  }
};
connectDB();

// ════════════════════════════════════════════════════════════
//  ENCRYPTION — AES-256-GCM para tokens en reposo
// ════════════════════════════════════════════════════════════
const ENC_KEY = Buffer.from(
  (process.env.ENCRYPTION_KEY || 'koi0000000000000000000000000000k').padEnd(32, '0').slice(0, 32),
  'utf8'
);

const encrypt = (text) => {
  if (!text) return null;
  const iv      = crypto.randomBytes(12);
  const cipher  = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc     = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag     = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
};

const decrypt = (payload) => {
  if (!payload) return null;
  try {
    const [ivHex, tagHex, encHex] = payload.split(':');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      ENC_KEY,
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(encHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  } catch { return null; }
};

// ════════════════════════════════════════════════════════════
//  SCHEMAS
// ════════════════════════════════════════════════════════════

// ── USER ─────────────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
  nombre:       { type: String, trim: true },
  apellido:     { type: String, trim: true },
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:     { type: String, select: false },
  googleId:     { type: String, sparse: true },
  avatar:       { type: String },
  plan:         { type: String, default: 'free', enum: ['free', 'pro'] },
  settings: {
    factAuto:   { type: Boolean, default: true },
    envioAuto:  { type: Boolean, default: true },
    categoria:  { type: String, default: 'C' },
    cuit:       { type: String },
  },
  ultimoAcceso: { type: Date, default: Date.now },
  creadoEn:     { type: Date, default: Date.now },
}, { timestamps: false });

UserSchema.pre('save', async function(next) {
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});
UserSchema.methods.checkPassword = function(plain) {
  return bcrypt.compare(plain, this.password);
};

const User = mongoose.model('User', UserSchema);

// ── INTEGRATION — Universal Connector ────────────────────────
//
//  Un documento por (userId, platform, storeId).
//  `credentials` guarda CUALQUIER tipo de clave encriptada.
//  El `webhookSecret` es la clave de routing multi-tenant.

const IntegrationSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  // Plataforma — extendible sin cambiar el schema
  platform: {
    type:     String,
    required: true,
    enum:     ['woocommerce', 'tiendanube', 'mercadolibre', 'empretienda', 'rappi', 'vtex', 'shopify'],
  },

  // Identificador único de la tienda dentro de la plataforma
  storeId:   { type: String, required: true },
  storeName: { type: String },
  storeUrl:  { type: String },

  status: {
    type:    String,
    default: 'active',
    enum:    ['active', 'paused', 'error', 'pending'],
  },

  // Credenciales — TODAS encriptadas. Usamos un objeto libre
  // para soportar cualquier plataforma sin migrar el schema.
  credentials: {
    type:    mongoose.Schema.Types.Mixed,
    default: {},
  },

  // Token único de 48 chars que identifica al usuario en webhooks
  webhookSecret: {
    type:    String,
    default: () => crypto.randomBytes(24).toString('hex'),
    index:   true,
  },

  lastSyncAt:  { type: Date },
  syncCursor:  { type: String },  // paginación: guarda el último cursor/página
  errorLog:    { type: String },
  updatedAt:   { type: Date, default: Date.now },
  createdAt:   { type: Date, default: Date.now },
}, { timestamps: false });

IntegrationSchema.index({ userId: 1, platform: 1, storeId: 1 }, { unique: true });

// Helpers de credenciales
IntegrationSchema.methods.setKey = function(field, value) {
  this.credentials = { ...this.credentials, [field]: encrypt(value) };
};
IntegrationSchema.methods.getKey = function(field) {
  return decrypt(this.credentials?.[field]);
};

const Integration = mongoose.model('Integration', IntegrationSchema);

// ── ORDER — Slim canonical model ──────────────────────────────
//
//  Solo campos financieros. Sin rawPayload.
//  El índice único evita duplicados incluso en bulk ingests.

const OrderSchema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  integrationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Integration' },
  platform:      { type: String, required: true },

  // Identificador original de la orden en la plataforma
  externalId:    { type: String, required: true },

  // Datos del cliente (normalizados)
  customerName:  { type: String, default: '' },
  customerEmail: { type: String, default: '' },
  customerDoc:   { type: String, default: '0' },  // DNI/CUIT normalizado

  // Financiero
  amount:   { type: Number, required: true },
  currency: { type: String, default: 'ARS' },

  // Estado de facturación
  status: {
    type:    String,
    default: 'pending_invoice',
    enum:    ['pending_invoice', 'invoiced', 'error_data', 'error_afip', 'skipped'],
  },
  caeNumber: { type: String },
  caeExpiry: { type: Date },
  errorLog:  { type: String },
  createdAt: { type: Date, default: Date.now },
}, { timestamps: false });

// Índice único multi-tenant: (usuario, plataforma, orden) → 1 registro
OrderSchema.index({ userId: 1, platform: 1, externalId: 1 }, { unique: true });
// Índice para consultas de stats
OrderSchema.index({ userId: 1, platform: 1, createdAt: -1 });

const Order = mongoose.model('Order', OrderSchema);

// ════════════════════════════════════════════════════════════
//  NORMALIZER — Universal Data Cleaner
//
//  Recibe el payload crudo de cada plataforma y devuelve
//  un objeto canónico con solo los campos que necesitamos.
//  Nunca guarda el objeto original.
// ════════════════════════════════════════════════════════════
const ARCA_LIMIT = 380_000;
const CUIT_CF    = '99999999';  // consumidor final AFIP

const normalize = {

  woocommerce(raw) {
    const b   = raw.billing || {};
    const doc = _cleanDoc(b.dni || b.identification || b.cpf || '');
    return {
      externalId:    String(raw.id),
      customerName:  `${b.first_name || ''} ${b.last_name || ''}`.trim(),
      customerEmail: b.email || '',
      customerDoc:   _resolveDoc(doc, parseFloat(raw.total) || 0),
      amount:        parseFloat(raw.total) || 0,
      currency:      raw.currency || 'ARS',
    };
  },

  tiendanube(raw) {
    const doc = _cleanDoc(raw.billing_info?.document || '');
    return {
      externalId:    String(raw.id),
      customerName:  raw.contact?.name || `${raw.contact?.first_name || ''} ${raw.contact?.last_name || ''}`.trim(),
      customerEmail: raw.contact?.email || '',
      customerDoc:   _resolveDoc(doc, parseFloat(raw.total) || 0),
      amount:        parseFloat(raw.total) || 0,
      currency:      raw.currency || 'ARS',
    };
  },

  mercadolibre(raw) {
    // ML no comparte DNI — solo usable si llega en order_items buyer
    const doc = _cleanDoc(raw.billing_info?.doc_number || '');
    return {
      externalId:    String(raw.id),
      customerName:  raw.buyer?.nickname || '',
      customerEmail: raw.buyer?.email || '',
      customerDoc:   _resolveDoc(doc, parseFloat(raw.total_amount) || 0),
      amount:        parseFloat(raw.total_amount) || 0,
      currency:      raw.currency_id || 'ARS',
    };
  },

  vtex(raw) {
    const client = raw.clientProfileData || {};
    const doc    = _cleanDoc(client.document || client.cpf || '');
    return {
      externalId:    raw.orderId || String(raw.id),
      customerName:  `${client.firstName || ''} ${client.lastName || ''}`.trim(),
      customerEmail: client.email || '',
      customerDoc:   _resolveDoc(doc, parseFloat(raw.value) / 100 || 0), // VTEX en centavos
      amount:        parseFloat(raw.value) / 100 || 0,
      currency:      raw.currencyCode || 'ARS',
    };
  },

  empretienda(raw) {
    const doc = _cleanDoc(raw.customer?.dni || raw.customer?.document || '');
    return {
      externalId:    String(raw.order_id || raw.id),
      customerName:  raw.customer?.name || '',
      customerEmail: raw.customer?.email || '',
      customerDoc:   _resolveDoc(doc, parseFloat(raw.total_price || raw.total) || 0),
      amount:        parseFloat(raw.total_price || raw.total) || 0,
      currency:      'ARS',
    };
  },

  rappi(raw) {
    const order = raw.order || raw;
    return {
      externalId:    String(order.id),
      customerName:  order.user?.name || '',
      customerEmail: order.user?.email || '',
      customerDoc:   CUIT_CF,
      amount:        parseFloat(order.total_products || order.total) || 0,
      currency:      'ARS',
    };
  },

  shopify(raw) {
    const addr = raw.billing_address || raw.shipping_address || {};
    const doc  = _cleanDoc(raw.note_attributes?.find(a => a.name === 'dni')?.value || '');
    return {
      externalId:    String(raw.id),
      customerName:  `${addr.first_name || ''} ${addr.last_name || ''}`.trim(),
      customerEmail: raw.email || raw.customer?.email || '',
      customerDoc:   _resolveDoc(doc, parseFloat(raw.total_price) || 0),
      amount:        parseFloat(raw.total_price) || 0,
      currency:      raw.currency || 'ARS',
    };
  },
};

// Helpers de normalización
function _cleanDoc(raw) {
  return String(raw || '').replace(/\D/g, '');
}
function _resolveDoc(doc, amount) {
  if (doc.length >= 7 && doc.length <= 11) return doc;
  return amount >= ARCA_LIMIT ? null : CUIT_CF; // null = error_data
}

// ════════════════════════════════════════════════════════════
//  UPSERT ENGINE — Slim Atomic Write
//
//  Guarda solo los campos canónicos. Idempotente: si la orden
//  ya existe (re-delivery del webhook) simplemente la ignora.
// ════════════════════════════════════════════════════════════
async function upsertOrder(integration, canonical) {
  if (!canonical) return;

  // Sin DNI y monto alto → error sin guardar basura
  if (canonical.customerDoc === null) {
    return Order.findOneAndUpdate(
      { userId: integration.userId, platform: integration.platform, externalId: canonical.externalId },
      {
        $setOnInsert: {
          userId:        integration.userId,
          integrationId: integration._id,
          platform:      integration.platform,
          ...canonical,
          customerDoc: '0',
          status:      'error_data',
          errorLog:    `Monto $${canonical.amount} ≥ $${ARCA_LIMIT} sin DNI válido`,
        },
      },
      { upsert: true, new: false }
    ).catch(() => {}); // ignora duplicados silenciosamente
  }

  return Order.findOneAndUpdate(
    { userId: integration.userId, platform: integration.platform, externalId: canonical.externalId },
    {
      $setOnInsert: {
        userId:        integration.userId,
        integrationId: integration._id,
        platform:      integration.platform,
        ...canonical,
        status:    'pending_invoice',
      },
    },
    { upsert: true, new: false }
  ).catch(err => {
    if (err.code !== 11000) // ignora duplicate key, relanza el resto
      console.error(`❌ upsert error [${integration.platform}#${canonical.externalId}]:`, err.message);
  });
}

// ════════════════════════════════════════════════════════════
//  AUTH HELPERS
// ════════════════════════════════════════════════════════════
const signToken = (userId) =>
  jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '7d' });

const setTokenCookie = (res, token) =>
  res.cookie('koi_token', token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   7 * 24 * 60 * 60 * 1000,
  });

// Middleware para páginas HTML — redirige al login
const requireAuth = (req, res, next) => {
  try {
    req.userId = jwt.verify(req.cookies.koi_token, JWT_SECRET).id;
    next();
  } catch {
    res.clearCookie('koi_token');
    res.redirect('/login');
  }
};

// Middleware para rutas API — devuelve JSON
const requireAuthAPI = (req, res, next) => {
  const token = req.cookies.koi_token
    || (req.headers.authorization || '').replace('Bearer ', '');
  try {
    req.userId = jwt.verify(token, JWT_SECRET).id;
    next();
  } catch {
    res.status(401).json({ error: 'No autenticado' });
  }
};

// ════════════════════════════════════════════════════════════
//  PASSPORT — Google OAuth 2.0
// ════════════════════════════════════════════════════════════
passport.use(new GoogleStrategy({
  clientID:     process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL:  `${BASE}/auth/google/callback`,
}, async (_, __, profile, done) => {
  try {
    const email = profile.emails?.[0]?.value?.toLowerCase();
    if (!email) return done(new Error('Google no devolvió email'));

    let user = await User.findOne({ $or: [{ googleId: profile.id }, { email }] });

    if (!user) {
      user = await User.create({
        googleId: profile.id,
        email,
        nombre:   profile.name?.givenName  || '',
        apellido: profile.name?.familyName || '',
        avatar:   profile.photos?.[0]?.value || '',
      });
    } else {
      if (!user.googleId) user.googleId = profile.id;
      user.avatar       = profile.photos?.[0]?.value || user.avatar;
      user.ultimoAcceso = new Date();
      await user.save();
    }
    done(null, user);
  } catch (e) { done(e); }
}));

passport.serializeUser((user, done)   => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try { done(null, await User.findById(id).select('-password')); }
  catch (e) { done(e); }
});

// ════════════════════════════════════════════════════════════
//  RUTAS AUTH
// ════════════════════════════════════════════════════════════

app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=google_failed' }),
  (req, res) => {
    setTokenCookie(res, signToken(req.user.id));
    res.redirect('/dashboard');
  }
);

app.post('/auth/register', async (req, res) => {
  try {
    const { nombre, apellido, email, password } = req.body;
    if (!nombre || !email || !password)
      return res.status(400).json({ error: 'Nombre, email y contraseña son obligatorios.' });
    if (password.length < 8)
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
    if (await User.findOne({ email: email.toLowerCase() }))
      return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });

    const user = await User.create({ nombre, apellido, email, password });
    setTokenCookie(res, signToken(user.id));
    res.json({ ok: true, user: { nombre: user.nombre, email: user.email } });
  } catch (e) {
    console.error('Register:', e.message);
    res.status(500).json({ error: 'Error interno. Intentá de nuevo.' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email y contraseña requeridos.' });

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user?.password)
      return res.status(401).json({ error: 'Email o contraseña incorrectos.' });

    if (!await user.checkPassword(password))
      return res.status(401).json({ error: 'Email o contraseña incorrectos.' });

    user.ultimoAcceso = new Date();
    await user.save();

    setTokenCookie(res, signToken(user.id));
    res.json({ ok: true, user: { nombre: user.nombre, email: user.email } });
  } catch (e) {
    console.error('Login:', e.message);
    res.status(500).json({ error: 'Error interno.' });
  }
});

app.get('/auth/logout', (req, res) => {
  req.logout?.(() => {});
  res.clearCookie('koi_token');
  res.redirect('/login');
});

// ════════════════════════════════════════════════════════════
//  API — USUARIO
// ════════════════════════════════════════════════════════════

app.get('/api/me', requireAuthAPI, async (req, res) => {
  const user = await User.findById(req.userId).select('-password').lean();
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ ok: true, user });
});

app.patch('/api/me/settings', requireAuthAPI, async (req, res) => {
  try {
    const allowed = ['factAuto', 'envioAuto', 'categoria', 'cuit', 'nombre', 'apellido'];
    const update  = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        update[`settings.${key}`] = req.body[key];
      }
    }
    const user = await User.findByIdAndUpdate(
      req.userId,
      { $set: update },
      { new: true, select: '-password' }
    ).lean();
    res.json({ ok: true, user });
  } catch (e) {
    res.status(500).json({ error: 'Error al guardar configuración' });
  }
});

// ════════════════════════════════════════════════════════════
//  API — INTEGRACIONES
// ════════════════════════════════════════════════════════════

// Listar — nunca expone credentials
app.get('/api/integrations', requireAuthAPI, async (req, res) => {
  const list = await Integration.find({ userId: req.userId })
    .select('-credentials -webhookSecret')
    .lean();
  res.json({ ok: true, integrations: list });
});

// Activar / Pausar
app.patch('/api/integrations/:id/status', requireAuthAPI, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'paused'].includes(status))
      return res.status(400).json({ error: 'Status inválido' });
    const doc = await Integration.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { status },
      { new: true, select: '-credentials -webhookSecret' }
    );
    if (!doc) return res.status(404).json({ error: 'Integración no encontrada' });
    res.json({ ok: true, integration: doc });
  } catch (e) { res.status(500).json({ error: 'Error interno' }); }
});

// Desconectar
app.delete('/api/integrations/:id', requireAuthAPI, async (req, res) => {
  try {
    const doc = await Integration.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!doc) return res.status(404).json({ error: 'Integración no encontrada' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Error interno' }); }
});

// Webhook URL (para mostrar al usuario)
app.get('/api/integrations/:id/webhook', requireAuthAPI, async (req, res) => {
  const doc = await Integration.findOne({ _id: req.params.id, userId: req.userId })
    .select('platform webhookSecret');
  if (!doc) return res.status(404).json({ error: 'No encontrada' });
  res.json({ ok: true, url: `${BASE}/webhook/${doc.platform}/${doc.webhookSecret}` });
});

// ── Conectar Token-Based (TiendaNube, Empretienda, Rappi, VTEX) ──
app.post('/api/integrations/:platform', requireAuthAPI, async (req, res) => {
  const { platform } = req.params;
  const TOKEN_PLATFORMS = ['tiendanube', 'empretienda', 'rappi', 'vtex', 'shopify'];
  if (!TOKEN_PLATFORMS.includes(platform))
    return res.status(400).json({ error: `Plataforma ${platform} no soporta token directo` });

  try {
    const { storeId, storeName, storeUrl, apiToken, apiKey, apiSecret } = req.body;
    if (!storeId) return res.status(400).json({ error: 'storeId requerido' });

    const creds = {};
    if (apiToken)  creds.apiToken  = encrypt(apiToken);
    if (apiKey)    creds.apiKey    = encrypt(apiKey);
    if (apiSecret) creds.apiSecret = encrypt(apiSecret);

    const integration = await Integration.findOneAndUpdate(
      { userId: req.userId, platform, storeId: String(storeId) },
      {
        $set: {
          storeName: storeName || `${platform} ${storeId}`,
          storeUrl:  storeUrl || '',
          status:    'active',
          errorLog:  '',
          credentials: creds,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          userId:   req.userId,
          platform,
          storeId:  String(storeId),
          createdAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    // Registrar webhook si la plataforma lo soporta
    if (platform === 'tiendanube' && apiToken) {
      await _registerWebhookTiendaNube(integration, apiToken).catch(console.warn);
    }

    res.json({ ok: true, message: `${platform} conectado correctamente.` });
  } catch (e) {
    console.error(`Connect ${platform}:`, e.message);
    res.status(500).json({ error: 'Error al conectar. Verificá las credenciales.' });
  }
});

// ════════════════════════════════════════════════════════════
//  WOOCOMMERCE OAUTH
// ════════════════════════════════════════════════════════════

app.get('/auth/woo/connect', requireAuth, (req, res) => {
  const { store_url } = req.query;
  if (!store_url) return res.status(400).send('Falta store_url');

  const clean = store_url.replace(/\/$/, '').toLowerCase();

  // Firmamos userId + storeUrl en un state token (15 min de validez)
  const state = jwt.sign({ userId: req.userId, storeUrl: clean }, JWT_SECRET, { expiresIn: '15m' });

  const callbackUrl = `${BASE}/auth/woo/callback?state=${encodeURIComponent(state)}`;
  const returnUrl   = `${BASE}/dashboard?woo=connected`;

  const authUrl = `${clean}/wc-auth/v1/authorize`
    + `?app_name=KOI-Factura`
    + `&scope=read_write`
    + `&user_id=${req.userId}`
    + `&return_url=${encodeURIComponent(returnUrl)}`
    + `&callback_url=${encodeURIComponent(callbackUrl)}`;

  res.redirect(authUrl);
});

app.post('/auth/woo/callback', async (req, res) => {
  res.status(200).json({ status: 'ok' }); // WooCommerce necesita 200 inmediato

  const { state } = req.query;
  const { consumer_key, consumer_secret } = req.body;

  try {
    const { userId, storeUrl } = jwt.verify(state, JWT_SECRET);

    const integration = await Integration.findOneAndUpdate(
      { userId, platform: 'woocommerce', storeId: storeUrl },
      {
        $set: {
          storeName:    storeUrl.replace(/^https?:\/\//, ''),
          storeUrl,
          status:       'active',
          errorLog:     '',
          credentials: {
            consumerKey:    encrypt(consumer_key),
            consumerSecret: encrypt(consumer_secret),
          },
          updatedAt: new Date(),
        },
        $setOnInsert: { userId, platform: 'woocommerce', storeId: storeUrl, createdAt: new Date() },
      },
      { upsert: true, new: true }
    );

    await _registerWebhookWoo(integration, consumer_key, consumer_secret, storeUrl);
    console.log(`✅ WooCommerce conectado: ${storeUrl} → usuario ${userId}`);
  } catch (e) {
    console.error('WooCommerce callback error:', e.message);
  }
});

async function _registerWebhookWoo(integration, key, secret, storeUrl) {
  const webhookUrl = `${BASE}/webhook/woocommerce/${integration.webhookSecret}`;
  try {
    const { data: existing } = await axios.get(`${storeUrl}/wp-json/wc/v3/webhooks`, {
      auth:   { username: key, password: secret },
      params: { per_page: 100 },
    });
    if (existing?.some(wh => wh.delivery_url === webhookUrl)) return;
    await axios.post(`${storeUrl}/wp-json/wc/v3/webhooks`, {
      name: 'KOI-Factura', topic: 'order.created',
      delivery_url: webhookUrl, status: 'active',
    }, { auth: { username: key, password: secret } });
    console.log(`🔌 WooCommerce webhook registrado: ${storeUrl}`);
  } catch (e) {
    console.warn('WooCommerce webhook:', e.response?.data?.message || e.message);
    await Integration.findByIdAndUpdate(integration._id, { errorLog: `Webhook error: ${e.message}` });
  }
}

async function _registerWebhookTiendaNube(integration, apiToken) {
  const storeId    = integration.storeId;
  const webhookUrl = `${BASE}/webhook/tiendanube/${integration.webhookSecret}`;
  await axios.post(
    `https://api.tiendanube.com/v1/${storeId}/webhooks`,
    { event: 'order/paid', url: webhookUrl },
    { headers: { Authentication: `bearer ${apiToken}`, 'User-Agent': 'KOI-Factura/3.0' } }
  );
  console.log(`🔌 TiendaNube webhook registrado: ${storeId}`);
}

// ════════════════════════════════════════════════════════════
//  MERCADOLIBRE OAUTH
// ════════════════════════════════════════════════════════════

app.get('/auth/ml/connect', requireAuth, (req, res) => {
  const state = jwt.sign({ userId: req.userId }, JWT_SECRET, { expiresIn: '15m' });
  const url = 'https://auth.mercadolibre.com.ar/authorization'
    + `?response_type=code`
    + `&client_id=${process.env.ML_CLIENT_ID}`
    + `&redirect_uri=${encodeURIComponent(`${BASE}/auth/ml/callback`)}`
    + `&state=${encodeURIComponent(state)}`;
  res.redirect(url);
});

app.get('/auth/ml/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.redirect('/dashboard?error=ml_denied');
  try {
    const { userId } = jwt.verify(state, JWT_SECRET);

    const { data: token } = await axios.post('https://api.mercadolibre.com/oauth/token', {
      grant_type:    'authorization_code',
      client_id:     process.env.ML_CLIENT_ID,
      client_secret: process.env.ML_CLIENT_SECRET,
      code,
      redirect_uri:  `${BASE}/auth/ml/callback`,
    });

    const { data: seller } = await axios.get('https://api.mercadolibre.com/users/me', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });

    const sellerId = String(token.user_id || seller.id);

    await Integration.findOneAndUpdate(
      { userId, platform: 'mercadolibre', storeId: sellerId },
      {
        $set: {
          storeName: seller.nickname || `ML ${sellerId}`,
          status:    'active',
          errorLog:  '',
          credentials: {
            accessToken:  encrypt(token.access_token),
            refreshToken: encrypt(token.refresh_token),
            tokenExpiry:  new Date(Date.now() + token.expires_in * 1000).toISOString(),
            sellerId,
          },
          updatedAt: new Date(),
        },
        $setOnInsert: { userId, platform: 'mercadolibre', storeId: sellerId, createdAt: new Date() },
      },
      { upsert: true }
    );

    console.log(`✅ MercadoLibre conectado: seller ${sellerId} → usuario ${userId}`);
    res.redirect('/dashboard?ml=connected');
  } catch (e) {
    console.error('ML callback:', e.response?.data || e.message);
    res.redirect('/dashboard?error=ml_failed');
  }
});

// Refresh automático de token ML
async function _getMLToken(integration) {
  const expiry = new Date(integration.credentials.tokenExpiry || 0);
  const isExpiringSoon = expiry < new Date(Date.now() + 10 * 60 * 1000);

  if (!isExpiringSoon) return decrypt(integration.credentials.accessToken);

  const { data } = await axios.post('https://api.mercadolibre.com/oauth/token', {
    grant_type:    'refresh_token',
    client_id:     process.env.ML_CLIENT_ID,
    client_secret: process.env.ML_CLIENT_SECRET,
    refresh_token: decrypt(integration.credentials.refreshToken),
  });

  await Integration.findByIdAndUpdate(integration._id, {
    'credentials.accessToken':  encrypt(data.access_token),
    'credentials.refreshToken': encrypt(data.refresh_token),
    'credentials.tokenExpiry':  new Date(Date.now() + data.expires_in * 1000).toISOString(),
  });

  return data.access_token;
}

// ════════════════════════════════════════════════════════════
//  BULK SYNC ENGINE — Paginación máxima por plataforma
//
//  Cada integración puede triggerear un sync manual o
//  programado. El cursor se guarda en integration.syncCursor
//  para reanudar si falla.
// ════════════════════════════════════════════════════════════

const BULK_SYNC = {

  async woocommerce(integration) {
    const key    = integration.getKey('consumerKey');
    const secret = integration.getKey('consumerSecret');
    const base   = integration.storeUrl;
    let   page   = 1;
    let   total  = 0;

    while (true) {
      const { data: orders } = await axios.get(`${base}/wp-json/wc/v3/orders`, {
        auth:   { username: key, password: secret },
        params: { per_page: 100, page, status: 'completed', orderby: 'date', order: 'desc' },
      });
      if (!orders?.length) break;

      await Promise.all(orders.map(raw =>
        upsertOrder(integration, normalize.woocommerce(raw))
      ));
      total += orders.length;
      if (orders.length < 100) break;
      page++;
    }
    return total;
  },

  async tiendanube(integration) {
    const token   = integration.getKey('apiToken');
    const storeId = integration.storeId;
    let   page    = 1;
    let   total   = 0;

    while (true) {
      const { data: orders } = await axios.get(
        `https://api.tiendanube.com/v1/${storeId}/orders`,
        {
          headers: { Authentication: `bearer ${token}`, 'User-Agent': 'KOI-Factura/3.0' },
          params:  { per_page: 200, page, payment_status: 'paid' },
        }
      );
      if (!orders?.length) break;
      await Promise.all(orders.map(raw => upsertOrder(integration, normalize.tiendanube(raw))));
      total += orders.length;
      if (orders.length < 200) break;
      page++;
    }
    return total;
  },

  async mercadolibre(integration) {
    const accessToken = await _getMLToken(integration);
    const sellerId    = integration.credentials.sellerId;
    let   offset      = 0;
    let   total       = 0;
    const LIMIT       = 50; // ML máximo

    while (true) {
      const { data } = await axios.get('https://api.mercadolibre.com/orders/search', {
        headers: { Authorization: `Bearer ${accessToken}` },
        params:  { seller: sellerId, limit: LIMIT, offset, sort: 'date_desc' },
      });
      const orders = data.results || [];
      if (!orders.length) break;
      await Promise.all(orders.map(raw => upsertOrder(integration, normalize.mercadolibre(raw))));
      total  += orders.length;
      offset += LIMIT;
      if (offset >= (data.paging?.total || 0)) break;
    }
    return total;
  },

  async vtex(integration) {
    const apiKey    = integration.getKey('apiKey');
    const apiToken  = integration.getKey('apiToken');
    const storeUrl  = integration.storeUrl; // ej: https://mitienda.myvtex.com
    let   page      = 1;
    let   total     = 0;
    const PER_PAGE  = 100;

    while (true) {
      const { data } = await axios.get(`${storeUrl}/api/oms/pvt/orders`, {
        headers: {
          'X-VTEX-API-AppKey':   apiKey,
          'X-VTEX-API-AppToken': apiToken,
        },
        params: { page, per_page: PER_PAGE, f_status: 'invoiced,payment-approved' },
      });
      const orders = data.list || [];
      if (!orders.length) break;
      await Promise.all(orders.map(raw => upsertOrder(integration, normalize.vtex(raw))));
      total += orders.length;
      if (orders.length < PER_PAGE) break;
      page++;
    }
    return total;
  },
};

// Endpoint para disparar sync manual desde el dashboard
app.post('/api/integrations/:id/sync', requireAuthAPI, async (req, res) => {
  try {
    const integration = await Integration.findOne({ _id: req.params.id, userId: req.userId });
    if (!integration) return res.status(404).json({ error: 'No encontrada' });
    if (integration.status !== 'active') return res.status(400).json({ error: 'Integración inactiva' });

    const syncFn = BULK_SYNC[integration.platform];
    if (!syncFn) return res.status(400).json({ error: `Sync no disponible para ${integration.platform}` });

    // Responder inmediato y ejecutar en background
    res.json({ ok: true, message: 'Sincronización iniciada en background' });

    syncFn(integration)
      .then(count => {
        console.log(`✅ Sync ${integration.platform} completado: ${count} órdenes`);
        return Integration.findByIdAndUpdate(integration._id, { lastSyncAt: new Date(), errorLog: '' });
      })
      .catch(async err => {
        console.error(`❌ Sync ${integration.platform} error:`, err.message);
        await Integration.findByIdAndUpdate(integration._id, { errorLog: err.message, status: 'error' });
      });
  } catch (e) { res.status(500).json({ error: 'Error interno' }); }
});

// ════════════════════════════════════════════════════════════
//  WEBHOOKS UNIVERSALES — /webhook/:platform/:secret
//
//  El webhookSecret es el router multi-tenant.
//  Un solo lookup de DB identifica userId + platform.
// ════════════════════════════════════════════════════════════

// Handler genérico reutilizable
async function handleWebhook(platform, secret, getCanonical) {
  const integration = await Integration.findOne({
    platform,
    webhookSecret: secret,
    status: 'active',
  });
  if (!integration) {
    console.warn(`⚠️  Webhook ${platform}: secret no encontrado (${secret.slice(0, 8)}...)`);
    return;
  }
  try {
    const canonical = await getCanonical(integration);
    if (canonical) await upsertOrder(integration, canonical);
  } catch (e) {
    console.error(`❌ Webhook ${platform} error:`, e.message);
  }
}

app.post('/webhook/woocommerce/:secret', async (req, res) => {
  res.status(200).send('OK');
  await handleWebhook('woocommerce', req.params.secret, () =>
    normalize.woocommerce(req.body)
  );
});

app.post('/webhook/tiendanube/:secret', async (req, res) => {
  res.status(200).send('OK');
  await handleWebhook('tiendanube', req.params.secret, async (integration) => {
    // TiendaNube solo envía el ID → fetchear la orden completa
    const token   = integration.getKey('apiToken');
    const orderId = req.body.id;
    const { data } = await axios.get(
      `https://api.tiendanube.com/v1/${integration.storeId}/orders/${orderId}`,
      { headers: { Authentication: `bearer ${token}`, 'User-Agent': 'KOI-Factura/3.0' } }
    );
    return normalize.tiendanube(data);
  });
});

app.post('/webhook/mercadolibre/:secret', async (req, res) => {
  res.status(200).send('OK');
  const { topic, resource } = req.body;
  if (!['orders_v2', 'orders'].includes(topic)) return;
  await handleWebhook('mercadolibre', req.params.secret, async (integration) => {
    const token    = await _getMLToken(integration);
    const orderUrl = resource.startsWith('http') ? resource : `https://api.mercadolibre.com${resource}`;
    const { data } = await axios.get(orderUrl, { headers: { Authorization: `Bearer ${token}` } });
    return normalize.mercadolibre(data);
  });
});

app.post('/webhook/vtex/:secret', async (req, res) => {
  res.status(200).send('OK');
  await handleWebhook('vtex', req.params.secret, () =>
    normalize.vtex(req.body)
  );
});

app.post('/webhook/empretienda/:secret', async (req, res) => {
  res.status(200).send('OK');
  await handleWebhook('empretienda', req.params.secret, () =>
    normalize.empretienda(req.body)
  );
});

app.post('/webhook/rappi/:secret', async (req, res) => {
  res.status(200).send('OK');
  await handleWebhook('rappi', req.params.secret, () =>
    normalize.rappi(req.body)
  );
});

app.post('/webhook/shopify/:secret', async (req, res) => {
  res.status(200).send('OK');
  await handleWebhook('shopify', req.params.secret, () =>
    normalize.shopify(req.body)
  );
});

// ════════════════════════════════════════════════════════════
//  API — STATS MULTI-FUENTE (/api/stats/dashboard)
//
//  Aislamiento garantizado: todas las queries incluyen userId.
// ════════════════════════════════════════════════════════════

app.get('/api/stats/dashboard', requireAuthAPI, async (req, res) => {
  try {
    const { platform, desde, hasta } = req.query;

    const match = { userId: new mongoose.Types.ObjectId(req.userId) };
    if (platform)                         match.platform = platform;
    if (desde || hasta) {
      match.createdAt = {};
      if (desde) match.createdAt.$gte = new Date(desde);
      if (hasta) match.createdAt.$lte = new Date(hasta);
    }

    const [totals, byPlatform, recent] = await Promise.all([

      // Total facturado multi-plataforma
      Order.aggregate([
        { $match: { ...match, status: { $in: ['pending_invoice', 'invoiced'] } } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),

      // Desglose por plataforma
      Order.aggregate([
        { $match: { ...match, status: { $in: ['pending_invoice', 'invoiced'] } } },
        { $group: { _id: '$platform', total: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $sort: { total: -1 } },
      ]),

      // Últimas 50 órdenes
      Order.find({ ...match })
        .sort({ createdAt: -1 })
        .limit(50)
        .select('platform externalId customerName amount currency status createdAt')
        .lean(),
    ]);

    res.json({
      ok:         true,
      totalMonto: totals[0]?.total  || 0,
      totalOrden: totals[0]?.count  || 0,
      plataformas: byPlatform,
      ultimas:     recent,
    });
  } catch (e) {
    console.error('Stats error:', e.message);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

app.get('/api/orders', requireAuthAPI, async (req, res) => {
  try {
    const { platform, status, limit = 100 } = req.query;
    const filter = { userId: req.userId };
    if (platform) filter.platform = platform;
    if (status)   filter.status   = status;
    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit), 500))
      .lean();
    res.json({ ok: true, orders });
  } catch (e) { res.status(500).json({ error: 'Error interno' }); }
});

// ════════════════════════════════════════════════════════════
//  PÁGINAS HTML — Static routing
// ════════════════════════════════════════════════════════════

const isLoggedIn = (req) => {
  try { jwt.verify(req.cookies.koi_token, JWT_SECRET); return true; }
  catch { return false; }
};

app.get('/',         (req, res) => res.redirect(isLoggedIn(req) ? '/dashboard' : '/login'));
app.get('/login',    (req, res) => isLoggedIn(req)
  ? res.redirect('/dashboard')
  : res.sendFile(path.join(__dirname, 'public', 'login.html'))
);
app.get('/dashboard', requireAuth, (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

// ════════════════════════════════════════════════════════════
//  KEEP-ALIVE — Anti cold-start para Render free tier
//
//  Cada 10 minutos hace un self-ping para mantener la instancia
//  caliente y asegurar que los webhooks no sufran cold-start delay.
// ════════════════════════════════════════════════════════════

const PING_INTERVAL = 10 * 60 * 1000; // 10 minutos

const selfPing = () => {
  if (!process.env.BASE_URL) return; // no pingear en desarrollo local
  axios.get(`${BASE}/health`, { timeout: 10_000 })
    .then(() => console.log(`🏓 Keep-alive ping OK [${new Date().toISOString()}]`))
    .catch(err => console.warn(`⚠️  Keep-alive ping failed: ${err.message}`));
};

app.get('/health', (_, res) => res.json({ status: 'ok', ts: Date.now() }));

// ════════════════════════════════════════════════════════════
//  START
// ════════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log(`🚀 KOI-Factura v3.0 corriendo en puerto ${PORT}`);
  console.log(`📡 Base URL: ${BASE}`);
  // Iniciar keep-alive después de 30s (espera que el server esté estable)
  setTimeout(() => {
    selfPing();
    setInterval(selfPing, PING_INTERVAL);
  }, 30_000);
});
// ── MOTOR DE HISTÓRICO (BULK SYNC) ──
const BULK_SYNC = {
  async woocommerce(integration) {
    const key = integration.getKey('consumerKey');
    const secret = integration.getKey('consumerSecret');
    const base = integration.storeUrl;
    let page = 1;
    let totalProcesadas = 0;

    console.log(`⏳ Iniciando sync histórico para: ${base}`);

    while (true) {
      try {
        const { data: orders } = await axios.get(`${base}/wp-json/wc/v3/orders`, {
          auth: { username: key, password: secret },
          params: { 
            per_page: 50, 
            page: page, 
            status: 'any' // Traemos todas las órdenes (completadas, procesando, etc)
          },
        });

        if (!orders || orders.length === 0) break; // No hay más páginas

        // Procesamos cada orden con el upsertOrder que ya tenés
        for (const raw of orders) {
          const canonical = normalize.woocommerce(raw);
          await upsertOrder(integration, canonical);
        }

        totalProcesadas += orders.length;
        console.log(`✅ Página ${page} procesada (${orders.length} órdenes)`);

        if (orders.length < 50) break; // Era la última página
        page++;
      } catch (error) {
        console.error(`❌ Error en página ${page}:`, error.message);
        break;
      }
    }
    return totalProcesadas;
  }
};
