// ============================================================
//  KOI-FACTURA · SaaS Multi-Tenant Engine v3.2
//  Node/Express · MongoDB Atlas · Google OAuth · JWT
//  AFIP/ARCA — Delegación Multi-Tenant integrada
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
//
//  Render Secret Files:
//    /etc/secrets/koi.crt  ← certificado del CUIT Maestro
//    /etc/secrets/koi.key  ← clave privada del CUIT Maestro
//
//  Variables de entorno en Render:
//    AFIP_CUIT      → CUIT del maestro (ej: 20309782489)
//    AFIP_CERT_PATH → ruta al .crt  (ej: /etc/secrets/koi.crt)
//    AFIP_KEY_PATH  → ruta al .key  (ej: /etc/secrets/koi.key)
//
//  Cache de Tickets de Acceso por usuario: /tmp/koi-ta/{cuit}/ta-wsfe.json
//  (En Render el filesystem /tmp persiste durante la instancia)
// ════════════════════════════════════════════════════════════
const CUIT_MAESTRO = (process.env.AFIP_CUIT || process.env.CUIT_MAESTRO || '20309782489').replace(/\D/g, '');
const PROD_MODE    = process.env.NODE_ENV === 'production';

// Rutas de certs — primero env vars, luego Secret Files de Render como default
const AFIP_CERT_PATH = process.env.AFIP_CERT_PATH || '/etc/secrets/koi.crt';
const AFIP_KEY_PATH  = process.env.AFIP_KEY_PATH  || '/etc/secrets/koi.key';

// Directorio para cache de Tickets de Acceso por usuario
const TA_CACHE_DIR = process.env.TA_CACHE_DIR || path.join(os.tmpdir(), 'koi-ta');
fs.mkdirSync(TA_CACHE_DIR, { recursive: true });

const WSAA_URL = PROD_MODE
  ? 'https://wsaa.afip.gov.ar/ws/services/LoginCms'
  : 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms';

const WSFE_URL = PROD_MODE
  ? 'https://servicios1.afip.gov.ar/wsfev1/service.asmx'
  : 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx';

// Verificación temprana de certs al arrancar
function _verificarCertsMaestro() {
  const certOk = fs.existsSync(AFIP_CERT_PATH);
  const keyOk  = fs.existsSync(AFIP_KEY_PATH);
  if (certOk && keyOk) {
    console.log(`🔐 Certs AFIP listos: ${AFIP_CERT_PATH} / ${AFIP_KEY_PATH}`);
    console.log(`🔐 CUIT Maestro: ${CUIT_MAESTRO}`);
  } else {
    console.warn(`⚠️  Certs AFIP NO encontrados:`);
    if (!certOk) console.warn(`   Falta .crt en: ${AFIP_CERT_PATH}`);
    if (!keyOk)  console.warn(`   Falta .key en: ${AFIP_KEY_PATH}`);
    console.warn(`   Configurá AFIP_CERT_PATH y AFIP_KEY_PATH en Render Environment`);
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
    factAuto:   { type: Boolean, default: true },   // Facturación automática
    envioAuto:  { type: Boolean, default: true },   // Envío automático de mail
    categoria:  { type: String, default: 'C' },
    cuit:       { type: String },
    arcaUser:   { type: String },
    arcaClave:  { type: String },                   // encriptada
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
  // Concepto — solo para ventas manuales
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
//  MÓDULO AFIP — DELEGACIÓN MULTI-TENANT (PRODUCCIÓN OK)
// ════════════════════════════════════════════════════════════

// --- FUNCIONES AUXILIARES (Deben ir arriba para evitar errores de "not defined") ---

function _tipoComprobante(categoria = 'C') {
  // ARCA usa: 1 para Factura A, 6 para Factura B, 11 para Factura C
  if (categoria === 'A') return 1;
  if (categoria === 'B') return 6;
  return 11; 
}

function _fechaAFIP(d) {
  return d.toISOString().split('T')[0].replace(/-/g, '');
}

async function _afipUltimoNro(cuit, puntoVenta, cbTipo, token, sign) {
  const soap = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Header/>
  <soapenv:Body>
    <ar:FECompUltimoAutorizado>
      <ar:Auth>
        <ar:Token>${token}</ar:Token>
        <ar:Sign>${sign}</ar:Sign>
        <ar:Cuit>${cuit}</ar:Cuit>
      </ar:Auth>
      <ar:PtoVta>${puntoVenta}</ar:PtoVta>
      <ar:CbteTipo>${cbTipo}</ar:CbteTipo>
    </ar:FECompUltimoAutorizado>
  </soapenv:Body>
</soapenv:Envelope>`;

  const resp = await _soapPost(WSFE_URL, soap);
  const match = resp.match(/<CbteNro>(\d+)<\/CbteNro>/);
  return match ? parseInt(match[1], 10) : 0;
}

function _firmarCMS(xml) {
  if (!fs.existsSync(AFIP_KEY_PATH) || !fs.existsSync(AFIP_CERT_PATH)) {
    throw new Error(`Certificados no encontrados en: ${AFIP_CERT_PATH}`);
  }

  const tmpXml = path.join(os.tmpdir(), `koi_ltr_${Date.now()}.xml`);
  const tmpOut = path.join(os.tmpdir(), `koi_cms_${Date.now()}.der`);

  try {
    fs.writeFileSync(tmpXml, xml, 'utf8');
    execSync(
      `openssl cms -sign -in "${tmpXml}" -signer "${AFIP_CERT_PATH}" -inkey "${AFIP_KEY_PATH}"` +
      ` -nodetach -outform DER -out "${tmpOut}"`,
      { stdio: 'pipe' }
    );
    return fs.readFileSync(tmpOut).toString('base64');
  } finally {
    try { fs.unlinkSync(tmpXml); } catch {}
    try { fs.unlinkSync(tmpOut); } catch {}
  }
}

function _generarCMS(servicio = 'wsfe') {
  const ahora = new Date();
  const fechaDesde = new Date(ahora.getTime() - (10 * 60 * 1000));
  const fechaHasta = new Date(ahora.getTime() + (12 * 60 * 60 * 1000));

  const toAFIP = (date) => {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    const p = fmt.formatToParts(date);
    const get = (t) => p.find(x => x.type === t).value;
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}-03:00`;
  };

  return _firmarCMS(`<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${Math.floor(Date.now() / 1000)}</uniqueId>
    <generationTime>${toAFIP(fechaDesde)}</generationTime>
    <expirationTime>${toAFIP(fechaHasta)}</expirationTime>
  </header>
  <service>${servicio}</service>
</loginTicketRequest>`);
}

function _soapPost(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const postData = Buffer.from(body, 'utf8');
    
    const isWsaa = url.includes('wsaa');

    const options = {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + (parsed.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Content-Length': postData.length,
        // El secreto: comillas dobles dentro de las simples para cumplir el estándar estricto
        'SOAPAction': isWsaa ? '""' : '"http://ar.gov.afip.dif.FEV1/FECAESolicitar"',
        'Host': parsed.hostname,
        'Connection': 'keep-alive',
        'User-Agent': 'Koi-Fintech/1.0'
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => {
        // Log preventivo si ARCA responde algo que no es XML
        if (res.statusCode !== 200 && !data.includes('Envelope')) {
          console.error(`⚠️ ARCA HTTP ${res.statusCode}:`, data.substring(0, 100));
        }
        resolve(data);
      });
    });

    req.on('error', (e) => reject(new Error(`Error de red ARCA: ${e.message}`)));
    
    // Timeout de 15 segundos para no dejar la petición colgada
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Timeout en la conexión con ARCA'));
    });

    req.write(postData);
    req.end();
  });
}

