// ============================================================
//  KOI-FACTURA · Backend Multi-Usuario
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

// ── MONGODB ───────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('🐟 KOI: MongoDB conectado'))
  .catch(err => console.error('❌ MongoDB error:', err));

// ════════════════════════════════════════════════════════════
//  SCHEMAS Y MODELOS
// ════════════════════════════════════════════════════════════

// ── USER ─────────────────────────────────────────────────────
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
UserSchema.pre('save', async function(next) {
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});
UserSchema.methods.verificarPassword = function(pwd) {
  return bcrypt.compare(pwd, this.password);
};
const User = mongoose.model('User', UserSchema);

// ── INTEGRATIONS ─────────────────────────────────────────────
//
//  Una integración = una tienda conectada a un usuario.
//  Soporta: woocommerce | tiendanube | empretienda | mercadolibre | rappi
//
//  Estrategia de seguridad para tokens:
//  - Los access tokens se guardan encriptados con AES-256-GCM
//  - Solo se desencriptan cuando se necesitan hacer llamadas a la API
//  - Nunca se exponen en respuestas JSON al frontend

const ENCRYPTION_KEY = Buffer.from(
  process.env.ENCRYPTION_KEY || 'koi0000000000000000000000000000k', // 32 bytes
  'utf8'
).slice(0, 32);

function encrypt(text) {
  const iv         = crypto.randomBytes(12);
  const cipher     = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted  = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag    = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(payload) {
  const [ivHex, tagHex, encHex] = payload.split(':');
  const iv        = Buffer.from(ivHex, 'hex');
  const authTag   = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(encHex, 'hex');
  const decipher  = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

const IntegrationSchema = new mongoose.Schema({
  // Referencia al usuario dueño de la integración
  userId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
    index:    true,
  },

  // Plataforma
  platform: {
    type:     String,
    required: true,
    enum:     ['woocommerce', 'tiendanube', 'empretienda', 'mercadolibre', 'rappi'],
  },

  // Identificador único de la tienda dentro de la plataforma
  // WooCommerce  → URL de la tienda (ej: "https://mitienda.com")
  // MercadoLibre → seller_id del usuario
  // TiendaNube   → store_id numérico
  // Empretienda  → slug de la tienda
  // Rappi        → restaurant_id
  storeId:   { type: String, required: true },
  storeName: { type: String },       // nombre amigable para mostrar en UI
  storeUrl:  { type: String },       // URL pública de la tienda (si aplica)

  // Estado de la conexión
  status: {
    type:    String,
    default: 'active',
    enum:    ['active', 'error', 'revoked', 'pending'],
  },

  // Credenciales — SIEMPRE encriptadas en reposo
  credentials: {
    // OAuth (WooCommerce, MercadoLibre)
    accessToken:  { type: String },   // encriptado
    refreshToken: { type: String },   // encriptado
    tokenExpiry:  { type: Date },

    // API Keys (WooCommerce básico, TiendaNube, Empretienda)
    consumerKey:    { type: String }, // encriptado
    consumerSecret: { type: String }, // encriptado
    apiToken:       { type: String }, // encriptado — para TiendaNube / Empretienda

    // Identificadores de plataforma
    sellerId:   { type: String },   // MercadoLibre seller ID
    storeNumId: { type: String },   // TiendaNube store numeric ID
  },

  // Webhook — token único para verificar que el webhook viene de esta tienda
  // Se genera al crear la integración y se incluye en la URL del webhook
  webhookSecret: {
    type:    String,
    default: () => crypto.randomBytes(24).toString('hex'),
  },

  // Metadatos
  lastSyncAt: { type: Date },
  errorLog:   { type: String },
  createdAt:  { type: Date, default: Date.now },
  updatedAt:  { type: Date, default: Date.now },
});

// Índice compuesto: un usuario no puede tener dos integraciones
// de la misma plataforma para la misma tienda
IntegrationSchema.index({ userId: 1, platform: 1, storeId: 1 }, { unique: true });

IntegrationSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Helper: guardar credencial encriptada
IntegrationSchema.methods.setCredential = function(field, value) {
  if (value) this.credentials[field] = encrypt(value);
};

// Helper: leer credencial desencriptada
IntegrationSchema.methods.getCredential = function(field) {
  const val = this.credentials[field];
  if (!val) return null;
  try { return decrypt(val); } catch(e) { return null; }
};

const Integration = mongoose.model('Integration', IntegrationSchema);

// ── ORDER ─────────────────────────────────────────────────────
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
  status: {
    type:    String,
    default: 'pending_invoice',
    enum:    ['pending_invoice', 'invoiced', 'error_data', 'error_afip', 'skipped'],
  },
  caeNumber:  { type: String },
  caeExpiry:  { type: Date },
  errorLog:   { type: String },
  rawPayload: { type: mongoose.Schema.Types.Mixed }, // payload original del webhook
  createdAt:  { type: Date, default: Date.now },
});
// Evitar duplicados: una orden de una plataforma solo se procesa una vez por usuario
OrderSchema.index({ userId: 1, platform: 1, externalId: 1 }, { unique: true });

