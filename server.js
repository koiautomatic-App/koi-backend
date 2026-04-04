// ============================================================
//  KOI-FACTURA · SaaS Multi-Tenant Engine v4.1
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
const fsp            = require('fs').promises; // <-- AGREGÁ ESTA LÍNEA
const { execSync }   = require('child_process');
const os             = require('os');
const https          = require('https');

// --- NUEVAS DEPENDENCIAS v4.1 ---
const xmlbuilder     = require('xmlbuilder');
const { DOMParser }  = require('@xmldom/xmldom');

const app  = express();
const PORT = process.env.PORT || 10000;
const BASE = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const JWT_SECRET = process.env.JWT_SECRET || 'koi-jwt-dev-change-in-production';

// ════════════════════════════════════════════════════════════
//  AFIP — CONFIGURACIÓN GLOBAL
// ════════════════════════════════════════════════════════════
const CUIT_MAESTRO = (process.env.AFIP_CUIT || process.env.CUIT_MAESTRO || '20309782489').replace(/\D/g, '');
const PROD_MODE    = process.env.NODE_ENV === 'production';

// Rutas de certs — primero env vars, luego Secret Files de Render como default
const AFIP_CERT_PATH = process.env.AFIP_CERT_PATH || '/etc/secrets/koi.crt';
const AFIP_KEY_PATH  = process.env.AFIP_KEY_PATH  || '/etc/secrets/koi.key';

// Directorio para cache de Tickets de Acceso por usuario
const TA_CACHE_DIR = process.env.TA_CACHE_DIR || path.join(os.tmpdir(), 'koi-ta');
if (!fs.existsSync(TA_CACHE_DIR)) {
    fs.mkdirSync(TA_CACHE_DIR, { recursive: true });
}

// URLs unificadas en un objeto para mejor gestión
const AFIP_URLS = {
    wsaa: PROD_MODE 
        ? 'https://wsaa.afip.gov.ar/ws/services/LoginCms' 
        : 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
    wsfe: PROD_MODE 
        ? 'https://servicios1.afip.gov.ar/wsfev1/service.asmx' 
        : 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx'
};