function _parsearTA(xml) {
  const fault = xml.match(/<faultstring>([\s\S]*?)<\/faultstring>/);
  if (fault) throw new Error(`ARCA Error SOAP: ${fault[1].trim()}`);

  const m = xml.match(/<loginCmsReturn>([\s\S]*?)<\/loginCmsReturn>/);
  if (!m) throw new Error('WSAA: No se encontró loginCmsReturn. Revisar vinculación de servicio en AFIP.');

  const taXml = Buffer.from(m[1].trim(), 'base64').toString('utf8');
  
  // 🔍 ESTO ES LO IMPORTANTE:
  console.log("--- CONTENIDO DEL TICKET RECIBIDO ---");
  console.log(taXml); 
  console.log("-------------------------------------");

  const token = taXml.match(/<token>([\s\S]*?)<\/token>/)?.[1]?.trim();
  const sign  = taXml.match(/<sign>([\s\S]*?)<\/sign>/)?.[1]?.trim();
  const exp   = taXml.match(/<expirationTime>([\s\S]*?)<\/expirationTime>/)?.[1]?.trim();

  if (!token || !sign) {
    // Si no hay token, buscamos el mensaje de error que manda AFIP adentro
    const msgError = taXml.match(/<error>([\s\S]*?)<\/error>/)?.[1] || 'Error interno de ARCA';
    throw new Error(`AFIP denegó el ticket: ${msgError}`);
  }
  
  return { token, sign, expiracion: exp, generadoEn: new Date().toISOString() };
}

// --- FUNCIONES PRINCIPALES ---

async function afip_obtenerTA(cuitUsuario) {
  const cuit = String(cuitUsuario).replace(/\D/g, '');
  const cache = _leerTACache(cuit);
  if (cache && _taEsValido(cache)) return { token: cache.token, sign: cache.sign };

  const cms = _generarCMS('wsfe');
  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.xsb.com.ar">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;

  const resp = await _soapPost(WSAA_URL, soapBody);
  const ta   = _parsearTA(resp);
  _guardarTACache(cuit, ta);
  return { token: ta.token, sign: ta.sign };
}

