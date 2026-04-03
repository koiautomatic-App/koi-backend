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
// ════════════════════════════════════════════════════════════

const AFIP_PROD      = process.env.AFIP_PROD === 'true';
const CUIT_MAESTRO   = process.env.AFIP_CUIT || ''; // Tu CUIT (KOI)
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
//  MÓDULO AFIP — COMUNICACIÓN Y FIRMA (CORREGIDO)
// ════════════════════════════════════════════════════════════

function _tipoComprobante(categoria = 'C') {
  if (categoria === 'A') return 1;
  if (categoria === 'B') return 6;
  return 11; 
}

function _fechaAFIP(d) {
  return d.toISOString().split('T')[0].replace(/-/g, '');
}

async function _soapPost(url, body) {
  const isWsaa = url.includes('wsaa');
  const soapAction = isWsaa ? '""' : '"http://ar.gov.afip.dif.FEV1/FECAESolicitar"';

  const headers = {
    'Content-Type': 'text/xml; charset=utf-8',
    'SOAPAction': soapAction,
    'Connection': 'keep-alive',
    'User-Agent': 'Koi-Fintech/1.1'
  };

  const agent = new https.Agent({
    secureProtocol: 'TLSv1_2_method',
    rejectUnauthorized: false
  });

  try {
    const resp = await axios.post(url, body, { 
      headers, 
      httpsAgent: agent,
      timeout: 15000,
      responseType: 'text' 
    });
    return resp.data;
  } catch (err) {
    if (err.response && err.response.data) return err.response.data;
    throw new Error(`Error de red ARCA: ${err.message}`);
  }
}

