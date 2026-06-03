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
const debugRoutes = require('./api/debug');  // 👈 AGREGAR

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
router.use('/api/debug', debugRoutes);  // 👈 AGREGAR

// ============================================================
// WEBHOOKS
// ============================================================
router.use('/webhook', webhookRoutes);

// ... resto del código igual ...