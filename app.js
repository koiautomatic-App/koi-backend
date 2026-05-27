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

const app = express();

// ============================================================
// MIDDLEWARES BASE
// ============================================================
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: config.BASE_URL, credentials: true }));

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
        "https://cdnjs.cloudflare.com"
      ],
      "frame-src": [
        "'self'",
        "https://accounts.google.com"
      ]
    },
  })
);

app.use(cookieParser());

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
// VIEW ENGINE
// ============================================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

logger.info('✅ App configurada correctamente');
module.exports = app;
