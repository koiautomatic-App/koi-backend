const axios = require('axios');
const config = require('../../../config');

const registerWebhookWoo = async (integration, key, secret, storeUrl) => {
  const wh = config.BASE_URL + '/webhook/woocommerce/' + integration.webhookSecret;
  try {
    const existing = await axios.get(storeUrl + '/wp-json/wc/v3/webhooks', {
      auth: { username: key, password: secret },
      params: { per_page: 100 }
    });
    
    if (existing.data && existing.data.some(function(w) { return w.delivery_url === wh; })) {
      return;
    }
    
    await axios.post(storeUrl + '/wp-json/wc/v3/webhooks', {
      name: 'KOI-Factura',
      topic: 'order.created',
      delivery_url: wh,
      status: 'active'
    }, {
      auth: { username: key, password: secret }
    });
    console.log('🔌 WooCommerce webhook registrado: ' + storeUrl);
  } catch(e) {
    console.warn('WooCommerce webhook error:', e.message);
  }
};

const registerWebhookTiendaNube = async (integration, apiToken) => {
  const wh = config.BASE_URL + '/webhook/tiendanube/' + integration.webhookSecret;
  await axios.post('https://api.tiendanube.com/v1/' + integration.storeId + '/webhooks', {
    event: 'order/paid',
    url: wh
  }, {
    headers: { Authentication: 'bearer ' + apiToken, 'User-Agent': 'KOI-Factura/4.0' }
  });
  console.log('🔌 TiendaNube webhook registrado');
};

module.exports = { registerWebhookWoo, registerWebhookTiendaNube };