// app.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const passport = require('passport');
const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');

// 👇 CONFIGURAR MERCADO PAGO AL INICIO
require('./config/mercadopago');

const app = express();

// ============================================================
// MIDDLEWARES BASE
// ============================================================
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: config.BASE_URL, credentials: true }));

// ============================================================
// DEBUG - VERIFICAR TOKEN DE MERCADO PAGO
// ============================================================
app.get('/debug/mercadopago', (req, res) => {
  const token = process.env.MP_ACCESS_TOKEN;
  res.json({
    token_configurado: !!token,
    token_length: token?.length || 0,
    token_preview: token ? token.substring(0, 10) + '...' : 'no token',
    node_env: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

// ============================================================
// HELMET - SEGURIDAD HTTP (CONFIGURACIÓN COMPLETA)
// ============================================================
app.use(helmet());

app.use(
  helmet.contentSecurityPolicy({
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "'unsafe-hashes'",
        "https://cdnjs.cloudflare.com",
        "https://cdn.jsdelivr.net",
        "https://unpkg.com",
        "https://code.jquery.com",
        "https://stackpath.bootstrapcdn.com",
        "https://*.googleapis.com",
        "https://*.gstatic.com"
      ],
      "script-src-attr": [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-hashes'"
      ],
      "style-src": [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com",
        "https://fonts.gstatic.com",
        "https://cdn.jsdelivr.net",
        "https://cdnjs.cloudflare.com",
        "https://stackpath.bootstrapcdn.com"
      ],
      "font-src": [
        "'self'",
        "https://fonts.gstatic.com",
        "https://cdn.jsdelivr.net",
        "data:"
      ],
      "img-src": [
        "'self'",
        "data:",
        "https://quickchart.io",
        "https://res.cloudinary.com",
        "https://*.cloudinary.com",
        "https://logotyp.us",
        "https://cdn.worldvectorlogo.com"
      ],
      "connect-src": [
        "'self'",
        "https://api.mercadolibre.com",
        "https://api.mercadopago.com",
        "https://*.afip.gov.ar",
        "https://cdn.jsdelivr.net",
        "https://cdnjs.cloudflare.com",
        "https://koi-facturas-pdfs-2.s3.us-east-2.amazonaws.com",
        "https://koi-facturas-pdfs-2.s3.amazonaws.com"
      ],
      "frame-src": [
        "'self'",
        "https://accounts.google.com",
        "https://koi-facturas-pdfs-2.s3.us-east-2.amazonaws.com",
        "https://koi-facturas-pdfs-2.s3.amazonaws.com"
      ],
      "object-src": [
        "'self'",
        "https://koi-facturas-pdfs-2.s3.us-east-2.amazonaws.com",
        "https://koi-facturas-pdfs-2.s3.amazonaws.com"
      ],
      "media-src": [
        "'self'",
        "https://koi-facturas-pdfs-2.s3.us-east-2.amazonaws.com",
        "https://koi-facturas-pdfs-2.s3.amazonaws.com"
      ]
    },
  })
);

app.use(cookieParser());

// ============================================================
// HEALTH CHECK PARA RENDER
// ============================================================
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    env: config.NODE_ENV
  });
});

// Health check detallado para diagnóstico
app.get('/health/detailed', async (req, res) => {
  const checks = {
    mongodb: false,
    timestamp: new Date().toISOString()
  };
  
  try {
    const mongoose = require('mongoose');
    checks.mongodb = mongoose.connection.readyState === 1;
    checks.mongodbState = mongoose.connection.readyState;
  } catch (e) {
    checks.mongodb = false;
    checks.mongodbError = e.message;
  }
  
  res.status(200).json(checks);
});

// ============================================================
// SESSION & PASSPORT
// ============================================================
app.use(session({
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: config.NODE_ENV === 'production', 
    httpOnly: true, 
    maxAge: 7 * 24 * 60 * 60 * 1000 
  },
}));

app.use(passport.initialize());
app.use(passport.session());

// ============================================================
// STATIC FILES
// ============================================================
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
    }
  }
}));

// ============================================================
// RUTAS DE LA API
// ============================================================

// Auth routes
app.use('/auth', require('./routes/auth'));

// API routes - Usuarios
app.use('/api/me', require('./routes/api/me'));
app.use('/api/orders', require('./routes/api/orders'));
app.use('/api/integrations', require('./routes/api/integrations'));
app.use('/api/admin', require('./routes/api/admin'));
app.use('/api/reports', require('./routes/api/reports'));

// ============================================================
// NOTIFICACIONES - RUTAS
// ============================================================
app.use('/api/notifications', require('./routes/api/notifications'));

// ============================================================
// PAIS
// ============================================================
app.use('/api/pais', require('./routes/api/pais'));

// ============================================================
// VIEW ENGINE
// ============================================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ============================================================
// RUTAS PRINCIPALES
// ============================================================
app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

logger.info('✅ App configurada correctamente');

// ============================================================
// EXPORTAR APP
// ============================================================
// ============================================================
// PRUEBA DEFINITIVA - WEBHOOK CON TOKEN HARCODEADO
// ============================================================
app.post('/test-webhook', async (req, res) => {
  console.log('🧪 TEST WEBHOOK - TOKEN HARCODEADO');
  
  try {
    // 👇 TOKEN HARCODEADO (REEMPLAZÁ CON TU TOKEN REAL)
    const token = 'APP_USR-5364373661842224-071513-737ba9db7b2533b5140f1ea45fbacf09-5346892568601999';
    console.log('🔍 Token:', token.substring(0, 10) + '...');
    
    const mercadopago = require('mercadopago');
    console.log('🔧 mercadopago cargado');
    console.log('🔧 mercadopago.config ANTES:', !!mercadopago.config);
    
    mercadopago.configure({
      access_token: token
    });
    console.log('✅ mercadopago configurado');
    console.log('🔧 mercadopago.config DESPUÉS:', !!mercadopago.config);
    
    const payment = await mercadopago.payment.findById('168833683866');
    console.log('📊 Payment status:', payment.body.status);
    console.log('📊 Payment ID:', payment.body.id);
    
    res.json({
      ok: true,
      tokenConfigurado: true,
      hasConfig: !!mercadopago.config,
      paymentStatus: payment.body.status,
      paymentId: payment.body.id
    });
  } catch (error) {
    console.error('❌ Error en test-webhook:', error.message);
    console.error('❌ Stack:', error.stack);
    res.status(500).json({ 
      error: error.message,
      stack: error.stack
    });
  }
});
module.exports = app;