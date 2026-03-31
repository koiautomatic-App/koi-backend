// ============================================================
//  KOI-FACTURA · SaaS Multi-Tenant Engine v3.1
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
//  MONGODB
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
    setTimeout(connectDB, 5000);
  }
};
connectDB();

// ════════════════════════════════════════════════════════════
//  ENCRYPTION — AES-256-GCM
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
//  SCHEMAS (Actualizados para Vinculación ARCA)
// ════════════════════════════════════════════════════════════

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
    
    // ── NUEVO: Datos para Vinculación Manual ARCA ──
    arcaUser:   { type: String }, // Generalmente el mismo CUIT
    arcaPass:   { type: String }, // Se guardará ENCRIPTADA con encrypt()
    arcaStatus: { 
      type: String, 
      default: 'sin_vincular', 
      enum: ['sin_vincular', 'pendiente', 'en_proceso', 'vinculado', 'error'] 
    },
    arcaNotas:  { type: String }, // Por si necesitas decirle algo al usuario (ej: "Clave vencida")
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

const IntegrationSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  platform: {
    type:      String,
    required: true,
    enum:      ['woocommerce', 'tiendanube', 'mercadolibre', 'empretienda', 'rappi', 'vtex', 'shopify'],
  },
  storeId:   { type: String, required: true },
  storeName: { type: String },
  storeUrl:  { type: String },
  status: {
    type:    String,
    default: 'active',
    enum:    ['active', 'paused', 'error', 'pending'],
  },
  credentials: {
    type:    mongoose.Schema.Types.Mixed,
    default: {},
  },
  webhookSecret: {
    type:    String,
    default: () => crypto.randomBytes(24).toString('hex'),
    index:   true,
  },
  lastSyncAt:  { type: Date },
  syncCursor:  { type: String },
  errorLog:    { type: String },
  initialSyncDone: { type: Boolean, default: false },
  updatedAt:   { type: Date, default: Date.now },
  createdAt:   { type: Date, default: Date.now },
}, { timestamps: false });

IntegrationSchema.index({ userId: 1, platform: 1, storeId: 1 }, { unique: true });

// Estos métodos son clave: usan la función encrypt/decrypt que ya tenés en el server
IntegrationSchema.methods.setKey = function(field, value) {
  this.credentials = { ...this.credentials, [field]: encrypt(value) };
};
IntegrationSchema.methods.getKey = function(field) {
  return decrypt(this.credentials?.[field]);
};

const Integration = mongoose.model('Integration', IntegrationSchema);

const OrderSchema = new mongoose.Schema({
  userId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  integrationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Integration' },
  platform:       { type: String, required: true },
  externalId:     { type: String, required: true },
  customerName:   { type: String, default: '' },
  customerEmail:  { type: String, default: '' },
  customerDoc:    { type: String, default: '0' },
  amount:         { type: Number, required: true },
  currency:       { type: String, default: 'ARS' },
  status: {
    type:    String,
    default: 'pending_invoice',
    enum:    ['pending_invoice', 'invoiced', 'error_data', 'error_afip', 'skipped'],
  },
  orderDate:  { type: Date },
  caeNumber:  { type: String },
  caeExpiry:  { type: Date },
  errorLog:   { type: String },
  createdAt:  { type: Date, default: Date.now },
}, { timestamps: false });

OrderSchema.index({ userId: 1, platform: 1, externalId: 1 }, { unique: true });
OrderSchema.index({ userId: 1, platform: 1, orderDate: -1 });
OrderSchema.index({ userId: 1, platform: 1, createdAt: -1 });

