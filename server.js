// ============================================================
//   KOI-FACTURA · Backend (Versión Corregida)
//   Node/Express + MongoDB + Google OAuth + WooCommerce
// ============================================================

require('dotenv').config();

// --- LOGS DE DIAGNÓSTICO (Revisar en el Dashboard de Render) ---
console.log("--- 🐟 KOI: CHEQUEO DE INICIO ---");
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("ID de Google:", process.env.GOOGLE_CLIENT_ID ? "DETECTADO ✅" : "FALTANTE ❌");
console.log("URL Base:", process.env.BASE_URL || "No configurada");
console.log("---------------------------------");

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

// Configuración de Sesión (Importante para Google Auth)
app.use(session({
  secret:            process.env.SESSION_SECRET || 'koi-session-dev-123',
  resave:            false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', 
    maxAge: 7*24*60*60*1000 
  }
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
const JWT_SECRET = process.env.JWT_SECRET || 'koi-jwt-dev-456';

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
  try { 
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id; 
    next(); 
  } catch(e) { 
    res.clearCookie('koi_token'); 
    res.redirect('/login'); 
  }
}

function requireAuthAPI(req, res, next) {
  const token = req.cookies.koi_token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try { 
    req.userId = jwt.verify(token, JWT_SECRET).id; 
    next(); 
  } catch(e) { 
    res.status(401).json({ error: 'Token inválido o expirado' }); 
  }
}

// ── PASSPORT GOOGLE OAUTH (Corregido con validación de ID) ─────
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.error("❌ ERROR CRÍTICO: Faltan GOOGLE_CLIENT_ID o GOOGLE_CLIENT_SECRET en las variables de entorno.");
} else {
    passport.use(new GoogleStrategy({
      clientID:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:  `${process.env.BASE_URL}/auth/google/callback`,
    }, async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value?.toLowerCase();
        if (!email) return done(new Error('No se obtuvo email de Google'));
        
        let user = await User.findOne({ $or: [{ googleId: profile.id }, { email }] });
        
        if (!user) {
          user = await User.create({
            googleId: profile.id, 
            email,
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
      } catch(e) { 
        done(e); 
      }
    }));
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try { 
    const user = await User.findById(id);
    done(null, user); 
  } catch(e) { 
    done(e); 
  }
});

// ── RUTAS AUTH ────────────────────────────────────────────────
app.get('/auth/google', passport.authenticate('google', { scope: ['profile','email'] }));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=auth_failed' }),
  (req, res) => { 
    setAuthCookie(res, generarToken(req.user.id)); 
    res.redirect('/dashboard'); 
  }
);

app.post('/auth/register', async (req, res) => {
  try {
    const { nombre, apellido, email, password } = req.body;
    if (!email || !password || !nombre) return res.status(400).json({ error: 'Faltan campos.' });
    if (await User.findOne({ email: email.toLowerCase() })) return res.status(409).json({ error: 'Ya existe el email.' });
    const user = await User.create({ nombre, apellido, email, password });
    setAuthCookie(res, generarToken(user.id));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Error' }); }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !user.password || !(await user.verificarPassword(password))) {
        return res.status(401).json({ error: 'Credenciales inválidas.' });
    }
    setAuthCookie(res, generarToken(user.id));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Error' }); }
});

app.get('/auth/logout', (req, res) => {
  req.logout?.(() => {});
  res.clearCookie('koi_token');
  res.redirect('/login');
});

app.get('/api/me', requireAuthAPI, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    res.json({ ok: true, user });
  } catch(e) { res.status(500).json({ error: 'Error' }); }
});

// ── RUTAS WOOCOMMERCE & API ────────────────────────────────────
app.post('/webhook/woocommerce', async (req, res) => {
  const data = req.body;
  try {
    const amount = parseFloat(data.total);
    let cleanDni = (data.billing.dni || data.billing.identification || "999").replace(/\D/g, "");
    await new Order({
      platform: 'woocommerce', 
      externalId: data.id.toString(),
      customerName: `${data.billing.first_name} ${data.billing.last_name}`,
      customerEmail: data.billing.email, 
      customerDoc: cleanDni,
      amount,
      status: 'pending_invoice'
    }).save();
    res.status(200).send('OK');
  } catch(error) { res.status(500).send('Error'); }
});

app.get('/api/orders', requireAuthAPI, async (req, res) => {
  try { res.json(await Order.find().sort({ createdAt: -1 }).limit(10)); }
  catch(err) { res.status(500).json({ error: "Error" }); }
});

// ── PÁGINAS HTML ──────────────────────────────────────────────
app.get('/', (req, res) => {
  const token = req.cookies.koi_token;
  if (token) {
    try { jwt.verify(token, JWT_SECRET); return res.redirect('/dashboard'); } catch(e) {}
  }
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── START ─────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`🚀 KOI corriendo en puerto ${PORT}`));
