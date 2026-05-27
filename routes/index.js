// routes/index.js - VERSIÓN CON DEBUG
const express = require('express');
const path = require('path');
const router = express.Router();

const authRoutes = require('./auth');
const meRoutes = require('./api/me');
const ordersRoutes = require('./api/orders');
const integrationsRoutes = require('./api/integrations');
const statsRoutes = require('./api/stats');
const adminRoutes = require('./api/admin');
const suscripcionRoutes = require('./api/suscripcion');
const webhookRoutes = require('./webhooks');

// ============================================================
// RUTAS DE AUTENTICACIÓN (incluye Google OAuth)
// ============================================================
router.use('/auth', authRoutes);

// ============================================================
// RUTAS API
// ============================================================
router.use('/api/me', meRoutes);
router.use('/api/orders', ordersRoutes);
router.use('/api/integrations', integrationsRoutes);
router.use('/api/stats', statsRoutes);
router.use('/api/admin', adminRoutes);
router.use('/api/suscripcion', suscripcionRoutes);

// ============================================================
// WEBHOOKS
// ============================================================
router.use('/webhook', webhookRoutes);

// ============================================================
// HEALTH CHECK
// ============================================================
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ============================================================
// PÁGINAS HTML
// ============================================================

// Helper para verificar si el usuario está logueado - CON DEBUG
const isLoggedIn = (req) => {
  try {
    const token = req.cookies?.koi_token;
    console.log(`🔍 [${req.url}] Token presente:`, token ? 'SÍ' : 'NO');
    
    if (!token) return false;
    
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const decoded = jwt.verify(token, config.JWT_SECRET);
    console.log(`🔍 [${req.url}] Token válido para:`, decoded.email);
    return true;
  } catch (e) {
    console.error(`❌ [${req.url}] Error token:`, e.message);
    return false;
  }
};

// Landing page
router.get('/', (req, res) => {
  console.log(`🚪 GET / - isLoggedIn: ${isLoggedIn(req)}`);
  if (isLoggedIn(req)) {
    console.log('↪️ Redirigiendo a /dashboard');
    return res.redirect('/dashboard');
  }
  console.log('📄 Mostrando landing page');
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

// Login
router.get('/login', (req, res) => {
  console.log(`🚪 GET /login - isLoggedIn: ${isLoggedIn(req)}`);
  if (isLoggedIn(req)) {
    console.log('↪️ Redirigiendo a /dashboard');
    return res.redirect('/dashboard');
  }
  console.log('📄 Mostrando login page');
  res.sendFile(path.join(__dirname, '../public', 'login.html'));
});

// Dashboard
router.get('/dashboard', (req, res) => {
  console.log(`🚪 GET /dashboard - isLoggedIn: ${isLoggedIn(req)}`);
  if (!isLoggedIn(req)) {
    console.log('↪️ Redirigiendo a /login');
    return res.redirect('/login');
  }
  console.log('📄 Mostrando dashboard');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
  res.sendFile(path.join(__dirname, '../public', 'dashboard.html'));
});

// Admin panel
router.get('/admin', (req, res) => {
  console.log(`🚪 GET /admin - isLoggedIn: ${isLoggedIn(req)}`);
  if (!isLoggedIn(req)) {
    console.log('↪️ Redirigiendo a /login');
    return res.redirect('/login');
  }
  res.sendFile(path.join(__dirname, '../public', 'admin.html'));
});

// Logout
router.get('/logout', (req, res) => {
  res.clearCookie('koi_token');
  res.redirect('/login');
});

module.exports = router;
