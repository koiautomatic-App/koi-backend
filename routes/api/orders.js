const express = require('express');
const router = express.Router();
const { requireAuthAPI, requireAdmin } = require('../../middleware/auth');
const {
  listarOrdenes,
  obtenerOrden,
  emitirOrden,
  cancelarFactura,
  enviarMailOrden,
  eliminarOrden,
  generarPDF,
  actualizarOrden
} = require('../../controllers/orderController');

router.get('/', requireAuthAPI, listarOrdenes);
router.get('/:id', requireAuthAPI, obtenerOrden);
router.post('/:id/emitir', requireAuthAPI, emitirOrden);
router.post('/:id/cancelar', requireAuthAPI, cancelarFactura);
router.post('/:id/mail', requireAuthAPI, enviarMailOrden);
router.delete('/:id', requireAuthAPI, eliminarOrden);
router.get('/:id/pdf', requireAuthAPI, generarPDF);
router.patch('/:id', requireAuthAPI, actualizarOrden);

// 👇 ENDPOINT DE EMERGENCIA PARA CORREGIR STATUS (solo admin)
router.post('/fix-woo-status', requireAuthAPI, requireAdmin, async (req, res) => {
  try {
    const Order = require('../../models/Order');
    const ids = ['17550', '17542', '17540'];
    const result = await Order.updateMany(
      { externalId: { $in: ids }, userId: req.userId },
      { $set: { 'rawPayload.status': 'completed' } }
    );
    res.json({ ok: true, modified: result.modifiedCount, message: `${result.modifiedCount} órdenes actualizadas` });
  } catch (error) {
    console.error('Error fix-woo-status:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;