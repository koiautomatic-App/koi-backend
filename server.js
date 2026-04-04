// ============================================================
//  KOI-FACTURA · SaaS Multi-Tenant Engine v3.4
//  Node/Express · MongoDB Atlas · Google OAuth · JWT
//  AFIP/ARCA — Delegación Multi-Tenant integrada
//  CORREGIDO: XML, namespaces, formato de números
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
const { execSync }   = require('child_process');
const os             = require('os');
const https          = require('https');

const app  = express();
const PORT = process.env.PORT || 10000;
const BASE = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const JWT_SECRET = process.env.JWT_SECRET || 'koi-jwt-dev-change-in-production';

// ════════════════════════════════════════════════════════════
//  AFIP — CONFIGURACIÓN GLOBAL
// ════════════════════════════════════════════════════════════
const CUIT_MAESTRO = (process.env.AFIP_CUIT || process.env.CUIT_MAESTRO || '20309782489').replace(/\D/g, '');
const PROD_MODE    = process.env.NODE_ENV === 'production';

const AFIP_CERT_PATH = process.env.AFIP_CERT_PATH || '/etc/secrets/koi.crt';
const AFIP_KEY_PATH  = process.env.AFIP_KEY_PATH  || '/etc/secrets/koi.key';

const TA_CACHE_DIR = process.env.TA_CACHE_DIR || path.join(os.tmpdir(), 'koi-ta');
fs.mkdirSync(TA_CACHE_DIR, { recursive: true });

const WSAA_URL = PROD_MODE
  ? 'https://wsaa.afip.gov.ar/ws/services/LoginCms'
  : 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms';

const WSFE_URL = PROD_MODE
  ? 'https://servicios1.afip.gov.ar/wsfev1/service.asmx'
  : 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx';

function _verificarCertsMaestro() {
  const certOk = fs.existsSync(AFIP_CERT_PATH);
  const keyOk  = fs.existsSync(AFIP_KEY_PATH);
  if (certOk && keyOk) {
    console.log(`🔐 Certs AFIP listos: ${AFIP_CERT_PATH} / ${AFIP_KEY_PATH}`);
    console.log(`🔐 CUIT Maestro: ${CUIT_MAESTRO}`);
    console.log(`🌐 AFIP modo: ${PROD_MODE ? 'PRODUCCIÓN' : 'HOMOLOGACIÓN'}`);
  } else {
    console.warn(`⚠️  Certs AFIP NO encontrados:`);
    if (!certOk) console.warn(`   Falta .crt en: ${AFIP_CERT_PATH}`);
    if (!keyOk)  console.warn(`   Falta .key en: ${AFIP_KEY_PATH}`);
  }
}
_verificarCertsMaestro();

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
  cookie: { secure: PROD_MODE, httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 },
}));
app.use(passport.initialize());
app.use(passport.session());

// ════════════════════════════════════════════════════════════
//  MONGODB
// ════════════════════════════════════════════════════════════
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize: 10, serverSelectionTimeoutMS: 5000,
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
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivHex, 'hex'));
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
    arcaUser:   { type: String },
    arcaClave:  { type: String },
    arcaPtoVta: { type: Number, default: 1 },
    arcaStatus: {
      type:    String,
      default: 'sin_vincular',
      enum:    ['sin_vincular', 'pendiente', 'en_proceso', 'vinculado', 'error'],
    },
    arcaNotas:  { type: String },
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
    type:     String,
    required: true,
    enum:     ['woocommerce', 'tiendanube', 'mercadolibre', 'empretienda', 'rappi', 'vtex', 'shopify'],
  },
  storeId:         { type: String, required: true },
  storeName:       { type: String },
  storeUrl:        { type: String },
  status:          { type: String, default: 'active', enum: ['active', 'paused', 'error', 'pending'] },
  credentials:     { type: mongoose.Schema.Types.Mixed, default: {} },
  webhookSecret:   { type: String, default: () => crypto.randomBytes(24).toString('hex'), index: true },
  lastSyncAt:      { type: Date },
  syncCursor:      { type: String },
  errorLog:        { type: String },
  initialSyncDone: { type: Boolean, default: false },
  updatedAt:       { type: Date, default: Date.now },
  createdAt:       { type: Date, default: Date.now },
}, { timestamps: false });

IntegrationSchema.index({ userId: 1, platform: 1, storeId: 1 }, { unique: true });
IntegrationSchema.methods.setKey = function(field, value) {
  this.credentials = { ...this.credentials, [field]: encrypt(value) };
};
IntegrationSchema.methods.getKey = function(field) {
  return decrypt(this.credentials?.[field]);
};
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
//  MÓDULO AFIP — CORREGIDO
// ════════════════════════════════════════════════════════════

