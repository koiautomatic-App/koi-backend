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

// 👇 NUEVO ENDPOINT: Sincronizar orden específica de WooCommerce
router.post('/woocommerce/sync-order/:orderId', requireAuthAPI, async (req, res) => {
  try {
    const Integration = require('../../models/Integration');
    const axios = require('axios');
    const normalize = require('../../services/integrations/normalizers');
    const { upsertOrder } = require('../../services/integrations/upsert');
    
    const integration = await Integration.findOne({ 
      userId: req.userId, 
      platform: 'woocommerce',
      status: 'active'
    });
    
    if (!integration) {
      return res.status(404).json({ error: 'Integración WooCommerce no encontrada' });
    }
    
    const orderId = req.params.orderId;
    const key = integration.getKey('consumerKey');
    const secret = integration.getKey('consumerSecret');
    const base = integration.storeUrl;
    
    console.log(`🔄 Sincronizando orden específica: ${orderId}`);
    
    // Obtener la orden desde WooCommerce
    const { data: raw } = await axios.get(`${base}/wp-json/wc/v3/orders/${orderId}`, {
      auth: { username: key, password: secret },
      timeout: 30000
    });
    
    if (!raw || !raw.id) {
      return res.status(404).json({ error: 'Orden no encontrada en WooCommerce' });
    }
    
    // Normalizar y guardar
    const canonical = normalize.woocommerce(raw);
    if (!canonical) {
      return res.status(400).json({ error: 'La orden no está completada o no es válida' });
    }
    
    const order = await upsertOrder(integration, canonical);
    
    res.json({ 
      ok: true, 
      order: { 
        id: order.externalId, 
        amount: order.amount,
        customer: order.customerName
      } 
    });
    
  } catch (error) {
    console.error('Error sync order:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;