// ============================================================
//  KOI-FACTURA · Backend
//  Node/Express + MongoDB + Google OAuth + WooCommerce
// ============================================================
//  Variables de entorno (.env / Render Environment):
//
//  MONGO_URI            → mongodb+srv://...
//  JWT_SECRET           → string secreto largo
//  SESSION_SECRET       → string secreto para cookies
//  GOOGLE_CLIENT_ID     → de Google Cloud Console
//  GOOGLE_CLIENT_SECRET → de Google Cloud Console
//  BASE_URL             → https://koi-backend-zzoc.onrender.com
//  PORT                 → (Render lo asigna automático)
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
const path           = require('path');

const app  = express();
const PORT = process.env.PORT || 10000;

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
  .then(() => console.log('🐟 KOI: Motor de base de datos encendido'))
  .catch(err => console.error('❌ Error Mongo:', err));

// ── MODELOS ───────────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
  nombre:       { type: String, trim: true },
  apellido:     { type: String, trim: true },
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:     { type: String },
  googleId:     { type: String },
  avatar:       { type: String },
  plan:         { type: String, default: 'free' },
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

const OrderSchema = new mongoose.Schema({
  platform:      String,
  externalId:    String,
  customerName:  String,
  customerEmail: String,
  customerDoc:   String,
  amount:        Number,
  status:        { type: String, default: 'pending_invoice' },
  errorLog:      String,
  createdAt:     { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', OrderSchema);

const StoreSchema = new mongoose.Schema({
  storeUrl:       String,
  consumerKey:    String,
  consumerSecret: String,
  userId:         String,
  platform:       { type: String, default: 'woocommerce' }
});
const Store = mongoose.model('Store', StoreSchema);

// ── JWT HELPERS ───────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'koi-jwt-dev';

function generarToken(userId) {
  return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '7d' });
}
function setAuthCookie(res, token) {
  res.cookie('koi_token', token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   7*24*60*60*1000
  });
}

// ── MIDDLEWARES DE AUTH ───────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.cookies.koi_token;
  if (!token) return res.redirect('/login');
  try { req.userId = jwt.verify(token, JWT_SECRET).id; next(); }
  catch(e) { res.clearCookie('koi_token'); res.redirect('/login'); }
}
function requireAuthAPI(req, res, next) {
  const token = req.cookies.koi_token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try { req.userId = jwt.verify(token, JWT_SECRET).id; next(); }
  catch(e) { res.status(401).json({ error: 'Token inválido o expirado' }); }
}

// ── PASSPORT GOOGLE OAUTH ─────────────────────────────────────
passport.use(new GoogleStrategy({
  clientID:     process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL:  `${process.env.BASE_URL || 'http://localhost:' + PORT}/auth/google/callback`,
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
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try { done(null, await User.findById(id)); } catch(e) { done(e); }
});

// ═══════════════════════════════════════════════════════════
//  RUTAS AUTH
// ═══════════════════════════════════════════════════════════

app.get('/auth/google', passport.authenticate('google', { scope: ['profile','email'] }));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=auth_failed' }),
  (req, res) => { setAuthCookie(res, generarToken(req.user.id)); res.redirect('/dashboard'); }
);

app.post('/auth/register', async (req, res) => {
  try {
    const { nombre, apellido, email, password } = req.body;
    if (!email || !password || !nombre) return res.status(400).json({ error: 'Faltan campos obligatorios.' });
    if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
    if (await User.findOne({ email: email.toLowerCase() })) return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });
    const user = await User.create({ nombre, apellido, email, password });
    setAuthCookie(res, generarToken(user.id));
    res.json({ ok: true, user: { nombre: user.nombre, email: user.email } });
  } catch(e) { console.error('Register:', e); res.status(500).json({ error: 'Error interno.' }); }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Completá email y contraseña.' });
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
    if (!user.password) return res.status(401).json({ error: 'Esta cuenta usa Google. Ingresá con el botón de Google.' });
    if (!await user.verificarPassword(password)) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
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

// ═══════════════════════════════════════════════════════════
//  RUTAS WOOCOMMERCE (sin cambios respecto al original)
// ═══════════════════════════════════════════════════════════

app.post('/webhook/woocommerce', async (req, res) => {
  const data   = req.body;
  const amount = parseFloat(data.total);
  let rawDni   = data.billing.dni || data.billing.identification || "";
  let cleanDni = rawDni.replace(/\D/g, "");
  let status   = 'pending_invoice';
  let errorLog = '';
  const ARCA_LIMIT = 380000;
  const isDniValid = cleanDni.length >= 7 && cleanDni.length <= 11;
  if (!isDniValid) {
    if (amount < ARCA_LIMIT) { cleanDni = "999"; }
    else { status = 'error_data'; errorLog = `Monto alto ($${amount}) requiere DNI. Recibido: "${rawDni}"`; }
  }
  try {
    await new Order({
      platform: 'woocommerce', externalId: data.id.toString(),
      customerName: `${data.billing.first_name} ${data.billing.last_name}`,
      customerEmail: data.billing.email, customerDoc: cleanDni,
      amount, status, errorLog
    }).save();
    console.log(`✅ Orden ${data.id} guardada con DNI: ${cleanDni}`);
    res.status(200).send('OK');
  } catch(error) { res.status(500).send('Error'); }
});

app.get('/auth/woo/connect', (req, res) => {
  const { store_url } = req.query;
  if (!store_url) return res.status(400).send("Falta URL");
  const cleanUrl     = store_url.replace(/\/$/, "");
  const callback_url = `https://${req.get('host')}/auth/woo/callback?store_url=${cleanUrl}`;
  const auth_url     = `${cleanUrl}/wc-auth/v1/authorize?app_name=KOI-Factura&scope=read_write&user_id=sono_user_01&return_url=${cleanUrl}&callback_url=${callback_url}`;
  res.redirect(auth_url);
});

app.post('/auth/woo/callback', async (req, res) => {
  const keys = req.body, storeUrl = req.query.store_url;
  res.status(200).json({ status: "success" });
  try {
    await Store.findOneAndUpdate(
      { storeUrl },
      { storeUrl, consumerKey: keys.consumer_key, consumerSecret: keys.consumer_secret, userId: keys.user_id },
      { upsert: true }
    );
    await axios.post(`${storeUrl}/wp-json/wc/v3/webhooks`, {
      name: 'KOI - Facturación Automática', topic: 'order.created',
      delivery_url: `https://${req.get('host')}/webhook/woocommerce`, status: 'active'
    }, { auth: { username: keys.consumer_key, password: keys.consumer_secret } });
    console.log(`🔌 Webhook OK en ${storeUrl}`);
  } catch(error) { console.error('❌ Error post-conexión:', error.message); }
});

// ═══════════════════════════════════════════════════════════
//  RUTAS API DASHBOARD
// ═══════════════════════════════════════════════════════════

app.get('/api/orders', requireAuthAPI, async (req, res) => {
  try { res.json(await Order.find().sort({ createdAt: -1 }).limit(10)); }
  catch(err) { res.status(500).json({ error: "Error al cargar órdenes" }); }
});

app.get('/api/stores', requireAuthAPI, async (req, res) => {
  try { res.json(await Store.find()); }
  catch(err) { res.status(500).json({ error: "Error al cargar tiendas" }); }
});

// ═══════════════════════════════════════════════════════════
//  PÁGINAS HTML
// ═══════════════════════════════════════════════════════════

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
