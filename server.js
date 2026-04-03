// ============================================================
//  KOI-FACTURA · SaaS Multi-Tenant Engine v3.5
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

// ════════════════════════════════════════════════════════════
//  CONCLUSIÓN 1: MOTOR DE COMUNICACIÓN (AXIOS + TLS 1.2)
// ════════════════════════════════════════════════════════════

async function _soapPost(url, body) {
  const isWsaa = url.includes('wsaa');
  const soapAction = isWsaa ? '""' : '"http://ar.gov.afip.dif.FEV1/FECAESolicitar"';

  const agent = new https.Agent({
    secureProtocol: 'TLSv1_2_method', // Obligatorio para ARCA
    rejectUnauthorized: false
  });

  try {
    const resp = await axios.post(url, body, { 
      headers: { 
        'Content-Type': 'text/xml; charset=utf-8', 
        'SOAPAction': soapAction 
      }, 
      httpsAgent: agent,
      timeout: 20000,
      responseType: 'text' 
    });
    return resp.data;
  } catch (err) {
    return err.response?.data || `Error de red ARCA: ${err.message}`;
  }
}

// ════════════════════════════════════════════════════════════
//  CONCLUSIÓN 2: CMS CON IDENTIDAD Y RELOJ SINCRONIZADO
// ════════════════════════════════════════════════════════════

function _generarCMS(servicio = 'wsfe') {
  const ahora = new Date();
  // Restamos 10 min para evitar error de "reloj adelantado" en ARCA
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

  // XML Corregido: Source y Destination son vitales para Delegación
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
  if (!fs.existsSync(AFIP_KEY_PATH) || !fs.existsSync(AFIP_CERT_PATH)) {
    throw new Error("Certificados KOI no encontrados en /certs");
  }
  const tmpXml = path.join(os.tmpdir(), `koi_ltr_${Date.now()}.xml`);
  const tmpOut = path.join(os.tmpdir(), `koi_cms_${Date.now()}.der`);
  try {
    fs.writeFileSync(tmpXml, xml, 'utf8');
    execSync(`openssl cms -sign -in "${tmpXml}" -signer "${AFIP_CERT_PATH}" -inkey "${AFIP_KEY_PATH}" -nodetach -outform DER -out "${tmpOut}"`);
    return fs.readFileSync(tmpOut).toString('base64');
  } finally {
    try { fs.unlinkSync(tmpXml); fs.unlinkSync(tmpOut); } catch {}
  }
}

// ════════════════════════════════════════════════════════════
//  CONCLUSIÓN 3: RUTA RAÍZ (EVITA EL 404)
// ════════════════════════════════════════════════════════════

app.get('/', (req, res) => {
  res.send(`
    <body style="font-family:sans-serif; text-align:center; padding:50px;">
      <h1>🐟 KOI Backend v3.5</h1>
      <p style="color:green;">Servidor Operativo en Render</p>
      <small>Modo: ${AFIP_PROD ? 'PRODUCCIÓN' : 'HOMOLOGACIÓN'}</small>
    </body>
  `);
});

// [AQUÍ CONTINÚA EL RESTO DE TU CÓDIGO ORIGINAL DE SERVER(15).JS]
// Modelos, Passport, Rutas de MercadoPago, etc.
// Asegúrate de mantener tus funciones de cache: _leerTACache, _guardarTACache, etc.

app.listen(PORT, () => {
  console.log(`🚀 KOI Engine LIVE en puerto ${PORT}`);
});