async function afip_emitirComprobante(cuitEmisor, puntoVenta, datos) {
  const { token, sign } = await afip_obtenerTA(cuitEmisor);
  
  const cbTipo = _tipoComprobante();
  const ultimoNro = await _afipUltimoNro(cuitEmisor, puntoVenta, cbTipo, token, sign);
  const nroComp = ultimoNro + 1;

  const fechaVenta = datos.fechaOriginal ? new Date(datos.fechaOriginal) : new Date();
  const fechaHoy = new Date();
  const diff = Math.floor((fechaHoy - fechaVenta) / (1000 * 60 * 60 * 24));
  
  let fEmision = _fechaAFIP(fechaHoy);
  if (diff <= 5) fEmision = _fechaAFIP(fechaVenta);
  else {
    const limite = new Date();
    limite.setDate(fechaHoy.getDate() - 5);
    fEmision = _fechaAFIP(limite);
  }

  const importe = parseFloat(datos.importeTotal.toFixed(2));
  const docTipo = (importe >= 191624) ? 96 : (String(datos.clienteDoc).length === 11 ? 80 : 99);
  const docNro  = String(datos.clienteDoc || '0').replace(/\D/g, '') || '0';

  const soap = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Header/><soapenv:Body><ar:FECAESolicitar><ar:Auth>
  <ar:Token>${token}</ar:Token><ar:Sign>${sign}</ar:Sign><ar:Cuit>${cuitEmisor}</ar:Cuit>
  </ar:Auth><ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${puntoVenta}</ar:PtoVta>
  <ar:CbteTipo>${cbTipo}</ar:CbteTipo></ar:FeCabReq><ar:FeDetReq><ar:FECAEDetRequest>
  <ar:Concepto>1</ar:Concepto><ar:DocTipo>${docTipo}</ar:DocTipo><ar:DocNro>${docNro}</ar:DocNro>
  <ar:CbteDesde>${nroComp}</ar:CbteDesde><ar:CbteHasta>${nroComp}</ar:CbteHasta><ar:CbteFch>${fEmision}</ar:CbteFch>
  <ar:ImpTotal>${importe}</ar:ImpTotal><ar:ImpTotConc>0.00</ar:ImpTotConc><ar:ImpNeto>${importe}</ar:ImpNeto>
  <ar:ImpOpEx>0.00</ar:ImpOpEx><ar:ImpIVA>0.00</ar:ImpIVA><ar:ImpTrib>0.00</ar:ImpTrib>
  <ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz></ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq>
  </ar:FECAESolicitar></soapenv:Body></soapenv:Envelope>`;

  const resp = await _soapPost(WSFE_URL, soap);
  const resultado = resp.match(/<Resultado>([\s\S]*?)<\/Resultado>/)?.[1];
  
  if (resultado !== 'A') {
    const err = resp.match(/<Msg>([\s\S]*?)<\/Msg>/)?.[1];
    throw new Error(`AFIP: ${err || 'Rechazado'}`);
  }
  
  const cae = resp.match(/<CAE>([\s\S]*?)<\/CAE>/)[1];
  return { cae, nroComp };
}
// --- FUNCIONES DE CACHE (Faltaban estas) ---

function _leerTACache(cuit) {
  try {
    const filePath = path.join(TA_CACHE_DIR, cuit, 'ta-wsfe.json');
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.error("Error leyendo cache:", e);
  }
  return null;
}

function _guardarTACache(cuit, ta) {
  try {
    const dir = path.join(TA_CACHE_DIR, cuit);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ta-wsfe.json'), JSON.stringify(ta, null, 2), 'utf8');
  } catch (e) {
    console.error("Error guardando cache:", e);
  }
}

function _taEsValido(ta) {
  if (!ta || !ta.expiracion) return false;
  // Consideramos válido si falta más de 10 minutos para que venza
  const vto = new Date(ta.expiracion).getTime();
  const ahora = Date.now();
  return (vto - ahora) > (10 * 60 * 1000);
}

function _parseFechaAFIP(str) {
  if (!str || str.length !== 8) return null;
  return new Date(`${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`);
}

// (Mantené tus funciones auxiliares _leerTACache, _guardarTACache, etc. igual)
// ════════════════════════════════════════════════════════════
//  MIDDLEWARE — extrae arcaCuit + respeta factAuto/envioAuto
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
  req.factAuto      = user.settings.factAuto    !== false; // default true
  req.envioAuto     = user.settings.envioAuto   !== false; // default true
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
//
//  Si el usuario tiene factAuto=true y arcaStatus='vinculado',
//  emite el CAE automáticamente al guardar la orden.
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

  // ── Auto-facturación si el usuario tiene factAuto=true ──
  if (order && order.status === 'pending_invoice') {
    _intentarAutoFacturar(integration.userId, order);
  }
}

/**
 * Intenta emitir CAE automáticamente para una orden.
 * Solo actúa si:
 *  - El usuario tiene arcaStatus = 'vinculado'
 *  - El usuario tiene factAuto = true
 */
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

    // ── Envío automático de mail si envioAuto=true ──
    if (user.settings.envioAuto && order.customerEmail) {
      _enviarMailFactura(order, resultado.cae).catch(console.warn);
    }

  } catch (e) {
    console.error(`❌ Auto-facturación orden ${order._id}:`, e.message);
    await Order.findByIdAndUpdate(order._id, {
      status:   'error_afip',
      errorLog: e.message,
    });
  }
}

/**
 * Stub de envío de mail — implementar con nodemailer o Resend.
 * Por ahora solo loguea; conectar con el proveedor de email preferido.
 */
async function _enviarMailFactura(order, cae) {
  console.log(`📧 [TODO] Enviar factura CAE ${cae} a ${order.customerEmail}`);
  // Ejemplo con Resend:
  // await resend.emails.send({
  //   from: 'facturas@koi.ar',
  //   to: order.customerEmail,
  //   subject: `Tu factura KOI — CAE ${cae}`,
  //   html: `<p>Tu comprobante está disponible. CAE: ${cae}</p>`,
  // });
}

// ════════════════════════════════════════════════════════════
//  AUTH HELPERS
// ════════════════════════════════════════════════════════════
const signToken = (userId) => jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '7d' });

const setTokenCookie = (res, token) =>
  res.cookie('koi_token', token, {
    httpOnly: true, secure: PROD_MODE, sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

const requireAuth = (req, res, next) => {
  try { req.userId = jwt.verify(req.cookies.koi_token, JWT_SECRET).id; next(); }
  catch { res.clearCookie('koi_token'); res.redirect('/login'); }
};

const requireAuthAPI = (req, res, next) => {
  const token = req.cookies.koi_token || (req.headers.authorization || '').replace('Bearer ', '');
  try { req.userId = jwt.verify(token, JWT_SECRET).id; next(); }
  catch { res.status(401).json({ error: 'No autenticado' }); }
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
        googleId: profile.id, email,
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

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=google_failed' }),
  (req, res) => { setTokenCookie(res, signToken(req.user.id)); res.redirect('/dashboard'); }
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
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos.' });
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user?.password) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
    if (!await user.checkPassword(password)) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
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
//  API — USUARIO & CONFIGURACIÓN
// ════════════════════════════════════════════════════════════

app.get('/api/me', requireAuthAPI, async (req, res) => {
  const user = await User.findById(req.userId).select('-password -settings.arcaClave').lean();
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ ok: true, user });
});

// ── Guardar configuración general (factAuto, envioAuto, categoria, etc.) ──
app.patch('/api/me/settings', requireAuthAPI, async (req, res) => {
  try {
    const { nombre, apellido, ...body } = req.body;
    const update = {};

    if (nombre)   update.nombre   = nombre;
    if (apellido) update.apellido = apellido;

    // Campos de settings permitidos — incluyendo factAuto y envioAuto
    const allowedSettings = ['factAuto', 'envioAuto', 'categoria', 'cuit'];
    for (const key of allowedSettings) {
      if (body[key] !== undefined) {
        update[`settings.${key}`] = body[key];
      }
    }

    const user = await User.findByIdAndUpdate(
      req.userId,
      { $set: update },
      { new: true, select: '-password -settings.arcaClave' }
    ).lean();

    res.json({ ok: true, user });
  } catch (e) {
    res.status(500).json({ error: 'Error al guardar configuración' });
  }
});

// ── Vincular Carpeta Fiscal (ARCA) ────────────────────────
app.patch('/api/me/arca', requireAuthAPI, async (req, res) => {
  try {
    const { cuit, arcaClave } = req.body;
    if (!cuit || !arcaClave) return res.status(400).json({ error: 'CUIT y Clave Fiscal son requeridos.' });

    const cleanCuit = String(cuit).replace(/\D/g, '');

    const user = await User.findByIdAndUpdate(
      req.userId,
      {
        $set: {
          'settings.cuit':       cleanCuit,
          'settings.arcaUser':   cleanCuit,
          'settings.arcaClave':  encrypt(arcaClave),
          'settings.arcaStatus': 'pendiente',
          'settings.arcaNotas':  'Datos recibidos. Validando vinculación con ARCA...',
        },
      },
      { new: true, select: '-password -settings.arcaClave' }
    ).lean();

    res.json({ ok: true, message: 'Carpeta fiscal enviada. El proceso puede demorar hasta 24hs.', user });
  } catch (e) {
    console.error('Error ARCA Link:', e.message);
    res.status(500).json({ error: 'No se pudo procesar la vinculación.' });
  }
});

// ════════════════════════════════════════════════════════════
//  API — AFIP/ARCA — EMISIÓN
// ════════════════════════════════════════════════════════════

app.get('/api/afip/delegacion', requireAuthAPI, requireArcaCuit, async (req, res) => {
  try {
    const resultado = await afip_verificarDelegacion(req.arcaCuit);
    res.json({ ok: resultado.ok, mensaje: resultado.mensaje, cuit: req.arcaCuit });
  } catch (e) {
    res.status(500).json({ error: 'Error verificando delegación: ' + e.message });
  }
});

app.get('/api/afip/estado', requireAuthAPI, async (req, res) => {
  try {
    await new Promise((resolve, reject) => {
      const r = https.get(WSFE_URL + '?wsdl', { timeout: 8000 }, resolve);
      r.on('error', reject);
      r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    });
    res.json({ ok: true, online: true });
  } catch {
    res.json({ ok: true, online: false });
  }
});

// ── Emitir CAE para una orden específica ─────────────────
app.post('/api/orders/:orderId/emitir', requireAuthAPI, requireArcaCuit, async (req, res) => {
  const { orderId } = req.params;
  try {
    const order = await Order.findOne({ _id: orderId, userId: req.userId });
    if (!order) return res.status(404).json({ error: 'Orden no encontrada' });

    if (order.status === 'invoiced') {
      return res.status(409).json({ error: 'Esta orden ya tiene un CAE emitido.', cae: order.caeNumber });
    }
    if (order.status === 'error_data') {
      return res.status(400).json({ error: `No se puede emitir: ${order.errorLog}` });
    }

    const resultado = await afip_emitirComprobante(
      req.arcaCuit,
      req.arcaPtoVta,
      {
        tipoComprobante: _tipoComprobante(req.arcaCategoria),
        clienteDoc:      order.customerDoc || '0',
        importeTotal:    order.amount,
      }
    );

    await Order.findByIdAndUpdate(orderId, {
      status:    'invoiced',
      caeNumber: resultado.cae,
      caeExpiry: resultado.caeFchVto,
      errorLog:  '',
    });

    console.log(`✅ CAE: CUIT=${req.arcaCuit} PV=${req.arcaPtoVta} Orden=${orderId} CAE=${resultado.cae}`);

    // Enviar mail si envioAuto=true
    if (req.envioAuto && order.customerEmail) {
      _enviarMailFactura(order, resultado.cae).catch(console.warn);
    }

    res.json({ ok: true, cae: resultado.cae, vto: resultado.caeFchVto, nroComp: resultado.nroComp });

  } catch (e) {
    console.error(`❌ Emitir CAE orden ${orderId}:`, e.message);
    await Order.findOneAndUpdate(
      { _id: orderId, userId: req.userId },
      { status: 'error_afip', errorLog: e.message }
    );
    res.status(500).json({ error: e.message });
  }
});

// ── Emitir en lote todas las órdenes pendientes ─────────
app.post('/api/afip/emitir-lote', requireAuthAPI, requireArcaCuit, async (req, res) => {
  try {
    const pendientes = await Order.find({ userId: req.userId, status: 'pending_invoice' })
      .sort({ orderDate: 1, createdAt: 1 });

    if (!pendientes.length) {
      return res.json({ ok: true, mensaje: 'No hay órdenes pendientes de facturar.' });
    }

    res.json({ ok: true, mensaje: `Iniciando emisión de ${pendientes.length} comprobantes…`, total: pendientes.length });

    const cuit      = req.arcaCuit;
    const ptoVta    = req.arcaPtoVta;
    const categoria = req.arcaCategoria;
    const envioAuto = req.envioAuto;
    let ok = 0, errores = 0;

    for (const order of pendientes) {
      try {
        const r = await afip_emitirComprobante(cuit, ptoVta, {
          tipoComprobante: _tipoComprobante(categoria),
          clienteDoc:      order.customerDoc || '0',
          importeTotal:    order.amount,
        });
        await Order.findByIdAndUpdate(order._id, {
          status: 'invoiced', caeNumber: r.cae, caeExpiry: r.caeFchVto, errorLog: '',
        });
        if (envioAuto && order.customerEmail) {
          _enviarMailFactura(order, r.cae).catch(console.warn);
        }
        ok++;
        await new Promise(r => setTimeout(r, 350));
      } catch (e) {
        errores++;
        await Order.findByIdAndUpdate(order._id, { status: 'error_afip', errorLog: e.message });
        console.error(`❌ Lote CAE orden ${order._id}:`, e.message);
      }
    }
    console.log(`📊 Lote finalizado CUIT=${cuit}: ${ok} emitidos, ${errores} errores`);
  } catch (e) {
    console.error('Emitir lote error:', e.message);
  }
});

// ════════════════════════════════════════════════════════════
//  API — ÓRDENES MANUALES
//
//  POST /api/orders/manual — crea una venta manual y,
//  si factAuto=true, emite el CAE automáticamente.
// ════════════════════════════════════════════════════════════
app.post('/api/orders/manual', requireAuthAPI, async (req, res) => {
  try {
    const { cliente, email, concepto, monto, tipo, dni } = req.body;

    if (!cliente || !monto) {
      return res.status(400).json({ error: 'Cliente y monto son obligatorios.' });
    }
    if (parseFloat(monto) <= 0) {
      return res.status(400).json({ error: 'El monto debe ser mayor a 0.' });
    }

    const user = await User.findById(req.userId).select('settings').lean();
    const externalId = `MAN-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    const order = await Order.create({
      userId:        req.userId,
      platform:      'manual',
      externalId,
      customerName:  cliente,
      customerEmail: email || '',
      customerDoc:   dni   || CUIT_CF,
      amount:        parseFloat(monto),
      currency:      'ARS',
      concepto:      concepto || '',
      status:        'pending_invoice',
      orderDate:     new Date(),
    });

    // ── Auto-facturación si corresponde ──
    if (user?.settings?.factAuto !== false && user?.settings?.arcaStatus === 'vinculado') {
      // Responder primero, facturar en background
      res.json({ ok: true, nro: externalId, id: order._id, message: 'Venta registrada. Emitiendo CAE...' });
      _intentarAutoFacturar(req.userId, order);
    } else {
      res.json({ ok: true, nro: externalId, id: order._id, message: 'Venta registrada como pendiente.' });
    }

  } catch (e) {
    console.error('Manual order error:', e.message);
    res.status(500).json({ error: 'Error al registrar la venta.' });
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
    if (!['active', 'paused'].includes(status)) return res.status(400).json({ error: 'Status inválido' });
    const doc = await Integration.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId }, { status },
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
          storeName: storeName || `${platform} ${storeId}`, storeUrl: storeUrl || '',
          status: 'active', errorLog: '', credentials: creds,
          updatedAt: new Date(), initialSyncDone: false,
        },
        $setOnInsert: { userId: req.userId, platform, storeId: String(storeId), createdAt: new Date() },
      },
      { upsert: true, new: true }
    );

    if (platform === 'tiendanube' && apiToken) {
      await _registerWebhookTiendaNube(integration, apiToken).catch(console.warn);
    }

    _dispararSyncHistorico(integration);
    res.json({ ok: true, message: `${platform} conectado. Sincronizando historial...` });
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
  const clean   = store_url.replace(/\/$/, '').toLowerCase();
  const state   = jwt.sign({ userId: req.userId, storeUrl: clean }, JWT_SECRET, { expiresIn: '15m' });
  const authUrl = `${clean}/wc-auth/v1/authorize`
    + `?app_name=KOI-Factura&scope=read_write&user_id=${req.userId}`
    + `&return_url=${encodeURIComponent(`${BASE}/dashboard?woo=connected`)}`
    + `&callback_url=${encodeURIComponent(`${BASE}/auth/woo/callback?state=${encodeURIComponent(state)}`)}`;
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
          storeName: storeUrl.replace(/^https?:\/\//, ''), storeUrl,
          status: 'active', errorLog: '',
          credentials: { consumerKey: encrypt(consumer_key), consumerSecret: encrypt(consumer_secret) },
          initialSyncDone: false, updatedAt: new Date(),
        },
        $setOnInsert: { userId, platform: 'woocommerce', storeId: storeUrl, createdAt: new Date() },
      },
      { upsert: true, new: true }
    );
    await _registerWebhookWoo(integration, consumer_key, consumer_secret, storeUrl);
    _dispararSyncHistorico(integration);
    console.log(`✅ WooCommerce conectado: ${storeUrl}`);
  } catch (e) { console.error('WooCommerce callback:', e.message); }
});

