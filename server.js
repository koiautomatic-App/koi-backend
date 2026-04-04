// ============================================================
//  KOI-FACTURA · v4.3 — Fix crítico WSAA/AFIP
//
//  CAMBIOS v4.3 vs v4.2:
//  ─────────────────────────────────────────────────────────
//  1. WSAA namespace SIN trailing slash
//     ANTES: xmlns:wsaa="http://...afip.gov.ar/"
//     AHORA:  xmlns:wsaa="http://...afip.gov.ar"
//
//  2. Timestamps TRA SIN milisegundos (AFIP los rechaza)
//     ANTES: 2024-01-15T13:30:00.000Z → "2024-01-15T13:30:00.000-03:00"
//     AHORA:  "2024-01-15T10:30:00-03:00" (hora ARG real, sin .000)
//
//  3. WSFE también usa namespace sin trailing slash
//
//  4. Logging detallado del request/response AFIP para debug
// ============================================================

'use strict';

require('dotenv').config();
const forge = require('node-forge');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const xmlbuilder = require('xmlbuilder');
const { DOMParser } = require('@xmldom/xmldom');

const app = express();
const PORT = process.env.PORT || 10000;
const BASE = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const JWT_SECRET = process.env.JWT_SECRET || 'koi-jwt-dev-change-in-production';

// ════════════════════════════════════════════════════════════
//  TLS — AFIP usa claves DH de 1024 bits (OpenSSL 3.x las rechaza por default)
// ════════════════════════════════════════════════════════════
const httpsAgent = new https.Agent({
  secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
  rejectUnauthorized: true,
  keepAlive: true,
});

axios.defaults.httpsAgent = httpsAgent;

// ════════════════════════════════════════════════════════════
//  AFIP — CONFIGURACIÓN GLOBAL
//  URLs tomadas de env vars primero, luego hardcoded producción
// ════════════════════════════════════════════════════════════
const AFIP_URLS = {
  wsaa: process.env.WSAA_URL || 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
  wsfe: process.env.WSFE_URL || 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
};

const AFIP_KEY_PATH  = process.env.AFIP_KEY_PATH  || '/etc/secrets/koi.key';
const AFIP_CERT_PATH = process.env.AFIP_CERT_PATH || '/etc/secrets/koi.crt';
const TA_CACHE_DIR   = path.join(os.tmpdir(), 'koi-ta-cache');
fs.mkdirSync(TA_CACHE_DIR, { recursive: true });

console.log('');
console.log('==============================================');
console.log('  KOI-Factura v4.3 — Config al arrancar');
console.log('==============================================');
console.log('  WSAA URL   :', AFIP_URLS.wsaa);
console.log('  WSFE URL   :', AFIP_URLS.wsfe);
console.log('  CERT path  :', AFIP_CERT_PATH, '→ existe:', fs.existsSync(AFIP_CERT_PATH));
console.log('  KEY  path  :', AFIP_KEY_PATH,  '→ existe:', fs.existsSync(AFIP_KEY_PATH));
if (fs.existsSync(AFIP_CERT_PATH)) console.log('  CERT size  :', fs.statSync(AFIP_CERT_PATH).size, 'bytes');
if (fs.existsSync(AFIP_KEY_PATH))  console.log('  KEY  size  :', fs.statSync(AFIP_KEY_PATH).size,  'bytes');
console.log('==============================================');
console.log('');

// ════════════════════════════════════════════════════════════
//  MIDDLEWARES
// ════════════════════════════════════════════════════════════
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const allowedOrigins = [BASE, 'http://localhost:3000', 'http://localhost:10000'];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin) || (origin || '').includes('render.com')) cb(null, true);
    else cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'koi-session-dev',
  resave: false, saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 },
}));
app.use(passport.initialize());
app.use(passport.session());

// ════════════════════════════════════════════════════════════
//  MONGODB
// ════════════════════════════════════════════════════════════
mongoose.connect(process.env.MONGO_URI, { maxPoolSize: 10 })
  .then(() => console.log('🐟 MongoDB conectado'))
  .catch(err => console.error('❌ MongoDB:', err.message));

