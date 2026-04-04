// ============================================================
//  KOI-FACTURA · SaaS Multi-Tenant Engine v3.5 (PROD)
//  Ajustes: Ruta Raíz, TLS 1.2, Delegación CUIT y Timezone
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
const JWT_SECRET = process.env.JWT_SECRET || 'koi-jwt-prod-secret-2026';

// ════════════════════════════════════════════════════════════
//  1. AFIP — CONFIGURACIÓN DE DELEGACIÓN Y RUTAS
// ════════════════════════════════════════════════════════════

const AFIP_PROD      = process.env.AFIP_PROD === 'true';
const CUIT_MAESTRO   = (process.env.AFIP_CUIT || '').replace(/\D/g, ''); 
const AFIP_CERT_PATH = path.join(__dirname, 'certs', 'koi.crt');
const AFIP_KEY_PATH  = path.join(__dirname, 'certs', 'koi.key');
const TA_CACHE_DIR   = path.join(__dirname, 'cache', 'ta');

const WSAA_URL = AFIP_PROD ? 'https://wsaa.afip.gov.ar/ws/services/LoginCms' : 'https://wsaa.test.afip.gov.ar/ws/services/LoginCms';
const WSFE_URL = AFIP_PROD ? 'https://servicios1.afip.gov.ar/wsfev1/service.asmx' : 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx';

if (!fs.existsSync(TA_CACHE_DIR)) fs.mkdirSync(TA_CACHE_DIR, { recursive: true });

// ════════════════════════════════════════════════════════════
//  2. MOTOR DE COMUNICACIÓN CORREGIDO (TLS 1.2)
// ════════════════════════════════════════════════════════════

async function _soapPost(url, body, action = '') {
  // AJUSTE: Forzamos TLS 1.2 para evitar el Error 500 de conexión rechazada
  const agent = new https.Agent({ secureProtocol: 'TLSv1_2_method', rejectUnauthorized: false });
  try {
    const resp = await axios.post(url, body, { 
      headers: { 
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': action 
      },
      httpsAgent: agent,
      timeout: 25000,
      responseType: 'text' 
    });
    return resp.data;
  } catch (err) {
    console.error("❌ Error ARCA:", err.message);
    throw new Error(`Error de comunicación con AFIP: ${err.message}`);
  }
}

// ════════════════════════════════════════════════════════════
//  3. GENERACIÓN DE TICKET CON TIMEZONE ARGENTINA
// ════════════════════════════════════════════════════════════

function _generarCMS(servicio = 'wsfe') {
  const ahora = new Date();
  // AJUSTE: Margen de tiempo y offset -03:00 para que AFIP no rechace el ticket
  const fechaDesde = new Date(ahora.getTime() - (10 * 60 * 1000));
  const fechaHasta = new Date(ahora.getTime() + (12 * 60 * 60 * 1000));
  const toAFIP = (d) => d.toISOString().split('.')[0] + "-03:00";

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
    // AJUSTE: Verificación de existencia de certificados antes de firmar
    if (!fs.existsSync(AFIP_CERT_PATH) || !fs.existsSync(AFIP_KEY_PATH)) {
        throw new Error("Faltan certificados en la carpeta /certs");
    }
    fs.writeFileSync(tmpXml, xml);
    execSync(`openssl cms -sign -in "${tmpXml}" -signer "${AFIP_CERT_PATH}" -inkey "${AFIP_KEY_PATH}" -nodetach -outform DER -out "${tmpOut}"`);
    return fs.readFileSync(tmpOut).toString('base64');
  } finally {
    try { fs.unlinkSync(tmpXml); fs.unlinkSync(tmpOut); } catch {}
  }
}

// ════════════════════════════════════════════════════════════
//  4. RUTAS DE ACCESO Y SALUD (PREVIENE 404 EN RENDER)
// ════════════════════════════════════════════════════════════

app.use(cors());
app.use(express.json());
app.use(cookieParser());

// AJUSTE: Ruta raíz para confirmación de estado
app.get('/', (req, res) => {
  res.status(200).send(`
    <div style="font-family:sans-serif; text-align:center; padding:50px;">
      <h1>🐟 KOI Backend v3.5</h1>
      <p style="color:green; font-weight:bold;">✅ Servidor Operativo</p>
      <p>Modo: ${AFIP_PROD ? 'PRODUCCIÓN' : 'HOMOLOGACIÓN'}</p>
      <small>Certificados cargados: ${fs.existsSync(AFIP_CERT_PATH) ? 'SI' : 'NO'}</small>
    </div>
  `);
});

app.get('/ping', (req, res) => res.status(200).send('pong'));

// ════════════════════════════════════════════════════════════
//  5. INICIO Y CONEXIÓN
// ════════════════════════════════════════════════════════════

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`
      --------------------------------------------------
      🚀 KOI-FACTURA ONLINE
      Puerto: ${PORT}
      CUIT Maestro: ${CUIT_MAESTRO}
      --------------------------------------------------
      `);
    });
  })
  .catch(err => {
    console.error("❌ Error en conexión MongoDB:", err.message);
    process.exit(1);
  });
