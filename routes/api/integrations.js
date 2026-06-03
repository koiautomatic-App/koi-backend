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
// ============================================================
// DIAGNÓSTICO: Verificar credenciales de WooCommerce
// ============================================================
router.get('/woocommerce/check-credentials', requireAuthAPI, async (req, res) => {
  try {
    const Integration = require('../../models/Integration');
    const axios = require('axios');

    const integration = await Integration.findOne({
      userId: req.userId,
      platform: 'woocommerce',
      status: 'active'
    });

    if (!integration) {
      return res.status(404).json({ error: 'Integración no encontrada' });
    }

    const key = integration.getKey('consumerKey');
    const secret = integration.getKey('consumerSecret');
    const base = integration.storeUrl;

    console.log(`🔍 Verificando credenciales para ${base}...`);

    const response = await axios.get(`${base}/wp-json/wc/v3/orders`, {
      auth: { username: key, password: secret },
      params: { per_page: 1 },
      timeout: 10000
    });

    res.json({
      ok: true,
      message: '✅ Credenciales válidas',
      status: response.status,
      storeUrl: base
    });

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
      code: error.response?.status
    });
  }
});
// ============================================================
// ENRIQUECIMIENTO DE ÓRDENES MERCADOLIBRE
// ============================================================

// Enriquecer todas las órdenes pendientes del usuario
router.post('/mercadolibre/enrich-all', requireAuthAPI, async (req, res) => {
  try {
    const { enrichPendingOrders } = require('../../services/integrations/enrich/autoEnrich');
    
    // Responder inmediatamente
    res.json({ 
      ok: true, 
      message: 'Enriquecimiento masivo iniciado en background. Revisa los logs para ver el progreso.' 
    });
    
    // Ejecutar en background
    const result = await enrichPendingOrders(req.userId);
    console.log(`📊 Usuario ${req.userId}: ${result.enriched}/${result.total} órdenes ML enriquecidas`);
    
  } catch (error) {
    console.error('Error en enrich-all:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// Enriquecer una orden específica de MercadoLibre
router.post('/mercadolibre/enrich-order/:orderId', requireAuthAPI, async (req, res) => {
  try {
    const Order = require('../../models/Order');
    const { enrichOrderWithRetry } = require('../../services/integrations/enrich/autoEnrich');
    
    const order = await Order.findOne({
      _id: req.params.orderId,
      userId: req.userId,
      platform: 'mercadolibre'
    });
    
    if (!order) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    
    const success = await enrichOrderWithRetry(order);
    
    const updatedOrder = await Order.findById(order._id);
    
    res.json({
      success,
      order: {
        id: updatedOrder.externalId,
        customerName: updatedOrder.customerName,
        customerDoc: updatedOrder.customerDoc,
        buyerIdentificationNumber: updatedOrder.buyerIdentificationNumber,
        buyerIdentificationType: updatedOrder.buyerIdentificationType,
        orderEnriched: updatedOrder.orderEnriched
      }
    });
    
  } catch (error) {
    console.error('Error en enrich-order:', error);
    res.status(500).json({ error: error.message });
  }
});

// Obtener estadísticas de órdenes pendientes de enriquecer
router.get('/mercadolibre/enrich-stats', requireAuthAPI, async (req, res) => {
  try {
    const Order = require('../../models/Order');
    
    const totalMLOrders = await Order.countDocuments({
      userId: req.userId,
      platform: 'mercadolibre'
    });
    
    const pendingEnrich = await Order.countDocuments({
      userId: req.userId,
      platform: 'mercadolibre',
      $or: [
        { buyerIdentificationNumber: { $in: [null, '', '0'] } },
        { customerDoc: { $in: [null, '', '0'] } },
        { orderEnriched: false },
        { 'settings.needsEnrich': true }
      ]
    });
    
    const enriched = totalMLOrders - pendingEnrich;
    
    res.json({
      ok: true,
      stats: {
        totalMLOrders,
        enriched,
        pendingEnrich,
        percentage: totalMLOrders > 0 ? Math.round((enriched / totalMLOrders) * 100) : 0
      }
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
module.exports = router;