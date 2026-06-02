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

// Endpoint: Sincronizar orden específica de WooCommerce
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
    
    const { data: raw } = await axios.get(`${base}/wp-json/wc/v3/orders/${orderId}`, {
      auth: { username: key, password: secret },
      timeout: 30000
    });
    
    if (!raw || !raw.id) {
      return res.status(404).json({ error: 'Orden no encontrada en WooCommerce' });
    }
    
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
// ============================================================
// SINCRONIZAR TODAS LAS ÓRDENES COMPLETADAS QUE FALTAN
// ============================================================
router.post('/woocommerce/sync-missing-completed', requireAuthAPI, async (req, res) => {
  try {
    const Integration = require('../../models/Integration');
    const Order = require('../../models/Order');
    const axios = require('axios');
    const normalize = require('../../services/integrations/normalizers');
    const { upsertOrder } = require('../../services/integrations/upsert');

    // Buscar la integración de WooCommerce del usuario
    const integration = await Integration.findOne({
      userId: req.userId,
      platform: 'woocommerce',
      status: 'active'
    });

    if (!integration) {
      return res.status(404).json({ error: 'Integración WooCommerce no encontrada' });
    }

    const key = integration.getKey('consumerKey');
    const secret = integration.getKey('consumerSecret');
    const base = integration.storeUrl;

    // Responder inmediatamente
    res.json({ 
      ok: true, 
      message: 'Búsqueda de órdenes pendientes iniciada. Revisa los logs.' 
    });

    // ============================================================
    // 1. Obtener IDs de órdenes ya existentes en KOI
    // ============================================================
    const existingOrders = await Order.find({ 
      userId: req.userId, 
      platform: 'woocommerce' 
    }).select('externalId').lean();
    
    const existingIds = new Set(existingOrders.map(o => o.externalId));
    console.log(`📊 Órdenes existentes en KOI: ${existingIds.size}`);

    // ============================================================
    // 2. Buscar órdenes "completed" en WooCommerce
    // ============================================================
    let page = 1;
    let totalFound = 0;
    let synced = 0;
    const missingOrders = [];

    while (true) {
      try {
        const params = {
          page,
          per_page: 100,
          status: 'completed',
          orderby: 'date',
          order: 'desc'
        };

        console.log(`🔍 Buscando página ${page}...`);

        const { data: orders } = await axios.get(`${base}/wp-json/wc/v3/orders`, {
          auth: { username: key, password: secret },
          params,
          timeout: 30000
        });

        if (!orders || orders.length === 0) break;

        for (const raw of orders) {
          const orderId = String(raw.id);
          totalFound++;
          
          if (!existingIds.has(orderId)) {
            missingOrders.push(raw);
            console.log(`📦 Orden faltante: #${orderId} - ${raw.billing?.first_name} ${raw.billing?.last_name} - $${raw.total}`);
          }
        }

        if (orders.length < 100) break;
        page++;
        await new Promise(r => setTimeout(r, 500));

      } catch (error) {
        console.error(`❌ Error en página ${page}:`, error.message);
        break;
      }
    }

    console.log(`📊 Total órdenes revisadas: ${totalFound}`);
    console.log(`📊 Órdenes faltantes: ${missingOrders.length}`);

    // ============================================================
    // 3. Sincronizar las órdenes faltantes
    // ============================================================
    for (const order of missingOrders) {
      try {
        const canonical = normalize.woocommerce(order);
        if (canonical) {
          await upsertOrder(integration, canonical);
          synced++;
          console.log(`✅ Sincronizada #${order.id} - ${synced}/${missingOrders.length}`);
        }
      } catch (error) {
        console.error(`❌ Error sincronizando #${order.id}:`, error.message);
      }
      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`🎉 Sincronización completada: ${synced} nuevas órdenes agregadas`);

  } catch (error) {
    console.error('❌ Error en sync-missing-completed:', error);
  }
});
module.exports = router;