const Order = mongoose.model('Order', OrderSchema);

// ════════════════════════════════════════════════════════════
//  HELPERS AUTH
// ════════════════════════════════════════════════════════════

function generarToken(userId) {
  return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '7d' });
}
function setAuthCookie(res, token) {
  res.cookie('koi_token', token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   7*24*60*60*1000,
  });
}
function requireAuth(req, res, next) {
  const token = req.cookies.koi_token;
  if (!token) return res.redirect('/login');
  try { req.userId = jwt.verify(token, JWT_SECRET).id; next(); }
  catch(e) { res.clearCookie('koi_token'); res.redirect('/login'); }
}
function requireAuthAPI(req, res, next) {
  const token = req.cookies.koi_token
    || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try { req.userId = jwt.verify(token, JWT_SECRET).id; next(); }
  catch(e) { res.status(401).json({ error: 'Token inválido o expirado' }); }
}

// ── PASSPORT GOOGLE ───────────────────────────────────────────
passport.use(new GoogleStrategy({
  clientID:     process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL:  `${BASE}/auth/google/callback`,
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails?.[0]?.value?.toLowerCase();
    if (!email) return done(new Error('No se obtuvo email de Google'));
    let user = await User.findOne({ $or: [{ googleId: profile.id }, { email }] });
    if (!user) {
      user = await User.create({
        googleId: profile.id, email,
        nombre:   profile.name?.givenName  || '',
        apellido: profile.name?.familyName || '',
        avatar:   profile.photos?.[0]?.value || '',
      });
    } else if (!user.googleId) {
      user.googleId = profile.id;
      user.avatar   = profile.photos?.[0]?.value || user.avatar;
    }
    user.ultimoAcceso = new Date();
    await user.save();
    done(null, user);
  } catch(e) { done(e); }
}));
passport.serializeUser((user, done)   => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try { done(null, await User.findById(id)); } catch(e) { done(e); }
});

// ════════════════════════════════════════════════════════════
//  RUTAS AUTH (Login/Register/Google)
// ════════════════════════════════════════════════════════════

app.get('/auth/google', passport.authenticate('google', { scope: ['profile','email'] }));
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=auth_failed' }),
  (req, res) => { setAuthCookie(res, generarToken(req.user.id)); res.redirect('/dashboard'); }
);

app.post('/auth/register', async (req, res) => {
  try {
    const { nombre, apellido, email, password } = req.body;
    if (!email || !password || !nombre)
      return res.status(400).json({ error: 'Faltan campos obligatorios.' });
    if (password.length < 8)
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
    if (await User.findOne({ email: email.toLowerCase() }))
      return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });
    const user = await User.create({ nombre, apellido, email, password });
    setAuthCookie(res, generarToken(user.id));
    res.json({ ok: true, user: { nombre: user.nombre, email: user.email } });
  } catch(e) { console.error('Register:', e); res.status(500).json({ error: 'Error interno.' }); }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Completá email y contraseña.' });
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !user.password)
      return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
    if (!await user.verificarPassword(password))
      return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
    user.ultimoAcceso = new Date();
    await user.save();
    setAuthCookie(res, generarToken(user.id));
    res.json({ ok: true, user: { nombre: user.nombre, email: user.email } });
  } catch(e) { console.error('Login:', e); res.status(500).json({ error: 'Error interno.' }); }
});