// Verificación temprana de certs al arrancar
function _verificarCertsMaestro() {
    const certOk = fs.existsSync(AFIP_CERT_PATH);
    const keyOk  = fs.existsSync(AFIP_KEY_PATH);
    if (certOk && keyOk) {
        console.log(`🔐 Certs AFIP listos: ${AFIP_CERT_PATH} / ${AFIP_KEY_PATH}`);
        console.log(`🔐 CUIT Maestro: ${CUIT_MAESTRO}`);
        console.log(`🌐 Modo: ${PROD_MODE ? 'PRODUCCIÓN' : 'HOMOLOGACIÓN'}`);
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

// Soporte para JSON y formularios (Límite de 1mb es correcto para facturación)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Configuración de CORS Robusta
const allowedOrigins = [BASE, 'http://localhost:3000', 'http://localhost:10000']; 
app.use(cors({
  origin: function (origin, callback) {
    // Permitir peticiones sin origen (como apps móviles o curl) o las de la lista
    if (!origin || allowedOrigins.indexOf(origin) !== -1 || origin.includes('render.com')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(cookieParser());

// Servir archivos estáticos (asegúrate de tener la carpeta 'public' creada)
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de Sesión para Passport/Google Auth
app.use(session({
  secret: process.env.SESSION_SECRET || 'koi-session-dev-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: PROD_MODE, // true en producción (HTTPS)
    sameSite: PROD_MODE ? 'none' : 'lax', // Necesario para cross-domain en Render
    httpOnly: true, 
    maxAge: 7 * 24 * 60 * 60 * 1000 // 1 semana
  },
}));

app.use(passport.initialize());
app.use(passport.session());
// ════════════════════════════════════════════════════════════
//  MONGODB (CONEXIÓN & MONITOREO)
// ════════════════════════════════════════════════════════════
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize: 10, 
      serverSelectionTimeoutMS: 5000,
    });
    console.log('🐟 KOI: MongoDB conectado');
  } catch (err) {
    console.error('❌ MongoDB error inicial:', err.message);
    // Reintento automático cada 5 segundos
    setTimeout(connectDB, 5000);
  }
};

// Monitoreo de eventos una vez conectado
mongoose.connection.on('error', err => {
  console.error('🔴 MongoDB error en ejecución:', err);
});

mongoose.connection.on('disconnected', () => {
  console.warn('🟡 MongoDB desconectado. Intentando reconectar...');
});

connectDB();
// ════════════════════════════════════════════════════════════
//  ENCRYPTION — AES-256-GCM (ROBUSTO)
// ════════════════════════════════════════════════════════════

// Aseguramos que la llave tenga 32 bytes exactos para aes-256
const rawKey = process.env.ENCRYPTION_KEY || 'koi0000000000000000000000000000k';
const ENC_KEY = Buffer.alloc(32, rawKey).slice(0, 32);

const encrypt = (text) => {
  if (!text) return null;
  try {
    const iv     = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
    const enc    = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
    const tag    = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
  } catch (e) {
    console.error('❌ Error en encriptación:', e.message);
    return null;
  }
};

const decrypt = (payload) => {
  if (!payload || typeof payload !== 'string' || !payload.includes(':')) return null;
  try {
    const parts = payload.split(':');
    if (parts.length !== 3) return null;

    const [ivHex, tagHex, encHex] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    
    return Buffer.concat([
      decipher.update(Buffer.from(encHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  } catch (e) { 
    // No logueamos el error aquí para no llenar la consola si hay datos viejos sin encriptar
    return null; 
  }
};

// ════════════════════════════════════════════════════════════
//  SCHEMAS (REVISADOS & OPTIMIZADOS v4.1)
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
    cuit:       { type: String, trim: true, set: v => v ? v.replace(/\D/g, '') : v }, // Limpia guiones auto
    arcaUser:   { type: String },
    arcaClave:  { type: String }, // Encriptada vía middleware o manual
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

// Middleware de Password
UserSchema.pre('save', async function(next) {
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

UserSchema.methods.checkPassword = function(plain) {
  return bcrypt.compare(plain, this.password);
};

const User = mongoose.model('User', UserSchema);

// --- INTEGRACIONES ---
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

// Métodos de encriptación integrados
IntegrationSchema.methods.setKey = function(field, value) {
  if (!this.credentials) this.credentials = {};
  this.credentials[field] = encrypt(value);
  this.markModified('credentials');
};

IntegrationSchema.methods.getKey = function(field) {
  return decrypt(this.credentials?.[field]);
};

const Integration = mongoose.model('Integration', IntegrationSchema);

// --- ÓRDENES ---
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
  // Datos AFIP
  nroComp:    { type: Number }, // Nuevo: Para guardar el nro de factura real
  caeNumber:  { type: String },
  caeExpiry:  { type: Date },
  errorLog:   { type: String },
  createdAt:  { type: Date, default: Date.now },
}, { timestamps: false });

OrderSchema.index({ userId: 1, platform: 1, externalId: 1 }, { unique: true });
OrderSchema.index({ userId: 1, orderDate: -1 });

const Order = mongoose.model('Order', OrderSchema);

// ════════════════════════════════════════════════════════════
//  AFIP — FUNCIONES AUXILIARES GLOBALES (v4.1)
// ════════════════════════════════════════════════════════════

// (Nota: AFIP_URLS ya fue definido arriba con soporte PROD_MODE)

/**
 * _docTipo: Clasifica el documento para AFIP
 */
function _docTipo(doc) {
  const d = String(doc || '0').replace(/\D/g, '');
  if (d.length === 11) return 80; // CUIT
  if (d === '0' || d.startsWith('9999') || d === '') return 99; // Consumidor Final / Sin identificar
  return 96; // DNI
}

/**
 * _tipoComprobante: Define el tipo de factura (11 = Factura C)
 */
function _tipoComprobante(categoria) {
  // Lógica preparada para expandirse a A o B en el futuro
  return 11; 
}

/**
 * _fechaAFIP: Formatea fecha a AAAAMMDD
 */
function _fechaAFIP(d) {
  const date = d instanceof Date ? d : new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('');
}

/**
 * _parseFechaAFIP: Convierte AAAAMMDD a objeto Date de JS
 */
function _parseFechaAFIP(str) {
  if (!str || str.length !== 8) return null;
  // Usamos el formato ISO para evitar confusiones de zona horaria
  return new Date(`${str.slice(0,4)}-${str.slice(4,6)}-${str.slice(6,8)}T12:00:00Z`);
}

// ════════════════════════════════════════════════════════════
//  AFIP — MÓDULO DE EMISIÓN v4.1 (COMPLETO & UNIFICADO)
// ════════════════════════════════════════════════════════════

/**
 * Emite un comprobante electrónico en AFIP utilizando delegación.
 */
async function afip_emitirComprobante(cuitEmisor, puntoVenta, datos) {
  // 1. Obtener credenciales (Token y Sign) vía WSAA
  const { token, sign } = await afip_obtenerTA(cuitEmisor);
  
  // 2. Determinar tipo de comprobante (C=11, B=6, A=1)
  const cbTipo = datos.tipoComprobante || _tipoComprobante(datos.categoria);
  
  // 3. Sincronizar número de factura con AFIP
  const ultimoNro = await _afipUltimoNro(cuitEmisor, puntoVenta, cbTipo, token, sign);
  const nroComp = ultimoNro + 1;
  
  // 4. Preparar datos comerciales
  const importe = datos.importeTotal.toFixed(2);
  const docTipo = _docTipo(datos.clienteDoc);
  const docNro  = String(datos.clienteDoc || '0').replace(/\D/g, '') || '0';

  // 5. Construir el XML SOAP
  const soap = xmlbuilder.create('soapenv:Envelope')
    .att('xmlns:soapenv', 'http://schemas.xmlsoap.org/soap/envelope/')
    .att('xmlns:ar', 'http://ar.gov.afip.dif.FEV1/')
    .ele('soapenv:Header').up()
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
              .ele('ar:Concepto').txt(1).up() // 1 = Productos
              .ele('ar:DocTipo').txt(docTipo).up()
              .ele('ar:DocNro').txt(docNro).up()
              .ele('ar:CbteDesde').txt(nroComp).up()
              .ele('ar:CbteHasta').txt(nroComp).up()
              .ele('ar:CbteFch').txt(_fechaAFIP()).up()
              .ele('ar:ImpTotal').txt(importe).up()
              .ele('ar:ImpTotConc').txt("0.00").up()
              .ele('ar:ImpNeto').txt(importe).up()
              .ele('ar:ImpOpEx').txt("0.00").up()
              .ele('ar:ImpIVA').txt("0.00").up()
              .ele('ar:ImpTrib').txt("0.00").up()
              .ele('ar:MonId').txt('PES').up()
              .ele('ar:MonCotiz').txt(1).up()
            .up()
          .up()
        .up()
      .up().up().end();

  // 6. Enviar a AFIP y procesar respuesta
  const xmlDoc = await _soapPost(AFIP_URLS.wsfe, soap);
  const resultado = xmlDoc.getElementsByTagName('Resultado')[0]?.textContent;

  if (resultado !== 'A') {
    const errNodes = xmlDoc.getElementsByTagName('Err');
    const obsNodes = xmlDoc.getElementsByTagName('Obs');
    let fallos = [];

    for (let i = 0; i < errNodes.length; i++) {
      fallos.push(`[Error ${errNodes[i].getElementsByTagName('Code')[0]?.textContent}] ${errNodes[i].getElementsByTagName('Msg')[0]?.textContent}`);
    }
    for (let i = 0; i < obsNodes.length; i++) {
      fallos.push(`[Obs ${obsNodes[i].getElementsByTagName('Code')[0]?.textContent}] ${obsNodes[i].getElementsByTagName('Msg')[0]?.textContent}`);
    }
    throw new Error(`AFIP rechazó la factura: ${fallos.join(' | ') || 'Causa desconocida'}`);
  }

  const detResp = xmlDoc.getElementsByTagName('FECAEDetResponse')[0];
  return { 
    cae: detResp.getElementsByTagName('CAE')[0]?.textContent, 
    caeFchVto: _parseFechaAFIP(detResp.getElementsByTagName('CAEFchVto')[0]?.textContent), 
    nroComp 
  };
}

/**
 * Obtiene el Ticket de Acceso (Token y Sign) con caché en /tmp.
 */
async function afip_obtenerTA(cuitEmisor) {
  const TA_PATH = path.join('/tmp', `ta-${
    cuitEmisor}.xml`);

  // Intentar leer caché para no saturar WSAA
  try {
    const cachedXML = await fsp.readFile(TA_PATH, 'utf-8');
    const xml = new DOMParser().parseFromString(cachedXML, 'text/xml');
    const expTime = xml.getElementsByTagName('expirationTime')[0]?.textContent;
    if (expTime && new Date(expTime) > new Date(Date.now() + 600000)) {
      return {
        token: xml.getElementsByTagName('token')[0].textContent,
        sign: xml.getElementsByTagName('sign')[0].textContent
      };
    }
  } catch (e) {}

  const ahora = new Date();
  const expira = new Date(ahora.getTime() + 12 * 60 * 60 * 1000);
  const tra = xmlbuilder.create('loginTicketRequest').att('version', '1.0')
    .ele('header')
      .ele('uniqueId').txt(Math.floor(ahora.getTime() / 1000)).up()
      .ele('generationTime').txt(ahora.toISOString()).up()
      .ele('expirationTime').txt(expira.toISOString()).up()
    .up()
    .ele('service').txt('wsfe').up()
    .end();

  const traPath = path.join('/tmp', `tra-${cuitEmisor}.xml`);
  const cmsPath = path.join('/tmp', `tra-${cuitEmisor}.cms`);
  
  // Rutas a Secret Files de Render
  const keyPath = process.env.AFIP_KEY_PATH || path.resolve(__dirname, './certs/private.key');
  const crtPath = process.env.AFIP_CERT_PATH || path.resolve(__dirname, './certs/maestro.crt');

  await fs.writeFile(traPath, tra);

  try {
    // Firmar con OpenSSL
    execSync(`openssl cms -sign -in ${traPath} -out ${cmsPath} -signer ${crtPath} -inkey ${keyPath} -nodetach -outform DER`);
    const cmsBase64 = (await fsp.readFile(cmsPath)).toString('base64');
    const soapWsaa = xmlbuilder.create('soapenv:Envelope')
      .att('xmlns:soapenv', 'http://schemas.xmlsoap.org/soap/envelope/')
      .att('xmlns:wsaa', 'http://wsaa.view.sua.diah.afip.gov.ar/ws/services/LoginCms')
      .ele('soapenv:Body').ele('wsaa:loginCms').ele('wsaa:in0').txt(cmsBase64).up().up().up().end();

    const resp = await axios.post(AFIP_URLS.wsaa, soapWsaa, { headers: { 'Content-Type': 'text/xml' } });
    const wsaaDoc = new DOMParser().parseFromString(resp.data, 'text/xml');
    const loginReturn = wsaaDoc.getElementsByTagName('loginCmsReturn')[0]?.textContent;
    
    await fsp.writeFile(TA_PATH, loginReturn);
    const finalXml = new DOMParser().parseFromString(loginReturn, 'text/xml');
    
    return {
      token: finalXml.getElementsByTagName('token')[0].textContent,
      sign: finalXml.getElementsByTagName('sign')[0].textContent
    };
  } finally {
    await fsp.unlink(traPath).catch(() => {});
    await fsp.unlink(cmsPath).catch(() => {});
  }
}

// ════════════════════════════════════════════════════════════
//  CONFIGURACIÓN DE RUTAS DE CERTIFICADOS (RENDER FRIENDLY)
// ════════════════════════════════════════════════════════════

// 1. Prioridad: Secret Files de Render (Definidos en tus Env Vars)
// 2. Backup: Carpeta local (Para cuando testeás en tu PC)
const keyPath = process.env.AFIP_KEY_PATH || path.resolve(__dirname, './certs/private.key');
const crtPath = process.env.AFIP_CERT_PATH || path.resolve(__dirname, './certs/maestro.crt');

// Tip de Debugging: Agregá esto antes de firmar para estar 100% seguro
if (!require('fs').existsSync(keyPath)) {
  console.error(`❌ ERROR CRÍTICO: No se encontró la llave privada en ${keyPath}`);
}

  await fs.writeFile(traPath, tra);

  try {
    execSync(`openssl cms -sign -in ${traPath} -out ${cmsPath} -signer ${crtPath} -inkey ${keyPath} -nodetach -outform DER`);
    const cmsBase64 = (await fs.readFile(cmsPath)).toString('base64');

    const soapWsaa = xmlbuilder.create('soapenv:Envelope')
      .att('xmlns:soapenv', 'http://schemas.xmlsoap.org/soap/envelope/')
      .att('xmlns:wsaa', 'http://wsaa.view.sua.diah.afip.gov.ar/ws/services/LoginCms')
      .ele('soapenv:Body').ele('wsaa:loginCms').ele('wsaa:in0').txt(cmsBase64).up().up().up().end();

    const resp = await axios.post(AFIP_URLS.wsaa, soapWsaa, { headers: { 'Content-Type': 'text/xml' } });
    const wsaaDoc = new DOMParser().parseFromString(resp.data, 'text/xml');
    const loginReturn = wsaaDoc.getElementsByTagName('loginCmsReturn')[0]?.textContent;
    
    await fs.writeFile(TA_PATH, loginReturn);
    const finalXml = new DOMParser().parseFromString(loginReturn, 'text/xml');
    
    return {
      token: finalXml.getElementsByTagName('token')[0].textContent,
      sign: finalXml.getElementsByTagName('sign')[0].textContent
    };
  } finally {
    await fs.unlink(traPath).catch(() => {});
    await fs.unlink(cmsPath).catch(() => {});
  }
}


// ════════════════════════════════════════════════════════════
//  FUNCIONES DE APOYO (REQUERIDAS POR EL MÓDULO)
// ════════════════════════════════════════════════════════════

/**
 * Consulta en AFIP cuál fue el último número de comprobante autorizado
 * para un punto de venta y tipo específicos.
 */
async function _afipUltimoNro(cuit, ptoVta, tipo, token, sign) {
  const soap = xmlbuilder.create('soapenv:Envelope')
    .att('xmlns:soapenv', 'http://schemas.xmlsoap.org/soap/envelope/')
    .att('xmlns:ar', 'http://ar.gov.afip.dif.FEV1/')
    .ele('soapenv:Header').up()
    .ele('soapenv:Body')
      .ele('ar:FECompUltimoAutorizado') // Nombre exacto del método WSFE
        .ele('ar:Auth')
          .ele('ar:Token').txt(token).up()
          .ele('ar:Sign').txt(sign).up()
          .ele('ar:Cuit').txt(cuit).up()
        .up()
        .ele('ar:PtoVta').txt(ptoVta).up()
        .ele('ar:CbteTipo').txt(tipo).up()
      .up()
    .up().end();

  try {
    const xmlDoc = await _soapPost(AFIP_URLS.wsfe, soap);
    const nro = xmlDoc.getElementsByTagName('CbteNro')[0]?.textContent;
    
    if (nro === undefined) {
      // Si no hay número, verificamos si AFIP devolvió un error de Auth
      const errorMsg = xmlDoc.getElementsByTagName('Msg')[0]?.textContent;
      throw new Error(errorMsg || "No se pudo recuperar el último número de AFIP.");
    }

    return parseInt(nro || '0');
  } catch (e) {
    throw new Error(`Error sincronizando correlativo: ${e.message}`);
  }
}

/**
 * Realiza el POST HTTP al Web Service de AFIP y parsea el XML de respuesta.
 */
async function _soapPost(url, xml) {
  try {
    const resp = await axios.post(url, xml, {
      headers: { 
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': url.includes('wsfe') ? 'http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado' : ''
      },
      timeout: 12000 // Aumentamos a 12s por la latencia típica de AFIP
    });
    
    return new DOMParser().parseFromString(resp.data, 'text/xml');
  } catch (error) {
    const msg = error.response 
      ? `AFIP respondió con error HTTP ${error.response.status}` 
      : `No se pudo conectar con los servidores de AFIP (Timeout/Red)`;
    
    throw new Error(msg);
  }
}

// --- HELPERS MENORES ---

function _tipoComprobante(cat) {
  // 11: Factura C (Monotributo), 6: Factura B, 1: Factura A
  const c = String(cat).toUpperCase();
  if (c === 'A') return 1;
  if (c === 'B') return 6;
  return 11; 
}

function _docTipo(doc) {
  // 80: CUIT, 96: DNI, 99: Sin identificar (Consumidor Final)
  const d = String(doc || '').replace(/\D/g, '');
  if (d.length === 11) return 80;
  if (d.length >= 7 && d.length <= 8) return 96;
  return 99;
}

function _fechaAFIP() {
  // Formato AAAAMMDD requerido por AFIP
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function _parseFechaAFIP(f) {
  if (!f || f.length !== 8) return null;
  return new Date(`${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}`);
}

// ════════════════════════════════════════════════════════════
//  MIDDLEWARE — VALIDACIÓN DE CUIT Y ESTADO ARCA (v4.1)
// ════════════════════════════════════════════════════════════

async function requireArcaCuit(req, res, next) {
  try {
    // Buscamos el ID en req.userId (JWT) o req.user._id (Passport)
    const userId = req.userId || req.user?._id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Sesión no válida o expirada.' });
    }

    const user = await User.findById(userId).select('settings').lean();

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    // 1. Verificación de CUIT existente
    const cuitLimpio = user.settings?.cuit ? user.settings.cuit.replace(/\D/g, '') : null;
    if (!cuitLimpio || cuitLimpio.length !== 11) {
      return res.status(400).json({
        error: 'CUIT no configurado o inválido. Completalo en la sección ARCA.',
      });
    }

    // 2. Verificación de Vinculación (Seguridad SaaS)
    if (user.settings.arcaStatus !== 'vinculado') {
      const statusActual = user.settings.arcaStatus || 'sin_vincular';
      return res.status(403).json({
        error: `Estado: ${statusActual}. La facturación requiere vinculación confirmada.`,
      });
    }

    // 3. Inyección de datos en el objeto Request para los controladores
    req.arcaCuit      = cuitLimpio;
    req.arcaPtoVta    = parseInt(user.settings.arcaPtoVta) || 1;
    req.arcaCategoria = user.settings.categoria || 'C';
    req.factAuto      = user.settings.factAuto !== false;  // default true
    req.envioAuto     = user.settings.envioAuto !== false; // default true

    next();
  } catch (error) {
    console.error('❌ Error en Middleware requireArcaCuit:', error.message);
    res.status(500).json({ error: 'Error interno al validar credenciales de facturación.' });
  }
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
//  UPSERT ENGINE + AUTO-FACTURACIÓN (v4.1)
// ════════════════════════════════════════════════════════════

// Límite AFIP para Consumidor Final sin identificar (Actualizar según ARCA)
const ARCA_LIMIT_SIN_DNI = 191624; 

async function upsertOrder(integration, canonical) {
  if (!canonical) return;

  const orderFilter = {
    userId:     integration.userId,
    platform:   integration.platform,
    externalId: canonical.externalId,
  };

  // 1. Validación de Monto vs DNI (Consumidor Final)
  const requiereDNI = canonical.amount >= ARCA_LIMIT_SIN_DNI;
  const tieneDNI = canonical.customerDoc && canonical.customerDoc !== '0';

  if (requiereDNI && !tieneDNI) {
    await Order.findOneAndUpdate(
      orderFilter,
      {
        $setOnInsert: {
          userId: integration.userId, 
          integrationId: integration._id,
          platform: integration.platform, 
          ...canonical,
          customerDoc: '0', 
          status: 'error_data',
          errorLog: `Monto $${canonical.amount.toLocaleString()} supera límite sin DNI`,
        },
      },
      { upsert: true }
    ).catch(() => {});
    return;
  }

  // 2. Upsert de la Orden
  const order = await Order.findOneAndUpdate(
    orderFilter,
    {
      $setOnInsert: {
        userId: integration.userId, 
        integrationId: integration._id,
        platform: integration.platform, 
        ...canonical, 
        status: 'pending_invoice',
      },
    },
    { upsert: true, new: true }
  ).catch(err => {
    if (err.code !== 11000)
      console.error(`❌ upsert [${integration.platform}#${canonical.externalId}]:`, err.message);
    return null;
  });

  // 3. Disparo de Auto-facturación (Background task)
  if (order && order.status === 'pending_invoice') {
    // No usamos await para no bloquear el webhook de la plataforma
    _intentarAutoFacturar(integration.userId, order).catch(e => 
      console.error(`Critical background error: ${e.message}`)
    );
  }
}

async function _intentarAutoFacturar(userId, order) {
  try {
    const user = await User.findById(userId).select('settings').lean();
    if (!user?.settings) return;

    const { factAuto, arcaStatus, cuit, arcaPtoVta, categoria } = user.settings;

    // Solo facturamos si está vinculado y tiene el switch activado
    if (!factAuto || arcaStatus !== 'vinculado' || !cuit) return;

    const cuitLimpio = cuit.replace(/\D/g, '');
    const ptoVta     = parseInt(arcaPtoVta) || 1;
    
    // Llamada al motor AFIP v4.1
    const resultado = await afip_emitirComprobante(cuitLimpio, ptoVta, {
      categoria:    categoria || 'C',
      clienteDoc:   order.customerDoc || '0',
      importeTotal: order.amount,
    });

    // Actualizamos la orden con CAE y Nro de Comprobante
    await Order.findByIdAndUpdate(order._id, {
      status:    'invoiced',
      nroComp:   resultado.nroComp,
      caeNumber: resultado.cae,
      caeExpiry: resultado.caeFchVto,
      errorLog:  '',
    });

    console.log(`✅ Facturado: CUIT ${cuitLimpio} | Nro ${resultado.nroComp} | CAE ${resultado.cae}`);

    // Envío de mail (Opcional)
    if (user.settings.envioAuto && order.customerEmail) {
      _enviarMailFactura(order, resultado.cae, resultado.nroComp).catch(console.warn);
    }

  } catch (e) {
    console.error(`❌ Error Auto-Factura [ID: ${order._id}]:`, e.message);
    await Order.findByIdAndUpdate(order._id, {
      status:   'error_afip',
      errorLog: e.message,
    });
  }
}

async function _enviarMailFactura(order, cae, nroComp) {
  // Aquí integrarás Nodemailer / Resend / Sendgrid
  console.log(`📧 [EMAIL QUEUE] Enviar Factura ${nroComp} (CAE: ${cae}) a ${order.customerEmail}`);
}

// ════════════════════════════════════════════════════════════
//  AUTH HELPERS (SEGURIDAD REFORZADA v4.1)
// ════════════════════════════════════════════════════════════

const signToken = (userId) => jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '7d' });

const setTokenCookie = (res, token) => {
  res.cookie('koi_token', token, {
    httpOnly: true,
    secure: PROD_MODE, 
    // 'none' permite que la cookie viaje entre dominios de Render/Frontend
    sameSite: PROD_MODE ? 'none' : 'lax', 
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días
  });
};

// Middleware para rutas de navegación (Redirecciona)
const requireAuth = (req, res, next) => {
  const token = req.cookies.koi_token;
  if (!token) return res.redirect('/login');

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (err) {
    res.clearCookie('koi_token');
    res.redirect('/login');
  }
};

// Middleware para rutas de API (JSON response)
const requireAuthAPI = (req, res, next) => {
  const token = req.cookies.koi_token || (req.headers.authorization || '').replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Sesión expirada o no encontrada' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (err) {
    // Si el token es inválido, limpiamos la cookie y avisamos al front
    res.clearCookie('koi_token');
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

// ════════════════════════════════════════════════════════════
//  PASSPORT — GOOGLE OAUTH 2.0 (v4.1)
// ════════════════════════════════════════════════════════════

passport.use(new GoogleStrategy({
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  `${BASE}/auth/google/callback`,
    proxy: true // Vital para que funcione correctamente tras el proxy de Render
  }, 
  async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value?.toLowerCase();
      if (!email) return done(new Error('Google no devolvió una dirección de correo válida.'));

      // Buscamos por GoogleID o por Email para evitar duplicados
      let user = await User.findOne({ 
        $or: [ { googleId: profile.id }, { email: email } ] 
      });

      if (!user) {
        // Crear usuario nuevo si no existe
        user = await User.create({
          googleId: profile.id,
          email:    email,
          nombre:   profile.name?.givenName  || '',
          apellido: profile.name?.familyName || '',
          avatar:   profile.photos?.[0]?.value || '',
          ultimoAcceso: new Date()
        });
        console.log(`🆕 Nuevo usuario via Google: ${email}`);
      } else {
        // Actualizar usuario existente
        let changed = false;
        if (!user.googleId) { user.googleId = profile.id; changed = true; }
        
        // Actualizamos avatar y último acceso
        const newAvatar = profile.photos?.[0]?.value;
        if (newAvatar && user.avatar !== newAvatar) { user.avatar = newAvatar; changed = true; }
        
        user.ultimoAcceso = new Date();
        if (changed) await user.save();
      }

      return done(null, user);
    } catch (e) {
      console.error('❌ Error en GoogleStrategy:', e.message);
      return done(e);
    }
  }
));

// Serialización liviana (solo el ID)
passport.serializeUser((user, done) => done(null, user.id || user._id));

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id).select('-password').lean();
    done(null, user);
  } catch (e) {
    done(e);
  }
});

