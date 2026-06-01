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

// ============================================================
// ENDPOINT DE EMERGENCIA PARA CORREGIR STATUS (solo admin)
// ============================================================
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

// ============================================================
// DIAGNÓSTICO: Obtener próximo número de AFIP
// ============================================================
router.get('/debug/afip-next-number', requireAuthAPI, async (req, res) => {
  try {
    const User = require('../../models/User');
    const { getAfipToken } = require('../../services/afip/wsaa');
    const { getUltimoComprobante } = require('../../services/afip/wsfe');
    
    const user = await User.findById(req.userId).select('settings').lean();
    const cuit = user?.settings?.cuit;
    const ptoVta = user?.settings?.arcaPtoVta || 3;
    const tipoCbte = 11; // Factura C
    
    if (!cuit) {
      return res.status(400).json({ error: 'CUIT no configurado' });
    }
    
    console.log(`🔍 Consultando AFIP para CUIT: ${cuit}, PtoVta: ${ptoVta}`);
    
    const { token, sign } = await getAfipToken(cuit);
    const ultimoNro = await getUltimoComprobante(cuit, ptoVta, tipoCbte, token, sign);
    
    res.json({
      ok: true,
      cuit,
      puntoVenta: ptoVta,
      tipoComprobante: tipoCbte,
      ultimoNro,
      proximoNro: ultimoNro + 1
    });
    
  } catch (error) {
    console.error('Error obteniendo próximo número:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// EMITIR FACTURA CON NÚMERO FORZADO (solo admin)
// ============================================================
router.post('/:id/emitir-con-numero', requireAuthAPI, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { nroComprobante, puntoVenta } = req.body;
    
    const Order = require('../../models/Order');
    const User = require('../../models/User');
    const { emitirCAE } = require('../../services/afip/wsfe');
    
    if (!nroComprobante) {
      return res.status(400).json({ error: 'Falta nroComprobante' });
    }
    
    // Actualizar la orden con el número forzado
    await Order.findByIdAndUpdate(id, {
      nroComprobante: nroComprobante,
      puntoVenta: puntoVenta || 3,
      tipoComprobante: 11,
      nroFormatted: `FC C 00003-00000${nroComprobante}`
    });
    
    // Emitir la factura
    const user = await User.findById(req.userId).select('settings').lean();
    const result = await emitirCAE(id, user);
    
    res.json({
      ok: true,
      cae: result.cae,
      nroCbte: result.nroCbte,
      nroFormatted: `FC C 00003-00000${result.nroCbte}`,
      message: 'Factura emitida correctamente'
    });
    
  } catch (error) {
    console.error('Error emitir con número:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// EMITIR FACTURA CON NÚMERO FORZADO (para usuarios normales)
// ============================================================
router.post('/:id/emitir-con-numero-user', requireAuthAPI, async (req, res) => {
  try {
    const { id } = req.params;
    const { nroComprobante, puntoVenta } = req.body;
    
    const Order = require('../../models/Order');
    const User = require('../../models/User');
    const { emitirCAE } = require('../../services/afip/wsfe');
    
    if (!nroComprobante) {
      return res.status(400).json({ error: 'Falta nroComprobante' });
    }
    
    // Verificar que la orden pertenece al usuario
    const order = await Order.findOne({ _id: id, userId: req.userId });
    if (!order) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    
    // Actualizar la orden con el número forzado
    await Order.findByIdAndUpdate(id, {
      nroComprobante: nroComprobante,
      puntoVenta: puntoVenta || 3,
      tipoComprobante: 11,
      nroFormatted: `FC C 00003-00000${nroComprobante}`
    });
    
    // Emitir la factura
    const user = await User.findById(req.userId).select('settings').lean();
    const result = await emitirCAE(id, user);
    
    res.json({
      ok: true,
      cae: result.cae,
      nroCbte: result.nroCbte,
      nroFormatted: `FC C 00003-00000${result.nroCbte}`,
      message: 'Factura emitida correctamente'
    });
    
  } catch (error) {
    console.error('Error emitir con número:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// FORZAR DATOS DE FACTURACIÓN (para usuarios normales)
// ============================================================
router.post('/:id/forzar-datos', requireAuthAPI, async (req, res) => {
  try {
    const { id } = req.params;
    const { puntoVenta, nroComprobante, tipoComprobante, nroFormatted } = req.body;
    
    const Order = require('../../models/Order');
    
    // Verificar que la orden pertenece al usuario
    const order = await Order.findOne({ _id: id, userId: req.userId });
    if (!order) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    
    const updateData = {};
    if (puntoVenta !== undefined) updateData.puntoVenta = puntoVenta;
    if (nroComprobante !== undefined) updateData.nroComprobante = nroComprobante;
    if (tipoComprobante !== undefined) updateData.tipoComprobante = tipoComprobante;
    if (nroFormatted !== undefined) updateData.nroFormatted = nroFormatted;
    
    const updatedOrder = await Order.findByIdAndUpdate(id, { $set: updateData }, { new: true });
    
    res.json({
      ok: true,
      message: 'Datos actualizados correctamente',
      order: {
        puntoVenta: updatedOrder.puntoVenta,
        nroComprobante: updatedOrder.nroComprobante,
        nroFormatted: updatedOrder.nroFormatted
      }
    });
    
  } catch (error) {
    console.error('Error forzar datos:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;