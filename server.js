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
    // Datos fiscales del usuario (su propio CUIT)
    cuit:          { type: String },          // ej: "27310889518"
    razonSocial:   { type: String },
    puntoVenta:    { type: Number },   // legacy — usar arcaPtoVta
    tipoComprobante: { type: Number, default: 11 }, // 11=FC, 6=FB, 1=FA
    // Clave Fiscal AFIP encriptada (para futura emisión directa)
    arcaClave:     { type: String },          // encriptada
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
  rawPayload:    { type: mongoose.Schema.Types.Mixed, default: null },  // 👈 AGREGAR ESTA LÍNEA
  status: {
    type:    String,
    default: 'pending_invoice',
    enum:    ['pending_invoice','invoiced','error_data','error_afip','skipped'],
  },
  // Datos de la factura emitida
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
//  NORMALIZER
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
    const concepto = items.length
      ? items.map(i => i.nombre).join(', ')
      : 'Venta WooCommerce';
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
      rawPayload:    raw,  // 👈 AGREGAR ESTA LÍNEA
    };
  },
  tiendanube: (raw) => {
    const doc   = _cleanDoc(raw.billing_info?.document || '');
    const items = (raw.products || []).map(i => ({
      nombre:   i.name    || i.product_name || 'Producto',
      cantidad: i.quantity || 1,
      precio:   parseFloat(i.price || 0),
      sku:      i.sku || '',
    }));
    const concepto = items.length
      ? items.map(i => i.nombre).join(', ')
      : 'Venta Tienda Nube';
    return {
      externalId:    String(raw.id),
      customerName:  raw.contact?.name || '',
      customerEmail: raw.contact?.email || '',
      customerDoc:   _resolveDoc(doc, parseFloat(raw.total)||0),
      amount:        parseFloat(raw.total) || 0,
      currency:      raw.currency || 'ARS',
      concepto,
      items,
      orderDate:     raw.paid_at ? new Date(raw.paid_at) : raw.created_at ? new Date(raw.created_at) : undefined,
    };
  },
  mercadolibre: (raw) => {
    const doc   = _cleanDoc(raw.billing_info?.doc_number || '');
    const items = (raw.order_items || []).map(i => ({
      nombre:   i.item?.title || 'Producto',
      cantidad: i.quantity    || 1,
      precio:   parseFloat(i.unit_price || 0),
      sku:      i.item?.seller_sku || '',
    }));
    const concepto = items.length
      ? items.map(i => i.nombre).join(', ')
      : 'Venta Mercado Libre';
    return {
      externalId:    String(raw.id),
      customerName:  raw.buyer?.nickname || '',
      customerEmail: raw.buyer?.email || '',
      customerDoc:   _resolveDoc(doc, parseFloat(raw.total_amount)||0),
      amount:        parseFloat(raw.total_amount) || 0,
      currency:      raw.currency_id || 'ARS',
    };
  },
  vtex: (raw) => {
    const c = raw.clientProfileData || {};
    const doc = _cleanDoc(c.document || '');
    return {
      externalId:    raw.orderId || String(raw.id),
      customerName:  `${c.firstName||''} ${c.lastName||''}`.trim(),
      customerEmail: c.email || '',
      customerDoc:   _resolveDoc(doc, (parseFloat(raw.value)||0)/100),
      amount:        (parseFloat(raw.value)||0) / 100,
      currency:      raw.currencyCode || 'ARS',
    };
  },
  empretienda: (raw) => {
    const doc = _cleanDoc(raw.customer?.dni || '');
    return {
      externalId:    String(raw.order_id || raw.id),
      customerName:  raw.customer?.name || '',
      customerEmail: raw.customer?.email || '',
      customerDoc:   _resolveDoc(doc, parseFloat(raw.total_price||raw.total)||0),
      amount:        parseFloat(raw.total_price || raw.total) || 0,
      currency:      'ARS',
    };
  },
  rappi: (raw) => {
    const o = raw.order || raw;
    return {
      externalId:    String(o.id),
      customerName:  o.user?.name || '',
      customerEmail: o.user?.email || '',
      customerDoc:   CUIT_CF,
      amount:        parseFloat(o.total_products || o.total) || 0,
      currency:      'ARS',
    };
  },
  shopify: (raw) => {
    const a = raw.billing_address || raw.shipping_address || {};
    const doc = _cleanDoc(raw.note_attributes?.find(x => x.name==='dni')?.value || '');
    return {
      externalId:    String(raw.id),
      customerName:  `${a.first_name||''} ${a.last_name||''}`.trim(),
      customerEmail: raw.email || '',
      customerDoc:   _resolveDoc(doc, parseFloat(raw.total_price)||0),
      amount:        parseFloat(raw.total_price) || 0,
      currency:      raw.currency || 'ARS',
    };
  },
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
    }},
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).catch(err => {
    if (err.code !== 11000) console.error(`upsert error:`, err.message);
    return null;
  });

  // Auto-emitir si el usuario tiene factAuto activado
  if (doc && status === 'pending_invoice') {
    const user = await User.findById(integration.userId).select('settings').lean();
    if (user?.settings?.factAuto && user?.settings?.cuit) {
      emitirCAE(doc._id, user).catch(e => console.error('Auto-emit error:', e.message));
    }
  }
  return doc;
}

// ════════════════════════════════════════════════════════════
//  MÓDULO AFIP/WSFE v2 — Firma PKCS#7 real con node-forge
//
//  Arquitectura multi-tenant:
//  - KOI tiene UN certificado maestro (.crt + .key) montado en Render
//  - Cada usuario tiene su CUIT en user.settings.cuit
//  - KOI firma el TRA con su cert y solicita el CAE en nombre del CUIT
//  - El token WSAA se cachea 12hs por CUIT para no saturar AFIP
// ════════════════════════════════════════════════════════════

// Cargar certificado KOI desde archivos montados en Render
const AFIP_CERT_PATH = process.env.AFIP_CERT_PATH || './cert/afip.crt';
const AFIP_KEY_PATH  = process.env.AFIP_KEY_PATH  || './cert/afip.key';

let AFIP_CERT, AFIP_KEY;
try {
  AFIP_CERT = fs.readFileSync(AFIP_CERT_PATH, 'utf8');
  AFIP_KEY  = fs.readFileSync(AFIP_KEY_PATH,  'utf8');
  console.log('✅ Certificado AFIP cargado');
  console.log('   CERT:', AFIP_CERT_PATH, '— size:', AFIP_CERT.length, 'chars');
  console.log('   KEY: ', AFIP_KEY_PATH,  '— size:', AFIP_KEY.length,  'chars');
} catch(e) {
  console.warn('⚠️  Certificado AFIP no encontrado:', e.message);
  console.warn('   Buscando en:', AFIP_CERT_PATH, 'y', AFIP_KEY_PATH);
}

// ── TLS AFIP FIX ─────────────────────────────────────────────
// AFIP WSFE usa DH keys de 1024 bits — OpenSSL 3.x (Node 18+) las
// rechaza con EPROTO. Solución: bajar SECLEVEL a 0 solo para el agent
// que habla con AFIP. No afecta conexiones entrantes al servidor.
//
// Valores de secureOptions:
//   SSL_OP_LEGACY_SERVER_CONNECT = 0x00000004  (permite DH pequeño)
//   SSL_OP_NO_SSLv2              = 0x01000000
const SSL_OP_LEGACY = typeof crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT !== 'undefined'
  ? crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT
  : 0x00000004;