// ════════════════════════════════════════════════════════════
//  RUTAS AUTH (REVISADAS v4.1)
// ════════════════════════════════════════════════════════════

// --- GOOGLE OAUTH ---
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=google_failed' }),
  (req, res) => {
    const token = signToken(req.user.id || req.user._id);
    setTokenCookie(res, token);
    // Redirigimos al dashboard del frontend
    res.redirect('/dashboard');
  }
);

// --- REGISTRO MANUAL ---
app.post('/auth/register', async (req, res) => {
  try {
    let { nombre, apellido, email, password } = req.body;
    
    if (!nombre || !email || !password) {
      return res.status(400).json({ error: 'Nombre, email y contraseña son obligatorios.' });
    }

    const emailLimpio = email.trim().toLowerCase();

    if (password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
    }

    const existe = await User.findOne({ email: emailLimpio });
    if (existe) {
      return res.status(409).json({ error: 'Este email ya está registrado. Intentá iniciar sesión.' });
    }

    const user = await User.create({ 
      nombre: nombre.trim(), 
      apellido: apellido ? apellido.trim() : '', 
      email: emailLimpio, 
      password 
    });

    const token = signToken(user._id);
    setTokenCookie(res, token);

    res.status(201).json({ 
      ok: true, 
      user: { nombre: user.nombre, email: user.email, plan: user.plan } 
    });
  } catch (e) {
    console.error('❌ Error Register:', e.message);
    res.status(500).json({ error: 'No se pudo crear la cuenta. Reintentá en unos instantes.' });
  }
});