async function _registerWebhookWoo(integration, key, secret, storeUrl) {
  const webhookUrl = `${BASE}/webhook/woocommerce/${integration.webhookSecret}`;
  try {
    const { data: existing } = await axios.get(`${storeUrl}/wp-json/wc/v3/webhooks`, {
      auth: { username: key, password: secret }, params: { per_page: 100 },
    });
    if (existing?.some(wh => wh.delivery_url === webhookUrl)) return;
    await axios.post(`${storeUrl}/wp-json/wc/v3/webhooks`,
      { name: 'KOI-Factura', topic: 'order.created', delivery_url: webhookUrl, status: 'active' },
      { auth: { username: key, password: secret } }
    );
    console.log(`🔌 WooCommerce webhook: ${storeUrl}`);
  } catch (e) {
    console.warn('WooCommerce webhook:', e.response?.data?.message || e.message);
    await Integration.findByIdAndUpdate(integration._id, { errorLog: `Webhook: ${e.message}` });
  }
}

async function _registerWebhookTiendaNube(integration, apiToken) {
  const webhookUrl = `${BASE}/webhook/tiendanube/${integration.webhookSecret}`;
  await axios.post(
    `https://api.tiendanube.com/v1/${integration.storeId}/webhooks`,
    { event: 'order/paid', url: webhookUrl },
    { headers: { Authentication: `bearer ${apiToken}`, 'User-Agent': 'KOI-Factura/3.2' } }
  );
}