const httpsAgent = new https.Agent({
  secureOptions:     SSL_OP_LEGACY,
  rejectUnauthorized: true,
  keepAlive:          true,
  // SECLEVEL=0 permite DH de cualquier tamaño (incluyendo 1024 bits de AFIP)
  // DEFAULT: suites estándar + DHE con clave chica
  ciphers: 'DEFAULT:@SECLEVEL=0',
});

// Global — aplica a WSAA, WSFE y cualquier llamada axios
axios.defaults.httpsAgent = httpsAgent;
console.log('[TLS] Agent AFIP: SSL_OP_LEGACY=' + SSL_OP_LEGACY.toString(16) + ' SECLEVEL=0');

// URLs producción
const AFIP_URLS = {
  wsaa: process.env.WSAA_URL || 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
  wsfe: process.env.WSFE_URL || 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
};

// Cache de tokens: cuit → { token, sign, expiry }
const tokenCache = new Map();

// ── PASO 1: Obtener Token WSAA con firma PKCS#7 real ─────────
async function getAfipToken(cuit) {
  const cached = tokenCache.get(cuit);
  if (cached && cached.expiry > Date.now() + 5 * 60_000) {
    return { token: cached.token, sign: cached.sign };
  }

  if (!AFIP_CERT || !AFIP_KEY) throw new Error('Certificado AFIP no cargado en el servidor');

  const forge = require('node-forge');

  // Construir TRA
  const now     = new Date();
  // Timestamps sin milisegundos y con zona Argentina (-03:00)
  // AFIP rechaza el formato con milisegundos (.000)
  const _toAfipTs = (d) => {
    const off = -3 * 60;
    const utc = d.getTime() + d.getTimezoneOffset() * 60_000;
    const arg = new Date(utc + off * 60_000);
    const p   = n => String(n).padStart(2, '0');
    return `${arg.getFullYear()}-${p(arg.getMonth()+1)}-${p(arg.getDate())}T${p(arg.getHours())}:${p(arg.getMinutes())}:${p(arg.getSeconds())}-03:00`;
  };
  const genTime = _toAfipTs(new Date(now.getTime() - 60_000));
  const expTime = _toAfipTs(new Date(now.getTime() + 12 * 3600_000));
  console.log(`[AFIP] TRA gen: ${genTime} | exp: ${expTime}`);

  const tra = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<loginTicketRequest version="1.0">',
    '  <header>',
    `    <uniqueId>${Math.floor(Date.now() / 1000)}</uniqueId>`,
    `    <generationTime>${genTime}</generationTime>`,
    `    <expirationTime>${expTime}</expirationTime>`,
    '  </header>',
    '  <service>wsfe</service>',
    '</loginTicketRequest>',
  ].join('\n');

  // Firmar con PKCS#7 — el formato que AFIP realmente acepta
  const cert    = forge.pki.certificateFromPem(AFIP_CERT);
  const privKey = forge.pki.privateKeyFromPem(AFIP_KEY);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key:         privKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType,   value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime,   value: new Date() },
    ],
  });
  p7.sign({ detached: false });

  // Convertir a DER → base64
  const derBuffer = Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary');
  const cmsSigned = derBuffer.toString('base64');

  // Llamar al WSAA
  const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope
  xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ns1="http://wsaa.view.sua.dvadac.desein.afip.gov.ar">
  <SOAP-ENV:Body>
    <ns1:loginCms>
      <ns1:in0>${cmsSigned}</ns1:in0>
    </ns1:loginCms>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

  console.log(`[AFIP] POST WSAA → ${AFIP_URLS.wsaa}`);
  const res = await axios.post(AFIP_URLS.wsaa, soapEnvelope, {
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '""' },
    httpsAgent,
    timeout: 30_000,
  });
  console.log(`[AFIP] WSAA respondió HTTP ${res.status} — ${res.data.length} chars`);

  // ── Parsear respuesta WSAA ──────────────────────────────────
  //
  //  Estructura real de la respuesta AFIP:
  //
  //  <soap:Envelope>
  //    <soap:Body>
  //      <loginCmsResponse>
  //        <loginCmsReturn>
  //          &lt;loginTicketResponse&gt;    ← XML escapado con entidades HTML
  //            &lt;credentials&gt;
  //              &lt;token&gt;TOKEN&lt;/token&gt;
  //              &lt;sign&gt;SIGN&lt;/sign&gt;
  //            &lt;/credentials&gt;
  //          &lt;/loginTicketResponse&gt;
  //        </loginCmsReturn>
  //      </loginCmsResponse>
  //    </soap:Body>
  //  </soap:Envelope>
  //
  //  textContent de loginCmsReturn ya decodifica &lt; → <
  //  por lo que loginReturn ES el XML del TA — NO hay base64.

  const soapDoc  = new DOMParser().parseFromString(res.data, 'text/xml');

  // Verificar SOAP Fault
  const fault = soapDoc.getElementsByTagName('faultstring')[0]?.textContent;
  if (fault) throw new Error(`WSAA SOAP fault: ${fault}`);

  // Extraer contenido de loginCmsReturn (puede llamarse loginCmsReturn o return)
  const loginCmsReturn = (
    soapDoc.getElementsByTagName('loginCmsReturn')[0] ||
    soapDoc.getElementsByTagName('ns1:loginCmsReturn')[0] ||
    soapDoc.getElementsByTagName('return')[0]
  )?.textContent;

  if (!loginCmsReturn) {
    console.error('[AFIP] Respuesta WSAA completa:', res.data.slice(0, 1000));
    throw new Error('WSAA: no se encontró loginCmsReturn. Respuesta: ' + res.data.slice(0, 300));
  }

  // loginCmsReturn contiene el XML del TA directamente (textContent decodificó &lt; → <)
  // NO aplicar base64 decode — hacerlo genera basura
  const taDoc  = new DOMParser().parseFromString(loginCmsReturn, 'text/xml');

  // El TA puede tener <credentials> o <header> + <credentials>
  const token  = taDoc.getElementsByTagName('token')[0]?.textContent?.trim();
  const sign   = taDoc.getElementsByTagName('sign')[0]?.textContent?.trim();
  const expStr = (
    taDoc.getElementsByTagName('expirationTime')[0] ||
    taDoc.getElementsByTagName('generationTime')[0]
  )?.textContent;

  if (!token || !sign) {
    console.error('[AFIP] TA XML parseado:', loginCmsReturn.slice(0, 500));
    throw new Error('WSAA: token o sign no encontrado en el TA');
  }

  const expiry = expStr ? new Date(expStr).getTime() : Date.now() + 12 * 3_600_000;

  tokenCache.set(cuit, { token, sign, expiry });
  console.log(`[AFIP] ✅ Token WSAA OK para CUIT ${cuit} — expira ${new Date(expiry).toISOString()}`);
  return { token, sign };
}

