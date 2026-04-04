// ============================================================
//  KOI-FACTURA · v4.2 (ESTABLE - PRODUCCIÓN)
//  Basado en el código que funciona correctamente
// ============================================================

'use strict';

require('dotenv').config();

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
const { execSync } = require('child_process');
const os = require('os');
const https = require('https');
const xmlbuilder = require('xmlbuilder');
const { DOMParser } = require('@xmldom/xmldom');

const app = express();
const PORT = process.env.PORT || 10000;
const BASE = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const JWT_SECRET = process.env.JWT_SECRET || 'koi-jwt-dev-change-in-production';

// ════════════════════════════════════════════════════════════
//  AFIP — CONFIGURACIÓN GLOBAL (FIJA EN PRODUCCIÓN)
// ════════════════════════════════════════════════════════════

// URLs DIRECTAS de producción (las que funcionaban)
const AFIP_URLS = {
  wsaa: 'https://servicios1.afip.gov.ar/ws/services/LoginCms',
  wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx'
};

// Rutas de certificados (priorizar secrets de Render, fallback a local)
const AFIP_KEY_PATH = process.env.AFIP_KEY_PATH || path.join(__dirname, 'cert', 'koi.key');
const AFIP_CERT_PATH = process.env.AFIP_CERT_PATH || path.join(__dirname, 'cert', 'koi.crt');
const TA_CACHE_DIR = path.join(os.tmpdir(), 'koi-ta-cache');

// Crear directorio de cache si no existe
if (!fs.existsSync(TA_CACHE_DIR)) {
  fs.mkdirSync(TA_CACHE_DIR, { recursive: true });
}

console.log(`🔐 Certificado AFIP: ${AFIP_CERT_PATH} (existe: ${fs.existsSync(AFIP_CERT_PATH)})`);
console.log(`🔐 Clave AFIP: ${AFIP_KEY_PATH} (existe: ${fs.existsSync(AFIP_KEY_PATH)})`);

// ════════════════════════════════════════════════════════════
//  MIDDLEWARES
// ════════════════════════════════════════════════════════════
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: BASE, credentials: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'koi-session-dev',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

app.use(passport.initialize());
app.use(passport.session());

// ════════════════════════════════════════════════════════════
//  MONGODB
// ════════════════════════════════════════════════════════════
mongoose.connect(process.env.MONGO_URI, { maxPoolSize: 10 })
  .then(() => console.log('🐟 MongoDB conectado'))
  .catch(err => console.error('❌ MongoDB error:', err.message));

// ════════════════════════════════════════════════════════════
//  ENCRYPTION
// ════════════════════════════════════════════════════════════
const ENC_KEY = Buffer.from(
  (process.env.ENCRYPTION_KEY || 'koi0000000000000000000000000000k').slice(0, 32), 'utf8'
);

const encrypt = (text) => {
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
};

const decrypt = (payload) => {
  if (!payload) return null;
  try {
    const [ivHex, tagHex, encHex] = payload.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
  } catch { return null; }
};

// ════════════════════════════════════════════════════════════
//  SCHEMAS (SIMPLIFICADOS)
// ════════════════════════════════════════════════════════════

const UserSchema = new mongoose.Schema({
  nombre: { type: String, trim: true },
  apellido: { type: String, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, select: false },
  googleId: { type: String, sparse: true },
  avatar: { type: String },
  plan: { type: String, default: 'free' },
  settings: {
    factAuto: { type: Boolean, default: true },
    envioAuto: { type: Boolean, default: true },
    categoria: { type: String, default: 'C' },
    cuit: { type: String },
    arcaPtoVta: { type: Number, default: 1 },
    arcaStatus: { type: String, default: 'sin_vincular', enum: ['sin_vincular', 'pendiente', 'vinculado', 'error'] },
    arcaClave: { type: String },
  },
  ultimoAcceso: { type: Date, default: Date.now },
  creadoEn: { type: Date, default: Date.now },
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

const OrderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  platform: { type: String, required: true },
  externalId: { type: String, required: true },
  customerName: { type: String, default: '' },
  customerEmail: { type: String, default: '' },
  customerDoc: { type: String, default: '0' },
  amount: { type: Number, required: true },
  concepto: { type: String, default: '' },
  status: { type: String, default: 'pending_invoice', enum: ['pending_invoice', 'processing', 'invoiced', 'error_afip', 'error_data'] },
  nroComp: { type: Number },
  caeNumber: { type: String },
  caeExpiry: { type: Date },
  errorLog: { type: String },
  retryCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});