// ════════════════════════════════════════════════════════════
//  ENCRYPTION
// ════════════════════════════════════════════════════════════
const ENC_KEY = Buffer.from(
  (process.env.ENCRYPTION_KEY || 'koi0000000000000000000000000000k').slice(0, 32), 'utf8'
);
const encrypt = (text) => {
  if (!text) return null;
  try {
    const iv = crypto.randomBytes(12);
    const c  = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
    const e  = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
    return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${e.toString('hex')}`;
  } catch { return null; }
};
const decrypt = (payload) => {
  if (!payload) return null;
  try {
    const [iv, tag, enc] = payload.split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(iv, 'hex'));
    d.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([d.update(Buffer.from(enc, 'hex')), d.final()]).toString('utf8');
  } catch { return null; }
};

// ════════════════════════════════════════════════════════════
//  SCHEMAS
// ════════════════════════════════════════════════════════════
const UserSchema = new mongoose.Schema({
  nombre: { type: String, trim: true },
  apellido: { type: String, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, select: false },
  googleId: { type: String, sparse: true },
  avatar: { type: String },
  plan: { type: String, default: 'free', enum: ['free', 'pro'] },
  settings: {
    factAuto:   { type: Boolean, default: true },
    envioAuto:  { type: Boolean, default: true },
    categoria:  { type: String, default: 'C' },
    cuit:       { type: String, trim: true },
    arcaUser:   { type: String },
    arcaClave:  { type: String },
    arcaPtoVta: { type: Number, default: 1 },
    arcaStatus: {
      type: String, default: 'sin_vincular',
      enum: ['sin_vincular', 'pendiente', 'en_proceso', 'vinculado', 'error'],
    },
    arcaNotas: { type: String },
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

const IntegrationSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  platform: { type: String, required: true, enum: ['woocommerce','tiendanube','mercadolibre','empretienda','rappi','vtex','shopify'] },
  storeId:   { type: String, required: true },
  storeName: { type: String },
  storeUrl:  { type: String },
  status:    { type: String, default: 'active', enum: ['active','paused','error','pending'] },
  credentials: { type: mongoose.Schema.Types.Mixed, default: {} },
  webhookSecret: { type: String, default: () => crypto.randomBytes(24).toString('hex'), index: true },
  lastSyncAt:    { type: Date },
  errorLog:      { type: String },
  initialSyncDone: { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
});
IntegrationSchema.index({ userId: 1, platform: 1, storeId: 1 }, { unique: true });
IntegrationSchema.methods.setKey = function(f, v) {
  if (!this.credentials) this.credentials = {};
  this.credentials[f] = encrypt(v);
  this.markModified('credentials');
};
IntegrationSchema.methods.getKey = function(f) { return decrypt(this.credentials?.[f]); };
const Integration = mongoose.model('Integration', IntegrationSchema);

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
  status: {
    type: String, default: 'pending_invoice',
    enum: ['pending_invoice','processing','invoiced','error_data','error_afip','skipped'],
  },
  orderDate:  { type: Date },
  nroComp:    { type: Number },
  caeNumber:  { type: String },
  caeExpiry:  { type: Date },
  errorLog:   { type: String },
  createdAt:  { type: Date, default: Date.now },
});
OrderSchema.index({ userId: 1, platform: 1, externalId: 1 }, { unique: true });
OrderSchema.index({ userId: 1, orderDate: -1 });
const Order = mongoose.model('Order', OrderSchema);

// ════════════════════════════════════════════════════════════
//  AFIP — HELPERS
// ════════════════════════════════════════════════════════════
const ARCA_LIMIT_SIN_DNI = 191624;
const CUIT_CF = '99999999';

function _docTipo(doc) {
  const d = String(doc || '0').replace(/\D/g, '');
  if (d.length === 11) return 80;
  if (d === '0' || d.startsWith('9999')) return 99;
  return 96;
}

function _fechaAFIP(d) {
  const date = d instanceof Date ? d : new Date();
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}`;
}

function _parseFechaAFIP(str) {
  if (!str || str.length !== 8) return null;
  return new Date(`${str.slice(0,4)}-${str.slice(4,6)}-${str.slice(6,8)}`);
}

/**
 * Convierte una fecha a formato ISO 8601 SIN milisegundos, con zona -03:00
 * AFIP rechaza timestamps con milisegundos.
 *
 * CORRECTO: "2024-01-15T10:30:00-03:00"
 * INCORRECTO: "2024-01-15T13:30:00.000Z" o "2024-01-15T13:30:00.000-03:00"
 */
function _toAfipTimestamp(date) {
  // Convertir a hora Argentina (UTC-3)
  const argOffset = -3 * 60; // minutos
  const utcMs     = date.getTime() + date.getTimezoneOffset() * 60_000;
  const argDate   = new Date(utcMs + argOffset * 60_000);

  const pad = n => String(n).padStart(2, '0');
  return (
    `${argDate.getFullYear()}-${pad(argDate.getMonth()+1)}-${pad(argDate.getDate())}` +
    `T${pad(argDate.getHours())}:${pad(argDate.getMinutes())}:${pad(argDate.getSeconds())}` +
    `-03:00`
  );
}

function _cleanDoc(raw) { return String(raw || '').replace(/\D/g, ''); }
function _resolveDoc(doc, amount) {
  if (doc.length >= 7 && doc.length <= 11) return doc;
  return amount >= ARCA_LIMIT_SIN_DNI ? null : CUIT_CF;
}

// ════════════════════════════════════════════════════════════
//  AFIP — TOKEN WSAA
//
//  FIX CRÍTICO: namespace WSAA correcto
//  AFIP WSDL usa "http://wsaa.view.sua.dvadac.desein.afip.gov.ar"
//  (SIN trailing slash al final)
//  Con trailing slash → HTTP 500 inmediato
// ════════════════════════════════════════════════════════════
async function afip_obtenerTA(cuit) {
  const TA_PATH = path.join(TA_CACHE_DIR, `${cuit}.json`);

  // 1. Cache válido → reusar
  if (fs.existsSync(TA_PATH)) {
    try {
      const cache = JSON.parse(fs.readFileSync(TA_PATH, 'utf8'));
      if (cache.expiry && cache.expiry > Date.now() + 5 * 60_000) {
        console.log(`[AFIP] TA cacheado para CUIT ${cuit} — expira ${new Date(cache.expiry).toISOString()}`);
        return { token: cache.token, sign: cache.sign };
      }
      console.log(`[AFIP] TA expirado para CUIT ${cuit} — renovando`);
    } catch {}
  }

  // 2. Verificar certs
  if (!fs.existsSync(AFIP_CERT_PATH)) throw new Error(`Cert no encontrado: ${AFIP_CERT_PATH}`);
  if (!fs.existsSync(AFIP_KEY_PATH))  throw new Error(`Key no encontrada: ${AFIP_KEY_PATH}`);

  console.log(`[AFIP] Obteniendo TA para CUIT ${cuit}`);

  // 3. Construir TRA con timestamps correctos (sin milisegundos, zona -03:00)
  const ahora   = new Date();
  const genTime = _toAfipTimestamp(new Date(ahora.getTime() - 60_000));
  const expTime = _toAfipTimestamp(new Date(ahora.getTime() + 12 * 3_600_000));

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

  console.log(`[AFIP] TRA generationTime: ${genTime}`);
  console.log(`[AFIP] TRA expirationTime: ${expTime}`);

  // 4. Firmar con node-forge (PKCS#7 DER)
  const certPem    = fs.readFileSync(AFIP_CERT_PATH, 'utf8');
  const keyPem     = fs.readFileSync(AFIP_KEY_PATH,  'utf8');
  const cert       = forge.pki.certificateFromPem(certPem);
  const privateKey = forge.pki.privateKeyFromPem(keyPem);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key: privateKey, certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType,   value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime,   value: new Date() },
    ],
  });
  p7.sign({ detached: false });

  const cmsBase64 = forge.util.encode64(
    forge.asn1.toDer(p7.toAsn1()).getBytes()
  );
  console.log(`[AFIP] CMS firmado con node-forge — longitud: ${cmsBase64.length}`);

  // 5. SOAP envelope para WSAA
  //    NAMESPACE CORRECTO: "http://wsaa.view.sua.dvadac.desein.afip.gov.ar"
  //    (SIN trailing slash — con slash AFIP devuelve HTTP 500)
  const soapWsaa = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope
  xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ns1="http://wsaa.view.sua.dvadac.desein.afip.gov.ar">
  <SOAP-ENV:Body>
    <ns1:loginCms>
      <ns1:in0>${cmsBase64}</ns1:in0>
    </ns1:loginCms>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

  console.log(`[AFIP] POST a WSAA: ${AFIP_URLS.wsaa}`);

  let resp;
  try {
    resp = await axios.post(AFIP_URLS.wsaa, soapWsaa, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': '""',
      },
      timeout: 30_000,
      httpsAgent,
    });
  } catch (axiosErr) {
    const status  = axiosErr.response?.status;
    const body    = axiosErr.response?.data?.substring(0, 500) || '';
    console.error(`[AFIP] WSAA HTTP ${status}:`, body);
    throw new Error(`WSAA HTTP ${status}: ${body || axiosErr.message}`);
  }

  console.log(`[AFIP] WSAA respondió HTTP ${resp.status} — ${resp.data.length} chars`);

  // 6. Parsear respuesta — la respuesta viene dentro de loginCmsReturn
  const wsaaDoc = new DOMParser().parseFromString(resp.data, 'text/xml');

  // Verificar fault SOAP
  const fault = wsaaDoc.getElementsByTagName('faultstring')[0]?.textContent;
  if (fault) throw new Error(`WSAA SOAP fault: ${fault}`);

  const loginReturn = wsaaDoc.getElementsByTagName('loginCmsReturn')[0]?.textContent;
  if (!loginReturn) {
    console.error('[AFIP] Respuesta WSAA completa:', resp.data.substring(0, 800));
    throw new Error('WSAA: no se encontró loginCmsReturn en la respuesta');
  }

  // Decodificar el TA interno (base64 → XML)
  const taXml  = Buffer.from(loginReturn, 'base64').toString('utf8');
  const taDoc  = new DOMParser().parseFromString(taXml, 'text/xml');
  const token  = taDoc.getElementsByTagName('token')[0]?.textContent;
  const sign   = taDoc.getElementsByTagName('sign')[0]?.textContent;
  const expStr = taDoc.getElementsByTagName('expirationTime')[0]?.textContent;

  if (!token || !sign) throw new Error('WSAA: token o sign no encontrado en el TA');

  const expiry = expStr ? new Date(expStr).getTime() : Date.now() + 12 * 3_600_000;

  // 7. Guardar en cache
  fs.writeFileSync(TA_PATH, JSON.stringify({ token, sign, expiry }), 'utf8');
  console.log(`[AFIP] TA OK para CUIT ${cuit} — expira ${new Date(expiry).toISOString()}`);

  return { token, sign };
}