// ── PASO 2: Último número de comprobante ─────────────────────
async function getUltimoComprobante(cuit, ptoVta, tipoCbte, token, sign) {
  const soap = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Header/>
  <soapenv:Body>
    <ar:FECompUltimoAutorizado>
      <ar:Auth>
        <ar:Token>${token}</ar:Token>
        <ar:Sign>${sign}</ar:Sign>
        <ar:Cuit>${cuit}</ar:Cuit>
      </ar:Auth>
      <ar:PtoVta>${ptoVta}</ar:PtoVta>
      <ar:CbteTipo>${tipoCbte}</ar:CbteTipo>
    </ar:FECompUltimoAutorizado>
  </soapenv:Body>
</soapenv:Envelope>`;

  let ultimoData;
  try {
    const r = await axios.post(AFIP_URLS.wsfe, soap, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': 'http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado',
      },
      httpsAgent,
      timeout: 20_000,
      validateStatus: () => true,
    });
    console.log(`[AFIP] UltimoNro HTTP ${r.status}`);
    if (r.status !== 200) console.error('[AFIP] UltimoNro body:', r.data?.substring(0, 500));
    ultimoData = r.data;
  } catch (e) {
    throw new Error('WSFE UltimoNro error: ' + e.message);
  }
  const xml = new DOMParser().parseFromString(ultimoData, 'text/xml');
  const fault = xml.getElementsByTagName('faultstring')[0]?.textContent;
  if (fault) throw new Error('WSFE UltimoNro fault: ' + fault);
  return parseInt(xml.getElementsByTagName('CbteNro')[0]?.textContent || '0');
}

// ── PASO 3: Determinar tipo de comprobante ───────────────────
//
//  Regla AFIP:
//  - Monotributo          → siempre Factura C (tipo 11)
//  - RI con CUIT receptor → Factura A (tipo 1)
//  - RI con DNI receptor  → Factura B (tipo 6)
function getTipoComprobante(orden, userSettings) {
  const cat = userSettings.categoria || 'C';

  // Monotributo (categoría A-K) → siempre C
  if (/^[A-K]$/.test(cat)) return 11;

  // Responsable Inscripto
  const docLen = (orden.customerDoc || '').replace(/\D/g, '').length;
  if (docLen === 11) return 1;  // CUIT → Factura A
  return 6;                      // DNI/CF → Factura B
}

// ── PASO 4: Solicitar CAE al WSFE ────────────────────────────
async function solicitarCAE(orden, userSettings, token, sign) {
  const cuit    = userSettings.cuit.replace(/\D/g, '');
  const ptoVta  = parseInt(userSettings.arcaPtoVta || userSettings.puntoVenta || 1);
  const tipo    = getTipoComprobante(orden, userSettings);

  const ultimo  = await getUltimoComprobante(cuit, ptoVta, tipo, token, sign);
  const nroCbte = ultimo + 1;

  const ahora  = new Date();
  const fecha  = `${ahora.getFullYear()}${String(ahora.getMonth()+1).padStart(2,'0')}${String(ahora.getDate()).padStart(2,'0')}`;

  const docClean  = (orden.customerDoc || '99999999').replace(/\D/g, '');
  const tipoDoc   = docClean === '99999999' ? 99 : docClean.length === 11 ? 80 : 96;
  const nroDoc    = tipoDoc === 99 ? 0 : parseInt(docClean);
  const importe   = parseFloat(orden.amount.toFixed(2));

  // Importes según tipo de comprobante
  let impNeto  = importe;
  let impIVA   = 0;
  let ivaItems = '';

  if (tipo === 1) {
    // Factura A: discriminar IVA 21%
    impIVA  = parseFloat((importe / 1.21 * 0.21).toFixed(2));
    impNeto = parseFloat((importe - impIVA).toFixed(2));
    ivaItems = `
        <ar:Iva>
          <ar:AlicIva>
            <ar:Id>5</ar:Id>
            <ar:BaseImp>${impNeto}</ar:BaseImp>
            <ar:Importe>${impIVA}</ar:Importe>
          </ar:AlicIva>
        </ar:Iva>`;
  }

  const soap = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Header/>
  <soapenv:Body>
    <ar:FECAESolicitar>
      <ar:Auth>
        <ar:Token>${token}</ar:Token>
        <ar:Sign>${sign}</ar:Sign>
        <ar:Cuit>${cuit}</ar:Cuit>
      </ar:Auth>
      <ar:FeCAEReq>
        <ar:FeCabReq>
          <ar:CantReg>1</ar:CantReg>
          <ar:PtoVta>${ptoVta}</ar:PtoVta>
          <ar:CbteTipo>${tipo}</ar:CbteTipo>
        </ar:FeCabReq>
        <ar:FeDetReq>
          <ar:FECAEDetRequest>
            <ar:Concepto>1</ar:Concepto>
            <ar:DocTipo>${tipoDoc}</ar:DocTipo>
            <ar:DocNro>${nroDoc}</ar:DocNro>
            <ar:CbteDesde>${nroCbte}</ar:CbteDesde>
            <ar:CbteHasta>${nroCbte}</ar:CbteHasta>
            <ar:CbteFch>${fecha}</ar:CbteFch>
            <ar:ImpTotal>${importe}</ar:ImpTotal>
            <ar:ImpTotConc>0</ar:ImpTotConc>
            <ar:ImpNeto>${impNeto}</ar:ImpNeto>
            <ar:ImpOpEx>0</ar:ImpOpEx>
            <ar:ImpIVA>${impIVA}</ar:ImpIVA>
            <ar:ImpTrib>0</ar:ImpTrib>
            <ar:MonId>PES</ar:MonId>
            <ar:MonCotiz>1</ar:MonCotiz>${ivaItems}
          </ar:FECAEDetRequest>
        </ar:FeDetReq>
      </ar:FeCAEReq>
    </ar:FECAESolicitar>
  </soapenv:Body>
</soapenv:Envelope>`;

  // WSFE puede devolver HTTP 500 con el detalle del error en el body XML
  // No lanzar hasta parsear la respuesta
  console.log('[AFIP] POST WSFE →', AFIP_URLS.wsfe);

  let wsfeData;
  try {
    const wsfeResp = await axios.post(AFIP_URLS.wsfe, soap, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': 'http://ar.gov.afip.dif.FEV1/FECAESolicitar',
      },
      httpsAgent,
      timeout: 30_000,
      validateStatus: () => true,  // no lanzar en 4xx/5xx — parsear el body primero
    });
    console.log(`[AFIP] WSFE HTTP ${wsfeResp.status} — ${wsfeResp.data?.length} chars`);
    console.log('[AFIP] WSFE body:', wsfeResp.data?.substring(0, 1200));
    wsfeData = wsfeResp.data;
  } catch (e) {
    console.error('[AFIP] WSFE error de red:', e.message);
    throw new Error('WSFE error de red: ' + e.message);
  }

  const parser  = new DOMParser();
  const xml     = parser.parseFromString(wsfeData, 'text/xml');

  // Verificar SOAP Fault (HTTP 500 con detalle)
  const soapFault = xml.getElementsByTagName('faultstring')[0]?.textContent;
  if (soapFault) {
    console.error('[AFIP] SOAP Fault WSFE:', soapFault);
    throw new Error('WSFE SOAP Fault: ' + soapFault);
  }

  const detResp = xml.getElementsByTagName('FECAEDetResponse')[0];
  const result  = detResp?.getElementsByTagName('Resultado')[0]?.textContent;

  if (result !== 'A') {
    // Recopilar todos los errores de AFIP
    const errores = [];
    const errNodes = xml.getElementsByTagName('Err');
    for (let i = 0; i < errNodes.length; i++) {
      const msg  = errNodes[i].getElementsByTagName('Msg')[0]?.textContent;
      const code = errNodes[i].getElementsByTagName('Code')[0]?.textContent;
      if (msg) errores.push(`[${code}] ${msg}`);
    }
    const obsNodes = xml.getElementsByTagName('Obs');
    for (let i = 0; i < obsNodes.length; i++) {
      const msg = obsNodes[i].getElementsByTagName('Msg')[0]?.textContent;
      if (msg) errores.push(msg);
    }
    const errMsg = errores.join(' | ') || `Resultado=${result || 'vacío'}`;
    console.error('[AFIP] WSFE rechazó:', errMsg);
    throw new Error('AFIP rechazó: ' + errMsg);
  }

  const cae     = detResp.getElementsByTagName('CAE')[0]?.textContent;
  const caeVto  = detResp.getElementsByTagName('CAEFchVto')[0]?.textContent;
  const caeExpiry = caeVto
    ? new Date(`${caeVto.slice(0,4)}-${caeVto.slice(4,6)}-${caeVto.slice(6,8)}`)
    : null;

  return { cae, caeExpiry, nroCbte, tipo, ptoVta, importe, impNeto, impIVA };
}