OrderSchema.index({ userId: 1, platform: 1, externalId: 1 }, { unique: true });
const Order = mongoose.model('Order', OrderSchema);

// ════════════════════════════════════════════════════════════
//  AFIP — FUNCIONES AUXILIARES
// ════════════════════════════════════════════════════════════

function _docTipo(doc) {
  const d = String(doc || '0').replace(/\D/g, '');
  if (d.length === 11) return 80;
  if (d === '0' || d.startsWith('9999')) return 99;
  return 96;
}

function _tipoComprobante(categoria) {
  return 11; // Factura C
}

function _fechaAFIP(d) {
  const date = d instanceof Date ? d : new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('');
}

function _parseFechaAFIP(str) {
  if (!str || str.length !== 8) return null;
  return new Date(`${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`);
}

// ════════════════════════════════════════════════════════════
//  AFIP — OBTENCIÓN DE TOKEN
// ════════════════════════════════════════════════════════════

async function afip_obtenerTA(cuit) {
  const TA_PATH = path.join(TA_CACHE_DIR, `${cuit}.json`);

  // Verificar cache
  if (fs.existsSync(TA_PATH)) {
    try {
      const cache = JSON.parse(fs.readFileSync(TA_PATH, 'utf8'));
      if (cache.expiry && cache.expiry > Date.now()) {
        return { token: cache.token, sign: cache.sign };
      }
    } catch (e) {}
  }

  // Generar TRA
  const tra = xmlbuilder.create('loginTicketRequest')
    .att('version', '1.0')
    .ele('header')
      .ele('uniqueId').txt(Math.floor(Date.now() / 1000)).up()
      .ele('generationTime').txt(new Date(Date.now() - 60000).toISOString().replace('Z', '-03:00')).up()
      .ele('expirationTime').txt(new Date(Date.now() + 12 * 3600000).toISOString().replace('Z', '-03:00')).up()
    .up()
    .ele('service').txt('wsfe').up()
    .end({ pretty: true });

  const traPath = path.join(os.tmpdir(), `tra-${Date.now()}.xml`);
  const cmsPath = path.join(os.tmpdir(), `cms-${Date.now()}.der`);

  try {
    fs.writeFileSync(traPath, tra);
    execSync(`openssl cms -sign -in "${traPath}" -out "${cmsPath}" -signer "${AFIP_CERT_PATH}" -inkey "${AFIP_KEY_PATH}" -nodetach -outform DER`, { stdio: 'pipe' });
    const cmsBase64 = fs.readFileSync(cmsPath).toString('base64');

    const soapWsaa = xmlbuilder.create('soapenv:Envelope')
      .att('xmlns:soapenv', 'http://schemas.xmlsoap.org/soap/envelope/')
      .att('xmlns:wsaa', 'http://wsaa.view.sua.dvadac.desein.afip.gov.ar/')
      .ele('soapenv:Body')
        .ele('wsaa:loginCms')
          .ele('wsaa:in0').txt(cmsBase64).up()
        .up()
      .up()
      .end({ pretty: false });

    const resp = await axios.post(AFIP_URLS.wsaa, soapWsaa, {
      headers: { 'Content-Type': 'text/xml' },
      timeout: 30000
    });

    const wsaaDoc = new DOMParser().parseFromString(resp.data, 'text/xml');
    const loginReturn = wsaaDoc.getElementsByTagName('loginCmsReturn')[0]?.textContent;
    if (!loginReturn) throw new Error("WSAA falló");

    const taXml = Buffer.from(loginReturn, 'base64').toString('utf8');
    const taDoc = new DOMParser().parseFromString(taXml, 'text/xml');
    const token = taDoc.getElementsByTagName('token')[0]?.textContent;
    const sign = taDoc.getElementsByTagName('sign')[0]?.textContent;

    if (!token || !sign) throw new Error("Token o sign no encontrados");

    const expiryMatch = taXml.match(/<expirationTime>(.*?)<\/expirationTime>/);
    const expiry = expiryMatch ? new Date(expiryMatch[1]).getTime() : Date.now() + 12 * 3600000;

    fs.writeFileSync(TA_PATH, JSON.stringify({ token, sign, expiry }));
    return { token, sign };
  } finally {
    try { fs.unlinkSync(traPath); } catch(e) {}
    try { fs.unlinkSync(cmsPath); } catch(e) {}
  }
}

// ════════════════════════════════════════════════════════════
//  AFIP — ÚLTIMO NÚMERO DE COMPROBANTE
// ════════════════════════════════════════════════════════════