// ════════════════════════════════════════════════════════════
//  AFIP — ÚLTIMO NÚMERO DE COMPROBANTE
// ════════════════════════════════════════════════════════════
async function _afipUltimoNro(cuit, ptoVta, tipo, token, sign) {
  const soap = xmlbuilder.create('soapenv:Envelope', { version: '1.0', encoding: 'UTF-8' })
    .att('xmlns:soapenv', 'http://schemas.xmlsoap.org/soap/envelope/')
    .att('xmlns:ar',      'http://ar.gov.afip.dif.FEV1/')
    .ele('soapenv:Body')
      .ele('ar:FECompUltimoAutorizado')
        .ele('ar:Auth')
          .ele('ar:Token').txt(token).up()
          .ele('ar:Sign').txt(sign).up()
          .ele('ar:Cuit').txt(cuit).up()
        .up()
        .ele('ar:PtoVta').txt(ptoVta).up()
        .ele('ar:CbteTipo').txt(tipo).up()
      .up()
    .up()
    .end({ pretty: false });

  const res  = await axios.post(AFIP_URLS.wsfe, soap, {
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '' },
    timeout: 30_000,
    httpsAgent,
  });
  const xml = new DOMParser().parseFromString(res.data, 'text/xml');
  return parseInt(xml.getElementsByTagName('CbteNro')[0]?.textContent || '0');
}

// ════════════════════════════════════════════════════════════
//  AFIP — EMISIÓN PRINCIPAL
// ════════════════════════════════════════════════════════════
async function afip_emitirComprobante(cuitEmisor, puntoVenta, datos) {
  console.log(`[AFIP] Emitiendo: CUIT=${cuitEmisor} PV=${puntoVenta} Monto=${datos.importeTotal}`);

  const { token, sign } = await afip_obtenerTA(cuitEmisor);

  const cbTipo    = 11; // Factura C (monotributo)
  const ultimoNro = await _afipUltimoNro(cuitEmisor, puntoVenta, cbTipo, token, sign);
  const nroComp   = ultimoNro + 1;

  const importe = parseFloat(datos.importeTotal.toFixed(2));
  const docTipo = _docTipo(datos.clienteDoc);
  const docNro  = docTipo === 99 ? 0 : parseInt(String(datos.clienteDoc || '0').replace(/\D/g, ''));

  console.log(`[AFIP] Último nro: ${ultimoNro} → emitiendo nro: ${nroComp}`);
  console.log(`[AFIP] DocTipo: ${docTipo} DocNro: ${docNro} Importe: ${importe}`);

  const soap = xmlbuilder.create('soapenv:Envelope', { version: '1.0', encoding: 'UTF-8' })
    .att('xmlns:soapenv', 'http://schemas.xmlsoap.org/soap/envelope/')
    .att('xmlns:ar',      'http://ar.gov.afip.dif.FEV1/')
    .ele('soapenv:Body')
      .ele('ar:FECAESolicitar')
        .ele('ar:Auth')
          .ele('ar:Token').txt(token).up()
          .ele('ar:Sign').txt(sign).up()
          .ele('ar:Cuit').txt(cuitEmisor).up()
        .up()
        .ele('ar:FeCAEReq')
          .ele('ar:FeCabReq')
            .ele('ar:CantReg').txt(1).up()
            .ele('ar:PtoVta').txt(puntoVenta).up()
            .ele('ar:CbteTipo').txt(cbTipo).up()
          .up()
          .ele('ar:FeDetReq')
            .ele('ar:FECAEDetRequest')
              .ele('ar:Concepto').txt(1).up()
              .ele('ar:DocTipo').txt(docTipo).up()
              .ele('ar:DocNro').txt(docNro).up()
              .ele('ar:CbteDesde').txt(nroComp).up()
              .ele('ar:CbteHasta').txt(nroComp).up()
              .ele('ar:CbteFch').txt(_fechaAFIP()).up()
              .ele('ar:ImpTotal').txt(importe.toFixed(2)).up()
              .ele('ar:ImpTotConc').txt('0.00').up()
              .ele('ar:ImpNeto').txt(importe.toFixed(2)).up()
              .ele('ar:ImpOpEx').txt('0.00').up()
              .ele('ar:ImpIVA').txt('0.00').up()
              .ele('ar:ImpTrib').txt('0.00').up()
              .ele('ar:MonId').txt('PES').up()
              .ele('ar:MonCotiz').txt(1).up()
            .up()
          .up()
        .up()
      .up()
    .up()
    .end({ pretty: false });

  let wsfeResp;
  try {
    wsfeResp = await axios.post(AFIP_URLS.wsfe, soap, {
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '' },
      timeout: 30_000,
      httpsAgent,
    });
  } catch (axiosErr) {
    const status = axiosErr.response?.status;
    const body   = axiosErr.response?.data?.substring(0, 500) || '';
    console.error(`[AFIP] WSFE HTTP ${status}:`, body);
    throw new Error(`WSFE HTTP ${status}: ${body || axiosErr.message}`);
  }

  const xmlDoc    = new DOMParser().parseFromString(wsfeResp.data, 'text/xml');
  const resultado = xmlDoc.getElementsByTagName('Resultado')[0]?.textContent;

  if (resultado !== 'A') {
    const errores = [];
    const errNodes = xmlDoc.getElementsByTagName('Err');
    for (let i = 0; i < errNodes.length; i++) {
      const code = errNodes[i].getElementsByTagName('Code')[0]?.textContent;
      const msg  = errNodes[i].getElementsByTagName('Msg')[0]?.textContent;
      if (msg) errores.push(`[${code}] ${msg}`);
    }
    // También capturar observaciones
    const obsNodes = xmlDoc.getElementsByTagName('Obs');
    for (let i = 0; i < obsNodes.length; i++) {
      const code = obsNodes[i].getElementsByTagName('Code')[0]?.textContent;
      const msg  = obsNodes[i].getElementsByTagName('Msg')[0]?.textContent;
      if (msg) errores.push(`OBS[${code}] ${msg}`);
    }
    const errMsg = errores.join(' | ') || `Resultado: ${resultado || 'vacío'}`;
    console.error('[AFIP] WSFE rechazó:', errMsg);
    throw new Error(`AFIP rechazó el comprobante: ${errMsg}`);
  }

  const detResp = xmlDoc.getElementsByTagName('FECAEDetResponse')[0];
  const cae     = detResp?.getElementsByTagName('CAE')[0]?.textContent;
  const caeVto  = detResp?.getElementsByTagName('CAEFchVto')[0]?.textContent;

  if (!cae) throw new Error('AFIP aprobó pero no devolvió CAE');

  console.log(`[AFIP] ✅ CAE: ${cae} — Nro: ${nroComp} — Vto: ${caeVto}`);

  return {
    cae,
    caeFchVto: _parseFechaAFIP(caeVto),
    nroComp,
  };
}

