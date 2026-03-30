// ============================================================
//  KOI-FACTURA · SaaS Multi-Tenant Engine v5.5 (OMNI-FLOW)
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
const passport       = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const crypto         = require('crypto');
const path           = require('path');

const app  = express();
const PORT = process.env.PORT || 10000;
const BASE = (process.env.BASE_URL || `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`).replace(/\/$/, '');
const JWT_SECRET = process.env.JWT_SECRET || 'koi-jwt-dev-secret';

// ── MIDDLEWARES ──────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'koi-session-dev',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(passport.initialize());
app.use(passport.session());

// ── DB CONNECTION ───────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI).then(() => console.log('🐟 KOI: Base de datos lista'));

// ── ENCRYPTION (AES-256-GCM) ─────────────────────────────────
const ENC_KEY = Buffer.from((process.env.ENCRYPTION_KEY || 'koi0000000000000000000000000000k').padEnd(32, '0').slice(0, 32), 'utf8');

const encrypt = (t) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(t), 'utf8'), cipher.final()]);
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
const User = mongoose.model('User', new mongoose.Schema({
  nombre: String, email: { type: String, unique: true }, googleId: String
}));

const Integration = mongoose.model('Integration', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, index: true },
  platform: String, storeUrl: String, status: String,
  credentials: { type: mongoose.Schema.Types.Mixed },
  lastSyncAt: Date
}));

const Order = mongoose.model('Order', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  amount: Number, externalId: String, customerName: String, createdAt: Date
}).index({ userId: 1, externalId: 1 }, { unique: true }));

// ── MOTOR DE SYNC (BACKGROUND PROGRESSIVO) ──────────────────
const syncWooData = async (integration) => {
  const key = decrypt(integration.credentials.consumerKey);
  const secret = decrypt(integration.credentials.consumerSecret);
  let page = 1;
  let hasMore = true;

  try {
    while (hasMore && page <= 5) { // Traemos hasta 250 órdenes en bloques de 50
      const { data: orders } = await axios.get(`${integration.storeUrl}/wp-json/wc/v3/orders`, {
        auth: { username: key, password: secret }, 
        params: { per_page: 50, page, status: 'completed' }
      });

      if (orders?.length > 0) {
        const ops = orders.map(o => ({
          updateOne: {
            filter: { userId: integration.userId, externalId: String(o.id) },
            update: { $set: { 
              amount: parseFloat(o.total), 
              customerName: o.billing?.first_name || 'Cliente', 
              createdAt: new Date(o.date_created) 
            }},
            upsert: true
          }
        }));
        await Order.bulkWrite(ops);
        if (orders.length < 50) hasMore = false;
        page++;
        await new Promise(r => setTimeout(r, 600)); // Respiro para el CPU
      } else { hasMore = false; }
    }
    await Integration.findByIdAndUpdate(integration._id, { lastSyncAt: new Date() });
  } catch (e) { console.error("Sync Error:", e.message); }
};

// ── API DASHBOARD (ESTADO HÍBRIDO) ──────────────────────────
app.get('/api/stats/dashboard', async (req, res) => {
  const token = req.cookies.koi_token;
  if (!token) return res.status(401).json({ error: '401' });

  try {
    const { id: userId } = jwt.verify(token, JWT_SECRET);
    const integration = await Integration.findOne({ userId, status: 'active' });
    const count = await Order.countDocuments({ userId });

    // Si hay integración pero 0 datos, disparamos el sync de fondo
    if (integration && count === 0) {
      setImmediate(() => syncWooData(integration));
    }

    const stats = await Order.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    res.json({
      ok: true,
      connected: !!integration, // Clave para que el front no se sature
      totalFacturado: stats[0]?.total || 0,
      totalVentas: count,
      ventas: await Order.find({ userId }).sort({ createdAt: -1 }).limit(10).lean()
    });
  } catch (e) { res.status(401).json({ error: '401' }); }
});

// ── GOOGLE AUTH ──────────────────────────────────────────────
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: `${BASE}/auth/google/callback`
}, async (_, __, profile, done) => {
  const email = profile.emails[0].value;
  let user = await User.findOne({ email });
  if (!user) user = await User.create({ nombre: profile.displayName, email, googleId: profile.id });
  done(null, user);
}));

passport.serializeUser((u, d) => d(null, u.id));
passport.deserializeUser(async (id, d) => d(null, await User.findById(id)));

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login' }), (req, res) => {
  const token = jwt.sign({ id: req.user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('koi_token', token, { httpOnly: true, secure: true, sameSite: 'lax' });
  res.redirect('/dashboard');
});

// ── WOOCOMMERCE CONNECTION ───────────────────────────────────
app.get('/auth/woo/connect', (req, res) => {
  const { store_url } = req.query;
  const token = req.cookies.koi_token;
  if (!store_url || !token) return res.status(400).send('Session error');

  const authUrl = `${store_url.replace(/\/$/, '')}/wc-auth/v1/authorize?app_name=KOI-Factura&scope=read_write&user_id=${token}&return_url=${encodeURIComponent(BASE + '/dashboard?woo=connected')}&callback_url=${BASE}/auth/woo/callback`;
  res.redirect(authUrl);
});

app.post('/auth/woo/callback', async (req, res) => {
  res.status(200).send('OK');
  const { user_id: token, consumer_key, consumer_secret, store_url } = req.body;
  try {
    const { id: userId } = jwt.verify(token, JWT_SECRET);
    const integration = await Integration.findOneAndUpdate(
      { userId, platform: 'woocommerce' },
      { $set: { status: 'active', storeUrl: store_url, credentials: { consumerKey: encrypt(consumer_key), consumerSecret: encrypt(consumer_secret) } } },
      { upsert: true, new: true }
    );
    setImmediate(() => syncWooData(integration));
  } catch (e) { console.error("Callback Error", e); }
});

// FRONTEND FALLBACK
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`🚀 KOI v5.5 Omni-Flow Activo`));