// ════════════════════════════════════════════════════════════
//  MERCADOLIBRE OAUTH
// ════════════════════════════════════════════════════════════

app.get('/auth/ml/connect', requireAuth, (req, res) => {
  const state = jwt.sign({ userId: req.userId }, JWT_SECRET, { expiresIn: '15m' });
  res.redirect(
    'https://auth.mercadolibre.com.ar/authorization'
    + `?response_type=code&client_id=${process.env.ML_CLIENT_ID}`
    + `&redirect_uri=${encodeURIComponent(`${BASE}/auth/ml/callback`)}`
    + `&state=${encodeURIComponent(state)}`
  );
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
      { headers: { Authorization: `Bearer ${token.access_token}` } }
    );
    const sellerId = String(token.user_id || seller.id);
    const integration = await Integration.findOneAndUpdate(
      { userId, platform: 'mercadolibre', storeId: sellerId },
      {
        $set: {
          storeName: seller.nickname || `ML ${sellerId}`, status: 'active', errorLog: '',
          credentials: {
            accessToken:  encrypt(token.access_token),
            refreshToken: encrypt(token.refresh_token),
            tokenExpiry:  new Date(Date.now() + token.expires_in * 1000).toISOString(),
            sellerId,
          },
          initialSyncDone: false, updatedAt: new Date(),
        },
        $setOnInsert: { userId, platform: 'mercadolibre', storeId: sellerId, createdAt: new Date() },
      },
      { upsert: true, new: true }
    );
    _dispararSyncHistorico(integration);
    res.redirect('/dashboard?ml=connected');
  } catch (e) {
    console.error('ML callback:', e.response?.data || e.message);
    res.redirect('/dashboard?error=ml_failed');
  }
});