// ════════════════════════════════════════════════════════════
//  NORMALIZER
// ════════════════════════════════════════════════════════════
const normalize = {
  woocommerce(raw) {
    const b = raw.billing || {};
    const doc = _cleanDoc(b.dni || b.identification || b.cpf || '');
    return {
      externalId:    String(raw.id),
      customerName:  `${b.first_name || ''} ${b.last_name || ''}`.trim(),
      customerEmail: b.email || '',
      customerDoc:   _resolveDoc(doc, parseFloat(raw.total) || 0),
      amount:        parseFloat(raw.total) || 0,
      currency:      raw.currency || 'ARS',
      orderDate:     raw.date_created ? new Date(raw.date_created) : undefined,
    };
  },
  tiendanube(raw) {
    const doc = _cleanDoc(raw.billing_info?.document || '');
    return {
      externalId:    String(raw.id),
      customerName:  raw.contact?.name || '',
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
    const c = raw.clientProfileData || {};
    const doc = _cleanDoc(c.document || c.cpf || '');
    return {
      externalId:    raw.orderId || String(raw.id),
      customerName:  `${c.firstName || ''} ${c.lastName || ''}`.trim(),
      customerEmail: c.email || '',
      customerDoc:   _resolveDoc(doc, (parseFloat(raw.value) || 0) / 100),
      amount:        (parseFloat(raw.value) || 0) / 100,
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
    const o = raw.order || raw;
    return {
      externalId:    String(o.id),
      customerName:  o.user?.name || '',
      customerEmail: o.user?.email || '',
      customerDoc:   CUIT_CF,
      amount:        parseFloat(o.total_products || o.total) || 0,
      currency:      'ARS',
      orderDate:     o.created_at ? new Date(o.created_at) : undefined,
    };
  },
  shopify(raw) {
    const a = raw.billing_address || raw.shipping_address || {};
    const doc = _cleanDoc(raw.note_attributes?.find(x => x.name === 'dni')?.value || '');
    return {
      externalId:    String(raw.id),
      customerName:  `${a.first_name || ''} ${a.last_name || ''}`.trim(),
      customerEmail: raw.email || raw.customer?.email || '',
      customerDoc:   _resolveDoc(doc, parseFloat(raw.total_price) || 0),
      amount:        parseFloat(raw.total_price) || 0,
      currency:      raw.currency || 'ARS',
      orderDate:     raw.created_at ? new Date(raw.created_at) : undefined,
    };
  },
};

// ════════════════════════════════════════════════════════════
//  UPSERT + AUTO-FACTURACIÓN
// ════════════════════════════════════════════════════════════
async function upsertOrder(integration, canonical) {
  if (!canonical) return;

  const filter = { userId: integration.userId, platform: integration.platform, externalId: canonical.externalId };
  const requiereDNI = canonical.amount >= ARCA_LIMIT_SIN_DNI;
  const tieneDNI    = canonical.customerDoc && canonical.customerDoc !== '0';

  if (requiereDNI && !tieneDNI) {
    await Order.findOneAndUpdate(filter, {
      $setOnInsert: { userId: integration.userId, integrationId: integration._id, platform: integration.platform, ...canonical, customerDoc: '0', status: 'error_data', errorLog: `Monto $${canonical.amount.toLocaleString()} supera límite sin DNI` },
    }, { upsert: true }).catch(() => {});
    return;
  }

  const order = await Order.findOneAndUpdate(filter, {
    $setOnInsert: { userId: integration.userId, integrationId: integration._id, platform: integration.platform, ...canonical, status: 'pending_invoice' },
  }, { upsert: true, new: true }).catch(err => { if (err.code !== 11000) console.error('upsert:', err.message); return null; });

  if (order?.status === 'pending_invoice') {
    _intentarAutoFacturar(integration.userId, order).catch(e => console.error('Auto-factura:', e.message));
  }
}

async function _intentarAutoFacturar(userId, order) {
  try {
    const user = await User.findById(userId).select('settings').lean();
    if (!user?.settings) return;
    const { factAuto, arcaStatus, cuit, arcaPtoVta } = user.settings;
    if (!factAuto || arcaStatus !== 'vinculado' || !cuit) return;

    const resultado = await afip_emitirComprobante(
      cuit.replace(/\D/g, ''),
      parseInt(arcaPtoVta) || 1,
      { clienteDoc: order.customerDoc || '0', importeTotal: order.amount }
    );

    await Order.findByIdAndUpdate(order._id, {
      status: 'invoiced', nroComp: resultado.nroComp,
      caeNumber: resultado.cae, caeExpiry: resultado.caeFchVto, errorLog: '',
    });
    console.log(`✅ Auto-CAE: ${resultado.cae} | Nro ${resultado.nroComp}`);
  } catch (e) {
    console.error('Auto-factura error:', e.message);
    await Order.findByIdAndUpdate(order._id, { status: 'error_afip', errorLog: e.message });
  }
}

// ════════════════════════════════════════════════════════════
//  AUTH HELPERS
// ════════════════════════════════════════════════════════════
const signToken      = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: '7d' });
const setTokenCookie = (res, token) => res.cookie('koi_token', token, { httpOnly: true, secure: false, sameSite: 'lax', maxAge: 7*24*60*60*1000 });
const requireAuth    = (req, res, next) => {
  try { req.userId = jwt.verify(req.cookies.koi_token, JWT_SECRET).id; next(); }
  catch { res.clearCookie('koi_token'); res.redirect('/login'); }
};
const requireAuthAPI = (req, res, next) => {
  const t = req.cookies.koi_token || (req.headers.authorization || '').replace('Bearer ', '');
  try { req.userId = jwt.verify(t, JWT_SECRET).id; next(); }
  catch { res.clearCookie('koi_token'); res.status(401).json({ error: 'No autenticado' }); }
};

async function requireArcaCuit(req, res, next) {
  try {
    const user = await User.findById(req.userId).select('settings').lean();
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    const cuit = user.settings?.cuit ? user.settings.cuit.replace(/\D/g, '') : null;
    if (!cuit || cuit.length !== 11) return res.status(400).json({ error: 'CUIT no configurado o inválido' });
    if (user.settings.arcaStatus !== 'vinculado') return res.status(403).json({ error: `Estado ARCA: ${user.settings.arcaStatus}. Requiere vinculación confirmada.` });
    req.arcaCuit      = cuit;
    req.arcaPtoVta    = parseInt(user.settings.arcaPtoVta) || 1;
    req.arcaCategoria = user.settings.categoria || 'C';
    req.factAuto      = user.settings.factAuto !== false;
    req.envioAuto     = user.settings.envioAuto !== false;
    next();
  } catch (e) { res.status(500).json({ error: 'Error validando credenciales: ' + e.message }); }
}

