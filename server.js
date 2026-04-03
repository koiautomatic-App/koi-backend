// ============================================================
//  KOI-FACTURA · SaaS Multi-Tenant Engine v3.5 (FINAL)
//  Node/Express · MongoDB Atlas · Google OAuth · JWT
//  AFIP/ARCA — Solución: Delegación & TLS 1.2
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
//  MODELOS DE DATOS (Mantenemos tus esquemas originales)
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
    categoria: { type: String, default: 'C' },
    tokenMP: String
  },
  createdAt: { type: Date, default: Date.now }
});

const OrderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  externalId: String,
  clienteNombre: String,
  clienteDoc: String,
  importeTotal: Number,
  items: Array,
  status: { type: String, default: 'paid' },
  afip: { cae: String, nroComp: Number, fchVto: String, error: String },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Order = mongoose.model('Order', OrderSchema);

// ════════════════════════════════════════════════════════════
//  AFIP — MOTOR DE SEGURIDAD Y DELEGACIÓN (EL GRAN CAMBIO)
// ════════════════════════════════════════════════════════════

const AFIP_PROD      = process.env.AFIP_PROD === 'true';
const CUIT_MAESTRO   = (process.env.AFIP_CUIT || '').replace(/\D/g, ''); 
const AFIP_CERT_PATH = path.join(__dirname, 'certs', 'koi.crt');
const AFIP_KEY_PATH  = path.join(__dirname, 'certs', 'koi.key');
const TA_CACHE_DIR   = path.join(__dirname, 'cache', 'ta');

const WSAA_URL = AFIP_PROD ? 'https://wsaa.afip.gov.ar/ws/services/LoginCms' : 'https://wsaa.test.afip.gov.ar/ws/services/LoginCms';
const WSFE_URL = AFIP_PROD ? 'https://servicios1.afip.gov.ar/wsfev1/service.asmx' : 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx';

if (!fs.existsSync(TA_CACHE_DIR)) fs.mkdirSync(TA_CACHE_DIR, { recursive: true });

// Conclusión 1: Usar Axios + TLS 1.2 para evitar bloqueos de Render/AFIP
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
    return err.response?.data || `Error ARCA: ${err.message}`;
  }
}

// Conclusión 2: CMS con CUIT_MAESTRO y Reloj Sincronizado
function _generarCMS(servicio = 'wsfe') {
  const ahora = new Date();
  const fechaDesde = new Date(ahora.getTime() - (10 * 60 * 1000)); // Margen de 10 min
  const fechaHasta = new Date(ahora.getTime() + (12 * 60 * 60 * 1000));

  const toAFIP = (d) => {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    const p = fmt.formatToParts(d);
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

// ════════════════════════════════════════════════════════════
//  MIDDLEWARES Y RUTAS DE ACCESO (Vuelve KOI Online)
// ════════════════════════════════════════════════════════════

app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(session({ secret: JWT_SECRET, resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

// Ruta de bienvenida para evitar el 404 de Render
app.get('/', (req, res) => {
  res.status(200).send('<h1>🐟 KOI Backend v3.5</h1><p>Motor de facturación listo.</p>');
});

// [TUS RUTAS DE AUTH, MERCADO PAGO Y ÓRDENES CONTINÚAN AQUÍ IGUAL QUE EN EL SERVER 15...]

// ════════════════════════════════════════════════════════════
//  INICIO DEL SERVIDOR
// ════════════════════════════════════════════════════════════

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    app.listen(PORT, () => console.log(`✅ KOI operativo en puerto ${PORT}`));
  });
