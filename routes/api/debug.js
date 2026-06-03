// routes/api/debug.js
const express = require('express');
const router = express.Router();
const { requireAuthAPI } = require('../../middleware/auth');
const Integration = require('../../models/Integration');
const { getMLToken } = require('../../services/integrations/token/ml');
const axios = require('axios');

// ============================================================
// DIAGNÓSTICO MERCADOLIBRE
// ============================================================

// 1. Obtener datos básicos de una orden ML
router.get('/ml-order/:id', requireAuthAPI, async (req, res) => {
  try {
    const integration = await Integration.findOne({ 
      userId: req.userId, 
      platform: 'mercadolibre',
      status: 'active'
    });
    
    if (!integration) {
      return res.status(404).json({ error: 'No hay integración con MercadoLibre' });
    }

    const token = await getMLToken(integration);
    const { data } = await axios.get(`https://api.mercadolibre.com/orders/${req.params.id}`, {
      headers: { Authorization: `Bearer ${token}`, 'x-format-new': 'true' }
    });

    res.json({
      id: data.id,
      status: data.status,
      total_amount: data.total_amount,
      buyer_id: data.buyer?.id,
      shipping_id: data.shipping?.id,
      items: data.order_items?.map(i => ({
        nombre: i.item?.title,
        cantidad: i.quantity,
        precio: i.unit_price
      }))
    });
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// 2. Obtener datos fiscales del comprador (DNI, nombre, domicilio)
router.get('/ml-order-billing-info/:orderId', requireAuthAPI, async (req, res) => {
  try {
    const integration = await Integration.findOne({ 
      userId: req.userId, 
      platform: 'mercadolibre',
      status: 'active'
    });
    
    if (!integration) {
      return res.status(404).json({ error: 'No hay integración con MercadoLibre' });
    }

    const token = await getMLToken(integration);
    const { data } = await axios.get(`https://api.mercadolibre.com/orders/${req.params.orderId}/billing_info`, {
      headers: { Authorization: `Bearer ${token}`, 'x-format-new': 'true' }
    });

    const additional = (data.billing_info?.additional_info || []).reduce((acc, item) => {
      acc[item.type] = item.value;
      return acc;
    }, {});

    res.json({
      doc_type: data.billing_info?.doc_type,
      doc_number: data.billing_info?.doc_number,
      nombre: `${additional.FIRST_NAME || ''} ${additional.LAST_NAME || ''}`.trim(),
      condicion_fiscal: additional.TAXPAYER_TYPE_ID || additional.TAX_TYPE,
      domicilio: {
        calle: additional.STREET_NAME,
        ciudad: additional.CITY_NAME,
        provincia: additional.STATE_NAME,
        codigo_postal: additional.ZIP_CODE
      }
    });
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// 3. Obtener tipo de envío (fulfillment, self_service, etc.)
router.get('/ml-shipment/:shipmentId', requireAuthAPI, async (req, res) => {
  try {
    const integration = await Integration.findOne({ 
      userId: req.userId, 
      platform: 'mercadolibre',
      status: 'active'
    });
    
    if (!integration) {
      return res.status(404).json({ error: 'No hay integración con MercadoLibre' });
    }

    const token = await getMLToken(integration);
    const { data } = await axios.get(`https://api.mercadolibre.com/shipments/${req.params.shipmentId}`, {
      headers: { Authorization: `Bearer ${token}`, 'x-format-new': 'true' }
    });

    const logisticType = data.logistic?.type;
    const incluirEnvio = logisticType === 'self_service';

    res.json({
      tipo: logisticType,
      incluir_en_factura: incluirEnvio,
      estado: data.status
    });
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});
// 4. Obtener datos del comprador por ID (DNI, nombre, etc.)
router.get('/ml-user/:userId', requireAuthAPI, async (req, res) => {
  try {
    const Integration = require('../../models/Integration');
    const { getMLToken } = require('../../services/integrations/token/ml');
    const axios = require('axios');
    
    const integration = await Integration.findOne({ 
      userId: req.userId, 
      platform: 'mercadolibre',
      status: 'active'
    });
    
    if (!integration) {
      return res.status(404).json({ error: 'No hay integración con MercadoLibre' });
    }
    
    const token = await getMLToken(integration);
    const { data } = await axios.get(`https://api.mercadolibre.com/users/${req.params.userId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    res.json({
      id: data.id,
      nickname: data.nickname,
      first_name: data.first_name,
      last_name: data.last_name,
      email: data.email,
      identification: data.identification || { type: null, number: null }
    });
    
  } catch (error) {
    console.error('Error en ml-user:', error.message);
    res.status(error.response?.status || 500).json({ 
      error: error.message,
      details: error.response?.data
    });
  }
});

module.exports = router;