async function _getMLToken(integration) {
  const expiry = new Date(integration.credentials.tokenExpiry || 0);
  if (expiry > new Date(Date.now() + 10 * 60 * 1000)) return decrypt(integration.credentials.accessToken);
  const { data } = await axios.post('https://api.mercadolibre.com/oauth/token', {
    grant_type: 'refresh_token', client_id: process.env.ML_CLIENT_ID,
    client_secret: process.env.ML_CLIENT_SECRET, refresh_token: decrypt(integration.credentials.refreshToken),
  });
  await Integration.findByIdAndUpdate(integration._id, {
    'credentials.accessToken':  encrypt(data.access_token),
    'credentials.refreshToken': encrypt(data.refresh_token),
    'credentials.tokenExpiry':  new Date(Date.now() + data.expires_in * 1000).toISOString(),
  });
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
      const { data: orders } = await axios.get(`${integration.storeUrl}/wp-json/wc/v3/orders`, {
        auth: { username: key, password: secret },
        params: { per_page: 100, page, orderby: 'date', order: 'desc' },
      });
      if (!orders?.length) break;
      await Promise.all(orders.map(r => upsertOrder(integration, normalize.woocommerce(r))));
      total += orders.length;
      if (orders.length < 100) break;
      page++;
    }
    return total;
  },
  async tiendanube(integration) {
    const token = integration.getKey('apiToken');
    let page = 1, total = 0;
    while (true) {
      const { data: orders } = await axios.get(
        `https://api.tiendanube.com/v1/${integration.storeId}/orders`,
        { headers: { Authentication: `bearer ${token}`, 'User-Agent': 'KOI-Factura/3.2' }, params: { per_page: 200, page } }
      );
      if (!orders?.length) break;
      await Promise.all(orders.map(r => upsertOrder(integration, normalize.tiendanube(r))));
      total += orders.length;
      if (orders.length < 200) break;
      page++;
    }
    return total;
  },
  async mercadolibre(integration) {
    const accessToken = await _getMLToken(integration);
    const sellerId    = integration.credentials.sellerId;
    let offset = 0, total = 0;
    while (true) {
      const { data } = await axios.get('https://api.mercadolibre.com/orders/search', {
        headers: { Authorization: `Bearer ${accessToken}` },
        params:  { seller: sellerId, limit: 50, offset, sort: 'date_desc' },
      });
      const orders = data.results || [];
      if (!orders.length) break;
      await Promise.all(orders.map(r => upsertOrder(integration, normalize.mercadolibre(r))));
      total  += orders.length;
      offset += 50;
      if (offset >= (data.paging?.total || 0)) break;
    }
    return total;
  },
  async vtex(integration) {
    const apiKey = integration.getKey('apiKey'), apiToken = integration.getKey('apiToken');
    let page = 1, total = 0;
    while (true) {
      const { data } = await axios.get(`${integration.storeUrl}/api/oms/pvt/orders`, {
        headers: { 'X-VTEX-API-AppKey': apiKey, 'X-VTEX-API-AppToken': apiToken },
        params:  { page, per_page: 100 },
      });
      const orders = data.list || [];
      if (!orders.length) break;
      await Promise.all(orders.map(r => upsertOrder(integration, normalize.vtex(r))));
      total += orders.length;
      if (orders.length < 100) break;
      page++;
    }
    return total;
  },
};

