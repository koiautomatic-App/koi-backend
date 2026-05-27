// routes/api/me.js
const express = require('express');
const router = express.Router();
const { requireAuthAPI } = require('../../middleware/auth');
const { 
  getMe, 
  updateSettings, 
  desconectarArca, 
  getArcaStatus 
} = require('../../controllers/userController');

router.get('/', requireAuthAPI, getMe);
router.patch('/settings', requireAuthAPI, updateSettings);
router.post('/desconectar-arca', requireAuthAPI, desconectarArca);
router.get('/arca-status', requireAuthAPI, getArcaStatus);

module.exports = router;