// ── FUNCIÓN PRINCIPAL: emitirCAE ─────────────────────────────
async function emitirCAE(orderId, userOverride = null) {
  const orden = await Order.findById(orderId);
  if (!orden)                        throw new Error('Orden no encontrada');
  if (orden.status === 'invoiced')   throw new Error('Esta orden ya tiene CAE emitido');
  if (orden.status === 'error_data') throw new Error('Orden con datos incompletos — revisá el DNI/CUIT del cliente');

  const user = userOverride
    || await User.findById(orden.userId).select('settings').lean();

  if (!user?.settings?.cuit) throw new Error('Configurá tu CUIT en Configuración antes de emitir');

  try {
    const cuit         = user.settings.cuit.replace(/\D/g, '');
    const { token, sign } = await getAfipToken(cuit);
    const result       = await solicitarCAE(orden, user.settings, token, sign);

    // Armar número de comprobante formateado
    const ptoVtaStr = String(result.ptoVta).padStart(5, '0');
    const nroCbteStr = String(result.nroCbte).padStart(8, '0');
    const tipoLabel  = result.tipo === 11 ? 'C' : result.tipo === 1 ? 'A' : 'B';

    await Order.findByIdAndUpdate(orderId, {
      status:          'invoiced',
      caeNumber:       result.cae,
      caeExpiry:       result.caeExpiry,
      tipoComprobante: result.tipo,
      puntoVenta:      result.ptoVta,
      nroComprobante:  result.nroCbte,
      nroFormatted:    `FC ${tipoLabel} ${ptoVtaStr}-${nroCbteStr}`,
      fechaEmision:    new Date(),
      impNeto:         result.impNeto,
      impIVA:          result.impIVA,
      errorLog:        '',
    });

    console.log(`✅ CAE emitido: ${result.cae} | FC ${tipoLabel} ${ptoVtaStr}-${nroCbteStr} | $${result.importe} | Usuario ${orden.userId}`);

    // Envío automático si el usuario lo tiene activado
    if (user.settings?.envioAuto && orden.customerEmail) {
      enviarFacturaMail(orderId).catch(e => console.error('Mail auto-send error:', e.message));
    }

    return result;
  } catch(e) {
    await Order.findByIdAndUpdate(orderId, {
      status:   'error_afip',
      errorLog: e.message,
    });
    throw e;
  }
}

// ── Envío de factura por mail ─────────────────────────────────
async function enviarFacturaMail(orderId) {
  const orden = await Order.findById(orderId).lean();
  if (!orden?.customerEmail) return;
  // TODO: integrar nodemailer
  console.log(`📧 Factura lista para enviar: ${orden.customerEmail} | CAE ${orden.caeNumber} | ${orden.nroFormatted}`);
}

// ════════════════════════════════════════════════════════════
//  BULK SYNC ENGINE — Histórico completo al conectar
// ════════════════════════════════════════════════════════════
const BULK_SYNC = {

  async woocommerce(integration) {
    const key    = integration.getKey('consumerKey');
    const secret = integration.getKey('consumerSecret');
    const base   = integration.storeUrl;
    let page = 1, total = 0;
    while (true) {
      const { data } = await axios.get(`${base}/wp-json/wc/v3/orders`, {
        auth:   { username: key, password: secret },
        params: { per_page: 100, page, status: 'completed', orderby: 'date', order: 'desc' },
        timeout: 30_000,
      });
      if (!data?.length) break;
      await Promise.all(data.map(raw => upsertOrder(integration, normalize.woocommerce(raw))));
      total += data.length;
      if (data.length < 100) break;
      page++;
    }
    return total;
  },

  async tiendanube(integration) {
    const token   = integration.getKey('apiToken');
    const storeId = integration.storeId;
    let page = 1, total = 0;
    while (true) {
      const { data } = await axios.get(`https://api.tiendanube.com/v1/${storeId}/orders`, {
        headers: { Authentication: `bearer ${token}`, 'User-Agent': 'KOI-Factura/4.0' },
        params:  { per_page: 200, page, payment_status: 'paid' },
        timeout: 30_000,
      });
      if (!data?.length) break;
      await Promise.all(data.map(raw => upsertOrder(integration, normalize.tiendanube(raw))));
      total += data.length;
      if (data.length < 200) break;
      page++;
    }
    return total;
  },

  async mercadolibre(integration) {
    const accessToken = await _getMLToken(integration);
    const sellerId    = integration.credentials.sellerId;
    let offset = 0, total = 0;
    const LIMIT = 50;
    while (true) {
      const { data } = await axios.get('https://api.mercadolibre.com/orders/search', {
        headers: { Authorization: `Bearer ${accessToken}` },
        params:  { seller: sellerId, limit: LIMIT, offset, sort: 'date_desc' },
        timeout: 30_000,
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
    const apiKey   = integration.getKey('apiKey');
    const apiToken = integration.getKey('apiToken');
    const storeUrl = integration.storeUrl;
    let page = 1, total = 0;
    while (true) {
      const { data } = await axios.get(`${storeUrl}/api/oms/pvt/orders`, {
        headers: { 'X-VTEX-API-AppKey': apiKey, 'X-VTEX-API-AppToken': apiToken },
        params:  { page, per_page: 100, f_status: 'invoiced,payment-approved' },
        timeout: 30_000,
      });
      const orders = data.list || [];
      if (!orders.length) break;
      await Promise.all(orders.map(raw => upsertOrder(integration, normalize.vtex(raw))));
      total += orders.length;
      if (orders.length < 100) break;
      page++;
    }
    return total;
  },
};

// Disparar sync en background (no bloquea la respuesta HTTP)
function startBackgroundSync(integration) {
  const syncFn = BULK_SYNC[integration.platform];
  if (!syncFn) return;
  console.log(`🔄 Iniciando sync histórico: ${integration.platform} | ${integration.storeId}`);
  syncFn(integration)
    .then(count => {
      console.log(`✅ Sync completo: ${integration.platform} → ${count} órdenes`);
      return Integration.findByIdAndUpdate(integration._id, { lastSyncAt: new Date(), errorLog: '' });
    })
    .catch(async err => {
      console.error(`❌ Sync error [${integration.platform}]:`, err.message);
      await Integration.findByIdAndUpdate(integration._id, { errorLog: err.message });
    });
}

// ════════════════════════════════════════════════════════════
//  AUTH HELPERS
// ════════════════════════════════════════════════════════════
const signToken = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: '7d' });
const setTokenCookie = (res, token) => res.cookie('koi_token', token, {
  httpOnly: true, secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax', maxAge: 7*24*60*60*1000,
});
const requireAuth = (req, res, next) => {
  try { req.userId = jwt.verify(req.cookies.koi_token, JWT_SECRET).id; next(); }
  catch { res.clearCookie('koi_token'); res.redirect('/login'); }
};
const requireAuthAPI = (req, res, next) => {
  const token = req.cookies.koi_token || (req.headers.authorization||'').replace('Bearer ','');
  try { req.userId = jwt.verify(token, JWT_SECRET).id; next(); }
  catch { res.status(401).json({ error: 'No autenticado' }); }
};

// ════════════════════════════════════════════════════════════
//  PASSPORT GOOGLE
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
      user = await User.create({ googleId: profile.id, email,
        nombre: profile.name?.givenName || '', apellido: profile.name?.familyName || '',
        avatar: profile.photos?.[0]?.value || '' });
    } else {
      if (!user.googleId) user.googleId = profile.id;
      user.avatar = profile.photos?.[0]?.value || user.avatar;
      user.ultimoAcceso = new Date();
      await user.save();
    }
    done(null, user);
  } catch(e) { done(e); }
}));
passport.serializeUser((u, done) => done(null, u.id));
passport.deserializeUser(async (id, done) => {
  try { done(null, await User.findById(id).select('-password')); } catch(e) { done(e); }
});