function _firmarCMS(xml) {
  if (!fs.existsSync(AFIP_KEY_PATH) || !fs.existsSync(AFIP_CERT_PATH)) {
    throw new Error("Certificados KOI no encontrados.");
  }
  const tmpXml = path.join(os.tmpdir(), `koi_ltr_${Date.now()}.xml`);
  const tmpOut = path.join(os.tmpdir(), `koi_cms_${Date.now()}.der`);
  try {
    fs.writeFileSync(tmpXml, xml, 'utf8');
    execSync(`openssl cms -sign -in "${tmpXml}" -signer "${AFIP_CERT_PATH}" -inkey "${AFIP_KEY_PATH}" -nodetach -outform DER -out "${tmpOut}"`, { stdio: 'pipe' });
    return fs.readFileSync(tmpOut).toString('base64');
  } finally {
    try { fs.unlinkSync(tmpXml); fs.unlinkSync(tmpOut); } catch {}
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

  // XML estructurado para Delegación
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

function _parsearTA(xml) {
  const fault = xml.match(/<faultstring>([\s\S]*?)<\/faultstring>/);
  if (fault) throw new Error(`AFIP Error: ${fault[1].trim()}`);

  const m = xml.match(/<loginCmsReturn>([\s\S]*?)<\/loginCmsReturn>/);
  if (!m) throw new Error('WSAA: No se recibió Ticket de Acceso.');

  const taXml = Buffer.from(m[1].trim(), 'base64').toString('utf8').trim();
  const token = taXml.match(/<token>([\s\S]*?)<\/token>/)?.[1]?.trim();
  const sign  = taXml.match(/<sign>([\s\S]*?)<\/sign>/)?.[1]?.trim();
  const exp   = taXml.match(/<expirationTime>([\s\S]*?)<\/expirationTime>/)?.[1]?.trim();

  if (!token || !sign) throw new Error('AFIP: Ticket inválido o denegado.');
  return { token, sign, expiracion: exp, generadoEn: new Date().toISOString() };
}

// ════════════════════════════════════════════════════════════
//  MÓDULO AFIP — FUNCIONES PRINCIPALES
// ════════════════════════════════════════════════════════════

async function afip_obtenerTA(cuitUsuario) {
  const cuitDestino = String(cuitUsuario).replace(/\D/g, '');
  const cache = _leerTACache(cuitDestino);
  if (cache && _taEsValido(cache)) return { token: cache.token, sign: cache.sign };

  const cms = _generarCMS('wsfe');
  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.xsb.com.ar">
  <soapenv:Body>
    <wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;

  const resp = await _soapPost(WSAA_URL, soapBody);
  const ta   = _parsearTA(resp);
  _guardarTACache(cuitDestino, ta);
  return { token: ta.token, sign: ta.sign };
}

async function afip_emitirComprobante(cuitEmisor, puntoVenta, datos) {
  const { token, sign } = await afip_obtenerTA(cuitEmisor);
  const cbTipo = _tipoComprobante(datos.categoria || 'C');
  
  // Obtener último número
  const soapUltimo = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Body>
    <ar:FECompUltimoAutorizado>
      <ar:Auth><ar:Token>${token}</ar:Token><ar:Sign>${sign}</ar:Sign><ar:Cuit>${cuitEmisor}</ar:Cuit></ar:Auth>
      <ar:PtoVta>${puntoVenta}</ar:PtoVta><ar:CbteTipo>${cbTipo}</ar:CbteTipo>
    </ar:FECompUltimoAutorizado>
  </soapenv:Body>
</soapenv:Envelope>`;

  const respUltimo = await _soapPost(WSFE_URL, soapUltimo);
  const ultimoNro = parseInt(respUltimo.match(/<CbteNro>(\d+)<\/CbteNro>/)?.[1] || '0', 10);
  const nroComp = ultimoNro + 1;

  // Lógica de importes y fechas
  const importe = parseFloat(datos.importeTotal.toFixed(2));
  const fEmision = _fechaAFIP(new Date());
  
  // Límite ARCA para identificación
  const ARCA_LIMIT = process.env.ARCA_LIMIT ? parseInt(process.env.ARCA_LIMIT) : 191624;
  const docTipo = (importe >= ARCA_LIMIT) ? (String(datos.clienteDoc).length === 11 ? 80 : 96) : (String(datos.clienteDoc).length === 11 ? 80 : 99);
  const docNro = String(datos.clienteDoc || '0').replace(/\D/g, '') || '0';

  const soapFactura = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Body><ar:FECAESolicitar><ar:Auth>
    <ar:Token>${token}</ar:Token><ar:Sign>${sign}</ar:Sign><ar:Cuit>${cuitEmisor}</ar:Cuit>
    </ar:Auth><ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${puntoVenta}</ar:PtoVta>
    <ar:CbteTipo>${cbTipo}</ar:CbteTipo></ar:FeCabReq><ar:FeDetReq><ar:FECAEDetRequest>
    <ar:Concepto>1</ar:Concepto><ar:DocTipo>${docTipo}</ar:DocTipo><ar:DocNro>${docNro}</ar:DocNro>
    <ar:CbteDesde>${nroComp}</ar:CbteDesde><ar:CbteHasta>${nroComp}</ar:CbteHasta><ar:CbteFch>${fEmision}</ar:CbteFch>
    <ar:ImpTotal>${importe}</ar:ImpTotal><ar:ImpTotConc>0.00</ar:ImpTotConc><ar:ImpNeto>${importe}</ar:ImpNeto>
    <ar:ImpOpEx>0.00</ar:ImpOpEx><ar:ImpIVA>0.00</ar:ImpIVA><ar:ImpTrib>0.00</ar:ImpTrib>
    <ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz></ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq>
  </ar:FECAESolicitar></soapenv:Body></soapenv:Envelope>`;

  const respFactura = await _soapPost(WSFE_URL, soapFactura);
  const resultado = respFactura.match(/<Resultado>([\s\S]*?)<\/Resultado>/)?.[1];

  if (resultado !== 'A') {
    const errorMsg = respFactura.match(/<Msg>([\s\S]*?)<\/Msg>/)?.[1] || 'Rechazado por ARCA';
    throw new Error(`AFIP: ${errorMsg}`);
  }

  return {
    cae: respFactura.match(/<CAE>([\s\S]*?)<\/CAE>/)?.[1],
    nroComp: parseInt(respFactura.match(/<CbteDesde>(\d+)<\/CbteDesde>/)?.[1] || nroComp),
    caeFchVto: respFactura.match(/<FchVto>(\d+)<\/FchVto>/)?.[1]
  };
}

// ════════════════════════════════════════════════════════════
//  GESTIÓN DE CACHE
// ════════════════════════════════════════════════════════════

function _leerTACache(cuit) {
  try {
    const p = path.join(TA_CACHE_DIR, cuit, 'ta-wsfe.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {} return null;
}

function _guardarTACache(cuit, ta) {
  try {
    const d = path.join(TA_CACHE_DIR, cuit);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'ta-wsfe.json'), JSON.stringify(ta, null, 2));
  } catch (e) {}
}

function _taEsValido(ta) {
  if (!ta || !ta.expiracion) return false;
  return (new Date(ta.expiracion).getTime() - Date.now()) > (10 * 60 * 1000);
}

// [EL RESTO DE TU CÓDIGO DE EXPRESS, PASSPORT Y RUTAS SIGUE IGUAL ABAJO...]
// (Mantené tus rutas de /api/orders, auth, etc., tal cual las tenías)

app.listen(PORT, () => {
  console.log(`🚀 KOI Engine v3.2 LIVE on port ${PORT}`);
  console.log(`📡 Modo: ${AFIP_PROD ? 'PRODUCCIÓN' : 'HOMOLOGACIÓN'}`);
});
