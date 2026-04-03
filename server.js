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
const JWT_SECRET = process.env.JWT_SECRET || 'koi-jwt-dev-secret';

// ════════════════════════════════════════════════════════════
//  MODELOS DE BASE DE DATOS (MongoDB)
// ════════════════════════════════════════════════════════════

const UserSchema = new mongoose.Schema({
  googleId: String,
  email: { type: String, required: true, unique: true },
  password: { type: String },
  name: String,
  role: { type: String, default: 'user' },
  settings: {
    cuit: String,
    razonSocial: String,
    puntoVenta: { type: Number, default: 1 },
    categoria: { type: String, default: 'C' }, // A, B, C o Monotributo
    tokenMP: String
  },
  createdAt: { type: Date, default: Date.now }
});

const OrderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  externalId: String, // ID de Mercado Pago o sistema externo
  clienteNombre: String,
  clienteDoc: String,
  importeTotal: Number,
  items: Array,
  status: { type: String, default: 'pending' }, // pending, paid, invoiced, error
  afip: {
    cae: String,
    nroComp: Number,
    fchVto: String,
    error: String
  },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Order = mongoose.model('Order', OrderSchema);

// ════════════════════════════════════════════════════════════
//  AFIP — CONFIGURACIÓN Y MOTOR (CORREGIDO)
// ════════════════════════════════════════════════════════════

const AFIP_PROD      = process.env.AFIP_PROD === 'true';
const CUIT_MAESTRO   = (process.env.AFIP_CUIT || '').replace(/\D/g, ''); 
const AFIP_CERT_PATH = path.join(__dirname, 'certs', 'koi.crt');
const AFIP_KEY_PATH  = path.join(__dirname, 'certs', 'koi.key');
const TA_CACHE_DIR   = path.join(__dirname, 'cache', 'ta');

const WSAA_URL = AFIP_PROD 
  ? 'https://wsaa.afip.gov.ar/ws/services/LoginCms' 
  : 'https://wsaa.test.afip.gov.ar/ws/services/LoginCms';

const WSFE_URL = AFIP_PROD 
  ? 'https://servicios1.afip.gov.ar/wsfev1/service.asmx' 
  : 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx';

if (!fs.existsSync(TA_CACHE_DIR)) fs.mkdirSync(TA_CACHE_DIR, { recursive: true });