// ════════════════════════════════════════════════════════════
//  PASSPORT GOOGLE
// ════════════════════════════════════════════════════════════
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: `${BASE}/auth/google/callback`, proxy: true,
}, async (_, __, profile, done) => {
  try {
    const email = profile.emails?.[0]?.value?.toLowerCase();
    if (!email) return done(new Error('Google no devolvió email'));
    let user = await User.findOne({ $or: [{ googleId: profile.id }, { email }] });
    if (!user) {
      user = await User.create({ googleId: profile.id, email, nombre: profile.name?.givenName || '', apellido: profile.name?.familyName || '', avatar: profile.photos?.[0]?.value || '' });
    } else {
      if (!user.googleId) user.googleId = profile.id;
      user.avatar = profile.photos?.[0]?.value || user.avatar;
      user.ultimoAcceso = new Date();
      await user.save();
    }
    done(null, user);
  } catch (e) { done(e); }
}));
passport.serializeUser((u, done) => done(null, u.id || u._id));
passport.deserializeUser(async (id, done) => {
  try { done(null, await User.findById(id).select('-password').lean()); } catch (e) { done(e); }
});

// ════════════════════════════════════════════════════════════
//  RUTAS AUTH
// ════════════════════════════════════════════════════════════
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=google_failed' }),
  (req, res) => { setTokenCookie(res, signToken(req.user.id || req.user._id)); res.redirect('/dashboard'); }
);

app.post('/auth/register', async (req, res) => {
  try {
    const { nombre, apellido, email, password } = req.body;
    if (!nombre || !email || !password) return res.status(400).json({ error: 'Faltan campos.' });
    if (password.length < 8) return res.status(400).json({ error: 'Mínimo 8 caracteres.' });
    const emailL = email.trim().toLowerCase();
    if (await User.findOne({ email: emailL })) return res.status(409).json({ error: 'Email ya registrado.' });
    const user = await User.create({ nombre: nombre.trim(), apellido: apellido?.trim() || '', email: emailL, password });
    setTokenCookie(res, signToken(user._id));
    res.status(201).json({ ok: true, user: { nombre: user.nombre, email: user.email } });
  } catch (e) { res.status(500).json({ error: 'Error al registrar.' }); }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos.' });
    const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+password');
    if (!user?.password || !await user.checkPassword(password)) return res.status(401).json({ error: 'Credenciales inválidas.' });
    user.ultimoAcceso = new Date(); await user.save();
    setTokenCookie(res, signToken(user._id));
    res.json({ ok: true, user: { nombre: user.nombre, email: user.email } });
  } catch (e) { res.status(500).json({ error: 'Error al iniciar sesión.' }); }
});

app.get('/auth/logout', (req, res) => { res.clearCookie('koi_token', { httpOnly: true, secure: false, sameSite: 'lax' }); res.redirect('/login'); });

// ════════════════════════════════════════════════════════════
//  API — USUARIO
// ════════════════════════════════════════════════════════════
app.get('/api/me', requireAuthAPI, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password -settings.arcaClave').lean();
    if (!user) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true, user });
  } catch (e) { res.status(500).json({ error: 'Error al obtener perfil' }); }
});

app.patch('/api/me/settings', requireAuthAPI, async (req, res) => {
  try {
    const { nombre, apellido, ...body } = req.body;
    const update = {};
    if (nombre)   update.nombre   = nombre.trim();
    if (apellido) update.apellido = apellido.trim();
    for (const key of ['factAuto', 'envioAuto', 'categoria', 'cuit', 'arcaPtoVta']) {
      if (body[key] !== undefined) {
        let v = body[key];
        if (key === 'cuit')       v = String(v).replace(/\D/g, '');
        if (key === 'arcaPtoVta') v = parseInt(v) || 1;
        update[`settings.${key}`] = v;
      }
    }
    const user = await User.findByIdAndUpdate(req.userId, { $set: update }, { new: true, select: '-password -settings.arcaClave' }).lean();
    res.json({ ok: true, user });
  } catch (e) { res.status(500).json({ error: 'Error al guardar' }); }
});

app.patch('/api/me/arca', requireAuthAPI, async (req, res) => {
  try {
    const { cuit, arcaClave } = req.body;
    if (!cuit || !arcaClave) return res.status(400).json({ error: 'CUIT y Clave Fiscal son obligatorios.' });
    const cleanCuit = String(cuit).replace(/\D/g, '');
    if (cleanCuit.length !== 11) return res.status(400).json({ error: 'CUIT inválido.' });
    const user = await User.findByIdAndUpdate(req.userId, {
      $set: { 'settings.cuit': cleanCuit, 'settings.arcaUser': cleanCuit, 'settings.arcaClave': encrypt(arcaClave), 'settings.arcaStatus': 'pendiente', 'settings.arcaNotas': 'Datos recibidos. Validando...' },
    }, { new: true, select: '-password -settings.arcaClave' }).lean();
    res.json({ ok: true, message: 'Vinculación enviada', user });
  } catch (e) { res.status(500).json({ error: 'Error al procesar vinculación' }); }
});

// ════════════════════════════════════════════════════════════
//  API — EMISIÓN CAE
// ════════════════════════════════════════════════════════════
app.get('/api/afip/estado', requireAuthAPI, async (req, res) => {
  try {
    await new Promise((resolve, reject) => {
      const r = https.get(AFIP_URLS.wsfe + '?wsdl', { agent: httpsAgent, timeout: 8000 }, resolve);
      r.on('error', reject);
      r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    });
    res.json({ ok: true, online: true });
  } catch { res.json({ ok: true, online: false }); }
});

