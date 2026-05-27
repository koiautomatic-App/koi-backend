const express = require('express');
const router = express.Router();
const { requireAuthAPI } = require('../../middleware/auth');
const {
  listarOrdenes,
  obtenerOrden,
  emitirOrden,
  cancelarFactura,
  enviarMailOrden,
  eliminarOrden,
  generarPDF  // 👈 Agregar esta importación
} = require('../../controllers/orderController');

router.get('/', requireAuthAPI, listarOrdenes);
router.get('/:id', requireAuthAPI, obtenerOrden);
router.post('/:id/emitir', requireAuthAPI, emitirOrden);
router.post('/:id/cancelar', requireAuthAPI, cancelarFactura);
router.post('/:id/mail', requireAuthAPI, enviarMailOrden);
router.delete('/:id', requireAuthAPI, eliminarOrden);
router.get('/:id/pdf', requireAuthAPI, generarPDF);  // 👈 Agregar esta línea

module.exports = router;