app.get('/auth/logout', (req, res) => {
  req.logout?.(() => {});
  res.clearCookie('koi_token');
  res.redirect('/login');
});

app.get('/api/me', requireAuthAPI, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ ok: true, user });
  } catch(e) { res.status(500).json({ error: 'Error interno' }); }
});

// ════════════════════════════════════════════════════════════
//  RUTAS INTEGRACIONES — /api/integrations
// ════════════════════════════════════════════════════════════

// GET — listar integraciones del usuario (sin exponer tokens)
app.get('/api/integrations', requireAuthAPI, async (req, res) => {
  try {
    const integrations = await Integration.find({ userId: req.userId })
      .select('-credentials -webhookSecret')
      .lean();
    res.json({ ok: true, integrations });
  } catch(e) { res.status(500).json({ error: 'Error interno' }); }
});

// DELETE — desconectar integración
app.delete('/api/integrations/:id', requireAuthAPI, async (req, res) => {
  try {
    const integration = await Integration.findOne({ _id: req.params.id, userId: req.userId });
    if (!integration) return res.status(404).json({ error: 'Integración no encontrada' });
    await integration.deleteOne();
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Error interno' }); }
});

// ── TIENDA NUBE: guardar API Token ─────────────────────────
app.post('/api/integrations/tiendanube', requireAuthAPI, async (req, res) => {
  try {
    const { storeNumId, storeName, apiToken } = req.body;
    if (!storeNumId || !apiToken)
      return res.status(400).json({ error: 'Faltan storeNumId y apiToken.' });

    // Verificar que el token es válido consultando la API de TiendaNube
    const tnRes = await axios.get(
      `https://api.tiendanube.com/v1/${storeNumId}/store`,
      { headers: { Authentication: `bearer ${apiToken}`, 'User-Agent': 'KOI-Factura' } }
    ).catch(() => null);

    if (!tnRes || tnRes.status !== 200)
      return res.status(401).json({ error: 'Token inválido o sin acceso a esa tienda.' });

    const store = tnRes.data;
    const integration = await Integration.findOneAndUpdate(
      { userId: req.userId, platform: 'tiendanube', storeId: storeNumId.toString() },
      {
        userId:     req.userId,
        platform:   'tiendanube',
        storeId:    storeNumId.toString(),
        storeName:  storeName || store.name?.es || `TiendaNube ${storeNumId}`,
        storeUrl:   store.main_domain || '',
        status:     'active',
        errorLog:   '',
        'credentials.storeNumId': storeNumId,
        'credentials.apiToken':   encrypt(apiToken),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Registrar webhook en TiendaNube
    await _registrarWebhookTiendaNube(integration, apiToken, storeNumId);

    res.json({ ok: true, message: 'TiendaNube conectada correctamente.' });
  } catch(e) { console.error('TiendaNube connect:', e.message); res.status(500).json({ error: 'Error interno.' }); }
});

async function _registrarWebhookTiendaNube(integration, apiToken, storeNumId) {
  const webhookUrl = `${BASE}/webhook/tiendanube/${integration.webhookSecret}`;
  try {
    await axios.post(
      `https://api.tiendanube.com/v1/${storeNumId}/webhooks`,
      { event: 'order/paid', url: webhookUrl },
      { headers: { Authentication: `bearer ${apiToken}`, 'User-Agent': 'KOI-Factura' } }
    );
    console.log(`🔌 TiendaNube webhook registrado para tienda ${storeNumId}`);
  } catch(e) {
    console.warn('TiendaNube webhook (puede ya existir):', e.response?.data?.description || e.message);
  }
}

// ── EMPRETIENDA: guardar API Token ─────────────────────────
app.post('/api/integrations/empretienda', requireAuthAPI, async (req, res) => {
  try {
    const { storeSlug, storeName, apiToken } = req.body;
    if (!storeSlug || !apiToken)
      return res.status(400).json({ error: 'Faltan storeSlug y apiToken.' });

    await Integration.findOneAndUpdate(
      { userId: req.userId, platform: 'empretienda', storeId: storeSlug },
      {
        userId:    req.userId,
        platform:  'empretienda',
        storeId:   storeSlug,
        storeName: storeName || `Empretienda ${storeSlug}`,
        storeUrl:  `https://${storeSlug}.empretienda.com.ar`,
        status:    'active',
        'credentials.apiToken': encrypt(apiToken),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ ok: true, message: 'Empretienda conectada correctamente.' });
  } catch(e) { res.status(500).json({ error: 'Error interno.' }); }
});

// ── RAPPI: guardar API Token ────────────────────────────────
app.post('/api/integrations/rappi', requireAuthAPI, async (req, res) => {
  try {
    const { restaurantId, storeName, apiToken } = req.body;
    if (!restaurantId || !apiToken)
      return res.status(400).json({ error: 'Faltan restaurantId y apiToken.' });

    await Integration.findOneAndUpdate(
      { userId: req.userId, platform: 'rappi', storeId: restaurantId.toString() },
      {
        userId:    req.userId,
        platform:  'rappi',
        storeId:   restaurantId.toString(),
        storeName: storeName || `Rappi ${restaurantId}`,
        status:    'active',
        'credentials.apiToken': encrypt(apiToken),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ ok: true, message: 'Rappi conectado correctamente.' });
  } catch(e) { res.status(500).json({ error: 'Error interno.' }); }
});

// ════════════════════════════════════════════════════════════
//  WOOCOMMERCE OAUTH — Flujo completo multi-usuario
// ════════════════════════════════════════════════════════════

// PASO 1 — El usuario ingresa la URL de su tienda en el dashboard.
// El dashboard hace GET /auth/woo/connect?store_url=...
// El servidor redirige a WooCommerce para que el owner autorice.
// Guardamos el userId en un state token firmado para recuperarlo en el callback.

app.get('/auth/woo/connect', requireAuth, (req, res) => {
  const { store_url } = req.query;
  if (!store_url) return res.status(400).json({ error: 'Falta store_url' });

  const cleanUrl = store_url.replace(/\/$/, '').toLowerCase();

  // Firmamos el userId + storeUrl en el state para recuperarlos en el callback
  // WooCommerce pasa el state de vuelta en user_id pero usamos callback_url query param
  const stateToken = jwt.sign(
    { userId: req.userId, storeUrl: cleanUrl },
    JWT_SECRET,
    { expiresIn: '15m' }  // el usuario tiene 15 min para autorizar
  );

  const callback_url = `${BASE}/auth/woo/callback?state=${encodeURIComponent(stateToken)}`;

  const auth_url = [
    `${cleanUrl}/wc-auth/v1/authorize`,
    `?app_name=KOI-Factura`,
    `&scope=read_write`,
    `&user_id=${req.userId}`,
    `&return_url=${encodeURIComponent(BASE + '/dashboard?woo=connected')}`,
    `&callback_url=${encodeURIComponent(callback_url)}`,
  ].join('');

  res.redirect(auth_url);
});

// PASO 2 — WooCommerce hace POST al callback con las credenciales.
// Identificamos al usuario desde el state token y guardamos las keys.

app.post('/auth/woo/callback', async (req, res) => {
  // Responder inmediatamente a WooCommerce (espera 200 rápido)
  res.status(200).json({ status: 'success' });

  const { state } = req.query;
  const keys = req.body; // { consumer_key, consumer_secret, key_permissions, user_id }

  try {
    // Verificar y decodificar el state token
    let decoded;
    try {
      decoded = jwt.verify(state, JWT_SECRET);
    } catch(e) {
      return console.error('❌ WooCommerce callback: state token inválido o expirado', e.message);
    }

    const { userId, storeUrl } = decoded;

    // Crear/actualizar la integración vinculada al usuario correcto
    const integration = await Integration.findOneAndUpdate(
      { userId, platform: 'woocommerce', storeId: storeUrl },
      {
        userId,
        platform:  'woocommerce',
        storeId:   storeUrl,
        storeName: storeUrl.replace(/^https?:\/\//, ''),
        storeUrl:  storeUrl,
        status:    'active',
        errorLog:  '',
        'credentials.consumerKey':    encrypt(keys.consumer_key),
        'credentials.consumerSecret': encrypt(keys.consumer_secret),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Registrar webhook en la tienda WooCommerce
    await _registrarWebhookWoo(integration, keys.consumer_key, keys.consumer_secret, storeUrl);

    console.log(`✅ WooCommerce integrado: ${storeUrl} → usuario ${userId}`);
  } catch(e) {
    console.error('❌ WooCommerce callback error:', e.message);
  }
});

async function _registrarWebhookWoo(integration, consumerKey, consumerSecret, storeUrl) {
  const webhookUrl = `${BASE}/webhook/woocommerce/${integration.webhookSecret}`;
  try {
    // Primero verificar si ya existe un webhook de KOI
    const existing = await axios.get(`${storeUrl}/wp-json/wc/v3/webhooks`, {
      auth: { username: consumerKey, password: consumerSecret },
      params: { per_page: 100 }
    });
    const alreadyExists = existing.data?.some(wh => wh.delivery_url === webhookUrl);
    if (alreadyExists) return console.log(`ℹ️  Webhook WooCommerce ya existe para ${storeUrl}`);

    await axios.post(`${storeUrl}/wp-json/wc/v3/webhooks`, {
      name:         'KOI - Facturación Automática',
      topic:        'order.created',
      delivery_url: webhookUrl,
      status:       'active',
      secret:       integration.webhookSecret,
    }, { auth: { username: consumerKey, password: consumerSecret } });

    console.log(`🔌 Webhook WooCommerce registrado: ${storeUrl}`);
  } catch(e) {
    console.error('❌ Error registrando webhook WooCommerce:', e.response?.data?.message || e.message);
    await Integration.findByIdAndUpdate(integration._id, {
      errorLog: `Error webhook: ${e.message}`,
    });
  }
}

// ════════════════════════════════════════════════════════════
//  MERCADOLIBRE OAUTH
// ════════════════════════════════════════════════════════════

// PASO 1 — Redirigir al usuario a MercadoLibre para autorizar
app.get('/auth/ml/connect', requireAuth, (req, res) => {
  const stateToken = jwt.sign({ userId: req.userId }, JWT_SECRET, { expiresIn: '15m' });
  const mlUrl = [
    'https://auth.mercadolibre.com.ar/authorization',
    `?response_type=code`,
    `&client_id=${process.env.ML_CLIENT_ID}`,
    `&redirect_uri=${encodeURIComponent(BASE + '/auth/ml/callback')}`,
    `&state=${encodeURIComponent(stateToken)}`,
  ].join('');
  res.redirect(mlUrl);
});

// PASO 2 — ML redirige con el code, intercambiamos por access_token
app.get('/auth/ml/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.redirect('/dashboard?error=ml_denied');

  try {
    const decoded = jwt.verify(state, JWT_SECRET);
    const { userId } = decoded;

    // Intercambiar code por access_token
    const tokenRes = await axios.post('https://api.mercadolibre.com/oauth/token', {
      grant_type:    'authorization_code',
      client_id:     process.env.ML_CLIENT_ID,
      client_secret: process.env.ML_CLIENT_SECRET,
      code,
      redirect_uri:  `${BASE}/auth/ml/callback`,
    });

    const { access_token, refresh_token, expires_in, user_id: sellerId } = tokenRes.data;

    // Obtener info del seller
    const userRes = await axios.get('https://api.mercadolibre.com/users/me', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const storeName = userRes.data.nickname || `MercadoLibre ${sellerId}`;

    const tokenExpiry = new Date(Date.now() + expires_in * 1000);

    await Integration.findOneAndUpdate(
      { userId, platform: 'mercadolibre', storeId: sellerId.toString() },
      {
        userId,
        platform:   'mercadolibre',
        storeId:    sellerId.toString(),
        storeName,
        status:     'active',
        errorLog:   '',
        'credentials.accessToken':  encrypt(access_token),
        'credentials.refreshToken': encrypt(refresh_token),
        'credentials.sellerId':     sellerId.toString(),
        'credentials.tokenExpiry':  tokenExpiry,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(`✅ MercadoLibre integrado: seller ${sellerId} → usuario ${userId}`);
    res.redirect('/dashboard?ml=connected');
  } catch(e) {
    console.error('❌ ML callback error:', e.response?.data || e.message);
    res.redirect('/dashboard?error=ml_failed');
  }
});

// Helper: refrescar token de MercadoLibre si está por vencer
async function _getMLToken(integration) {
  const expiry = integration.credentials.tokenExpiry;
  const accessToken = integration.getCredential('accessToken');

  // Si vence en menos de 10 minutos, refrescar
  if (expiry && new Date(expiry) < new Date(Date.now() + 10 * 60 * 1000)) {
    const refreshToken = integration.getCredential('refreshToken');
    const res = await axios.post('https://api.mercadolibre.com/oauth/token', {
      grant_type:    'refresh_token',
      client_id:     process.env.ML_CLIENT_ID,
      client_secret: process.env.ML_CLIENT_SECRET,
      refresh_token: refreshToken,
    });
    const { access_token, refresh_token: new_refresh, expires_in } = res.data;
    integration.credentials.accessToken  = encrypt(access_token);
    integration.credentials.refreshToken = encrypt(new_refresh);
    integration.credentials.tokenExpiry  = new Date(Date.now() + expires_in * 1000);
    await integration.save();
    return access_token;
  }
  return accessToken;
}

// ════════════════════════════════════════════════════════════
//  WEBHOOK UNIVERSAL — /webhook/:platform/:secret
//
//  El webhookSecret único por integración es la clave del sistema.
//  - Cada tienda conectada genera un webhookSecret aleatorio de 48 chars.
//  - La URL del webhook que registramos en cada plataforma incluye ese secret.
//  - Al recibir un webhook, buscamos la integración por ese secret.
//  - Así sabemos EXACTAMENTE a qué usuario pertenece la orden.
//  - No necesitamos parsear headers ni verificar firmas adicionales
//    (aunque también podemos hacerlo como segunda capa de seguridad).
// ════════════════════════════════════════════════════════════

// Normalizador de órdenes: transforma el payload crudo de cada plataforma
// en un objeto estándar que el procesador de facturas puede manejar.
function normalizeOrder(platform, rawPayload) {
  switch(platform) {

    case 'woocommerce': {
      const b = rawPayload.billing || {};
      let doc = (b.dni || b.identification || b.cpf || '').replace(/\D/g, '');
      if (!doc || doc.length < 7) doc = '0';  // consumidor final
      return {
        externalId:    rawPayload.id?.toString(),
        customerName:  `${b.first_name || ''} ${b.last_name || ''}`.trim(),
        customerEmail: b.email || '',
        customerDoc:   doc,
        amount:        parseFloat(rawPayload.total) || 0,
        currency:      rawPayload.currency || 'ARS',
      };
    }

    case 'tiendanube': {
      const contact = rawPayload.contact || {};
      const doc = (rawPayload.billing_info?.document || '').replace(/\D/g, '') || '0';
      return {
        externalId:    rawPayload.id?.toString(),
        customerName:  `${contact.name || ''}`.trim(),
        customerEmail: contact.email || '',
        customerDoc:   doc,
        amount:        parseFloat(rawPayload.total) || 0,
        currency:      rawPayload.currency || 'ARS',
      };
    }

    case 'empretienda': {
      return {
        externalId:    rawPayload.order_id?.toString() || rawPayload.id?.toString(),
        customerName:  rawPayload.customer?.name || '',
        customerEmail: rawPayload.customer?.email || '',
        customerDoc:   (rawPayload.customer?.dni || '').replace(/\D/g, '') || '0',
        amount:        parseFloat(rawPayload.total_price || rawPayload.total) || 0,
        currency:      'ARS',
      };
    }

    case 'mercadolibre': {
      // ML envía notificaciones, luego hay que fetchear la orden
      return {
        externalId:    rawPayload.id?.toString() || rawPayload.resource?.split('/').pop(),
        customerName:  rawPayload.buyer?.nickname || '',
        customerEmail: rawPayload.buyer?.email || '',
        customerDoc:   '0',  // ML no comparte DNI, se pide al comprador post-venta
        amount:        parseFloat(rawPayload.total_amount) || 0,
        currency:      rawPayload.currency_id || 'ARS',
      };
    }

    case 'rappi': {
      return {
        externalId:    rawPayload.order?.id?.toString() || rawPayload.id?.toString(),
        customerName:  rawPayload.order?.user?.name || '',
        customerEmail: rawPayload.order?.user?.email || '',
        customerDoc:   '0',
        amount:        parseFloat(rawPayload.order?.total_products) || 0,
        currency:      'ARS',
      };
    }

    default:
      return null;
  }
}

// Procesador de órdenes (acá iría la lógica AFIP cuando esté lista)
async function processOrder(integration, normalizedOrder, rawPayload) {
  const ARCA_LIMIT = 380000;

  // Validar si necesita DNI para montos altos
  if (normalizedOrder.amount >= ARCA_LIMIT && normalizedOrder.customerDoc === '0') {
    await Order.create({
      userId:        integration.userId,
      integrationId: integration._id,
      platform:      integration.platform,
      ...normalizedOrder,
      status:   'error_data',
      errorLog: `Monto $${normalizedOrder.amount} supera el límite sin DNI identificado.`,
      rawPayload,
    });
    console.warn(`⚠️  Orden ${normalizedOrder.externalId}: monto alto sin DNI`);
    return;
  }

  // Consumidor final para montos bajos sin DNI
  if (normalizedOrder.customerDoc === '0') {
    normalizedOrder.customerDoc = '99999999';  // CUIT consumidor final AFIP
  }

  // Guardar la orden (upsert para evitar duplicados)
  await Order.findOneAndUpdate(
    { userId: integration.userId, platform: integration.platform, externalId: normalizedOrder.externalId },
    {
      userId:        integration.userId,
      integrationId: integration._id,
      platform:      integration.platform,
      ...normalizedOrder,
      status:     'pending_invoice',
      rawPayload,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log(`✅ Orden guardada: ${integration.platform} #${normalizedOrder.externalId} | Usuario: ${integration.userId} | $${normalizedOrder.amount}`);

  // TODO: disparar emisión de factura contra AFIP/ARCA
  // await emitirFactura(integration, normalizedOrder);
}

// ── WEBHOOK WOOCOMMERCE ───────────────────────────────────────
app.post('/webhook/woocommerce/:secret', async (req, res) => {
  res.status(200).send('OK');  // responder rápido
  const { secret } = req.params;
  try {
    const integration = await Integration.findOne({ platform: 'woocommerce', webhookSecret: secret, status: 'active' });
    if (!integration) return console.warn(`⚠️  WooCommerce webhook: secret no encontrado (${secret})`);
    const normalized = normalizeOrder('woocommerce', req.body);
    if (!normalized) return;
    await processOrder(integration, normalized, req.body);
  } catch(e) { console.error('❌ WooCommerce webhook error:', e.message); }
});

// ── WEBHOOK TIENDANUBE ────────────────────────────────────────
app.post('/webhook/tiendanube/:secret', async (req, res) => {
  res.status(200).send('OK');
  const { secret } = req.params;
  try {
    const integration = await Integration.findOne({ platform: 'tiendanube', webhookSecret: secret, status: 'active' });
    if (!integration) return console.warn(`⚠️  TiendaNube webhook: secret no encontrado`);
    // TiendaNube envía solo el evento; fetchear la orden completa
    const orderId = req.body.id;
    const apiToken = integration.getCredential('apiToken');
    const storeNumId = integration.credentials.storeNumId;
    const orderRes = await axios.get(
      `https://api.tiendanube.com/v1/${storeNumId}/orders/${orderId}`,
      { headers: { Authentication: `bearer ${apiToken}`, 'User-Agent': 'KOI-Factura' } }
    );
    const normalized = normalizeOrder('tiendanube', orderRes.data);
    if (!normalized) return;
    await processOrder(integration, normalized, orderRes.data);
  } catch(e) { console.error('❌ TiendaNube webhook error:', e.message); }
});

// ── WEBHOOK MERCADOLIBRE ──────────────────────────────────────
// ML envía notificaciones de tipo "orders_v2" — hay que fetchear la orden
app.post('/webhook/mercadolibre/:secret', async (req, res) => {
  res.status(200).send('OK');
  const { secret } = req.params;
  const { topic, resource } = req.body;
  if (topic !== 'orders_v2' && topic !== 'orders') return; // solo órdenes
  try {
    const integration = await Integration.findOne({ platform: 'mercadolibre', webhookSecret: secret, status: 'active' });
    if (!integration) return;
    const accessToken = await _getMLToken(integration);
    const orderUrl = resource.startsWith('http') ? resource : `https://api.mercadolibre.com${resource}`;
    const orderRes = await axios.get(orderUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    const normalized = normalizeOrder('mercadolibre', orderRes.data);
    if (!normalized) return;
    await processOrder(integration, normalized, orderRes.data);
  } catch(e) { console.error('❌ MercadoLibre webhook error:', e.message); }
});

// ── WEBHOOK EMPRETIENDA ───────────────────────────────────────
app.post('/webhook/empretienda/:secret', async (req, res) => {
  res.status(200).send('OK');
  const { secret } = req.params;
  try {
    const integration = await Integration.findOne({ platform: 'empretienda', webhookSecret: secret, status: 'active' });
    if (!integration) return;
    const normalized = normalizeOrder('empretienda', req.body);
    if (!normalized) return;
    await processOrder(integration, normalized, req.body);
  } catch(e) { console.error('❌ Empretienda webhook error:', e.message); }
});

// ── WEBHOOK RAPPI ─────────────────────────────────────────────
app.post('/webhook/rappi/:secret', async (req, res) => {
  res.status(200).send('OK');
  const { secret } = req.params;
  try {
    const integration = await Integration.findOne({ platform: 'rappi', webhookSecret: secret, status: 'active' });
    if (!integration) return;
    const normalized = normalizeOrder('rappi', req.body);
    if (!normalized) return;
    await processOrder(integration, normalized, req.body);
  } catch(e) { console.error('❌ Rappi webhook error:', e.message); }
});

// ════════════════════════════════════════════════════════════
//  RUTAS API DASHBOARD
// ════════════════════════════════════════════════════════════

app.get('/api/orders', requireAuthAPI, async (req, res) => {
  try {
    const { platform, status, limit = 50 } = req.query;
    const filter = { userId: req.userId };
    if (platform) filter.platform = platform;
    if (status)   filter.status   = status;
    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit), 200))
      .select('-rawPayload')
      .lean();
    res.json({ ok: true, orders });
  } catch(e) { res.status(500).json({ error: 'Error interno' }); }
});

// Webhook URL para mostrarle al usuario en el dashboard
app.get('/api/integrations/:id/webhook-url', requireAuthAPI, async (req, res) => {
  try {
    const integration = await Integration.findOne({ _id: req.params.id, userId: req.userId });
    if (!integration) return res.status(404).json({ error: 'No encontrada' });
    const url = `${BASE}/webhook/${integration.platform}/${integration.webhookSecret}`;
    res.json({ ok: true, url });
  } catch(e) { res.status(500).json({ error: 'Error interno' }); }
});

// ════════════════════════════════════════════════════════════
//  PÁGINAS HTML
// ════════════════════════════════════════════════════════════

app.get('/', (req, res) => {
  try { jwt.verify(req.cookies.koi_token, JWT_SECRET); res.redirect('/dashboard'); }
  catch(e) { res.clearCookie('koi_token'); res.redirect('/login'); }
});
app.get('/login', (req, res) => {
  try { jwt.verify(req.cookies.koi_token, JWT_SECRET); res.redirect('/dashboard'); }
  catch(e) { res.sendFile(path.join(__dirname, 'public', 'login.html')); }
});
app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── START ─────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`🚀 KOI corriendo en puerto ${PORT}`));
