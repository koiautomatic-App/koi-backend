const express = require('express');
const router = express.Router();
const { requireAuthAPI } = require('../../middleware/auth');
const {
  listarOrdenes,
  obtenerOrden,
  emitirOrden,
  cancelarFactura,
  enviarMailOrden,
  eliminarOrden
} = require('../../controllers/orderController');

router.get('/', requireAuthAPI, listarOrdenes);
router.get('/:id', requireAuthAPI, obtenerOrden);
router.post('/:id/emitir', requireAuthAPI, emitirOrden);
router.post('/:id/cancelar', requireAuthAPI, cancelarFactura);
router.post('/:id/mail', requireAuthAPI, enviarMailOrden);
router.delete('/:id', requireAuthAPI, eliminarOrden);

module.exports = router;