async function _afipUltimoNro(cuit, ptoVta, tipo, token, sign) {
  const soap = xmlbuilder.create('soapenv:Envelope')
    .att('xmlns:soapenv', 'http://schemas.xmlsoap.org/soap/envelope/')
    .att('xmlns:ar', 'http://ar.gov.afip.dif.FEV1/')
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

  const res = await axios.post(AFIP_URLS.wsfe, soap, {
    headers: { 'Content-Type': 'text/xml' },
    timeout: 30000
  });
  const xmlDoc = new DOMParser().parseFromString(res.data, 'text/xml');
  const nro = xmlDoc.getElementsByTagName('CbteNro')[0]?.textContent;
  return parseInt(nro || '0');
}

// ════════════════════════════════════════════════════════════
//  AFIP — EMISIÓN PRINCIPAL
// ════════════════════════════════════════════════════════════

async function afip_emitirComprobante(cuitEmisor, puntoVenta, datos) {
  const { token, sign } = await afip_obtenerTA(cuitEmisor);
  
  const cbTipo = datos.tipoComprobante || _tipoComprobante(datos.categoria);
  const ultimoNro = await _afipUltimoNro(cuitEmisor, puntoVenta, cbTipo, token, sign);
  const nroComp = ultimoNro + 1;
  
  const importe = datos.importeTotal.toFixed(2);
  const docTipo = _docTipo(datos.clienteDoc);
  const docNro = String(datos.clienteDoc || '0').replace(/\D/g, '') || '0';

  const soap = xmlbuilder.create('soapenv:Envelope')
    .att('xmlns:soapenv', 'http://schemas.xmlsoap.org/soap/envelope/')
    .att('xmlns:ar', 'http://ar.gov.afip.dif.FEV1/')
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
      .up()
    .up()
    .end({ pretty: false });

  const xmlDoc = await (async () => {
    const res = await axios.post(AFIP_URLS.wsfe, soap, {
      headers: { 'Content-Type': 'text/xml' },
      timeout: 30000
    });
    return new DOMParser().parseFromString(res.data, 'text/xml');
  })();

  const resultado = xmlDoc.getElementsByTagName('Resultado')[0]?.textContent;

  if (resultado !== 'A') {
    const errores = [];
    const errNodes = xmlDoc.getElementsByTagName('Err');
    for (let i = 0; i < errNodes.length; i++) {
      const msg = errNodes[i].getElementsByTagName('Msg')[0]?.textContent;
      const code = errNodes[i].getElementsByTagName('Code')[0]?.textContent;
      if (msg) errores.push(`[${code}] ${msg}`);
    }
    throw new Error(`AFIP rechazó: ${errores.join(' | ') || 'Error desconocido'}`);
  }

  const detResp = xmlDoc.getElementsByTagName('FECAEDetResponse')[0];
  return {
    cae: detResp.getElementsByTagName('CAE')[0]?.textContent,
    caeFchVto: _parseFechaAFIP(detResp.getElementsByTagName('CAEFchVto')[0]?.textContent),
    nroComp
  };
}

// ════════════════════════════════════════════════════════════
//  AUTH HELPERS
// ════════════════════════════════════════════════════════════

const signToken = (userId) => jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '7d' });
const setTokenCookie = (res, token) => res.cookie('koi_token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
const requireAuthAPI = (req, res, next) => {
  const token = req.cookies.koi_token || (req.headers.authorization || '').replace('Bearer ', '');
  try { req.userId = jwt.verify(token, JWT_SECRET).id; next(); }
  catch { res.status(401).json({ error: 'No autenticado' }); }
};

// ════════════════════════════════════════════════════════════
//  PASSPORT GOOGLE (SIMPLIFICADO)
// ════════════════════════════════════════════════════════════

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: `${BASE}/auth/google/callback`,
}, async (_, __, profile, done) => {
  try {
    const email = profile.emails?.[0]?.value?.toLowerCase();
    if (!email) return done(new Error('No email'));
    let user = await User.findOne({ $or: [{ googleId: profile.id }, { email }] });
    if (!user) {
      user = await User.create({ googleId: profile.id, email, nombre: profile.name?.givenName || '' });
    }
    done(null, user);
  } catch (e) { done(e); }
}));
passport.serializeUser((u, done) => done(null, u.id));
passport.deserializeUser(async (id, done) => { try { done(null, await User.findById(id)); } catch (e) { done(e); } });

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login' }), (req, res) => { setTokenCookie(res, signToken(req.user.id)); res.redirect('/dashboard'); });
app.post('/auth/register', async (req, res) => {
  try {
    const { nombre, email, password } = req.body;
    if (!nombre || !email || !password) return res.status(400).json({ error: 'Faltan campos' });
    if (await User.findOne({ email: email.toLowerCase() })) return res.status(409).json({ error: 'Email ya registrado' });
    const user = await User.create({ nombre, email, password });
    setTokenCookie(res, signToken(user.id));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Error interno' }); }
});
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user || !await user.checkPassword(password)) return res.status(401).json({ error: 'Credenciales incorrectas' });
    setTokenCookie(res, signToken(user.id));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Error interno' }); }
});
app.get('/auth/logout', (req, res) => { res.clearCookie('koi_token'); res.redirect('/login'); });