async function _dispararSyncHistorico(integration) {
  const syncFn = BULK_SYNC[integration.platform];
  if (!syncFn) return;
  console.log(`🔄 Sync histórico: ${integration.platform} / ${integration.storeId}`);
  try {
    const count = await syncFn(integration);
    await Integration.findByIdAndUpdate(integration._id, { lastSyncAt: new Date(), errorLog: '', initialSyncDone: true });
    console.log(`✅ Sync ${integration.platform}: ${count} órdenes`);
  } catch (err) {
    console.error(`❌ Sync ${integration.platform}:`, err.message);
    await Integration.findByIdAndUpdate(integration._id, { errorLog: `Sync: ${err.message}`, status: 'error' });
  }
}

app.post('/api/integrations/:id/sync', requireAuthAPI, async (req, res) => {
  try {
    const integration = await Integration.findOne({ _id: req.params.id, userId: req.userId });
    if (!integration) return res.status(404).json({ error: 'No encontrada' });
    if (integration.status !== 'active') return res.status(400).json({ error: 'Integración inactiva' });
    const syncFn = BULK_SYNC[integration.platform];
    if (!syncFn) return res.status(400).json({ error: `Sync no disponible para ${integration.platform}` });
    res.json({ ok: true, message: 'Sincronización iniciada' });
    syncFn(integration)
      .then(count => Integration.findByIdAndUpdate(integration._id, { lastSyncAt: new Date(), errorLog: '' }))
      .catch(async err => Integration.findByIdAndUpdate(integration._id, { errorLog: err.message, status: 'error' }));
  } catch (e) { res.status(500).json({ error: 'Error interno' }); }
});

// ════════════════════════════════════════════════════════════
//  WEBHOOKS UNIVERSALES
// ════════════════════════════════════════════════════════════

async function handleWebhook(platform, secret, getCanonical) {
  const integration = await Integration.findOne({ platform, webhookSecret: secret, status: 'active' });
  if (!integration) return;
  try {
    const canonical = await getCanonical(integration);
    if (canonical) await upsertOrder(integration, canonical);
  } catch (e) { console.error(`❌ Webhook ${platform}:`, e.message); }
}