app.post('/api/orders/:orderId/emitir', requireAuthAPI, requireArcaCuit, async (req, res) => {
  const { orderId } = req.params;
  try {
    const order = await Order.findOne({ _id: orderId, userId: req.userId });
    if (!order) return res.status(404).json({ error: 'Orden no encontrada' });
    if (order.status === 'invoiced') return res.status(409).json({ error: 'Ya fue facturada', cae: order.caeNumber });

    const resultado = await afip_emitirComprobante(req.arcaCuit, req.arcaPtoVta, {
      clienteDoc: order.customerDoc || '0', importeTotal: order.amount,
    });

    await Order.findByIdAndUpdate(orderId, {
      status: 'invoiced', nroComp: resultado.nroComp,
      caeNumber: resultado.cae, caeExpiry: resultado.caeFchVto, errorLog: '',
    });

    res.json({ ok: true, cae: resultado.cae, nroComp: resultado.nroComp });
  } catch (e) {
    console.error('Emitir error:', e.message);
    await Order.findByIdAndUpdate(orderId, { status: 'error_afip', errorLog: e.message });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/orders/manual', requireAuthAPI, async (req, res) => {
  try {
    const { cliente, email, concepto, monto, dni } = req.body;
    const importe = parseFloat(monto);
    if (!cliente || isNaN(importe) || importe <= 0) return res.status(400).json({ error: 'Cliente y monto válido son obligatorios.' });

    const docLimpio = dni ? String(dni).replace(/\D/g, '') : '0';
    const user = await User.findById(req.userId).select('settings').lean();
    const externalId = `MAN-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const order = await Order.create({
      userId: req.userId, platform: 'manual', externalId,
      customerName: cliente.trim(), customerEmail: email ? email.trim().toLowerCase() : '',
      customerDoc: docLimpio, amount: importe, currency: 'ARS',
      concepto: concepto || 'Venta Manual', status: 'pending_invoice', orderDate: new Date(),
    });

    const isVinculado = user?.settings?.arcaStatus === 'vinculado';
    const isFactAuto  = user?.settings?.factAuto !== false;

    if (isVinculado && isFactAuto) {
      res.json({ ok: true, nro: externalId, id: order._id, message: 'Registrada. Emitiendo CAE...' });
      _intentarAutoFacturar(req.userId, order).catch(e => console.error('Auto-factura:', e.message));
    } else {
      res.json({ ok: true, nro: externalId, id: order._id, message: 'Venta registrada como pendiente.' });
    }
  } catch (e) { res.status(500).json({ error: 'Error al registrar venta: ' + e.message }); }
});

// ════════════════════════════════════════════════════════════
//  API — STATS
// ════════════════════════════════════════════════════════════
app.get('/api/stats/dashboard', requireAuthAPI, async (req, res) => {
  try {
    const { platform, desde, hasta } = req.query;
    const match = { userId: new mongoose.Types.ObjectId(req.userId) };
    if (platform) match.platform = platform;

    if (desde || hasta) {
      const df = {};
      if (desde) df.$gte = new Date(desde);
      if (hasta) { const h = new Date(hasta); h.setHours(23,59,59,999); df.$lte = h; }
      match.$or = [
        { orderDate: df },
        { orderDate: { $exists: false }, createdAt: df },
        { orderDate: null, createdAt: df },
      ];
    }

    const hoyStart = new Date(); hoyStart.setHours(0,0,0,0);
    const hoyEnd   = new Date(); hoyEnd.setHours(23,59,59,999);
    const matchHoy = {
      userId: new mongoose.Types.ObjectId(req.userId),
      status: { $in: ['pending_invoice','invoiced'] },
      $or: [
        { orderDate: { $gte: hoyStart, $lte: hoyEnd } },
        { orderDate: { $exists: false }, createdAt: { $gte: hoyStart, $lte: hoyEnd } },
        { orderDate: null, createdAt: { $gte: hoyStart, $lte: hoyEnd } },
      ],
    };
    if (platform) matchHoy.platform = platform;

    const [totals, facturado, recent, hoyAgg, pendientesCount, plataformas] = await Promise.all([
      Order.aggregate([{ $match: { ...match, status: { $in: ['pending_invoice','invoiced'] } } }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
      Order.aggregate([{ $match: { ...match, status: 'invoiced' } }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
      Order.find({ ...match }).sort({ orderDate: -1, createdAt: -1 }).limit(100).lean(),
      Order.aggregate([{ $match: matchHoy }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
      Order.countDocuments({ ...match, status: 'pending_invoice' }),
      Order.aggregate([{ $match: { ...match, status: { $in: ['pending_invoice','invoiced'] } } }, { $group: { _id: '$platform', total: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { total: -1 } }]),
    ]);

    res.json({
      ok: true,
      totalMonto:     totals[0]?.total    || 0,
      totalOrden:     totals[0]?.count    || 0,
      facturadoMonto: facturado[0]?.total || 0,
      facturadoCount: facturado[0]?.count || 0,
      hoyMonto:       hoyAgg[0]?.total    || 0,
      hoyCount:       hoyAgg[0]?.count    || 0,
      pendientes:     pendientesCount      || 0,
      plataformas,
      ultimas:        recent,
    });
  } catch (e) { res.status(500).json({ error: 'Error al obtener estadísticas' }); }
});

app.get('/api/orders', requireAuthAPI, async (req, res) => {
  try {
    const { platform, status, limit = 100 } = req.query;
    const filter = { userId: req.userId };
    if (platform) filter.platform = platform;
    if (status)   filter.status   = status;
    const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(Math.min(parseInt(limit), 500)).lean();
    res.json({ ok: true, orders });
  } catch (e) { res.status(500).json({ error: 'Error interno' }); }
});

// ════════════════════════════════════════════════════════════
//  API — INTEGRACIONES
// ════════════════════════════════════════════════════════════
app.get('/api/integrations', requireAuthAPI, async (req, res) => {
  const list = await Integration.find({ userId: req.userId }).select('-credentials -webhookSecret').lean();
  res.json({ ok: true, integrations: list });
});

app.patch('/api/integrations/:id/status', requireAuthAPI, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active','paused'].includes(status)) return res.status(400).json({ error: 'Status inválido' });
    const doc = await Integration.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, { status }, { new: true, select: '-credentials -webhookSecret' });
    if (!doc) return res.status(404).json({ error: 'No encontrada' });
    res.json({ ok: true, integration: doc });
  } catch (e) { res.status(500).json({ error: 'Error interno' }); }
});

app.delete('/api/integrations/:id', requireAuthAPI, async (req, res) => {
  try {
    const doc = await Integration.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!doc) return res.status(404).json({ error: 'No encontrada' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Error interno' }); }
});

app.get('/api/integrations/:id/webhook', requireAuthAPI, async (req, res) => {
  const doc = await Integration.findOne({ _id: req.params.id, userId: req.userId }).select('platform webhookSecret');
  if (!doc) return res.status(404).json({ error: 'No encontrada' });
  res.json({ ok: true, url: `${BASE}/webhook/${doc.platform}/${doc.webhookSecret}` });
});

app.post('/api/integrations/:platform', requireAuthAPI, async (req, res) => {
  const { platform } = req.params;
  const SUPPORTED = ['tiendanube','empretienda','rappi','vtex','shopify'];
  if (!SUPPORTED.includes(platform)) return res.status(400).json({ error: `Plataforma ${platform} no soporta token directo` });
  try {
    const { storeId, storeName, storeUrl, apiToken, apiKey, apiSecret } = req.body;
    if (!storeId) return res.status(400).json({ error: 'storeId requerido' });
    const creds = {};
    if (apiToken) creds.apiToken = encrypt(apiToken);
    if (apiKey)   creds.apiKey   = encrypt(apiKey);
    if (apiSecret) creds.apiSecret = encrypt(apiSecret);
    const integration = await Integration.findOneAndUpdate(
      { userId: req.userId, platform, storeId: String(storeId) },
      { $set: { storeName: storeName || `${platform} ${storeId}`, storeUrl: storeUrl || '', status: 'active', errorLog: '', credentials: creds, updatedAt: new Date(), initialSyncDone: false },
        $setOnInsert: { userId: req.userId, platform, storeId: String(storeId), createdAt: new Date() } },
      { upsert: true, new: true }
    );
    if (platform === 'tiendanube' && apiToken) await _registerWebhookTiendaNube(integration, apiToken).catch(console.warn);
    _dispararSyncHistorico(integration);
    res.json({ ok: true, message: `${platform} conectado. Sincronizando...` });
  } catch (e) { res.status(500).json({ error: 'Error al conectar: ' + e.message }); }
});

app.post('/api/integrations/:id/sync', requireAuthAPI, async (req, res) => {
  try {
    const integration = await Integration.findOne({ _id: req.params.id, userId: req.userId });
    if (!integration) return res.status(404).json({ error: 'No encontrada' });
    if (integration.status !== 'active') return res.status(400).json({ error: 'Integración inactiva' });
    if (!BULK_SYNC[integration.platform]) return res.status(400).json({ error: `Sync no disponible para ${integration.platform}` });
    res.json({ ok: true, message: 'Sincronización iniciada' });
    BULK_SYNC[integration.platform](integration)
      .then(() => Integration.findByIdAndUpdate(integration._id, { lastSyncAt: new Date(), errorLog: '' }))
      .catch(err => Integration.findByIdAndUpdate(integration._id, { errorLog: err.message }));
  } catch (e) { res.status(500).json({ error: 'Error interno' }); }
});

// ════════════════════════════════════════════════════════════
//  WOOCOMMERCE OAUTH
// ════════════════════════════════════════════════════════════
app.get('/auth/woo/connect', requireAuth, (req, res) => {
  const { store_url } = req.query;
  if (!store_url) return res.status(400).send('Falta store_url');
  const clean = store_url.replace(/\/$/, '').toLowerCase();
  const state = jwt.sign({ userId: req.userId, storeUrl: clean }, JWT_SECRET, { expiresIn: '15m' });
  res.redirect(`${clean}/wc-auth/v1/authorize?app_name=KOI-Factura&scope=read_write&user_id=${req.userId}&return_url=${encodeURIComponent(`${BASE}/dashboard?woo=connected`)}&callback_url=${encodeURIComponent(`${BASE}/auth/woo/callback?state=${encodeURIComponent(state)}`)}`);
});

app.post('/auth/woo/callback', async (req, res) => {
  res.status(200).json({ status: 'ok' });
  const { state } = req.query;
  const { consumer_key, consumer_secret } = req.body;
  try {
    const { userId, storeUrl } = jwt.verify(state, JWT_SECRET);
    const integration = await Integration.findOneAndUpdate(
      { userId, platform: 'woocommerce', storeId: storeUrl },
      { $set: { storeName: storeUrl.replace(/^https?:\/\//, ''), storeUrl, status: 'active', errorLog: '', credentials: { consumerKey: encrypt(consumer_key), consumerSecret: encrypt(consumer_secret) }, initialSyncDone: false, updatedAt: new Date() },
        $setOnInsert: { userId, platform: 'woocommerce', storeId: storeUrl, createdAt: new Date() } },
      { upsert: true, new: true }
    );
    await _registerWebhookWoo(integration, consumer_key, consumer_secret, storeUrl);
    _dispararSyncHistorico(integration);
    console.log(`✅ WooCommerce: ${storeUrl}`);
  } catch (e) { console.error('WooCommerce callback:', e.message); }
});

async function _registerWebhookWoo(integration, key, secret, storeUrl) {
  const wh = `${BASE}/webhook/woocommerce/${integration.webhookSecret}`;
  try {
    const { data: existing } = await axios.get(`${storeUrl}/wp-json/wc/v3/webhooks`, { auth: { username: key, password: secret }, params: { per_page: 100 } });
    if (existing?.some(w => w.delivery_url === wh)) return;
    await axios.post(`${storeUrl}/wp-json/wc/v3/webhooks`, { name: 'KOI-Factura', topic: 'order.created', delivery_url: wh, status: 'active' }, { auth: { username: key, password: secret } });
    console.log(`🔌 WooCommerce webhook: ${storeUrl}`);
  } catch (e) { console.warn('WooCommerce webhook:', e.message); }
}

async function _registerWebhookTiendaNube(integration, apiToken) {
  await axios.post(`https://api.tiendanube.com/v1/${integration.storeId}/webhooks`,
    { event: 'order/paid', url: `${BASE}/webhook/tiendanube/${integration.webhookSecret}` },
    { headers: { Authentication: `bearer ${apiToken}`, 'User-Agent': 'KOI-Factura/4.3' } }
  );
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
    const { data: token } = await axios.post('https://api.mercadolibre.com/oauth/token', { grant_type: 'authorization_code', client_id: process.env.ML_CLIENT_ID, client_secret: process.env.ML_CLIENT_SECRET, code, redirect_uri: `${BASE}/auth/ml/callback` });
    const { data: seller } = await axios.get('https://api.mercadolibre.com/users/me', { headers: { Authorization: `Bearer ${token.access_token}` } });
    const sellerId = String(token.user_id || seller.id);
    const integration = await Integration.findOneAndUpdate(
      { userId, platform: 'mercadolibre', storeId: sellerId },
      { $set: { storeName: seller.nickname || `ML ${sellerId}`, status: 'active', errorLog: '', credentials: { accessToken: encrypt(token.access_token), refreshToken: encrypt(token.refresh_token), tokenExpiry: new Date(Date.now() + token.expires_in * 1000).toISOString(), sellerId }, initialSyncDone: false, updatedAt: new Date() },
        $setOnInsert: { userId, platform: 'mercadolibre', storeId: sellerId, createdAt: new Date() } },
      { upsert: true, new: true }
    );
    _dispararSyncHistorico(integration);
    res.redirect('/dashboard?ml=connected');
  } catch (e) { console.error('ML callback:', e.message); res.redirect('/dashboard?error=ml_failed'); }
});

