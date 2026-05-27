// utils/afip-tls.js
const https = require('https');
const axios = require('axios');
const config = require('../config');
const logger = require('./logger');

// Configurar agente HTTPS con SECLEVEL=0 para AFIP
const httpsAgent = new https.Agent({
  secureOptions: config.SSL_OP_LEGACY || 0x00000004,
  rejectUnauthorized: true,
  keepAlive: true,
  ciphers: 'DEFAULT:@SECLEVEL=0',
});

// Aplicar a axios globalmente para llamadas a AFIP
axios.defaults.httpsAgent = httpsAgent;

const sslOpValue = config.SSL_OP_LEGACY || 0x00000004;
logger.info(`[TLS] Agent AFIP configurado: SSL_OP_LEGACY=${sslOpValue.toString(16)} SECLEVEL=0`);

module.exports = { httpsAgent };