// ════════════════════════════════════════════════════════════
//  RUTAS AUTH
// ════════════════════════════════════════════════════════════
app.get('/auth/google', passport.authenticate('google', { scope: ['profile','email'] }));
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=google_failed' }),
  (req, res) => { setTokenCookie(res, signToken(req.user.id)); res.redirect('/dashboard'); }
);

app.post('/auth/register', async (req, res) => {
  try {
    const { nombre, apellido, email, password } = req.body;
    if (!nombre || !email || !password) return res.status(400).json({ error: 'Faltan campos.' });
    if (password.length < 8) return res.status(400).json({ error: 'Mínimo 8 caracteres.' });
    if (await User.findOne({ email: email.toLowerCase() })) return res.status(409).json({ error: 'Email ya registrado.' });
    const user = await User.create({ nombre, apellido, email, password });
    setTokenCookie(res, signToken(user.id));
    res.json({ ok: true, user: { nombre: user.nombre, email: user.email } });
  } catch(e) { res.status(500).json({ error: 'Error interno.' }); }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos.' });
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user?.password || !await user.checkPassword(password))
      return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
    user.ultimoAcceso = new Date(); await user.save();
    setTokenCookie(res, signToken(user.id));
    res.json({ ok: true, user: { nombre: user.nombre, email: user.email } });
  } catch(e) { res.status(500).json({ error: 'Error interno.' }); }
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
  if (!user) return res.status(404).json({ error: 'No encontrado' });
  res.json({ ok: true, user });
});

app.patch('/api/me/settings', requireAuthAPI, async (req, res) => {
  try {
    const allowed = ['factAuto','envioAuto','categoria','cuit','razonSocial',
                     'puntoVenta','tipoComprobante','nombre','apellido'];
    const update = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) update[`settings.${k}`] = req.body[k];
    }
    // Encriptar arcaClave si viene
    if (req.body.arcaClave) update['settings.arcaClave'] = encrypt(req.body.arcaClave);
    const user = await User.findByIdAndUpdate(req.userId, { $set: update }, { new: true, select: '-password' }).lean();
    res.json({ ok: true, user });
  } catch(e) { res.status(500).json({ error: 'Error al guardar' }); }
});

// ════════════════════════════════════════════════════════════
//  API — EMISIÓN CAE
// ════════════════════════════════════════════════════════════

