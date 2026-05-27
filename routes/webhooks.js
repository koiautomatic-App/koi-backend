const express = require('express');
const router = express.Router();
const axios = require('axios');
const Integration = require('../models/Integration');
const { upsertOrder } = require('../services/integrations/upsert');
const { getMLToken } = require('../services/integrations/token/ml');
const normalize = require('../services/integrations/normalizers');

const handleWebhook = async (platform, secret, getCanonical) => {
  const integration = await Integration.findOne({ platform: platform, webhookSecret: secret, status: 'active' });
  if (!integration) {
    console.warn('⚠️ Webhook ' + platform + ': secret desconocido');
    return;
  }
  try {
    const canonical = await getCanonical(integration);
    if (canonical) await upsertOrder(integration, canonical);
  } catch(e) {
    console.error('❌ Webhook ' + platform + ':', e.message);
  }
};

// WooCommerce
router.post('/woocommerce/:secret', async (req, res) => {
  res.status(200).send('OK');
  await handleWebhook('woocommerce', req.params.secret, () => normalize.woocommerce(req.body));
});

// Tienda Nube
router.post('/tiendanube/:secret', async (req, res) => {
  res.status(200).send('OK');
  await handleWebhook('tiendanube', req.params.secret, async (integration) => {
    const token = integration.getKey('apiToken');
    const response = await axios.get('https://api.tiendanube.com/v1/' + integration.storeId + '/orders/' + req.body.id, {
      headers: { Authentication: 'bearer ' + token, 'User-Agent': 'KOI-Factura/4.0' }
    });
    return normalize.tiendanube(response.data);
  });
});

// MercadoLibre
router.post('/mercadolibre/:secret', async (req, res) => {
  res.status(200).send('OK');
  const { topic, resource } = req.body;
  if (!['orders_v2', 'orders'].includes(topic)) return;
  
  await handleWebhook('mercadolibre', req.params.secret, async (integration) => {
    const token = await getMLToken(integration);
    const url = resource.startsWith('http') ? resource : 'https://api.mercadolibre.com' + resource;
    const response = await axios.get(url, { headers: { Authorization: 'Bearer ' + token } });
    return normalize.mercadolibre(response.data);
  });
});

// VTEX
router.post('/vtex/:secret', async (req, res) => {
  res.status(200).send('OK');
  await handleWebhook('vtex', req.params.secret, () => normalize.vtex(req.body));
});

// Empretienda
router.post('/empretienda/:secret', async (req, res) => {
  res.status(200).send('OK');
  await handleWebhook('empretienda', req.params.secret, () => normalize.empretienda(req.body));
});

// Rappi
router.post('/rappi/:secret', async (req, res) => {
  res.status(200).send('OK');
  await handleWebhook('rappi', req.params.secret, () => normalize.rappi(req.body));
});

// Shopify
router.post('/shopify/:secret', async (req, res) => {
  res.status(200).send('OK');
  await handleWebhook('shopify', req.params.secret, () => normalize.shopify(req.body));
});

module.exports = router;