app.post('/webhook/woocommerce/:secret',  async (req, res) => { res.status(200).send('OK'); await handleWebhook('woocommerce',  req.params.secret, () => normalize.woocommerce(req.body)); });
app.post('/webhook/tiendanube/:secret',   async (req, res) => {
  res.status(200).send('OK');
  await handleWebhook('tiendanube', req.params.secret, async (integration) => {
    const { data } = await axios.get(
      `https://api.tiendanube.com/v1/${integration.storeId}/orders/${req.body.id}`,
      { headers: { Authentication: `bearer ${integration.getKey('apiToken')}`, 'User-Agent': 'KOI-Factura/3.2' } }
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
app.post('/webhook/vtex/:secret',        async (req, res) => { res.status(200).send('OK'); await handleWebhook('vtex',        req.params.secret, () => normalize.vtex(req.body)); });
app.post('/webhook/empretienda/:secret', async (req, res) => { res.status(200).send('OK'); await handleWebhook('empretienda', req.params.secret, () => normalize.empretienda(req.body)); });
app.post('/webhook/rappi/:secret',       async (req, res) => { res.status(200).send('OK'); await handleWebhook('rappi',       req.params.secret, () => normalize.rappi(req.body)); });
app.post('/webhook/shopify/:secret',     async (req, res) => { res.status(200).send('OK'); await handleWebhook('shopify',     req.params.secret, () => normalize.shopify(req.body)); });

// ════════════════════════════════════════════════════════════
//  API — STATS CON FILTRO DE PERÍODO
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
      status: { $in: ['pending_invoice', 'invoiced'] },
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
      Order.find({ ...match }).sort({ orderDate: -1, createdAt: -1 }).limit(100)
        .select('platform externalId customerName amount currency status createdAt orderDate').lean(),
      Order.aggregate([{ $match: matchHoy }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
      Order.countDocuments({ ...match, status: 'pending_invoice' }),
      Order.aggregate([{ $match: { ...match, status: { $in: ['pending_invoice','invoiced'] } } }, { $group: { _id: '$platform', total: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { total: -1 } }]),
    ]);

    res.json({
      ok:             true,
      totalMonto:     totals[0]?.total    || 0,
      totalOrden:     totals[0]?.count    || 0,
      facturadoMonto: facturado[0]?.total || 0,
      facturadoCount: facturado[0]?.count || 0,
      hoyMonto:       hoyAgg[0]?.total   || 0,
      hoyCount:       hoyAgg[0]?.count   || 0,
      pendientes:     pendientesCount     || 0,
      plataformas,
      ultimas:        recent,
    });
  } catch (e) {
    console.error('Stats:', e.message);
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
      .limit(Math.min(parseInt(limit), 500)).lean();
    res.json({ ok: true, orders });
  } catch (e) { res.status(500).json({ error: 'Error interno' }); }
});

// ════════════════════════════════════════════════════════════
//  PÁGINAS HTML
// ════════════════════════════════════════════════════════════

const isLoggedIn = (req) => {
  try { jwt.verify(req.cookies.koi_token, JWT_SECRET); return true; } catch { return false; }
};
app.get('/',          (req, res) => res.redirect(isLoggedIn(req) ? '/dashboard' : '/login'));
app.get('/login',     (req, res) => isLoggedIn(req) ? res.redirect('/dashboard') : res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/dashboard', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ════════════════════════════════════════════════════════════
//  KEEP-ALIVE
// ════════════════════════════════════════════════════════════
app.get('/health', (_, res) => res.json({ status: 'ok', ts: Date.now() }));

const selfPing = () => {
  if (!process.env.BASE_URL) return;
  axios.get(`${BASE}/health`, { timeout: 10_000 })
    .then(() => console.log(`🏓 Ping OK [${new Date().toISOString()}]`))
    .catch(err => console.warn(`⚠️  Ping: ${err.message}`));
};

app.listen(PORT, () => {
  console.log(`🚀 KOI-Factura v3.2 — puerto ${PORT}`);
  console.log(`📡 Base URL: ${BASE}`);
  console.log(`🔐 CUIT Maestro AFIP: ${CUIT_MAESTRO}`);
  console.log(`🌐 AFIP modo: ${PROD_MODE ? 'PRODUCCIÓN' : 'HOMOLOGACIÓN'}`);
  setTimeout(() => { selfPing(); setInterval(selfPing, 10 * 60 * 1000); }, 30_000);
});

// ════════════════════════════════════════════════════════════
//  ADMIN PANEL — CONSERJERÍA MANUAL (SOLO VOS)
// ════════════════════════════════════════════════════════════

const ADMIN_EMAIL = 'koi.automatic@gmail.com';

async function requireAdmin(req, res, next) {
  const admin = await User.findById(req.userId).select('email').lean();
  if (!admin || admin.email.trim() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: 'No tenés permisos de administrador.' });
  }
  next();
}

app.get('/api/admin/pendientes', requireAuthAPI, requireAdmin, async (req, res) => {
  try {
    const pendientes = await User.find({
      'settings.arcaStatus': { $in: ['pendiente', 'en_proceso', 'vinculado'] },
    }).select('nombre apellido email settings').lean();

    const lista = pendientes.map(u => {
      const s = u.settings || {};
      return {
        id:          u._id,
        cliente:     `${u.nombre || ''} ${u.apellido || ''}`.trim(),
        email:       u.email,
        cuit:        s.cuit        || 'N/A',
        claveFiscal: s.arcaClave   ? decrypt(s.arcaClave) : 'Sin clave',
        status:      s.arcaStatus  || 'pendiente',
        puntoVenta:  s.arcaPtoVta  || 1,
        notas:       s.arcaNotas   || '',
      };
    });

    res.json({ ok: true, total: lista.length, lista });
  } catch (e) {
    res.status(500).json({ error: 'Error en el panel de admin' });
  }
});

app.post('/api/admin/update-status', requireAuthAPI, requireAdmin, async (req, res) => {
  try {
    const { userId, nuevoStatus, notas, puntoVenta } = req.body;

    await User.findByIdAndUpdate(userId, {
      $set: {
        'settings.arcaStatus': nuevoStatus,
        'settings.arcaNotas':  notas,
        'settings.arcaPtoVta': Number(puntoVenta) || 1,
      },
    });

    // Si se vinculó → limpiar TA cacheado para forzar renovación
    if (nuevoStatus === 'vinculado') {
      const user = await User.findById(userId).select('settings.cuit').lean();
      const cuit = user?.settings?.cuit?.replace(/\D/g, '');
      if (cuit) {
        try { fs.unlinkSync(path.join(TA_CACHE_DIR, cuit, 'ta-wsfe.json')); } catch {}
        console.log(`🔄 TA cache limpiado para CUIT ${cuit}`);
      }
    }

    res.json({ ok: true, message: `Estado: "${nuevoStatus}". Punto de Venta: ${puntoVenta || 1}` });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo actualizar el estado.' });
  }
});

app.get('/api/admin/delegaciones', requireAuthAPI, requireAdmin, async (req, res) => {
  try {
    if (!fs.existsSync(TA_CACHE_DIR)) return res.json({ ok: true, delegaciones: [], maestro: CUIT_MAESTRO });

    const carpetas = fs.readdirSync(TA_CACHE_DIR).filter(d => /^\d+$/.test(d));
    const delegaciones = carpetas.map(cuit => {
      let estado = 'sin_ta', expiracion = null, valido = false;
      try {
        const ta   = JSON.parse(fs.readFileSync(path.join(TA_CACHE_DIR, cuit, 'ta-wsfe.json'), 'utf8'));
        expiracion = ta.expiracion;
        valido     = expiracion ? new Date(expiracion).getTime() > Date.now() : false;
        estado     = valido ? 'activo' : 'expirado';
      } catch {}
      return { cuit, estado, expiracion, valido };
    });

    res.json({ ok: true, delegaciones, maestro: CUIT_MAESTRO, modo: PROD_MODE ? 'produccion' : 'homologacion' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
