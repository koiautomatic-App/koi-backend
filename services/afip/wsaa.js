const axios = require('axios');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
const { DOMParser } = require('@xmldom/xmldom');
const forge = require('node-forge');
const config = require('../../config');
const { getToken, setToken } = require('./tokenCache');

const SSL_OP_LEGACY = crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT || 0x00000004;
const httpsAgent = new https.Agent({
  secureOptions: SSL_OP_LEGACY,
  rejectUnauthorized: true,
  keepAlive: true,
  ciphers: 'DEFAULT:@SECLEVEL=0'
});

let AFIP_CERT, AFIP_KEY;
try {
  AFIP_CERT = fs.readFileSync(config.AFIP_CERT_PATH, 'utf8');
  AFIP_KEY = fs.readFileSync(config.AFIP_KEY_PATH, 'utf8');
  console.log('✅ Certificado AFIP cargado');
} catch (e) {
  console.warn('⚠️ Certificado AFIP no encontrado:', e.message);
}

const toAfipTs = (d) => {
  const off = -3 * 60;
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const arg = new Date(utc + off * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return arg.getFullYear() + '-' + p(arg.getMonth()+1) + '-' + p(arg.getDate()) + 'T' + p(arg.getHours()) + ':' + p(arg.getMinutes()) + ':' + p(arg.getSeconds()) + '-03:00';
};

const getAfipToken = async (cuit) => {
  const cached = getToken(cuit);
  if (cached && cached.expiry > Date.now() + 5 * 60000) {
    return { token: cached.token, sign: cached.sign };
  }

  if (!AFIP_CERT || !AFIP_KEY) throw new Error('Certificado AFIP no cargado');

  const now = new Date();
  const genTime = toAfipTs(new Date(now.getTime() - 60000));
  const expTime = toAfipTs(new Date(now.getTime() + 12 * 3600000));

  const tra = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<loginTicketRequest version="1.0">',
    '  <header>',
    '    <uniqueId>' + Math.floor(Date.now() / 1000) + '</uniqueId>',
    '    <generationTime>' + genTime + '</generationTime>',
    '    <expirationTime>' + expTime + '</expirationTime>',
    '  </header>',
    '  <service>wsfe</service>',
    '</loginTicketRequest>'
  ].join('\n');

  const cert = forge.pki.certificateFromPem(AFIP_CERT);
  const privKey = forge.pki.privateKeyFromPem(AFIP_KEY);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key: privKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() }
    ]
  });
  p7.sign({ detached: false });

  const derBuffer = Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary');
  const cmsSigned = derBuffer.toString('base64');

  const soapEnvelope = '<?xml version="1.0" encoding="UTF-8"?>\n<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="http://wsaa.view.sua.dvadac.desein.afip.gov.ar">\n  <SOAP-ENV:Body>\n    <ns1:loginCms>\n      <ns1:in0>' + cmsSigned + '</ns1:in0>\n    </ns1:loginCms>\n  </SOAP-ENV:Body>\n</SOAP-ENV:Envelope>';

  const res = await axios.post(config.AFIP_URLS.wsaa, soapEnvelope, {
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '""' },
    httpsAgent: httpsAgent,
    timeout: 30000
  });

  const soapDoc = new DOMParser().parseFromString(res.data, 'text/xml');
  const loginCmsReturn = soapDoc.getElementsByTagName('loginCmsReturn')[0]?.textContent;
  
  if (!loginCmsReturn) throw new Error('WSAA: no se encontró loginCmsReturn');

  const taDoc = new DOMParser().parseFromString(loginCmsReturn, 'text/xml');
  const token = taDoc.getElementsByTagName('token')[0]?.textContent?.trim();
  const sign = taDoc.getElementsByTagName('sign')[0]?.textContent?.trim();
  const expStr = taDoc.getElementsByTagName('expirationTime')[0]?.textContent;
  const expiry = expStr ? new Date(expStr).getTime() : Date.now() + 12 * 3600000;

  setToken(cuit, { token: token, sign: sign, expiry: expiry });
  console.log('✅ AFIP Token OK para CUIT ' + cuit);
  return { token: token, sign: sign };
};

module.exports = { getAfipToken };