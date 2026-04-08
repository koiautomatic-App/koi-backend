// ============================================================
//  KOI-FACTURA · SaaS Multi-Tenant Engine v4.0
//  + Módulo de Emisión AFIP/WSFE (Producción)
// ============================================================
//  ENV VARS en Render:
//
//  MONGO_URI              mongodb+srv://...
//  JWT_SECRET             string 64 chars
//  SESSION_SECRET         string 32 chars
//  ENCRYPTION_KEY         exactamente 32 chars
//  GOOGLE_CLIENT_ID       Google Cloud Console
//  GOOGLE_CLIENT_SECRET   Google Cloud Console
//  ML_CLIENT_ID           MercadoLibre Developers
//  ML_CLIENT_SECRET       MercadoLibre Developers
//  BASE_URL               https://koi-backend-zzoc.onrender.com
//  AFIP_CERT_PATH         /ruta/al/archivo.crt  (montado en Render)
//  AFIP_KEY_PATH          /ruta/al/archivo.key
//  AFIP_SERVICE_CUIT      CUIT del titular del certificado (KOI)
//  PORT                   (Render lo asigna automático)
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
const fs             = require('fs');
const https          = require('https');
const { DOMParser }  = require('@xmldom/xmldom');
const xmlbuilder     = require('xmlbuilder');

const app  = express();
const PORT = process.env.PORT || 10000;
const BASE = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const JWT_SECRET = process.env.JWT_SECRET || 'koi-jwt-dev-change-in-production';

// ════════════════════════════════════════════════════════════
//  MIDDLEWARES
// ════════════════════════════════════════════════════════════
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: BASE, credentials: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret:            process.env.SESSION_SECRET || 'koi-session-dev',
  resave:            false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, maxAge: 7*24*60*60*1000 },
}));
app.use(passport.initialize());
app.use(passport.session());

// ════════════════════════════════════════════════════════════
//  MONGODB
// ════════════════════════════════════════════════════════════
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, { maxPoolSize: 10, serverSelectionTimeoutMS: 5000 });
    console.log('🐟 KOI: MongoDB conectado');
  } catch (err) {
    console.error('❌ MongoDB:', err.message);
    setTimeout(connectDB, 5000);
  }
};
connectDB();

// ════════════════════════════════════════════════════════════
//  ENCRYPTION — AES-256-GCM
// ════════════════════════════════════════════════════════════
const ENC_KEY = Buffer.from(
  (process.env.ENCRYPTION_KEY || 'koi0000000000000000000000000000k').slice(0, 32), 'utf8'
);

const encrypt = (text) => {
  if (!text) return null;
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc    = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
};

const decrypt = (payload) => {
  if (!payload) return null;
  try {
    const [ivHex, tagHex, encHex] = payload.split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivHex, 'hex'));
    d.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([d.update(Buffer.from(encHex, 'hex')), d.final()]).toString('utf8');
  } catch { return null; }
};

// ════════════════════════════════════════════════════════════
//  SCHEMAS
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
    cuit:          { type: String },
    razonSocial:   { type: String },
    puntoVenta:    { type: Number },
    tipoComprobante: { type: Number, default: 11 },
    arcaClave:     { type: String },
    arcaStatus: { type: String, enum: ['pendiente', 'vinculado', 'error', 'en_proceso'], default: 'pendiente' },
    arcaPtoVta: { type: Number },
    arcaNotas: { type: String },
    arcaError: { type: String },
    arcaVinculadoEn: { type: Date },
    arcaUpdatedAt: { type: Date },
  },
  ultimoAcceso: { type: Date, default: Date.now },
  creadoEn:     { type: Date, default: Date.now },
});

UserSchema.pre('save', async function(next) {
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});
UserSchema.methods.checkPassword = function(plain) {
  return bcrypt.compare(plain, this.password);
};
const User = mongoose.model('User', UserSchema);

// ── INTEGRATION ───────────────────────────────────────────────
const IntegrationSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  platform: { type: String, required: true, enum: ['woocommerce','tiendanube','mercadolibre','empretienda','rappi','vtex','shopify','manual'] },
  storeId:   { type: String, required: true },
  storeName: { type: String },
  storeUrl:  { type: String },
  status:    { type: String, default: 'active', enum: ['active','paused','error','pending'] },
  credentials: { type: mongoose.Schema.Types.Mixed, default: {} },
  webhookSecret: { type: String, default: () => crypto.randomBytes(24).toString('hex'), index: true },
  lastSyncAt:  { type: Date },
  errorLog:    { type: String },
  updatedAt:   { type: Date, default: Date.now },
  createdAt:   { type: Date, default: Date.now },
});
IntegrationSchema.index({ userId: 1, platform: 1, storeId: 1 }, { unique: true });
IntegrationSchema.methods.setKey = function(field, value) {
  this.credentials = { ...this.credentials, [field]: encrypt(value) };
};
IntegrationSchema.methods.getKey = function(field) {
  return decrypt(this.credentials?.[field]);
};
const Integration = mongoose.model('Integration', IntegrationSchema);