// --- LOGIN MANUAL ---
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos.' });

    const emailLimpio = email.trim().toLowerCase();
    const user = await User.findOne({ email: emailLimpio }).select('+password');

    if (!user || !user.password) {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    const passOk = await user.checkPassword(password);
    if (!passOk) {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    user.ultimoAcceso = new Date();
    await user.save();

    const token = signToken(user._id);
    setTokenCookie(res, token);

    res.json({ 
      ok: true, 
      user: { id: user._id, nombre: user.nombre, email: user.email, plan: user.plan } 
    });
  } catch (e) {
    console.error('❌ Error Login:', e.message);
    res.status(500).json({ error: 'Error interno en el servidor.' });
  }
});

// --- LOGOUT ---
app.get('/auth/logout', (req, res) => {
  req.logout((err) => {
    res.clearCookie('koi_token', {
      httpOnly: true,
      secure: PROD_MODE,
      sameSite: PROD_MODE ? 'none' : 'lax'
    });
    return res.redirect('/login');
  });
});

// ════════════════════════════════════════════════════════════
//  API — USUARIO & CONFIGURACIÓN (v4.1)
// ════════════════════════════════════════════════════════════

// --- OBTENER PERFIL ---
app.get('/api/me', requireAuthAPI, async (req, res) => {
  try {
    const user = await User.findById(req.userId)
      .select('-password -settings.arcaClave')
      .lean();
    
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    
    res.json({ ok: true, user });
  } catch (e) {
    res.status(500).json({ error: 'Error al obtener perfil' });
  }
});

