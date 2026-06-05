// routes/index.js - VERSIÓN CORREGIDA CON INVOICES
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
const debugRoutes = require('./api/debug');
const invoicesRoutes = require('./api/invoices');  // 👈 LÍNEA AGREGADA

// ============================================================
// RUTAS DE AUTENTICACIÓN
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
router.use('/api/debug', debugRoutes);
router.use('/api/invoices', invoicesRoutes);  // 👈 LÍNEA AGREGADA

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

const isLoggedIn = (req) => {
  try {
    const token = req.cookies?.koi_token;
    if (!token) return false;
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const decoded = jwt.verify(token, config.JWT_SECRET);
    return true;
  } catch (e) {
    return false;
  }
};

// Landing page
router.get('/', (req, res) => {
  if (isLoggedIn(req)) {
    return res.redirect('/dashboard');
  }
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

// Login
router.get('/login', (req, res) => {
  if (isLoggedIn(req)) {
    return res.redirect('/dashboard');
  }
  res.sendFile(path.join(__dirname, '../public', 'login.html'));
});

// Dashboard
router.get('/dashboard', (req, res) => {
  if (!isLoggedIn(req)) {
    return res.redirect('/login');
  }
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
  res.sendFile(path.join(__dirname, '../public', 'dashboard.html'));
});

// Admin panel
router.get('/admin', (req, res) => {
  if (!isLoggedIn(req)) {
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