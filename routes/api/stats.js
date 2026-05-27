const express = require('express');
const router = express.Router();
const { requireAuthAPI } = require('../../middleware/auth');
const { obtenerDashboardStats } = require('../../controllers/statsController');

router.get('/dashboard', requireAuthAPI, obtenerDashboardStats);

module.exports = router;