async function _getMLToken(integration) {
  const expiry = new Date(integration.credentials.tokenExpiry || 0);
  if (expiry > new Date(Date.now() + 10 * 60_000)) return decrypt(integration.credentials.accessToken);
  const { data } = await axios.post('https://api.mercadolibre.com/oauth/token', { grant_type: 'refresh_token', client_id: process.env.ML_CLIENT_ID, client_secret: process.env.ML_CLIENT_SECRET, refresh_token: decrypt(integration.credentials.refreshToken) });
  await Integration.findByIdAndUpdate(integration._id, { 'credentials.accessToken': encrypt(data.access_token), 'credentials.refreshToken': encrypt(data.refresh_token), 'credentials.tokenExpiry': new Date(Date.now() + data.expires_in * 1000).toISOString() });
  return data.access_token;
}

// ════════════════════════════════════════════════════════════
//  BULK SYNC ENGINE
// ════════════════════════════════════════════════════════════
const BULK_SYNC = {
  async woocommerce(integration) {
    const key = integration.getKey('consumerKey'), secret = integration.getKey('consumerSecret');
    let page = 1, total = 0;
    while (true) {
      const { data } = await axios.get(`${integration.storeUrl}/wp-json/wc/v3/orders`, { auth: { username: key, password: secret }, params: { per_page: 100, page, orderby: 'date', order: 'desc' } });
      if (!data?.length) break;
      for (const o of data) await upsertOrder(integration, normalize.woocommerce(o));
      total += data.length;
      if (data.length < 100) break;
      page++;
    }
    return total;
  },
  async tiendanube(integration) {
    const token = integration.getKey('apiToken');
    let page = 1, total = 0;
    while (true) {
      const { data } = await axios.get(`https://api.tiendanube.com/v1/${integration.storeId}/orders`, { headers: { Authentication: `bearer ${token}`, 'User-Agent': 'KOI-Factura/4.3' }, params: { per_page: 200, page } });
      if (!data?.length) break;
      for (const o of data) await upsertOrder(integration, normalize.tiendanube(o));
      total += data.length;
      if (data.length < 200) break;
      page++;
    }
    return total;
  },
  async mercadolibre(integration) {
    const accessToken = await _getMLToken(integration);
    const sellerId = integration.credentials.sellerId;
    let offset = 0, total = 0;
    while (true) {
      const { data } = await axios.get('https://api.mercadolibre.com/orders/search', { headers: { Authorization: `Bearer ${accessToken}` }, params: { seller: sellerId, limit: 50, offset, sort: 'date_desc' } });
      const orders = data.results || [];
      if (!orders.length) break;
      for (const o of orders) await upsertOrder(integration, normalize.mercadolibre(o));
      total += orders.length;
      offset += 50;
      if (offset >= (data.paging?.total || 0)) break;
    }
    return total;
  },
  async vtex(integration) {
    const apiKey = integration.getKey('apiKey'), apiToken = integration.getKey('apiToken');
    let page = 1, total = 0;
    while (true) {
      const { data } = await axios.get(`${integration.storeUrl}/api/oms/pvt/orders`, { headers: { 'X-VTEX-API-AppKey': apiKey, 'X-VTEX-API-AppToken': apiToken }, params: { page, per_page: 100 } });
      const orders = data.list || [];
      if (!orders.length) break;
      for (const o of orders) await upsertOrder(integration, normalize.vtex(o));
      total += orders.length;
      if (orders.length < 100) break;
      page++;
    }
    return total;
  },
};

