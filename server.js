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
  concepto:      { type: String, default: '' },   // descripción del producto/servicio
  items: [{                                        // líneas de detalle del pedido
    nombre:   { type: String },
    cantidad: { type: Number, default: 1 },
    precio:   { type: Number },
    sku:      { type: String },
  }],
  orderDate:     { type: Date },                  // fecha real de la orden en la plataforma
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
//  API — PDF DE FACTURA (template Sono Handmade)
// ════════════════════════════════════════════════════════════
app.get('/api/orders/:id/pdf', requireAuthAPI, async (req, res) => {
  try {
    const orden = await Order.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

    const user = await User.findById(req.userId)
      .select('nombre apellido settings').lean();

    // ── Datos del emisor ────────────────────────────────────
    const nombreFantasia = user?.settings?.razonSocial
      || `${user?.nombre||''} ${user?.apellido||''}`.trim()
      || 'Sono Handmade';
    const razonSocial = user?.settings?.razonSocial || nombreFantasia;
    const cuitRaw     = user?.settings?.cuit || '';
    const cuitFmt     = cuitRaw.replace(/(\d{2})(\d{8})(\d)/, '$1-$2-$3');

    // ── Datos del comprobante ───────────────────────────────
    const ptoVta  = String(orden.puntoVenta  || user?.settings?.arcaPtoVta || 1).padStart(4, '0');
    const nroCbte = String(orden.nroComprobante || 0).padStart(8, '0');
    const nroComp = `${ptoVta}-${nroCbte}`;
    const fecha   = (orden.orderDate || orden.createdAt)
      ? new Date(orden.orderDate || orden.createdAt)
          .toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' })
      : '—';

    // ── Importes ────────────────────────────────────────────
    const fmtARS = n => new Intl.NumberFormat('es-AR', {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    }).format(n || 0);

    // ── Items / líneas de detalle ───────────────────────────
    const items = orden.items?.length
      ? orden.items
      : [{ nombre: orden.concepto || 'Productos / Servicios', cantidad: 1, precio: orden.amount }];

    const filasItems = items.map(item => {
      const subtotal = (item.precio || 0) * (item.cantidad || 1);
      return `<tr>
        <td>${item.nombre || 'Producto'}</td>
        <td>${item.cantidad || 1}</td>
        <td>$ ${fmtARS(item.precio || 0)}</td>
        <td>$ ${fmtARS(subtotal)}</td>
      </tr>`;
    }).join('');

    // ── CAE ─────────────────────────────────────────────────
    const caeNum = orden.caeNumber || null;
    const caeVto = orden.caeExpiry
      ? new Date(orden.caeExpiry).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' })
      : '—';
    const caeDisplay = caeNum || '(pendiente)';

    // ── QR AFIP ─────────────────────────────────────────────
    // URL según spec AFIP: https://www.afip.gob.ar/fe/qr/?p=BASE64(json)
    let urlQrAfip = null;
    if (caeNum && cuitRaw) {
      const qrData = {
        ver:  1,
        fecha,
        cuit: parseInt(cuitRaw.replace(/\D/g,'')),
        ptoVta: parseInt(ptoVta),
        tipoCmp: orden.tipoComprobante || 11,
        nroCmp:  orden.nroComprobante  || 0,
        importe: orden.amount,
        moneda:  'PES',
        ctz:     1,
        tipoDocRec: 99,
        nroDocRec:  0,
        tipoCodAut: 'E',
        codAut: parseInt(caeNum),
      };
      const b64 = Buffer.from(JSON.stringify(qrData)).toString('base64');
      urlQrAfip = `https://www.afip.gob.ar/fe/qr/?p=${b64}`;
    }

    const html = _templateSono({
      nombreFantasia, razonSocial, cuitFmt, nroComp, fecha,
      filasItems,
      total:      fmtARS(orden.amount),
      caeDisplay,
      caeVto,
      urlQrAfip,
      sinCae:     !caeNum,
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="FC-${nroComp}.html"`);
    res.send(html);
  } catch(e) {
    console.error('PDF error:', e.message);
    res.status(500).json({ error: 'Error generando comprobante: ' + e.message });
  }
});

function _templateSono(d) {
  return `<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Factura C N° ${d.nroComp}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'DM Sans',sans-serif;background:#f0ebe3;padding:24px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .page{max-width:780px;margin:auto;background:#fff;border-radius:4px;overflow:hidden}
    .no-print{text-align:center;padding:20px;font-family:'DM Sans',sans-serif}
    .no-print button{background:#e28a71;color:#fff;border:none;padding:12px 28px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;margin-right:8px}
    .no-print button.sec{background:#f0ebe3;color:#6b4f3a}

    /* ── BORRADOR ── */
    .draft-banner{background:#fff3cd;border-bottom:2px solid #ffc107;padding:10px 36px;font-size:12px;font-weight:600;color:#856404;text-align:center}

    /* ── BARRA COLOR ── */
    .color-bar{height:6px;background:linear-gradient(90deg,#e28a71 0%,#c9a882 50%,#b2936f 100%)}

    /* ── HEADER ── */
    .header{padding:44px 52px 36px;display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #f0ebe3}
    .marca{font-family:'Syne',sans-serif;font-size:36px;font-weight:800;color:#e28a71;letter-spacing:-1.5px;line-height:1;margin-bottom:8px}
    .razon{font-size:11px;font-weight:400;color:#b2936f;letter-spacing:.5px;margin-bottom:2px}
    .cuit-line{font-size:11px;color:#c9b8a8}
    .comp-block{text-align:right}
    .comp-label{font-size:10px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:#c9a882;margin-bottom:4px}
    .comp-nro{font-family:'Syne',sans-serif;font-size:32px;font-weight:800;color:#2e1f14;letter-spacing:-1px;line-height:1;margin-bottom:10px}
    .comp-fecha{font-size:12px;color:#8c7060;line-height:1.8}

    /* ── BODY ── */
    .body{padding:40px 52px}

    /* ── TABLA ── */
    .tabla-items{width:100%;border-collapse:collapse;margin-bottom:0}
    .tabla-items thead tr th{font-size:9px;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;color:#c9a882;padding:0 0 14px;border-bottom:1px solid #f0ebe3}
    .tabla-items thead tr th:not(:first-child){text-align:right}
    .tabla-items tbody tr td{padding:18px 0;font-size:14px;color:#2e1f14;border-bottom:1px solid #f9f5f0;vertical-align:top}
    .tabla-items tbody tr td:not(:first-child){text-align:right;color:#6b4f3a}
    .tabla-items tbody tr:last-child td{border-bottom:none}

    /* ── TOTAL ── */
    .total-section{display:flex;justify-content:flex-end;padding:24px 0 40px;border-top:1px solid #f0ebe3}
    .total-inner{display:flex;align-items:baseline;gap:16px}
    .total-label{font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#c9a882}
    .total-amount{font-family:'Syne',sans-serif;font-size:38px;font-weight:800;color:#e28a71;letter-spacing:-1.5px;line-height:1}

    /* ── FOOTER AFIP ── */
    .footer-afip{margin:0 52px 40px;padding:20px 24px;background:#fdf8f4;border:1px solid #f0ebe3;border-left:3px solid #e28a71;border-radius:0 4px 4px 0;display:flex;align-items:center;gap:24px}
    .qr-wrap{flex-shrink:0;width:90px;height:90px;background:#fff;border:1px solid #e8ddd5;border-radius:4px;display:flex;align-items:center;justify-content:center;overflow:hidden}
    .qr-wrap img{width:90px;height:90px;display:block}
    .qr-placeholder{font-size:9px;color:#c9b8a8;text-align:center;padding:8px}
    .cae-info{flex:1}
    .cae-label{font-size:9px;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;color:#e28a71;margin-bottom:6px}
    .cae-num{font-family:'Syne',sans-serif;font-size:15px;font-weight:700;color:#2e1f14;margin-bottom:3px;letter-spacing:-.3px}
    .cae-vto{font-size:12px;color:#8c7060;margin-bottom:10px}
    .cae-ok{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:600;color:#2d6a4f;letter-spacing:.5px}
    .cae-ok::before{content:'';width:6px;height:6px;border-radius:50%;background:#2d6a4f;flex-shrink:0}
    .cae-pending{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:600;color:#856404;letter-spacing:.5px}
    .cae-pending::before{content:'';width:6px;height:6px;border-radius:50%;background:#ffc107;flex-shrink:0}

    /* ── KOI BADGE ── */
    .koi-inline{display:flex;align-items:center;gap:7px;margin-top:12px;padding:6px 12px;background:#080810;border-radius:6px;width:fit-content;border:1px solid rgba(0,230,118,0.2)}
    .koi-inline-txt{font-size:10px;font-weight:500;color:#00e676;white-space:nowrap;letter-spacing:.2px}
    .koi-inline-txt strong{font-weight:700}

    /* ── KOI STRIP ── */
    .koi-strip{background:#080810;padding:14px 52px;display:flex;align-items:center;gap:10px}
    .koi-text{font-family:'DM Sans',sans-serif;font-size:11px;font-weight:500;color:#00e676;letter-spacing:.3px;white-space:nowrap}
    .koi-text strong{font-weight:700}
    .koi-dot{width:3px;height:3px;border-radius:50%;background:rgba(0,230,118,0.3);flex-shrink:0}
    .koi-url{font-size:10px;color:rgba(0,230,118,0.4);letter-spacing:.5px}

    @media print{
      body{background:#fff;padding:0}
      .page{box-shadow:none;border-radius:0;max-width:100%}
      .no-print{display:none}
    }
  </style>
</head>
<body>

  <div class="no-print">
    <button onclick="window.print()">🖨 Imprimir / Guardar PDF</button>
    <button class="sec" onclick="window.close()">Cerrar</button>
  </div>

  <div class="page">

    <div class="color-bar"></div>

    ${d.sinCae ? '<div class="draft-banner">⚠ BORRADOR — Comprobante sin CAE. No tiene validez fiscal hasta ser emitido.</div>' : ''}

    <!-- HEADER -->
    <div class="header">
      <div>
        <div class="marca">${d.nombreFantasia}</div>
        <div class="razon">${d.razonSocial}</div>
        <div class="cuit-line">CUIT ${d.cuitFmt}</div>
      </div>
      <div class="comp-block">
        <div class="comp-label">Factura C</div>
        <div class="comp-nro">N° ${d.nroComp}</div>
        <div class="comp-fecha">${d.fecha}</div>
      </div>
    </div>

    <!-- BODY -->
    <div class="body">
      <table class="tabla-items">
        <thead>
          <tr>
            <th style="text-align:left;width:55%">Descripción</th>
            <th>Cant.</th>
            <th>P. Unitario</th>
            <th>Subtotal</th>
          </tr>
        </thead>
        <tbody>${d.filasItems}</tbody>
      </table>

      <div class="total-section">
        <div class="total-inner">
          <span class="total-label">Total</span>
          <span class="total-amount">$${d.total}</span>
        </div>
      </div>
    </div>

    <!-- FOOTER AFIP -->
    <div class="footer-afip">
      <div class="qr-wrap">
        ${d.urlQrAfip
          ? `<img src="${d.urlQrAfip}" width="90" height="90" alt="QR AFIP">`
          : '<div class="qr-placeholder">QR AFIP<br>disponible<br>al emitir</div>'}
      </div>
      <div class="cae-info">
        <div class="cae-label">Validación AFIP</div>
        <div class="cae-num">${d.caeDisplay}</div>
        <div class="cae-vto">Vencimiento ${d.caeVto}</div>
        <div class="${d.sinCae ? 'cae-pending' : 'cae-ok'}">${d.sinCae ? 'Pendiente de emisión' : 'Comprobante autorizado'}</div>

        <div class="koi-inline">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M15.5 5C14 3.5 11.5 3 9 4.5c-1.5.9-2.8 2.2-3.5 3.5H2l2.5 2-2.5 2h3.5c.7 1.3 2 2.6 3.5 3.5C11.5 17 14 16.5 15.5 15L18 10l-2.5-5z" fill="url(#kqr)"/>
            <circle cx="13.5" cy="8.5" r=".9" fill="#08081099"/>
            <defs><linearGradient id="kqr" x1="2" y1="5" x2="18" y2="15"><stop stop-color="#e8622a"/><stop offset=".55" stop-color="#f5a623"/><stop offset="1" stop-color="#00e676"/></linearGradient></defs>
          </svg>
          <span class="koi-inline-txt">Generada por <strong>KOI-FACTURA</strong> — Sistema de Facturación Electrónica</span>
        </div>
      </div>
    </div>

    <!-- KOI STRIP -->
    <div class="koi-strip">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M15.5 5C14 3.5 11.5 3 9 4.5c-1.5.9-2.8 2.2-3.5 3.5H2l2.5 2-2.5 2h3.5c.7 1.3 2 2.6 3.5 3.5C11.5 17 14 16.5 15.5 15L18 10l-2.5-5z" fill="url(#kst)"/>
        <circle cx="13.5" cy="8.5" r=".9" fill="#08081099"/>
        <defs><linearGradient id="kst" x1="2" y1="5" x2="18" y2="15"><stop stop-color="#e8622a"/><stop offset=".55" stop-color="#f5a623"/><stop offset="1" stop-color="#00e676"/></linearGradient></defs>
      </svg>
      <span class="koi-text"><strong>KOI-FACTURA</strong> · Sistema de Facturación Electrónica</span>
      <div class="koi-dot"></div>
      <span class="koi-url">koi-backend-zzoc.onrender.com</span>
    </div>

  </div>

</body>
</html>`;
}


// ════════════════════════════════════════════════════════════
//  API — STATS CON FILTRO DE PERÍODO
// ════════════════════════════════════════════════════════════
app.get('/api/stats/dashboard', requireAuthAPI, async (req, res) => {
  try {
    const { platform, desde, hasta } = req.query;

    const match = { userId: new mongoose.Types.ObjectId(req.userId) };
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
      status: 'invoiced',  // solo facturas efectivamente emitidas
    };

    const matchIngresos = {
      ...match,
      status: { $in: ['pending_invoice', 'invoiced'] },
    };

    const [totalesIngresos, totalesFacturado, porPlataforma, porDia, ultimas, pendientes] = await Promise.all([

      // Total ingresos del período (todas las órdenes)
      Order.aggregate([
        { $match: matchIngresos },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),

      // Total facturado del período (solo con CAE emitido)
      Order.aggregate([
        { $match: matchFacturado },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),

      // Desglose por plataforma
      Order.aggregate([
        { $match: matchIngresos },
        { $group: { _id: '$platform', total: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $sort: { total: -1 } },
      ]),

      // Ventas por día para el gráfico
      Order.aggregate([
        { $match: matchIngresos },
        { $group: {
          _id:   { $dateToString: { format: '%d', date: '$createdAt', timezone: '-03:00' } },
          total: { $sum: '$amount' },
        }},
        { $sort: { _id: 1 } },
      ]),

      // Últimas 50 órdenes del período
      Order.find(match)
        .sort({ createdAt: -1 })
        .limit(50)
        .select('platform externalId customerName customerEmail amount currency status caeNumber createdAt tipoComprobante puntoVenta nroComprobante')
        .lean(),

      // Pendientes sin CAE (de todos los tiempos, no solo del período)
      Order.countDocuments({ userId: req.userId, status: 'pending_invoice' }),
    ]);

    res.json({
      ok:             true,
      periodo:        { desde: match.createdAt.$gte, hasta: match.createdAt.$lte },
      totalMonto:     totalesIngresos[0]?.total  || 0,  // ingresos período
      totalOrden:     totalesIngresos[0]?.count  || 0,
      totalFacturado: totalesFacturado[0]?.total || 0,  // solo con CAE
      totalFacturas:  totalesFacturado[0]?.count || 0,
      pendientesCAE:  pendientes,
      plataformas:    porPlataforma,
      chartDias:      porDia.map(d => d._id),
      chartVentas:    porDia.map(d => Math.round(d.total)),
      ultimas,
    });
  } catch(e) {
    console.error('Stats error:', e.message);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

app.get('/api/orders', requireAuthAPI, async (req, res) => {
  try {
    const { platform, status, desde, hasta, limit = 100 } = req.query;
    const filter = { userId: req.userId };
    if (platform) filter.platform = platform;
    if (status)   filter.status   = status;
    if (desde || hasta) {
      filter.createdAt = {};
      if (desde) filter.createdAt.$gte = new Date(desde);
      if (hasta) filter.createdAt.$lte = new Date(hasta);
    }
    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit), 500))
      .lean();
    res.json({ ok: true, orders });
  } catch(e) { res.status(500).json({ error: 'Error interno' }); }
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

    // Contar órdenes sin concepto real
    const sinConcepto = await Order.countDocuments({
      userId:   req.userId,
      platform: 'woocommerce',
      $or: [
        { concepto: { $exists: false } },
        { concepto: '' },
        { concepto: 'woocommerce' },
        { concepto: 'Venta WooCommerce' },
        { items:    { $size: 0 } },
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

  // Traer órdenes sin concepto real
  const ordenes = await Order.find({
    userId,
    platform: 'woocommerce',
    $or: [
      { concepto: { $exists: false } },
      { concepto: '' },
      { concepto: 'woocommerce' },
      { concepto: 'Venta WooCommerce' },
      { items:    { $size: 0 } },
      { items:    { $exists: false } },
    ],
  }).select('externalId').lean();

  console.log(`[Backfill] ${ordenes.length} órdenes WooCommerce para actualizar`);

  let ok = 0, err = 0;

  // Procesar en lotes de 10 para no saturar la API
  const LOTE = 10;
  for (let i = 0; i < ordenes.length; i += LOTE) {
    const lote = ordenes.slice(i, i + LOTE);

    await Promise.all(lote.map(async (orden) => {
      try {
        const { data } = await axios.get(
          `${base}/wp-json/wc/v3/orders/${orden.externalId}`,
          { auth: { username: key, password: secret }, timeout: 15_000 }
        );

        // Si la orden no está completada, marcarla como skipped
        if (data.status && data.status !== 'completed') {
          await Order.updateOne(
            { userId, platform: 'woocommerce', externalId: orden.externalId },
            { $set: { status: 'skipped', concepto: `Pago no acreditado (${data.status})` } }
          );
          ok++;
          return;
        }

        const items = (data.line_items || []).map(i => ({
          nombre:   i.name     || 'Producto',
          cantidad: i.quantity || 1,
          precio:   parseFloat(i.price || i.subtotal || 0),
          sku:      i.sku      || '',
        }));

        const concepto = items.length
          ? items.map(i => i.nombre).join(', ')
          : 'Venta WooCommerce';

        await Order.updateOne(
          { _id: orden._id || undefined, userId, platform: 'woocommerce', externalId: orden.externalId },
          { $set: { concepto, items, orderDate: data.date_created ? new Date(data.date_created) : undefined } }
        );
        ok++;
      } catch(e) {
        err++;
        console.warn(`[Backfill] Error orden ${orden.externalId}:`, e.message);
      }
    }));

    // Pausa entre lotes para no saturar WooCommerce
    if (i + LOTE < ordenes.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`[Backfill] Completado: ${ok} OK, ${err} errores`);
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
//  KEEP-ALIVE — Anti cold-start Render free tier
// ════════════════════════════════════════════════════════════
setTimeout(() => {
  if (!process.env.BASE_URL) return;
  const ping = () => axios.get(`${BASE}/health`, { timeout: 10_000 })
    .then(() => console.log(`🏓 Keep-alive [${new Date().toISOString()}]`))
    .catch(e  => console.warn(`⚠️  Ping: ${e.message}`));
  ping();
  setInterval(ping, 10 * 60 * 1000);
}, 30_000);

// ════════════════════════════════════════════════════════════
//  START
// ════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`🚀 KOI-Factura v4.0 | Puerto ${PORT} | ${BASE}`);
});