// ── ORDER ─────────────────────────────────────────────────────
const OrderSchema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  integrationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Integration' },
  platform:      { type: String, required: true },
  externalId:    { type: String, required: true },
  customerName:  { type: String, default: '' },
  customerEmail: { type: String, default: '' },
  customerDoc:   { type: String, default: '0' },
  amount:        { type: Number, required: true },
  currency:      { type: String, default: 'ARS' },
  concepto:      { type: String, default: '' },
  items: [{
    nombre:   { type: String },
    cantidad: { type: Number, default: 1 },
    precio:   { type: Number },
    sku:      { type: String },
  }],
  orderDate:     { type: Date },
  rawPayload:    { type: mongoose.Schema.Types.Mixed, default: null },
  status: {
    type:    String,
    default: 'pending_invoice',
    enum:    ['pending_invoice','invoiced','error_data','error_afip','skipped'],
  },
  caeNumber:      { type: String },
  caeExpiry:      { type: Date },
  nroComprobante: { type: Number },
  tipoComprobante:{ type: Number },
  puntoVenta:     { type: Number },
  fechaEmision:   { type: Date },
  errorLog:       { type: String },
  createdAt:      { type: Date, default: Date.now },
});
OrderSchema.index({ userId: 1, platform: 1, externalId: 1 }, { unique: true });
OrderSchema.index({ userId: 1, status: 1, createdAt: -1 });
OrderSchema.index({ userId: 1, createdAt: -1 });
const Order = mongoose.model('Order', OrderSchema);

// ════════════════════════════════════════════════════════════
//  NORMALIZER (solo WooCommerce con rawPayload)
// ════════════════════════════════════════════════════════════
const ARCA_LIMIT = 380_000;
const CUIT_CF    = '99999999';

const _cleanDoc = (raw) => String(raw || '').replace(/\D/g, '');
const _resolveDoc = (doc, amount) => {
  if (doc.length >= 7 && doc.length <= 11) return doc;
  return amount >= ARCA_LIMIT ? null : CUIT_CF;
};

const normalize = {
  woocommerce: (raw) => {
    const b    = raw.billing || {};
    const doc  = _cleanDoc(b.dni || b.identification || b.cpf || '');
    const items = (raw.line_items || []).map(i => ({
      nombre:   i.name   || 'Producto',
      cantidad: i.quantity || 1,
      precio:   parseFloat(i.price || i.subtotal || 0),
      sku:      i.sku    || '',
    }));
    const concepto = items.length ? items.map(i => i.nombre).join(', ') : 'Venta WooCommerce';
    return {
      externalId:    String(raw.id),
      customerName:  `${b.first_name||''} ${b.last_name||''}`.trim(),
      customerEmail: b.email || '',
      customerDoc:   _resolveDoc(doc, parseFloat(raw.total)||0),
      amount:        parseFloat(raw.total) || 0,
      currency:      raw.currency || 'ARS',
      concepto,
      items,
      orderDate:     raw.date_created ? new Date(raw.date_created) : undefined,
      rawPayload:    raw,
    };
  },
  // ... otros normalizers (tiendanube, mercadolibre, etc.) mantener igual ...
};

// ════════════════════════════════════════════════════════════
//  UPSERT ENGINE
// ════════════════════════════════════════════════════════════
async function upsertOrder(integration, canonical) {
  if (!canonical) return null;

  const status = canonical.customerDoc === null ? 'error_data' : 'pending_invoice';
  const errorLog = canonical.customerDoc === null
    ? `Monto $${canonical.amount} ≥ $${ARCA_LIMIT} sin DNI válido` : '';
  if (canonical.customerDoc === null) canonical.customerDoc = '0';

  const doc = await Order.findOneAndUpdate(
    { userId: integration.userId, platform: integration.platform, externalId: canonical.externalId },
    { $setOnInsert: {
        userId:        integration.userId,
        integrationId: integration._id,
        platform:      integration.platform,
        ...canonical,
        status,
        errorLog,
        rawPayload:    canonical.rawPayload || null,
    }},
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).catch(err => {
    if (err.code !== 11000) console.error(`upsert error:`, err.message);
    return null;
  });

  if (doc && status === 'pending_invoice') {
    const user = await User.findById(integration.userId).select('settings').lean();
    if (user?.settings?.factAuto && user?.settings?.cuit) {
      emitirCAE(doc._id, user).catch(e => console.error('Auto-emit error:', e.message));
    }
  }
  return doc;
}

