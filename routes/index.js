// routes/index.js
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
// RUTAS API
// ============================================================
router.use('/auth', authRoutes);
router.use('/api/me', meRoutes);
router.use('/api/orders', ordersRoutes);
router.use('/api/integrations', integrationsRoutes);
router.use('/api/stats', statsRoutes);
router.use('/api/admin', adminRoutes);
router.use('/api/suscripcion', suscripcionRoutes);
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

// Helper para verificar si el usuario está logueado
const isLoggedIn = (req) => {
  try {
    const token = req.cookies?.koi_token;
    if (!token) return false;
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    jwt.verify(token, config.JWT_SECRET);
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

// Dashboard (requiere autenticación)
router.get('/dashboard', (req, res) => {
  if (!isLoggedIn(req)) {
    return res.redirect('/login');
  }
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
  res.sendFile(path.join(__dirname, '../public', 'dashboard.html'));
});

// Admin panel (requiere autenticación + admin check en frontend)
router.get('/admin', (req, res) => {
  if (!isLoggedIn(req)) {
    return res.redirect('/login');
  }
  res.sendFile(path.join(__dirname, '../public', 'admin.html'));
});

// Google OAuth callback (ya está en authRoutes, pero aseguramos)
router.get('/auth/google', (req, res) => {
  res.redirect('/auth/google');
});

// Logout
router.get('/logout', (req, res) => {
  res.clearCookie('koi_token');
  res.redirect('/login');
});

module.exports = router;