// --- GUARDAR CONFIGURACIÓN GENERAL ---
app.patch('/api/me/settings', requireAuthAPI, async (req, res) => {
  try {
    const { nombre, apellido, ...body } = req.body;
    const update = {};

    if (nombre)   update.nombre   = nombre.trim();
    if (apellido) update.apellido = apellido.trim();

    // Campos permitidos en settings
    const allowedSettings = ['factAuto', 'envioAuto', 'categoria', 'cuit', 'arcaPtoVta'];
    
    for (const key of allowedSettings) {
      if (body[key] !== undefined) {
        let value = body[key];
        // Limpieza específica si es CUIT
        if (key === 'cuit') value = String(value).replace(/\D/g, '');
        // Conversión si es Punto de Venta
        if (key === 'arcaPtoVta') value = parseInt(value) || 1;
        
        update[`settings.${key}`] = value;
      }
    }

    const user = await User.findByIdAndUpdate(
      req.userId,
      { $set: update },
      { new: true, select: '-password -settings.arcaClave' }
    ).lean();

    res.json({ ok: true, user });
  } catch (e) {
    console.error('❌ Update Settings:', e.message);
    res.status(500).json({ error: 'No se pudo actualizar la configuración.' });
  }
});

// --- VINCULAR CARPETA FISCAL (ARCA) ---
app.patch('/api/me/arca', requireAuthAPI, async (req, res) => {
  try {
    const { cuit, arcaClave } = req.body;
    
    if (!cuit || !arcaClave) {
      return res.status(400).json({ error: 'El CUIT y la Clave Fiscal son obligatorios.' });
    }

    const cleanCuit = String(cuit).replace(/\D/g, '');
    if (cleanCuit.length !== 11) {
      return res.status(400).json({ error: 'El CUIT ingresado no es válido (debe tener 11 dígitos).' });
    }

    const user = await User.findByIdAndUpdate(
      req.userId,
      {
        $set: {
          'settings.cuit':       cleanCuit,
          'settings.arcaUser':   cleanCuit,
          'settings.arcaClave':  encrypt(arcaClave), // AES-256-GCM
          'settings.arcaStatus': 'pendiente',
          'settings.arcaNotas':  'Datos recibidos. El administrador validará la delegación en ARCA.',
        },
      },
      { new: true, select: '-password -settings.arcaClave' }
    ).lean();

    res.json({ 
      ok: true, 
      message: 'Datos enviados con éxito. La vinculación puede demorar hasta 24hs hábiles.', 
      user 
    });
  } catch (e) {
    console.error('❌ Error ARCA Link:', e.message);
    res.status(500).json({ error: 'Error al procesar la vinculación fiscal.' });
  }
});