function _firmarCMS(xml) {
  if (!fs.existsSync(AFIP_KEY_PATH) || !fs.existsSync(AFIP_CERT_PATH)) {
    throw new Error(`Certificados AFIP no encontrados.`);
  }

  const tmpXml = path.join(os.tmpdir(), `koi_req_${Date.now()}.xml`);
  const tmpOut = path.join(os.tmpdir(), `koi_req_${Date.now()}.der`);

  try {
    fs.writeFileSync(tmpXml, xml, 'utf8');
    execSync(
      `openssl cms -sign -in "${tmpXml}" -signer "${AFIP_CERT_PATH}" -inkey "${AFIP_KEY_PATH}" ` +
      `-nodetach -outform DER -out "${tmpOut}"`,
      { stdio: 'pipe' }
    );
    const signed = fs.readFileSync(tmpOut);
    return signed.toString('base64');
  } finally {
    try { fs.unlinkSync(tmpXml); } catch {}
    try { fs.unlinkSync(tmpOut); } catch {}
  }
}

function _generarCMS(servicio = 'wsfe') {
  const ahora = new Date();
  const desde = new Date(ahora.getTime() - 60_000);
  const hasta = new Date(ahora.getTime() + 12 * 3600_000);
  
  const formatAFIP = (d) => {
    return d.toISOString().replace('Z', '-03:00');
  };

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${Date.now()}</uniqueId>
    <generationTime>${formatAFIP(desde)}</generationTime>
    <expirationTime>${formatAFIP(hasta)}</expirationTime>
  </header>
  <service>${servicio}</service>
</loginTicketRequest>`;

  return _firmarCMS(xml);
}

function _soapPost(url, body, action = '') {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const postData = Buffer.from(body, 'utf8');
    const headers = {
      'Content-Type': 'text/xml; charset=utf-8',
      'Content-Length': postData.length,
    };
    
    if (action) {
      headers['SOAPAction'] = action;
    } else if (url.includes('wsfev1')) {
      headers['SOAPAction'] = '';
    } else if (url.includes('LoginCms')) {
      headers['SOAPAction'] = '';
    }
    
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + (parsed.search || ''),
      method: 'POST',
      headers: headers,
      timeout: 60000,
    };

    const req = https.request(options, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(data);
        } else {
          reject(new Error(`AFIP HTTP ${res.statusCode}: ${data.substring(0, 500)}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout AFIP')); });
    req.write(postData);
    req.end();
  });
}

function _leerTACache(cuit) {
  try {
    return JSON.parse(fs.readFileSync(path.join(TA_CACHE_DIR, cuit, 'ta-wsfe.json'), 'utf8'));
  } catch { return null; }
}

function _guardarTACache(cuit, ta) {
  const dir = path.join(TA_CACHE_DIR, cuit);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ta-wsfe.json'), JSON.stringify(ta, null, 2), 'utf8');
}

function _taEsValido(ta) {
  if (!ta?.expiracion) return false;
  return Date.now() < new Date(ta.expiracion).getTime() - 10 * 60 * 1000;
}

function _parsearTA(xml) {
  const m = xml.match(/<loginCmsReturn>([\s\S]*?)<\/loginCmsReturn>/);
  if (!m) throw new Error('WSAA: no se encontró loginCmsReturn en la respuesta');

  const taXml = Buffer.from(m[1].trim(), 'base64').toString('utf8');
  const token = taXml.match(/<token>([\s\S]*?)<\/token>/)?.[1]?.trim();
  const sign  = taXml.match(/<sign>([\s\S]*?)<\/sign>/)?.[1]?.trim();
  const exp   = taXml.match(/<expirationTime>([\s\S]*?)<\/expirationTime>/)?.[1]?.trim();

  if (!token || !sign) throw new Error('WSAA: no se pudo extraer token/sign del TA');
  return { token, sign, expiracion: exp, generadoEn: new Date().toISOString() };
}

async function afip_obtenerTA(cuitUsuario) {
  const cache = _leerTACache(cuitUsuario);
  if (cache && _taEsValido(cache)) return { token: cache.token, sign: cache.sign };

  const cms = _generarCMS('wsfe');

  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope 
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" 
  xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov/">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cms}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;

  const resp = await _soapPost(WSAA_URL, soapBody, '');
  const ta   = _parsearTA(resp);
  _guardarTACache(cuitUsuario, ta);
  return { token: ta.token, sign: ta.sign };
}