// Emitir CAE de una orden específica (manual desde dashboard)
app.post('/api/orders/:id/emitir', requireAuthAPI, async (req, res) => {
  try {
    const orden = await Order.findOne({ _id: req.params.id, userId: req.userId });
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

    const user = await User.findById(req.userId).select('settings').lean();
    const result = await emitirCAE(orden._id, user);

    res.json({
      ok:    true,
      cae:   result.cae,
      vto:   result.caeExpiry,
      nroCbte: result.nroCbte,
      message: `CAE emitido: ${result.cae}`,
    });
  } catch(e) {
    console.error('Emitir CAE error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Emitir CAE en lote (todas las pending_invoice del usuario)
app.post('/api/orders/emitir-lote', requireAuthAPI, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('settings').lean();
    if (!user?.settings?.cuit) return res.status(400).json({ error: 'Configurá tu CUIT primero' });

    const pendientes = await Order.find({ userId: req.userId, status: 'pending_invoice' }).limit(50);
    if (!pendientes.length) return res.json({ ok: true, message: 'No hay órdenes pendientes', count: 0 });

    res.json({ ok: true, message: `Emitiendo ${pendientes.length} comprobantes en background`, count: pendientes.length });

    // Emitir en background con delay para no saturar AFIP
    for (const orden of pendientes) {
      await emitirCAE(orden._id, user).catch(e => console.error(`Lote error [${orden._id}]:`, e.message));
      await new Promise(r => setTimeout(r, 500)); // 500ms entre llamadas
    }
    console.log(`✅ Lote completado: ${pendientes.length} órdenes para usuario ${req.userId}`);
  } catch(e) {
    console.error('Lote error:', e.message);
  }
});
// ════════════════════════════════════════════════════════════
//  API — PDF DE FACTURA (usando EJS)
// ════════════════════════════════════════════════════════════

// Configurar EJS (path ya está declarado al inicio del archivo)
const ejs = require('ejs');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ... resto del código igual
// ════════════════════════════════════════════════════════════
//  API — STATS CON FILTRO DE PERÍODO
// ════════════════════════════════════════════════════════════
app.get('/api/stats/dashboard', requireAuthAPI, async (req, res) => {
  try {
    const { platform, desde, hasta } = req.query;

    const match = { 
      userId: new mongoose.Types.ObjectId(req.userId),
      status: { $ne: 'skipped' }
    };
    if (platform) match.platform = platform;

    // Período — por defecto mes actual
    const ahora  = new Date();
    const initMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    const finMes  = new Date(ahora.getFullYear(), ahora.getMonth()+1, 0, 23, 59, 59);

    match.createdAt = {
      $gte: desde ? new Date(desde) : initMes,
      $lte: hasta ? new Date(hasta) : finMes,
    };

    const matchFacturado = {
      ...match,
      status: 'invoiced',
    };

    // 👇 VENTAS PARA EL GRÁFICO (TODAS las órdenes, NO filtrar por facturación)
    const ventasAgrupadas = await Order.aggregate([
      { 
        $match: { 
          userId: new mongoose.Types.ObjectId(req.userId),
          amount: { $gt: 0 },
          createdAt: { $gte: match.createdAt.$gte, $lte: match.createdAt.$lte }
        } 
      },
      { 
        $group: {
          _id: { 
            $dateToString: { 
              format: '%Y-%m-%d', 
              date: '$createdAt',
              timezone: '-03:00' 
            } 
          },
          total: { $sum: '$amount' },
        }
      },
      { $sort: { _id: 1 } },
    ]);

    // Generar arrays para el gráfico (días del 1 al 30/31)
    const diasEnMes = new Date(match.createdAt.$lte).getDate();
    const chartDias = [];
    const chartVentas = [];

    // Inicializar arrays con ceros
    for (let i = 1; i <= diasEnMes; i++) {
      chartDias.push(i.toString().padStart(2, '0'));
      chartVentas.push(0);
    }

    // Llenar con los montos reales
    ventasAgrupadas.forEach(v => {
      const dia = parseInt(v._id.split('-')[2]);
      const idx = dia - 1;
      if (idx >= 0 && idx < chartVentas.length) {
        chartVentas[idx] = v.total;
      }
    });

    // 👇 FACTURADO DE HOY (usando fechaEmision)
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const manana = new Date(hoy);
    manana.setDate(manana.getDate() + 1);

    const hoyFacturado = await Order.aggregate([
      { 
        $match: { 
          userId: new mongoose.Types.ObjectId(req.userId),
          status: 'invoiced',
          fechaEmision: { $gte: hoy, $lt: manana }
        }
      },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]);

    const [totalesIngresos, totalesFacturado, porPlataforma, ultimas, pendientes] = await Promise.all([

      // Total ingresos del período
      Order.aggregate([
        { $match: match },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),

      // Total facturado del período
      Order.aggregate([
        { $match: matchFacturado },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),

      // Desglose por plataforma
      Order.aggregate([
        { $match: match },
        { $group: { _id: '$platform', total: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $sort: { total: -1 } },
      ]),

      // Últimas 50 órdenes del período
      Order.find(match)
        .sort({ createdAt: -1 })
        .limit(50)
        .select('platform externalId customerName customerEmail amount currency status caeNumber createdAt tipoComprobante puntoVenta nroComprobante items concepto')
        .lean(),

      // Pendientes sin CAE
      Order.countDocuments({ 
        userId: req.userId, 
        status: 'pending_invoice',
        createdAt: { $gte: match.createdAt.$gte, $lte: match.createdAt.$lte }
      }),
    ]);

    res.json({
      ok:             true,
      periodo:        { desde: match.createdAt.$gte, hasta: match.createdAt.$lte },
      totalMonto:     totalesIngresos[0]?.total  || 0,
      totalOrden:     totalesIngresos[0]?.count  || 0,
      totalFacturado: totalesFacturado[0]?.total || 0,
      totalFacturas:  totalesFacturado[0]?.count || 0,
      pendientesCAE:  pendientes,
      plataformas:    porPlataforma,
      chartDias:      chartDias,
      chartVentas:    chartVentas,
      ultimas,
      hoyMonto:       hoyFacturado[0]?.total || 0,
      hoyCount:       hoyFacturado[0]?.count || 0,
    });
  } catch(e) {
    console.error('Stats error:', e.message);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// ════════════════════════════════════════════════════════════
//  API — ORDERS
// ════════════════════════════════════════════════════════════
app.get('/api/orders', requireAuthAPI, async (req, res) => {
  try {
    const { 
      platform, 
      status, 
      desde, 
      hasta, 
      page = 1, 
      limit = 25,
      search = '' 
    } = req.query;
    
    const filter = { 
      userId: req.userId,
      status: { $ne: 'skipped' },
      $and: [
        {
          $or: [
            { items: { $exists: true, $ne: [] } },
            { concepto: { $exists: true, $ne: '', $nin: ['Venta WooCommerce', 'woocommerce', null] } }
          ]
        }
      ]
    };
    
    if (platform) filter.platform = platform;
    if (status)   filter.status   = status;
    if (desde || hasta) {
      filter.createdAt = {};
      if (desde) filter.createdAt.$gte = new Date(desde);
      if (hasta) filter.createdAt.$lte = new Date(hasta);
    }
    
    if (search && search.trim()) {
      filter.$and.push({
        $or: [
          { customerName: { $regex: search, $options: 'i' } },
          { customerEmail: { $regex: search, $options: 'i' } },
          { concepto: { $regex: search, $options: 'i' } },
          { externalId: { $regex: search, $options: 'i' } }
        ]
      });
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = Math.min(parseInt(limit), 100);
    
    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Order.countDocuments(filter)
    ]);
    
    const ordersWithSummary = orders.map(order => ({
      ...order,
      itemsSummary: order.items?.map(i => `${i.cantidad}x ${i.nombre}`).join(', ') || order.concepto || ''
    }));
    
    res.json({ 
      ok: true, 
      orders: ordersWithSummary,
      pagination: {
        page: parseInt(page),
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch(e) { 
    console.error('Orders error:', e.message);
    res.status(500).json({ error: 'Error interno' }); 
  }
});

// ════════════════════════════════════════════════════════════
//  API — INTEGRACIONES
// ════════════════════════════════════════════════════════════
app.get('/api/integrations', requireAuthAPI, async (req, res) => {
  const list = await Integration.find({ userId: req.userId })
    .select('-credentials -webhookSecret').lean();
  res.json({ ok: true, integrations: list });
});

app.patch('/api/integrations/:id/status', requireAuthAPI, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active','paused'].includes(status)) return res.status(400).json({ error: 'Status inválido' });
    const doc = await Integration.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId }, { status },
      { new: true, select: '-credentials -webhookSecret' }
    );
    if (!doc) return res.status(404).json({ error: 'No encontrada' });
    res.json({ ok: true, integration: doc });
  } catch(e) { res.status(500).json({ error: 'Error interno' }); }
});

app.delete('/api/integrations/:id', requireAuthAPI, async (req, res) => {
  try {
    const doc = await Integration.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!doc) return res.status(404).json({ error: 'No encontrada' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Error interno' }); }
});

app.post('/api/integrations/:id/sync', requireAuthAPI, async (req, res) => {
  try {
    const integration = await Integration.findOne({ _id: req.params.id, userId: req.userId });
    if (!integration) return res.status(404).json({ error: 'No encontrada' });
    if (integration.status !== 'active') return res.status(400).json({ error: 'Integración inactiva' });
    if (!BULK_SYNC[integration.platform]) return res.status(400).json({ error: `Sync no disponible para ${integration.platform}` });
    res.json({ ok: true, message: 'Sincronización histórica iniciada en background' });
    startBackgroundSync(integration);
  } catch(e) { res.status(500).json({ error: 'Error interno' }); }
});

app.get('/api/integrations/:id/webhook', requireAuthAPI, async (req, res) => {
  const doc = await Integration.findOne({ _id: req.params.id, userId: req.userId }).select('platform webhookSecret');
  if (!doc) return res.status(404).json({ error: 'No encontrada' });
  res.json({ ok: true, url: `${BASE}/webhook/${doc.platform}/${doc.webhookSecret}` });
});

// Conectar por token (TiendaNube, Empretienda, Rappi, VTEX)
app.post('/api/integrations/:platform', requireAuthAPI, async (req, res) => {
  const { platform } = req.params;
  const TOKEN_PLATFORMS = ['tiendanube','empretienda','rappi','vtex','shopify'];
  if (!TOKEN_PLATFORMS.includes(platform)) return res.status(400).json({ error: 'Plataforma no soportada' });

  try {
    const { storeId, storeName, storeUrl, apiToken, apiKey, apiSecret } = req.body;
    if (!storeId) return res.status(400).json({ error: 'storeId requerido' });

    const creds = {};
    if (apiToken)  creds.apiToken  = encrypt(apiToken);
    if (apiKey)    creds.apiKey    = encrypt(apiKey);
    if (apiSecret) creds.apiSecret = encrypt(apiSecret);

    const integration = await Integration.findOneAndUpdate(
      { userId: req.userId, platform, storeId: String(storeId) },
      { $set: { storeName: storeName||`${platform} ${storeId}`, storeUrl: storeUrl||'',
          status: 'active', errorLog: '', credentials: creds, updatedAt: new Date() },
        $setOnInsert: { userId: req.userId, platform, storeId: String(storeId), createdAt: new Date() } },
      { upsert: true, new: true }
    );

    if (platform === 'tiendanube' && apiToken)
      await _registerWebhookTiendaNube(integration, apiToken).catch(console.warn);

    res.json({ ok: true, message: `${platform} conectado. Sincronizando historial...` });

    // Sync histórico automático al conectar
    startBackgroundSync(integration);
  } catch(e) {
    console.error(`Connect ${platform}:`, e.message);
    res.status(500).json({ error: 'Error al conectar' });
  }
});

// ════════════════════════════════════════════════════════════
//  API — BACKFILL CONCEPTO (rellenar productos en órdenes históricas)
//
//  Para cada orden sin concepto real, consulta la API de WooCommerce
//  y actualiza los campos concepto + items.
//  Responde inmediato y procesa en background.
// ════════════════════════════════════════════════════════════
app.post('/api/integrations/:id/backfill-concepto', requireAuthAPI, async (req, res) => {
  try {
    const integration = await Integration.findOne({ _id: req.params.id, userId: req.userId });
    if (!integration) return res.status(404).json({ error: 'Integración no encontrada' });
    if (integration.platform !== 'woocommerce')
      return res.status(400).json({ error: 'Solo disponible para WooCommerce por ahora' });

    // Contar órdenes sin concepto real (misma query que usa el backfill)
    const sinConcepto = await Order.countDocuments({
      userId:   new mongoose.Types.ObjectId(req.userId),
      platform: 'woocommerce',
      status:   { $ne: 'skipped' },
      $or: [
        { concepto: { $exists: false } },
        { concepto: { $in: ['', 'woocommerce', 'Venta WooCommerce'] } },
        { items:    { $exists: false } },
      ],
    });

    res.json({ ok: true, pendientes: sinConcepto, message: `Actualizando ${sinConcepto} órdenes en background…` });

    // Procesar en background
    _backfillConceptoWoo(integration, req.userId).catch(e =>
      console.error('[Backfill] Error:', e.message)
    );
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

async function _backfillConceptoWoo(integration, userId) {
  const key    = integration.getKey('consumerKey');
  const secret = integration.getKey('consumerSecret');
  const base   = integration.storeUrl;

  // Buscar todas las órdenes WooCommerce del usuario que no tienen concepto real
  // Usamos regex para detectar valores genéricos/vacíos
  const ordenes = await Order.find({
    userId:   new mongoose.Types.ObjectId(userId),
    platform: 'woocommerce',
    status:   { $ne: 'skipped' },
    $or: [
      { concepto: { $exists: false } },
      { concepto: { $in: ['', 'woocommerce', 'Venta WooCommerce'] } },
      { items:    { $exists: false } },
    ],
  }).select('_id externalId').lean();

  console.log(`[Backfill] Iniciando — ${ordenes.length} órdenes a procesar`);
  if (!ordenes.length) {
    console.log('[Backfill] No hay órdenes pendientes');
    return;
  }

  let ok = 0, skipped = 0, err = 0;

  // Procesar DE A UNA para no saturar WooCommerce y que cada error sea aislado
  for (const orden of ordenes) {
    try {
      // Obtener detalle completo de la orden desde WooCommerce
      const resp = await axios.get(
        `${base}/wp-json/wc/v3/orders/${orden.externalId}`,
        {
          auth:    { username: key, password: secret },
          timeout: 20_000,
          validateStatus: () => true,  // no lanzar en 404 etc
        }
      );

      if (resp.status === 404) {
        // Orden eliminada en WooCommerce
        await Order.updateOne(
          { _id: orden._id },
          { $set: { concepto: 'Orden eliminada en WooCommerce', status: 'skipped' } }
        );
        skipped++;
        continue;
      }

      if (resp.status !== 200) {
        console.warn(`[Backfill] HTTP ${resp.status} para orden ${orden.externalId}`);
        err++;
        continue;
      }

      const raw = resp.data;

      // Solo procesar órdenes con pago acreditado
      if (raw.status && raw.status !== 'completed') {
        await Order.updateOne(
          { _id: orden._id },
          { $set: { concepto: `Sin acreditar (${raw.status})`, status: 'skipped' } }
        );
        skipped++;
        continue;
      }

      // Extraer líneas de producto
      const items = (raw.line_items || []).map(li => ({
        nombre:   li.name     || 'Producto',
        cantidad: li.quantity || 1,
        precio:   parseFloat(li.price || (parseFloat(li.subtotal || 0) / (li.quantity || 1)) || 0),
        sku:      li.sku      || '',
      }));

      const concepto = items.length
        ? items.map(li => li.nombre).join(', ')
        : 'Productos WooCommerce';

      const orderDate = raw.date_paid
        ? new Date(raw.date_paid)
        : raw.date_completed
          ? new Date(raw.date_completed)
          : raw.date_created
            ? new Date(raw.date_created)
            : undefined;

      await Order.updateOne(
        { _id: orden._id },
        { $set: { concepto, items, ...(orderDate ? { orderDate } : {}) } }
      );

      ok++;

      // Log cada 50 órdenes
      if (ok % 50 === 0) console.log(`[Backfill] Progreso: ${ok}/${ordenes.length}`);

      // Pequeña pausa para no saturar WooCommerce
      await new Promise(r => setTimeout(r, 150));

    } catch(e) {
      err++;
      console.warn(`[Backfill] Error orden ${orden.externalId}:`, e.message);
      await new Promise(r => setTimeout(r, 500)); // pausa extra tras error
    }
  }

  console.log(`[Backfill] ✅ Completado — OK: ${ok} | Skipped: ${skipped} | Errores: ${err}`);
}

// ════════════════════════════════════════════════════════════
//  WOOCOMMERCE OAUTH
// ════════════════════════════════════════════════════════════
app.get('/auth/woo/connect', requireAuth, (req, res) => {
  const { store_url } = req.query;
  if (!store_url) return res.status(400).send('Falta store_url');
  const clean    = store_url.replace(/\/$/, '').toLowerCase();
  const state    = jwt.sign({ userId: req.userId, storeUrl: clean }, JWT_SECRET, { expiresIn: '15m' });
  const callback = `${BASE}/auth/woo/callback?state=${encodeURIComponent(state)}`;
  const ret      = `${BASE}/dashboard?woo=connected`;
  res.redirect(`${clean}/wc-auth/v1/authorize?app_name=KOI-Factura&scope=read_write&user_id=${req.userId}&return_url=${encodeURIComponent(ret)}&callback_url=${encodeURIComponent(callback)}`);
});

app.post('/auth/woo/callback', async (req, res) => {
  res.status(200).json({ status: 'ok' });
  const { state }                    = req.query;
  const { consumer_key, consumer_secret } = req.body;
  try {
    const { userId, storeUrl } = jwt.verify(state, JWT_SECRET);
    const integration = await Integration.findOneAndUpdate(
      { userId, platform: 'woocommerce', storeId: storeUrl },
      { $set: { storeName: storeUrl.replace(/^https?:\/\//,''), storeUrl, status: 'active', errorLog: '',
          credentials: { consumerKey: encrypt(consumer_key), consumerSecret: encrypt(consumer_secret) },
          updatedAt: new Date() },
        $setOnInsert: { userId, platform: 'woocommerce', storeId: storeUrl, createdAt: new Date() } },
      { upsert: true, new: true }
    );
    await _registerWebhookWoo(integration, consumer_key, consumer_secret, storeUrl);
    console.log(`✅ WooCommerce conectado: ${storeUrl}`);
    // Sync histórico automático
    startBackgroundSync(integration);
  } catch(e) { console.error('WooCommerce callback:', e.message); }
});

async function _registerWebhookWoo(integration, key, secret, storeUrl) {
  const wh = `${BASE}/webhook/woocommerce/${integration.webhookSecret}`;
  try {
    const { data: existing } = await axios.get(`${storeUrl}/wp-json/wc/v3/webhooks`,
      { auth: { username: key, password: secret }, params: { per_page: 100 } });
    if (existing?.some(w => w.delivery_url === wh)) return;
    await axios.post(`${storeUrl}/wp-json/wc/v3/webhooks`,
      { name: 'KOI-Factura', topic: 'order.created', delivery_url: wh, status: 'active' },
      { auth: { username: key, password: secret } });
    console.log(`🔌 WooCommerce webhook: ${storeUrl}`);
  } catch(e) { console.warn('WooCommerce webhook:', e.message); }
}

async function _registerWebhookTiendaNube(integration, apiToken) {
  const wh = `${BASE}/webhook/tiendanube/${integration.webhookSecret}`;
  await axios.post(`https://api.tiendanube.com/v1/${integration.storeId}/webhooks`,
    { event: 'order/paid', url: wh },
    { headers: { Authentication: `bearer ${apiToken}`, 'User-Agent': 'KOI-Factura/4.0' } });
}

// ════════════════════════════════════════════════════════════
//  MERCADOLIBRE OAUTH
// ════════════════════════════════════════════════════════════
app.get('/auth/ml/connect', requireAuth, (req, res) => {
  const state = jwt.sign({ userId: req.userId }, JWT_SECRET, { expiresIn: '15m' });
  res.redirect(`https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=${process.env.ML_CLIENT_ID}&redirect_uri=${encodeURIComponent(`${BASE}/auth/ml/callback`)}&state=${encodeURIComponent(state)}`);
});

app.get('/auth/ml/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.redirect('/dashboard?error=ml_denied');
  try {
    const { userId } = jwt.verify(state, JWT_SECRET);
    const { data: token } = await axios.post('https://api.mercadolibre.com/oauth/token', {
      grant_type: 'authorization_code', client_id: process.env.ML_CLIENT_ID,
      client_secret: process.env.ML_CLIENT_SECRET, code, redirect_uri: `${BASE}/auth/ml/callback`,
    });
    const { data: seller } = await axios.get('https://api.mercadolibre.com/users/me',
      { headers: { Authorization: `Bearer ${token.access_token}` } });
    const sellerId = String(token.user_id || seller.id);
    const integration = await Integration.findOneAndUpdate(
      { userId, platform: 'mercadolibre', storeId: sellerId },
      { $set: { storeName: seller.nickname||`ML ${sellerId}`, status: 'active', errorLog: '',
          credentials: { accessToken: encrypt(token.access_token), refreshToken: encrypt(token.refresh_token),
            tokenExpiry: new Date(Date.now()+token.expires_in*1000).toISOString(), sellerId },
          updatedAt: new Date() },
        $setOnInsert: { userId, platform: 'mercadolibre', storeId: sellerId, createdAt: new Date() } },
      { upsert: true, new: true }
    );
    console.log(`✅ MercadoLibre: seller ${sellerId}`);
    res.redirect('/dashboard?ml=connected');
    // Sync histórico automático
    startBackgroundSync(integration);
  } catch(e) { console.error('ML callback:', e.message); res.redirect('/dashboard?error=ml_failed'); }
});

async function _getMLToken(integration) {
  const expiry = new Date(integration.credentials.tokenExpiry || 0);
  const accessToken = decrypt(integration.credentials.accessToken);
  if (expiry > new Date(Date.now() + 10*60*1000)) return accessToken;
  const { data } = await axios.post('https://api.mercadolibre.com/oauth/token', {
    grant_type: 'refresh_token', client_id: process.env.ML_CLIENT_ID,
    client_secret: process.env.ML_CLIENT_SECRET, refresh_token: decrypt(integration.credentials.refreshToken),
  });
  await Integration.findByIdAndUpdate(integration._id, {
    'credentials.accessToken':  encrypt(data.access_token),
    'credentials.refreshToken': encrypt(data.refresh_token),
    'credentials.tokenExpiry':  new Date(Date.now()+data.expires_in*1000).toISOString(),
  });
  return data.access_token;
}

// ════════════════════════════════════════════════════════════
//  WEBHOOKS UNIVERSALES
// ════════════════════════════════════════════════════════════
async function handleWebhook(platform, secret, getCanonical) {
  const integration = await Integration.findOne({ platform, webhookSecret: secret, status: 'active' });
  if (!integration) return console.warn(`⚠️  Webhook ${platform}: secret desconocido`);
  try {
    const canonical = await getCanonical(integration);
    if (canonical) await upsertOrder(integration, canonical);
  } catch(e) { console.error(`❌ Webhook ${platform}:`, e.message); }
}

app.post('/webhook/woocommerce/:secret', async (req, res) => {
  res.status(200).send('OK');
  await handleWebhook('woocommerce', req.params.secret, () => normalize.woocommerce(req.body));
});
app.post('/webhook/tiendanube/:secret', async (req, res) => {
  res.status(200).send('OK');
  await handleWebhook('tiendanube', req.params.secret, async (i) => {
    const token = i.getKey('apiToken');
    const { data } = await axios.get(`https://api.tiendanube.com/v1/${i.storeId}/orders/${req.body.id}`,
      { headers: { Authentication: `bearer ${token}`, 'User-Agent': 'KOI-Factura/4.0' } });
    return normalize.tiendanube(data);
  });
});
app.post('/webhook/mercadolibre/:secret', async (req, res) => {
  res.status(200).send('OK');
  const { topic, resource } = req.body;
  if (!['orders_v2','orders'].includes(topic)) return;
  await handleWebhook('mercadolibre', req.params.secret, async (i) => {
    const token = await _getMLToken(i);
    const url   = resource.startsWith('http') ? resource : `https://api.mercadolibre.com${resource}`;
    const { data } = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
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
//  PÁGINAS HTML
// ════════════════════════════════════════════════════════════
const isLoggedIn = (req) => {
  try { jwt.verify(req.cookies.koi_token, JWT_SECRET); return true; } catch { return false; }
};
app.get('/', (req, res) => res.redirect(isLoggedIn(req) ? '/dashboard' : '/login'));
app.get('/login', (req, res) => isLoggedIn(req) ? res.redirect('/dashboard') : res.sendFile(path.join(__dirname,'public','login.html')));
app.get('/dashboard', requireAuth, (req, res) => res.sendFile(path.join(__dirname,'public','index.html')));
app.get('/health', (_, res) => res.json({ status: 'ok', ts: Date.now() }));

// ════════════════════════════════════════════════════════════
//  HEALTH CHECK — Para keep-alive y monitoreo
// ════════════════════════════════════════════════════════════
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});


// ════════════════════════════════════════════════════════════
//  KEEP-ALIVE — Anti cold-start Render free tier (MEJORADO)
// ════════════════════════════════════════════════════════════
setTimeout(() => {
  if (!process.env.BASE_URL) return;
  
  const ping = async () => {
    try {
      const res = await axios.get(`${BASE}/health`, { timeout: 15000 });
      if (res.status === 200) {
        console.log(`🏓 Keep-alive OK [${new Date().toISOString()}]`);
      }
    } catch (e) {
      console.warn(`⚠️ Ping falló: ${e.message}`);
      // Si falla, reintentar después de 30 segundos
      setTimeout(ping, 30000);
    }
  };
  
  // Ping cada 5 minutos (más frecuente)
  ping();
  setInterval(ping, 5 * 60 * 1000);
}, 5000); // Empezar a los 5 segundos

// ════════════════════════════════════════════════════════════
//  START
// ════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`🚀 KOI-Factura v4.0 | Puerto ${PORT} | ${BASE}`);
});