// ════════════════════════════════════════════════════════════
//  API — AFIP/ARCA — EMISIÓN (v4.1)
// ════════════════════════════════════════════════════════════

// --- VERIFICAR ESTADO DEL WSFE (AFIP) ---
app.get('/api/afip/estado', requireAuthAPI, async (req, res) => {
  try {
    // Usamos el objeto AFIP_URLS que definimos al inicio
    const urlCheck = AFIP_URLS.wsfe + '?wsdl';
    await new Promise((resolve, reject) => {
      const r = https.get(urlCheck, { timeout: 5000 }, resolve);
      r.on('error', reject);
      r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    });
    res.json({ ok: true, online: true });
  } catch {
    res.json({ ok: true, online: false });
  }
});

// --- EMITIR CAE INDIVIDUAL ---
app.post('/api/orders/:orderId/emitir', requireAuthAPI, requireArcaCuit, async (req, res) => {
  const { orderId } = req.params;
  try {
    const order = await Order.findOne({ _id: orderId, userId: req.userId });
    if (!order) return res.status(404).json({ error: 'Orden no encontrada' });

    if (order.status === 'invoiced') {
      return res.status(409).json({ error: 'Esta orden ya fue facturada.', cae: order.caeNumber });
    }
    
    // Validación de seguridad por si el frontend saltó el bloqueo de DNI
    if (order.amount >= ARCA_LIMIT_SIN_DNI && (!order.customerDoc || order.customerDoc === '0')) {
      return res.status(400).json({ error: 'Esta orden supera el límite legal y requiere DNI del cliente.' });
    }

    const resultado = await afip_emitirComprobante(
      req.arcaCuit,
      req.arcaPtoVta,
      {
        categoria:       req.arcaCategoria,
        clienteDoc:      order.customerDoc || '0',
        importeTotal:    order.amount,
      }
    );

    // Actualizamos con TODOS los datos devueltos por AFIP
    const updatedOrder = await Order.findByIdAndUpdate(orderId, {
      status:    'invoiced',
      nroComp:   resultado.nroComp,
      caeNumber: resultado.cae,
      caeExpiry: resultado.caeFchVto,
      errorLog:  '',
    }, { new: true });

    // Envío de mail si el usuario lo tiene activo
    if (req.envioAuto && order.customerEmail) {
      _enviarMailFactura(updatedOrder, resultado.cae, resultado.nroComp).catch(console.warn);
    }

    res.json({ 
      ok: true, 
      cae: resultado.cae, 
      nroComp: resultado.nroComp, 
      vto: resultado.caeFchVto 
    });

  } catch (e) {
    console.error(`❌ Error emisión manual [${orderId}]:`, e.message);
    await Order.findByIdAndUpdate(orderId, { status: 'error_afip', errorLog: e.message });
    res.status(500).json({ error: e.message });
  }
});