const Order = mongoose.model('Order', OrderSchema);
// ════════════════════════════════════════════════════════════
//  NORMALIZER
// ════════════════════════════════════════════════════════════
const ARCA_LIMIT = 380_000;
const CUIT_CF    = '99999999';

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
      // Fecha original de la orden
      orderDate:     raw.date_created ? new Date(raw.date_created) : undefined,
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
      orderDate:     raw.paid_at ? new Date(raw.paid_at) : raw.created_at ? new Date(raw.created_at) : undefined,
    };
  },

  mercadolibre(raw) {
    const doc = _cleanDoc(raw.billing_info?.doc_number || '');
    return {
      externalId:    String(raw.id),
      customerName:  raw.buyer?.nickname || '',
      customerEmail: raw.buyer?.email || '',
      customerDoc:   _resolveDoc(doc, parseFloat(raw.total_amount) || 0),
      amount:        parseFloat(raw.total_amount) || 0,
      currency:      raw.currency_id || 'ARS',
      orderDate:     raw.date_created ? new Date(raw.date_created) : undefined,
    };
  },

  vtex(raw) {
    const client = raw.clientProfileData || {};
    const doc    = _cleanDoc(client.document || client.cpf || '');
    return {
      externalId:    raw.orderId || String(raw.id),
      customerName:  `${client.firstName || ''} ${client.lastName || ''}`.trim(),
      customerEmail: client.email || '',
      customerDoc:   _resolveDoc(doc, parseFloat(raw.value) / 100 || 0),
      amount:        parseFloat(raw.value) / 100 || 0,
      currency:      raw.currencyCode || 'ARS',
      orderDate:     raw.creationDate ? new Date(raw.creationDate) : undefined,
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
      orderDate:     raw.created_at ? new Date(raw.created_at) : undefined,
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
      orderDate:     order.created_at ? new Date(order.created_at) : undefined,
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
      orderDate:     raw.created_at ? new Date(raw.created_at) : undefined,
    };
  },
};

function _cleanDoc(raw) {
  return String(raw || '').replace(/\D/g, '');
}
function _resolveDoc(doc, amount) {
  if (doc.length >= 7 && doc.length <= 11) return doc;
  return amount >= ARCA_LIMIT ? null : CUIT_CF;
}

