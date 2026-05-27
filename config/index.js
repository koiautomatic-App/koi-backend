require('dotenv').config();

// Helper para SSL_OP_LEGACY (evita error en afip-tls.js)
const crypto = require('crypto');
const SSL_OP_LEGACY = typeof crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT !== 'undefined'
  ? crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT
  : 0x00000004;

module.exports = {
  PORT: process.env.PORT || 10000,
  BASE_URL: (process.env.BASE_URL || `http://localhost:${process.env.PORT || 10000}`).replace(/\/$/, ''),
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  JWT_SECRET: process.env.JWT_SECRET || 'koi-jwt-dev-change-in-production',
  SESSION_SECRET: process.env.SESSION_SECRET || 'koi-session-dev',
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'koi0000000000000000000000000000k',
  
  MONGO_URI: process.env.MONGO_URI,
  
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  
  ML_CLIENT_ID: process.env.ML_CLIENT_ID,
  ML_CLIENT_SECRET: process.env.ML_CLIENT_SECRET,
  
  AFIP_CERT_PATH: process.env.AFIP_CERT_PATH || './cert/afip.crt',
  AFIP_KEY_PATH: process.env.AFIP_KEY_PATH || './cert/afip.key',
  AFIP_URLS: {
    wsaa: process.env.WSAA_URL || 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
    wsfe: process.env.WSFE_URL || 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
  },
  
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  
  MP_ACCESS_TOKEN: process.env.MP_ACCESS_TOKEN,
  
  // 👇 NUEVA PROPIEDAD AGREGADA
  SSL_OP_LEGACY: SSL_OP_LEGACY,
  
  validateEnv: () => {
    const required = ['MONGO_URI', 'JWT_SECRET'];
    const missing = required.filter(key => !process.env[key]);
    if (missing.length) {
      console.warn(`⚠️ Missing env vars: ${missing.join(', ')}`);
    } else {
      console.log('✅ Environment variables validated');
    }
  }
};