// --- EMITIR LOTE DE PENDIENTES ---
app.post('/api/afip/emitir-lote', requireAuthAPI, requireArcaCuit, async (req, res) => {
  try {
    const pendientes = await Order.find({ 
      userId: req.userId, 
      status: 'pending_invoice' 
    }).sort({ createdAt: 1 });

    if (!pendientes.length) {
      return res.json({ ok: true, mensaje: 'No hay órdenes pendientes.' });
    }

    // Respuesta inmediata para el cliente (Procesamiento en background)
    res.json({ ok: true, total: pendientes.length, mensaje: 'Procesando lote...' });

    // Ejecución del lote
    (async () => {
      let ok = 0, errores = 0;
      for (const order of pendientes) {
        try {
          // Salto preventivo si falta DNI y es monto alto
          if (order.amount >= ARCA_LIMIT_SIN_DNI && (!order.customerDoc || order.customerDoc === '0')) {
             throw new Error(`Monto $${order.amount} requiere DNI`);
          }

          const r = await afip_emitirComprobante(req.arcaCuit, req.arcaPtoVta, {
            categoria:    req.arcaCategoria,
            clienteDoc:   order.customerDoc || '0',
            importeTotal: order.amount,
          });

          await Order.findByIdAndUpdate(order._id, {
            status: 'invoiced', 
            nroComp: r.nroComp,
            caeNumber: r.cae, 
            caeExpiry: r.caeFchVto, 
            errorLog: ''
          });

          if (req.envioAuto && order.customerEmail) {
            _enviarMailFactura(order, r.cae, r.nroComp).catch(() => {});
          }
          ok++;
          // Delay de cortesía para AFIP
          await new Promise(res => setTimeout(res, 400));
        } catch (err) {
          errores++;
          await Order.findByIdAndUpdate(order._id, { 
            status: err.message.includes('DNI') ? 'error_data' : 'error_afip', 
            errorLog: err.message 
          });
        }
      }
      console.log(`📊 Fin de Lote [${req.arcaCuit}]: ${ok} exitosas, ${errores} fallidas.`);
    })();

  } catch (e) {
    console.error('❌ Error crítico en Lote:', e.message);
    res.status(500).json({ error: 'No se pudo iniciar el proceso de lote.' });
  }
});