function _fechaAFIP(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function _parseFechaAFIP(str) {
  if (!str || str.length !== 8) return null;
  return new Date(`${str.slice(0,4)}-${str.slice(4,6)}-${str.slice(6,8)}`);
}

function _docTipo(doc) {
  const d = String(doc || '0').replace(/\D/g, '');
  if (d === '0' || d.startsWith('9999')) return 99;
  if (d.length === 11) return 80;
  return 96;
}

function _tipoComprobante(categoria) {
  return 11; // Monotributistas → Factura C
}

async function _afipUltimoNro(cuit, puntoVenta, cbTipo, token, sign) {
  const soap = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsfe="http://ar.gov.afip.dif.fev1/">
<soapenv:Header/>
<soapenv:Body>
<wsfe:FECompUltimoAutorizado>
<wsfe:Auth>
<wsfe:Token>${token}</wsfe:Token>
<wsfe:Sign>${sign}</wsfe:Sign>
<wsfe:Cuit>${cuit}</wsfe:Cuit>
</wsfe:Auth>
<wsfe:PtoVta>${puntoVenta}</wsfe:PtoVta>
<wsfe:CbteTipo>${cbTipo}</wsfe:CbteTipo>
</wsfe:FECompUltimoAutorizado>
</soapenv:Body>
</soapenv:Envelope>`;

  const resp = await _soapPost(WSFE_URL, soap, '');
  const match = resp.match(/<CbteNro>(\d+)<\/CbteNro>/);
  return match ? parseInt(match[1], 10) : 0;
}

async function afip_emitirComprobante(cuitEmisor, puntoVenta, datos) {
  const { token, sign } = await afip_obtenerTA(cuitEmisor);

  const cbTipo    = datos.tipoComprobante || 11;
  const ultimoNro = await _afipUltimoNro(cuitEmisor, puntoVenta, cbTipo, token, sign);
  const nroComp   = ultimoNro + 1;
  const fechaHoy  = _fechaAFIP(new Date());
  const importe   = datos.importeTotal.toFixed(2);
  const docTipo   = _docTipo(datos.clienteDoc);
  const docNro    = String(datos.clienteDoc || '0').replace(/\D/g, '') || '0';

  function escapeXml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  const soap = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsfe="http://ar.gov.afip.dif.fev1/">
<soapenv:Header/>
<soapenv:Body>
<wsfe:FECAESolicitar>
<wsfe:Auth>
<wsfe:Token>${escapeXml(token)}</wsfe:Token>
<wsfe:Sign>${escapeXml(sign)}</wsfe:Sign>
<wsfe:Cuit>${cuitEmisor}</wsfe:Cuit>
</wsfe:Auth>
<wsfe:FeCAEReq>
<wsfe:FeCabReq>
<wsfe:CantReg>1</wsfe:CantReg>
<wsfe:PtoVta>${puntoVenta}</wsfe:PtoVta>
<wsfe:CbteTipo>${cbTipo}</wsfe:CbteTipo>
</wsfe:FeCabReq>
<wsfe:FeDetReq>
<wsfe:FECAEDetRequest>
<wsfe:Concepto>1</wsfe:Concepto>
<wsfe:DocTipo>${docTipo}</wsfe:DocTipo>
<wsfe:DocNro>${docNro}</wsfe:DocNro>
<wsfe:CbteDesde>${nroComp}</wsfe:CbteDesde>
<wsfe:CbteHasta>${nroComp}</wsfe:CbteHasta>
<wsfe:CbteFch>${fechaHoy}</wsfe:CbteFch>
<wsfe:ImpTotal>${importe}</wsfe:ImpTotal>
<wsfe:ImpTotConc>0.00</wsfe:ImpTotConc>
<wsfe:ImpNeto>${importe}</wsfe:ImpNeto>
<wsfe:ImpOpEx>0.00</wsfe:ImpOpEx>
<wsfe:ImpIVA>0.00</wsfe:ImpIVA>
<wsfe:ImpTrib>0.00</wsfe:ImpTrib>
<wsfe:MonId>PES</wsfe:MonId>
<wsfe:MonCotiz>1.00</wsfe:MonCotiz>
</wsfe:FECAEDetRequest>
</wsfe:FeDetReq>
</wsfe:FeCAEReq>
</wsfe:FECAESolicitar>
</soapenv:Body>
</soapenv:Envelope>`;

  console.log(`📤 AFIP: CUIT=${cuitEmisor}, PV=${puntoVenta}, Nro=${nroComp}, Monto=${importe}`);

  const resp = await _soapPost(WSFE_URL, soap, '');
  
  const resultado = resp.match(/<Resultado>([^<]+)<\/Resultado>/)?.[1]?.trim();
  const cae = resp.match(/<CAE>([^<]+)<\/CAE>/)?.[1]?.trim();
  const caeVto = resp.match(/<CAEFchVto>([^<]+)<\/CAEFchVto>/)?.[1]?.trim();
  const errMsg = resp.match(/<Msg>([^<]+)<\/Msg>/)?.[1]?.trim();

  if (resultado === 'A' && cae) {
    console.log(`✅ CAE obtenido: ${cae}`);
    return { cae, caeFchVto: _parseFechaAFIP(caeVto), nroComp };
  } else {
    throw new Error(`AFIP rechazó: ${errMsg || 'Error sin mensaje'}`);
  }
}

async function afip_verificarDelegacion(cuitUsuario) {
  try {
    await afip_obtenerTA(cuitUsuario);
    return { ok: true, mensaje: 'Delegación activa ✓' };
  } catch (e) {
    const msg = e.message || '';
    const sinDelegacion = msg.includes('10003') || msg.toLowerCase().includes('no autorizado');
    return {
      ok:      false,
      mensaje: sinDelegacion
        ? `El CUIT ${cuitUsuario} no delegó wsfe al maestro de KOI (${CUIT_MAESTRO}). ` +
          `Ir a AFIP: Mi SIL → Administrador de Relaciones → Adherir WSFE → Representante: ${CUIT_MAESTRO}`
        : `Error de conexión con AFIP: ${msg}`,
    };
  }
}

// ════════════════════════════════════════════════════════════
//  MIDDLEWARE requireArcaCuit
// ════════════════════════════════════════════════════════════
async function requireArcaCuit(req, res, next) {
  const user = await User.findById(req.userId).select('settings').lean();

  if (!user?.settings?.cuit) {
    return res.status(400).json({
      error: 'No tenés un CUIT configurado. Ingresalo en la sección ARCA antes de facturar.',
    });
  }
  if (user.settings.arcaStatus !== 'vinculado') {
    return res.status(400).json({
      error: `Tu CUIT está en estado "${user.settings.arcaStatus}". ` +
             `La facturación se habilita cuando el admin confirme tu vinculación.`,
    });
  }

  req.arcaCuit      = user.settings.cuit.replace(/\D/g, '');
  req.arcaPtoVta    = user.settings.arcaPtoVta  || 1;
  req.arcaCategoria = user.settings.categoria   || 'C';
  req.factAuto      = user.settings.factAuto    !== false;
  req.envioAuto     = user.settings.envioAuto   !== false;
  next();
}

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

function _cleanDoc(raw) { return String(raw || '').replace(/\D/g, ''); }
function _resolveDoc(doc, amount) {
  if (doc.length >= 7 && doc.length <= 11) return doc;
  return amount >= ARCA_LIMIT ? null : CUIT_CF;
}

// ════════════════════════════════════════════════════════════
//  UPSERT ENGINE + AUTO-FACTURACIÓN
// ════════════════════════════════════════════════════════════
async function upsertOrder(integration, canonical) {
  if (!canonical) return;

  const orderFilter = {
    userId:    integration.userId,
    platform:  integration.platform,
    externalId: canonical.externalId,
  };

  if (canonical.customerDoc === null) {
    await Order.findOneAndUpdate(
      orderFilter,
      {
        $setOnInsert: {
          userId: integration.userId, integrationId: integration._id,
          platform: integration.platform, ...canonical,
          customerDoc: '0', status: 'error_data',
          errorLog: `Monto $${canonical.amount} ≥ $${ARCA_LIMIT} sin DNI válido`,
        },
      },
      { upsert: true, new: false }
    ).catch(() => {});
    return;
  }

  const order = await Order.findOneAndUpdate(
    orderFilter,
    {
      $setOnInsert: {
        userId: integration.userId, integrationId: integration._id,
        platform: integration.platform, ...canonical, status: 'pending_invoice',
      },
    },
    { upsert: true, new: true }
  ).catch(err => {
    if (err.code !== 11000)
      console.error(`❌ upsert [${integration.platform}#${canonical.externalId}]:`, err.message);
    return null;
  });

  if (order && order.status === 'pending_invoice') {
    _intentarAutoFacturar(integration.userId, order);
  }
}

async function _intentarAutoFacturar(userId, order) {
  try {
    const user = await User.findById(userId).select('settings').lean();
    if (!user?.settings) return;

    const { factAuto, arcaStatus, cuit, arcaPtoVta, categoria } = user.settings;

    if (!factAuto || arcaStatus !== 'vinculado' || !cuit) return;

    const cuitLimpio = cuit.replace(/\D/g, '');
    const ptoVta     = arcaPtoVta || 1;
    const cbTipo     = _tipoComprobante(categoria || 'C');

    const resultado = await afip_emitirComprobante(cuitLimpio, ptoVta, {
      tipoComprobante: cbTipo,
      clienteDoc:      order.customerDoc || '0',
      importeTotal:    order.amount,
    });

    await Order.findByIdAndUpdate(order._id, {
      status:    'invoiced',
      caeNumber: resultado.cae,
      caeExpiry: resultado.caeFchVto,
      errorLog:  '',
    });

    console.log(`✅ Auto-CAE: CUIT=${cuitLimpio} Orden=${order._id} CAE=${resultado.cae}`);

    if (user.settings.envioAuto && order.customerEmail) {
     