// ════════════════════════════════════════════════════════════
//  UPSERT ENGINE
// ════════════════════════════════════════════════════════════
async function upsertOrder(integration, canonical) {
  if (!canonical) return;

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
    ).catch(() => {});
  }

  return Order.findOneAndUpdate(
    { userId: integration.userId, platform: integration.platform, externalId: canonical.externalId },
    {
      $setOnInsert: {
        userId:        integration.userId,
        integrationId: integration._id,
        platform:      integration.platform,
        ...canonical,
        status: 'pending_invoice',
      },
    },
    { upsert: true, new: false }
  ).catch(err => {
    if (err.code !== 11000)
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

const requireAuth = (req, res, next) => {
  try {
    req.userId = jwt.verify(req.cookies.koi_token, JWT_SECRET).id;
    next();
  } catch {
    res.clearCookie('koi_token');
    res.redirect('/login');
  }
};

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

app.get('/api/integrations', requireAuthAPI, async (req, res) => {
  const list = await Integration.find({ userId: req.userId })
    .select('-credentials -webhookSecret')
    .lean();
  res.json({ ok: true, integrations: list });
});

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

app.delete('/api/integrations/:id', requireAuthAPI, async (req, res) => {
  try {
    const doc = await Integration.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!doc) return res.status(404).json({ error: 'Integración no encontrada' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Error interno' }); }
});

app.get('/api/integrations/:id/webhook', requireAuthAPI, async (req, res) => {
  const doc = await Integration.findOne({ _id: req.params.id, userId: req.userId })
    .select('platform webhookSecret');
  if (!doc) return res.status(404).json({ error: 'No encontrada' });
  res.json({ ok: true, url: `${BASE}/webhook/${doc.platform}/${doc.webhookSecret}` });
});

// ── Conectar Token-Based ──────────────────────────────────
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
          storeName:   storeName || `${platform} ${storeId}`,
          storeUrl:    storeUrl || '',
          status:      'active',
          errorLog:    '',
          credentials: creds,
          updatedAt:   new Date(),
          // Resetear flag para re-sincronizar al reconectar
          initialSyncDone: false,
        },
        $setOnInsert: {
          userId:    req.userId,
          platform,
          storeId:   String(storeId),
          createdAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    // Registrar webhook si aplica
    if (platform === 'tiendanube' && apiToken) {
      await _registerWebhookTiendaNube(integration, apiToken).catch(console.warn);
    }

    // ── NUEVO: disparar sync histórico completo en background ──
    _dispararSyncHistorico(integration);

    res.json({ ok: true, message: `${platform} conectado correctamente. Sincronizando historial...` });
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
  res.status(200).json({ status: 'ok' });

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
          initialSyncDone: false,
          updatedAt: new Date(),
        },
        $setOnInsert: { userId, platform: 'woocommerce', storeId: storeUrl, createdAt: new Date() },
      },
      { upsert: true, new: true }
    );

    await _registerWebhookWoo(integration, consumer_key, consumer_secret, storeUrl);

    // ── NUEVO: sync histórico completo ──
    _dispararSyncHistorico(integration);

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
    { headers: { Authentication: `bearer ${apiToken}`, 'User-Agent': 'KOI-Factura/3.1' } }
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

    const integration = await Integration.findOneAndUpdate(
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
          initialSyncDone: false,
          updatedAt: new Date(),
        },
        $setOnInsert: { userId, platform: 'mercadolibre', storeId: sellerId, createdAt: new Date() },
      },
      { upsert: true, new: true }
    );

    // ── NUEVO: sync histórico completo ──
    _dispararSyncHistorico(integration);

    console.log(`✅ MercadoLibre conectado: seller ${sellerId} → usuario ${userId}`);
    res.redirect('/dashboard?ml=connected');
  } catch (e) {
    console.error('ML callback:', e.response?.data || e.message);
    res.redirect('/dashboard?error=ml_failed');
  }
});

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
//  BULK SYNC ENGINE — Historial completo por plataforma
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
        // Sin filtro de status para traer TODAS las órdenes históricas
        params: { per_page: 100, page, orderby: 'date', order: 'desc' },
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
          headers: { Authentication: `bearer ${token}`, 'User-Agent': 'KOI-Factura/3.1' },
          // Sin filtro de payment_status para traer todo el historial
          params:  { per_page: 200, page },
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
    const LIMIT       = 50;

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
    const storeUrl  = integration.storeUrl;
    let   page      = 1;
    let   total     = 0;
    const PER_PAGE  = 100;

    while (true) {
      const { data } = await axios.get(`${storeUrl}/api/oms/pvt/orders`, {
        headers: {
          'X-VTEX-API-AppKey':   apiKey,
          'X-VTEX-API-AppToken': apiToken,
        },
        params: { page, per_page: PER_PAGE },
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

// ── Helper centralizado: disparar sync histórico ──────────
//  Se llama siempre que una integración se conecta/reconecta.
//  Marca initialSyncDone=true cuando termina exitosamente.
async function _dispararSyncHistorico(integration) {
  const syncFn = BULK_SYNC[integration.platform];
  if (!syncFn) {
    console.warn(`⚠️  No hay sync para ${integration.platform}`);
    return;
  }

  console.log(`🔄 Iniciando sync histórico: ${integration.platform} / ${integration.storeId}`);

  try {
    const count = await syncFn(integration);
    await Integration.findByIdAndUpdate(integration._id, {
      lastSyncAt:      new Date(),
      errorLog:        '',
      initialSyncDone: true,
    });
    console.log(`✅ Sync histórico ${integration.platform}: ${count} órdenes importadas`);
  } catch (err) {
    console.error(`❌ Sync histórico ${integration.platform} error:`, err.message);
    await Integration.findByIdAndUpdate(integration._id, {
      errorLog: `Sync error: ${err.message}`,
      status:   'error',
    });
  }
}

// ── Sync manual desde dashboard ───────────────────────────
app.post('/api/integrations/:id/sync', requireAuthAPI, async (req, res) => {
  try {
    const integration = await Integration.findOne({ _id: req.params.id, userId: req.userId });
    if (!integration) return res.status(404).json({ error: 'No encontrada' });
    if (integration.status !== 'active') return res.status(400).json({ error: 'Integración inactiva' });

    const syncFn = BULK_SYNC[integration.platform];
    if (!syncFn) return res.status(400).json({ error: `Sync no disponible para ${integration.platform}` });

    res.json({ ok: true, message: 'Sincronización iniciada en background' });

    syncFn(integration)
      .then(count => {
        console.log(`✅ Sync manual ${integration.platform}: ${count} órdenes`);
        return Integration.findByIdAndUpdate(integration._id, { lastSyncAt: new Date(), errorLog: '' });
      })
      .catch(async err => {
        console.error(`❌ Sync manual ${integration.platform} error:`, err.message);
        await Integration.findByIdAndUpdate(integration._id, { errorLog: err.message, status: 'error' });
      });
  } catch (e) { res.status(500).json({ error: 'Error interno' }); }
});

// ════════════════════════════════════════════════════════════
//  WEBHOOKS UNIVERSALES
// ════════════════════════════════════════════════════════════

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
    const token   = integration.getKey('apiToken');
    const orderId = req.body.id;
    const { data } = await axios.get(
      `https://api.tiendanube.com/v1/${integration.storeId}/orders/${orderId}`,
      { headers: { Authentication: `bearer ${token}`, 'User-Agent': 'KOI-Factura/3.1' } }
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
  await handleWebhook('vtex', req.params.secret, () => normalize.vtex(req.body));
});

app.post('/webhook/empretienda/:secret', async (req, res) => {
  res.status(200).send('OK');
  await handleWebhook('empretienda', req.params.secret, () => normalize.empretienda(req.body));
});

app.post('/webhook/rappi/:secret', async (req, res) => {
  res.status(200).send('OK');
  await handleWebhook('rappi', req.params.secret, () => normalize.rappi(req.body));
});

app.post('/webhook/shopify/:secret', async (req, res) => {
  res.status(200).send('OK');
  await handleWebhook('shopify', req.params.secret, () => normalize.shopify(req.body));
});

// ════════════════════════════════════════════════════════════
//  API — STATS CON FILTRO DE PERÍODO
//
//  Query params opcionales:
//    ?desde=YYYY-MM-DD   (inicio del período, inclusive)
//    ?hasta=YYYY-MM-DD   (fin del período, inclusive)
//    ?platform=xxx
//
//  El filtro se aplica sobre `orderDate` (fecha original de la
//  venta en la plataforma). Si orderDate es null cae en createdAt
//  como fallback.
// ════════════════════════════════════════════════════════════

app.get('/api/stats/dashboard', requireAuthAPI, async (req, res) => {
  try {
    const { platform, desde, hasta } = req.query;

    const match = { userId: new mongoose.Types.ObjectId(req.userId) };

    if (platform) match.platform = platform;

    // ── Filtro de período sobre orderDate (con fallback a createdAt) ──
    if (desde || hasta) {
      const dateFilter = {};
      if (desde) dateFilter.$gte = new Date(desde);
      // hasta: incluir todo el día hasta las 23:59:59
      if (hasta) {
        const h = new Date(hasta);
        h.setHours(23, 59, 59, 999);
        dateFilter.$lte = h;
      }

      // Usamos $or para cubrir órdenes con y sin orderDate
      match.$or = [
        { orderDate: dateFilter },
        // Fallback: si no tiene orderDate, usar createdAt
        { orderDate: { $exists: false }, createdAt: dateFilter },
        { orderDate: null,               createdAt: dateFilter },
      ];
    }

    // ── Fecha de inicio del día de hoy (para métrica "hoy") ──
    const hoyStart = new Date();
    hoyStart.setHours(0, 0, 0, 0);
    const hoyEnd = new Date();
    hoyEnd.setHours(23, 59, 59, 999);

    // ── Filtro exclusivo para métrica "hoy" dentro del período ──
    const matchHoy = {
      userId:   new mongoose.Types.ObjectId(req.userId),
      status:   { $in: ['pending_invoice', 'invoiced'] },
      $or: [
        { orderDate: { $gte: hoyStart, $lte: hoyEnd } },
        { orderDate: { $exists: false }, createdAt: { $gte: hoyStart, $lte: hoyEnd } },
        { orderDate: null, createdAt: { $gte: hoyStart, $lte: hoyEnd } },
      ],
    };
    if (platform) matchHoy.platform = platform;

    const [totals, byPlatform, recent, hoyAgg, pendientesCount] = await Promise.all([

      // Total del período seleccionado (facturas emitidas + pendientes)
      Order.aggregate([
        { $match: { ...match, status: { $in: ['pending_invoice', 'invoiced'] } } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),

      // Total FACTURADO del período (solo invoiced)
      Order.aggregate([
        { $match: { ...match, status: 'invoiced' } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),

      // Últimas 100 órdenes del período para el chart y bandeja
      Order.find({ ...match })
        .sort({ orderDate: -1, createdAt: -1 })
        .limit(100)
        .select('platform externalId customerName amount currency status createdAt orderDate')
        .lean(),

      // Monto de hoy
      Order.aggregate([
        { $match: matchHoy },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),

      // Pendientes de facturar en el período
      Order.countDocuments({ ...match, status: 'pending_invoice' }),
    ]);

    // Desglose por plataforma (período)
    const platformBreakdown = await Order.aggregate([
      { $match: { ...match, status: { $in: ['pending_invoice', 'invoiced'] } } },
      { $group: { _id: '$platform', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]);

    res.json({
      ok:            true,
      // Ingresos totales del período (pagadas + pendientes de facturar)
      totalMonto:    totals[0]?.total     || 0,
      totalOrden:    totals[0]?.count     || 0,
      // Solo las efectivamente FACTURADAS (con CAE) del período
      facturadoMonto: byPlatform[0]?.total || 0,
      facturadoCount: byPlatform[0]?.count || 0,
      // Hoy
      hoyMonto:      hoyAgg[0]?.total    || 0,
      hoyCount:      hoyAgg[0]?.count    || 0,
      // Pendientes
      pendientes:    pendientesCount      || 0,
      plataformas:   platformBreakdown,
      ultimas:       recent,
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
      .sort({ orderDate: -1, createdAt: -1 })
      .limit(Math.min(parseInt(limit), 500))
      .lean();
    res.json({ ok: true, orders });
  } catch (e) { res.status(500).json({ error: 'Error interno' }); }
});

// ════════════════════════════════════════════════════════════
//  PÁGINAS HTML
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
//  KEEP-ALIVE
// ════════════════════════════════════════════════════════════

const PING_INTERVAL = 10 * 60 * 1000;

const selfPing = () => {
  if (!process.env.BASE_URL) return;
  axios.get(`${BASE}/health`, { timeout: 10_000 })
    .then(() => console.log(`🏓 Keep-alive ping OK [${new Date().toISOString()}]`))
    .catch(err => console.warn(`⚠️  Keep-alive ping failed: ${err.message}`));
};

app.get('/health', (_, res) => res.json({ status: 'ok', ts: Date.now() }));

app.listen(PORT, () => {
  console.log(`🚀 KOI-Factura v3.1 corriendo en puerto ${PORT}`);
  console.log(`📡 Base URL: ${BASE}`);
  setTimeout(() => {
    selfPing();
    setInterval(selfPing, PING_INTERVAL);
  }, 30_000);
});