// ════════════════════════════════════════════════════════════
//  API
// ════════════════════════════════════════════════════════════

app.get('/api/me', requireAuthAPI, async (req, res) => {
  const user = await User.findById(req.userId).select('-password').lean();
  res.json({ ok: true, user });
});

app.patch('/api/me/settings', requireAuthAPI, async (req, res) => {
  const update = {};
  ['factAuto', 'envioAuto', 'categoria', 'cuit', 'arcaPtoVta'].forEach(k => {
    if (req.body[k] !== undefined) update[`settings.${k}`] = req.body[k];
  });
  const user = await User.findByIdAndUpdate(req.userId, { $set: update }, { new: true }).lean();
  res.json({ ok: true, user });
});

app.patch('/api/me/arca', requireAuthAPI, async (req, res) => {
  try {
    const { cuit, arcaClave } = req.body;
    if (!cuit || !arcaClave) return res.status(400).json({ error: 'CUIT y Clave requeridos' });
    const cleanCuit = String(cuit).replace(/\D/g, '');
    const user = await User.findByIdAndUpdate(req.userId, {
      $set: {
        'settings.cuit': cleanCuit,
        'settings.arcaClave': encrypt(arcaClave),
        'settings.arcaStatus': 'pendiente',
      }
    }, { new: true }).lean();
    res.json({ ok: true, message: 'Vinculación enviada', user });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/orders/manual', requireAuthAPI, async (req, res) => {
  try {
    const { cliente, email, concepto, monto } = req.body;
    const importe = parseFloat(monto);
    if (!cliente || isNaN(importe) || importe <= 0) {
      return res.status(400).json({ error: 'Cliente y monto válido son obligatorios.' });
    }
    const externalId = `MAN-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const order = await Order.create({
      userId: req.userId,
      platform: 'manual',
      externalId,
      customerName: cliente.trim(),
      customerEmail: email || '',
      amount: importe,
      concepto: concepto || 'Venta Manual',
      status: 'pending_invoice',
    });
    res.json({ ok: true, id: order._id, message: 'Venta registrada' });
  } catch (e) { res.status(500).json({ error: 'Error al registrar venta' }); }
});

app.post('/api/orders/:orderId/emitir', requireAuthAPI, async (req, res) => {
  const { orderId } = req.params;
  try {
    const order = await Order.findOne({ _id: orderId, userId: req.userId });
    if (!order) return res.status(404).json({ error: 'Orden no encontrada' });
    if (order.status === 'invoiced') return res.status(409).json({ error: 'Ya facturada' });

    const user = await User.findById(req.userId).select('settings').lean();
    if (!user?.settings?.cuit) return res.status(400).json({ error: 'CUIT no configurado' });
    if (user.settings.arcaStatus !== 'vinculado') return res.status(403).json({ error: 'AFIP no vinculado' });

    const cuitLimpio = user.settings.cuit.replace(/\D/g, '');
    const ptoVta = user.settings.arcaPtoVta || 1;

    const resultado = await afip_emitirComprobante(cuitLimpio, ptoVta, {
      categoria: user.settings.categoria || 'C',
      clienteDoc: order.customerDoc || '0',
      importeTotal: order.amount,
    });

    await Order.findByIdAndUpdate(orderId, {
      status: 'invoiced',
      nroComp: resultado.nroComp,
      caeNumber: resultado.cae,
      caeExpiry: resultado.caeFchVto,
    });

    res.json({ ok: true, cae: resultado.cae, nroComp: resultado.nroComp });
  } catch (e) {
    console.error('❌ Emitir error:', e.message);
    await Order.findByIdAndUpdate(orderId, { status: 'error_afip', errorLog: e.message });
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/stats/dashboard', requireAuthAPI, async (req, res) => {
  try {
    const stats = await Order.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(req.userId) } },
      { $group: { _id: '$status', total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]);
    res.json({ ok: true, stats });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// ════════════════════════════════════════════════════════════
//  STATIC & START
// ════════════════════════════════════════════════════════════

app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`🚀 KOI v4.2 | Puerto ${PORT} | ${BASE}`));