// ════════════════════════════════════════════════════════════
//  BACKFILL PARA ORDENES EXISTENTES
// ════════════════════════════════════════════════════════════
app.post('/api/integrations/:id/backfill-concepto', requireAuthAPI, async (req, res) => {
  try {
    const integration = await Integration.findOne({ _id: req.params.id, userId: req.userId });
    if (!integration) return res.status(404).json({ error: 'Integración no encontrada' });
    if (integration.platform !== 'woocommerce')
      return res.status(400).json({ error: 'Solo disponible para WooCommerce' });

    const sinConcepto = await Order.countDocuments({
      userId:   new mongoose.Types.ObjectId(req.userId),
      platform: 'woocommerce',
      $or: [
        { concepto: { $exists: false } },
        { concepto: { $in: ['', 'woocommerce', 'Venta WooCommerce'] } },
        { items: { $exists: false } },
      ],
    });

    res.json({ ok: true, pendientes: sinConcepto, message: `Actualizando ${sinConcepto} órdenes en background…` });
    _backfillConceptoWoo(integration, req.userId).catch(e => console.error('[Backfill] Error:', e.message));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

async function _backfillConceptoWoo(integration, userId) {
  const ordenes = await Order.find({
    userId:   new mongoose.Types.ObjectId(userId),
    platform: 'woocommerce',
    $or: [
      { concepto: { $exists: false } },
      { concepto: { $in: ['', 'woocommerce', 'Venta WooCommerce'] } },
      { items: { $exists: false } },
    ],
  }).select('_id externalId rawPayload').lean();

  console.log(`[Backfill] ${ordenes.length} órdenes a procesar`);
  let ok = 0;

  for (const orden of ordenes) {
    try {
      const raw = orden.rawPayload;
      if (!raw?.line_items?.length) continue;

      const items = raw.line_items.map(i => ({
        nombre:   i.name || 'Producto',
        cantidad: i.quantity || 1,
        precio:   parseFloat(i.price || 0),
        sku:      i.sku || '',
      }));

      const concepto = items.map(i => i.nombre).join(', ');
      await Order.updateOne({ _id: orden._id }, { $set: { concepto, items } });
      ok++;
      if (ok % 100 === 0) console.log(`[Backfill] Progreso: ${ok}/${ordenes.length}`);
    } catch(e) {
      console.warn(`Error orden ${orden.externalId}:`, e.message);
    }
  }
  console.log(`[Backfill] ✅ Completado: ${ok} órdenes actualizadas`);
}

// ════════════════════════════════════════════════════════════
//  MÓDULO AFIP/WSFE (resumido - mantener tu implementación existente)
// ════════════════════════════════════════════════════════════
// ... (todo tu código AFIP existente: getAfipToken, getUltimoComprobante, 
//     getTipoComprobante, solicitarCAE, emitirCAE, etc.) ...

// ════════════════════════════════════════════════════════════
//  ADMIN PANEL ENDPOINTS
// ════════════════════════════════════════════════════════════
const ADMIN_EMAILS = ['koi.automatic@gmail.com'];

const requireAdmin = async (req, res, next) => {
  try {
    const token = req.cookies.koi_token || (req.headers.authorization || '').replace('Bearer ', '');
    const { id } = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(id);
    if (!ADMIN_EMAILS.includes(user.email)) {
      return res.status(403).json({ error: 'Acceso no autorizado' });
    }
    req.adminId = id;
    next();
  } catch(e) {
    res.status(401).json({ error: 'No autenticado' });
  }
};

app.get('/api/admin/pendientes', requireAdmin, async (req, res) => {
  // ... tu código existente ...
  res.json({ ok: true, lista: [] });
});

app.post('/api/admin/update-status', requireAdmin, async (req, res) => {
  // ... tu código existente ...
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
//  START
// ════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`🚀 KOI-Factura v4.0 | Puerto ${PORT} | ${BASE}`);
});