async function _soapPost(url, body) {
  const isWsaa = url.includes('wsaa');
  const soapAction = isWsaa ? '""' : '"http://ar.gov.afip.dif.FEV1/FECAESolicitar"';
  const agent = new https.Agent({ secureProtocol: 'TLSv1_2_method', rejectUnauthorized: false });

  try {
    const resp = await axios.post(url, body, { 
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': soapAction },
      httpsAgent: agent,
      timeout: 20000,
      responseType: 'text' 
    });
    return resp.data;
  } catch (err) {
    if (err.response && err.response.data) return err.response.data;
    throw new Error(`Error conexión ARCA: ${err.message}`);
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

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <source>CUIT ${CUIT_MAESTRO}</source>
    <destination>cn=wsaa,o=afip,c=ar,serialNumber=CUIT 33693450239</destination>
    <uniqueId>${Math.floor(Date.now() / 1000)}</uniqueId>
    <generationTime>${toAFIP(fechaDesde)}</generationTime>
    <expirationTime>${toAFIP(fechaHasta)}</expirationTime>
  </header>
  <service>${servicio}</service>
</loginTicketRequest>`;

  return _firmarCMS(xml);
}

function _firmarCMS(xml) {
  const tmpXml = path.join(os.tmpdir(), `koi_${Date.now()}.xml`);
  const tmpOut = path.join(os.tmpdir(), `koi_${Date.now()}.der`);
  try {
    fs.writeFileSync(tmpXml, xml);
    execSync(`openssl cms -sign -in "${tmpXml}" -signer "${AFIP_CERT_PATH}" -inkey "${AFIP_KEY_PATH}" -nodetach -outform DER -out "${tmpOut}"`);
    return fs.readFileSync(tmpOut).toString('base64');
  } finally {
    try { fs.unlinkSync(tmpXml); fs.unlinkSync(tmpOut); } catch {}
  }
}

function _parsearTA(xml) {
  const fault = xml.match(/<faultstring>([\s\S]*?)<\/faultstring>/);
  if (fault) throw new Error(`AFIP: ${fault[1].trim()}`);
  const m = xml.match(/<loginCmsReturn>([\s\S]*?)<\/loginCmsReturn>/);
  if (!m) throw new Error('WSAA: No se recibió Ticket.');
  const taXml = Buffer.from(m[1].trim(), 'base64').toString('utf8');
  return {
    token: taXml.match(/<token>([\s\S]*?)<\/token>/)?.[1],
    sign: taXml.match(/<sign>([\s\S]*?)<\/sign>/)?.[1],
    expiracion: taXml.match(/<expirationTime>([\s\S]*?)<\/expirationTime>/)?.[1]
  };
}

async function afip_obtenerTA(cuitUsuario) {
  const cuit = String(cuitUsuario).replace(/\D/g, '');
  const cache = _leerTACache(cuit);
  if (cache && _taEsValido(cache)) return cache;

  const cms = _generarCMS('wsfe');
  const soap = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.xsb.com.ar">
  <soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body>
</soapenv:Envelope>`;

  const resp = await _soapPost(WSAA_URL, soap);
  const ta = _parsearTA(resp);
  _guardarTACache(cuit, ta);
  return ta;
}

// ════════════════════════════════════════════════════════════
//  MIDDLEWARES Y RUTAS BASE
// ════════════════════════════════════════════════════════════

app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(session({ secret: JWT_SECRET, resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

const requireAuthAPI = (req, res, next) => {
  const token = req.cookies.auth_token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) { res.status(401).json({ error: 'Sesión expirada' }); }
};

// Rutas de inicio (Evitan el 404)
app.get('/', (req, res) => res.send('KOI Backend v3.2 Online 🐟'));
app.get('/ping', (req, res) => res.send('pong'));

// ════════════════════════════════════════════════════════════
//  RUTAS DE FACTURACIÓN (CORE)
// ════════════════════════════════════════════════════════════

app.post('/api/orders/invoice/:orderId', requireAuthAPI, async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    const user = await User.findById(req.user.id);
    
    if (!order || !user.settings.cuit) return res.status(400).json({ error: 'Datos incompletos' });

    console.log(`🚀 Iniciando factura para orden ${order._id} (CUIT: ${user.settings.cuit})`);
    
    // Aquí llamamos a la lógica de AFIP
    const { token, sign } = await afip_obtenerTA(user.settings.cuit);
    
    // [Lógica simplificada de FECAESolicitar...]
    // (Usa la función afip_emitirComprobante definida en archivos anteriores)
    
    res.json({ ok: true, message: 'Ticket de acceso obtenido. Procesando CAE...' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════
//  GESTIÓN DE CACHE Y HELPER
// ════════════════════════════════════════════════════════════

function _leerTACache(cuit) {
  try {
    const p = path.join(TA_CACHE_DIR, cuit, 'ta-wsfe.json');
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  } catch (e) { return null; }
}

function _guardarTACache(cuit, ta) {
  const d = path.join(TA_CACHE_DIR, cuit);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'ta-wsfe.json'), JSON.stringify(ta));
}

function _taEsValido(ta) {
  if (!ta || !ta.expiracion) return false;
  return new Date(ta.expiracion) > new Date(Date.now() + 600000);
}

// ════════════════════════════════════════════════════════════
//  INICIO DEL SERVIDOR
// ════════════════════════════════════════════════════════════

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ Servidor KOI listo en puerto ${PORT}`);
      console.log(`🌐 Entorno: ${AFIP_PROD ? 'PRODUCCIÓN' : 'HOMOLOGACIÓN'}`);
    });
  })
  .catch(err => console.error("Error MongoDB:", err));