// ════════════════════════════════════════════════════════════
//  API — ÓRDENES MANUALES (v4.1)
// ════════════════════════════════════════════════════════════

app.post('/api/orders/manual', requireAuthAPI, async (req, res) => {
  try {
    const { cliente, email, concepto, monto, dni } = req.body;
    const importe = parseFloat(monto);

    // 1. Validaciones básicas
    if (!cliente || isNaN(importe) || importe <= 0) {
      return res.status(400).json({ error: 'Cliente y monto válido son obligatorios.' });
    }

    // 2. Validación de Límite Legal (Monto vs DNI)
    const docLimpio = dni ? String(dni).replace(/\D/g, '') : '0';
    
    if (importe >= ARCA_LIMIT_SIN_DNI && (docLimpio === '0' || docLimpio === '')) {
      return res.status(400).json({ 
        error: `Para montos mayores a $${ARCA_LIMIT_SIN_DNI.toLocaleString()}, el DNI/CUIT es obligatorio.` 
      });
    }

    // 3. Recuperar settings para decidir si auto-facturar
    const user = await User.findById(req.userId).select('settings').lean();
    
    // Generar un ID externo único para trazabilidad manual
    const externalId = `MAN-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    // 4. Crear la Orden en DB
    const order = await Order.create({
      userId:        req.userId,
      platform:      'manual',
      externalId,
      customerName:  cliente.trim(),
      customerEmail: email ? email.trim().toLowerCase() : '',
      customerDoc:   docLimpio,
      amount:        importe,
      currency:      'ARS',
      concepto:      concepto || 'Venta Manual',
      status:        'pending_invoice',
      orderDate:     new Date(),
    });

    // 5. Flujo de respuesta y Auto-facturación
    const isVinculado = user?.settings?.arcaStatus === 'vinculado';
    const isFactAuto  = user?.settings?.factAuto !== false;

    if (isVinculado && isFactAuto) {
      // Respondemos al cliente inmediatamente
      res.json({ 
        ok: true, 
        nro: externalId, 
        id: order._id, 
        message: 'Venta registrada. Procesando comprobante en AFIP...' 
      });

      // Ejecutamos en segundo plano para no bloquear el proceso
      _intentarAutoFacturar(req.userId, order).catch(err => {
         console.error(`❌ Fallo en background auto-factura manual: ${err.message}`);
      });
    } else {
      res.json({ 
        ok: true, 
        nro: externalId, 
        id: order._id, 
        message: 'Venta registrada como pendiente de facturación.' 
      });
    }

  } catch (e) {
    console.error('❌ Error en venta manual:', e.message);
    res.status(500).json({ error: 'No se pudo registrar la venta manual.' });
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
