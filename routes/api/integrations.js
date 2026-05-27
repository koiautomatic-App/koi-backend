const express = require('express');
const router = express.Router();
const { requireAuthAPI } = require('../../middleware/auth');
const {
  listarIntegraciones,
  conectarIntegracionToken,
  desconectarIntegracion,
  toggleIntegracionEstado,
  obtenerWebhookUrl
} = require('../../controllers/integrationController');

router.get('/', requireAuthAPI, listarIntegraciones);
router.post('/:platform', requireAuthAPI, conectarIntegracionToken);
router.delete('/:id', requireAuthAPI, desconectarIntegracion);
router.patch('/:id/status', requireAuthAPI, toggleIntegracionEstado);
router.get('/:id/webhook', requireAuthAPI, obtenerWebhookUrl);

module.exports = router;