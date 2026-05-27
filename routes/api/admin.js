const express = require('express');
const router = express.Router();
const { requireAuthAPI, requireAdmin } = require('../../middleware/auth');
const {
  actualizarPtoVenta,
  vincularArca,
  desvincularArca,
  verClaveArca,
  getStats,
  listarUsuarios,
  exportarCSV,
  listarIntegraciones,
  desvincularUsuario
} = require('../../controllers/adminController');

router.post('/actualizar-pto-venta', requireAuthAPI, requireAdmin, actualizarPtoVenta);
router.post('/vincular-arca', requireAuthAPI, requireAdmin, vincularArca);
router.post('/desvincular-arca', requireAuthAPI, requireAdmin, desvincularArca);
router.get('/user/:userId/arca-clave', requireAuthAPI, requireAdmin, verClaveArca);
router.get('/stats', requireAuthAPI, requireAdmin, getStats);
router.get('/users', requireAuthAPI, requireAdmin, listarUsuarios);
router.get('/export-csv', requireAuthAPI, requireAdmin, exportarCSV);
router.get('/integrations', requireAuthAPI, requireAdmin, listarIntegraciones);
router.post('/desvincular', requireAuthAPI, requireAdmin, desvincularUsuario);

module.exports = router;