async function _dispararSyncHistorico(integration) {
  const fn = BULK_SYNC[integration.platform];
  if (!fn) return;
  console.log(`🔄 Sync: ${integration.platform} / ${integration.storeId}`);
  try {
    const count = await fn(integration);
    await Integration.findByIdAndUpdate(integration._id, { lastSyncAt: new Date(), errorLog: '', initialSyncDone: true });
    console.log(`✅ Sync ${integration.platform}: ${count} órdenes`);
  } catch (err) {
    console.error(`❌ Sync ${integration.platform}:`, err.message);
    await Integration.findByIdAndUpdate(integration._id, { errorLog: `Sync: ${err.message}`, status: 'error' });
  }
}

// ════════════════════════════════════════════════════════════
//  WEBHOOKS
// ════════════════════════════════════════════════════════════
async function handleWebhook(platform, secret, getCanonical) {
  const integration = await Integration.findOne({ platform, webhookSecret: secret, status: 'active' });
  if (!integration) return;
  try {
    const canonical = await getCanonical(integration);
    if (canonical) await upsertOrder(integration, canonical);
  } catch (e) { console.error(`Webhook ${platform}:`, e.message); }
}

app.post('/webhook/woocommerce/:secret',  async (req, res) => { res.status(200).send('OK'); await handleWebhook('woocommerce',  req.params.secret, () => normalize.woocommerce(req.body)); });
app.post('/webhook/tiendanube/:secret',   async (req, res) => { res.status(200).send('OK'); await handleWebhook('tiendanube',   req.params.secret, async (i) => { const t = i.getKey('apiToken'); const { data } = await axios.get(`https://api.tiendanube.com/v1/${i.storeId}/orders/${req.body.id}`, { headers: { Authentication: `bearer ${t}`, 'User-Agent': 'KOI-Factura/4.3' } }); return normalize.tiendanube(data); }); });
app.post('/webhook/mercadolibre/:secret', async (req, res) => { res.status(200).send('OK'); const { topic, resource } = req.body; if (!['orders_v2','orders'].includes(topic)) return; await handleWebhook('mercadolibre', req.params.secret, async (i) => { const t = await _getMLToken(i); const url = resource.startsWith('http') ? resource : `https://api.mercadolibre.com${resource}`; const { data } = await axios.get(url, { headers: { Authorization: `Bearer ${t}` } }); return normalize.mercadolibre(data); }); });
app.post('/webhook/vtex/:secret',         async (req, res) => { res.status(200).send('OK'); await handleWebhook('vtex',         req.params.secret, () => normalize.vtex(req.body)); });
app.post('/webhook/empretienda/:secret',  async (req, res) => { res.status(200).send('OK'); await handleWebhook('empretienda',  req.params.secret, () => normalize.empretienda(req.body)); });
app.post('/webhook/rappi/:secret',        async (req, res) => { res.status(200).send('OK'); await handleWebhook('rappi',        req.params.secret, () => normalize.rappi(req.body)); });
app.post('/webhook/shopify/:secret',      async (req, res) => { res.status(200).send('OK'); await handleWebhook('shopify',      req.params.secret, () => normalize.shopify(req.body)); });

// ════════════════════════════════════════════════════════════
//  PÁGINAS HTML
// ════════════════════════════════════════════════════════════
const isLoggedIn = (req) => { try { jwt.verify(req.cookies.koi_token, JWT_SECRET); return true; } catch { return false; } };
app.get('/', (req, res) => res.redirect(isLoggedIn(req) ? '/dashboard' : '/login'));
app.get('/login', (req, res) => isLoggedIn(req) ? res.redirect('/dashboard') : res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/dashboard', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/health', (_, res) => res.json({ status: 'ok', ts: Date.now() }));

// ════════════════════════════════════════════════════════════
//  KEEP-ALIVE
// ════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`🚀 KOI-Factura v4.3 — puerto ${PORT} | ${BASE}`);
  if (process.env.BASE_URL) {
    const ping = () => axios.get(`${BASE}/health`, { timeout: 10_000 }).then(() => console.log('🏓 Ping OK')).catch(e => console.warn('⚠️ Ping:', e.message));
    setTimeout(() => { ping(); setInterval(ping, 10 * 60 * 1000); }, 30_000);
  }
});

// ════════════════════════════════════════════════════════════
//  ADMIN PANEL
// ════════════════════════════════════════════════════════════
const ADMIN_EMAIL = 'koi.automatic@gmail.com';

async function requireAdmin(req, res, next) {
  const admin = await User.findById(req.userId).select('email').lean();
  if (!admin || admin.email.trim() !== ADMIN_EMAIL) return res.status(403).json({ error: 'No autorizado' });
  next();
}

app.get('/api/admin/pendientes', requireAuthAPI, requireAdmin, async (req, res) => {
  try {
    const pendientes = await User.find({ 'settings.arcaStatus': { $in: ['pendiente','en_proceso','vinculado'] } }).select('nombre apellido email settings').lean();
    const lista = pendientes.map(u => ({
      id: u._id, cliente: `${u.nombre || ''} ${u.apellido || ''}`.trim(), email: u.email,
      cuit: u.settings?.cuit || 'N/A', claveFiscal: u.settings?.arcaClave ? decrypt(u.settings.arcaClave) : 'Sin clave',
      status: u.settings?.arcaStatus || 'pendiente', puntoVenta: u.settings?.arcaPtoVta || 1, notas: u.settings?.arcaNotas || '',
    }));
    res.json({ ok: true, total: lista.length, lista });
  } catch (e) { res.status(500).json({ error: 'Error en panel admin' }); }
});

app.post('/api/admin/update-status', requireAuthAPI, requireAdmin, async (req, res) => {
  try {
    const { userId, nuevoStatus, notas, puntoVenta } = req.body;
    await User.findByIdAndUpdate(userId, { $set: { 'settings.arcaStatus': nuevoStatus, 'settings.arcaNotas': notas, 'settings.arcaPtoVta': Number(puntoVenta) || 1 } });
    if (nuevoStatus === 'vinculado') {
      const user = await User.findById(userId).select('settings.cuit').lean();
      const cuit = user?.settings?.cuit?.replace(/\D/g, '');
      if (cuit) { try { fs.unlinkSync(path.join(TA_CACHE_DIR, `${cuit}.json`)); } catch {} console.log(`🔄 TA cache limpiado CUIT ${cuit}`); }
    }
    res.json({ ok: true, message: `Estado: "${nuevoStatus}"` });
  } catch (e) { res.status(500).json({ error: 'No se pudo actualizar' }); }
});
