const axios = require('axios');
const { upsertOrder } = require('../upsert');
const { getMLToken } = require('../token/ml');
const { enrichMercadoLibreOrder } = require('../enrich/mercadolibre');
const normalize = require('../normalizers');

const BULK_SYNC = {
  async woocommerce(integration) {
    const key = integration.getKey('consumerKey');
    const secret = integration.getKey('consumerSecret');
    const base = integration.storeUrl;
    let page = 1, total = 0;
    
    const params = {
      per_page: 100,
      page: page,
      status: 'completed',
      orderby: 'date',
      order: 'desc'
    };
    
    if (integration.lastSyncAt) {
      params.after = integration.lastSyncAt.toISOString();
      console.log('📅 Sincronizando órdenes después de: ' + params.after);
    }
    
    while (true) {
      try {
        const response = await axios.get(base + '/wp-json/wc/v3/orders', {
          auth: { username: key, password: secret },
          params: params,
          timeout: 30000
        });
        
        const data = response.data;
        if (!data || !data.length) break;
        
        for (var i = 0; i < data.length; i++) {
          const raw = data[i];
          try {
            await upsertOrder(integration, normalize.woocommerce(raw));
            total++;
          } catch(e) {
            console.error('Error procesando orden ' + raw.id + ':', e.message);
          }
        }
        
        if (data.length < 100) break;
        page++;
        params.page = page;
      } catch(e) {
        console.error('Error en página ' + page + ':', e.message);
        break;
      }
    }
    
    console.log('✅ WooCommerce sync: ' + total + ' órdenes procesadas');
    return total;
  },

  async tiendanube(integration) {
    const token = integration.getKey('apiToken');
    const storeId = integration.storeId;
    let page = 1, total = 0;
    
    while (true) {
      const response = await axios.get('https://api.tiendanube.com/v1/' + storeId + '/orders', {
        headers: { Authentication: 'bearer ' + token, 'User-Agent': 'KOI-Factura/4.0' },
        params: { per_page: 200, page: page, payment_status: 'paid' },
        timeout: 30000
      });
      
      const data = response.data;
      if (!data || !data.length) break;
      
      for (var i = 0; i < data.length; i++) {
        await upsertOrder(integration, normalize.tiendanube(data[i]));
      }
      total += data.length;
      if (data.length < 200) break;
      page++;
    }
    return total;
  },

  async mercadolibre(integration) {
    const accessToken = await getMLToken(integration);
    const sellerId = integration.credentials.sellerId;
    let offset = 0, total = 0;
    const LIMIT = 50;
    
    while (true) {
      const response = await axios.get('https://api.mercadolibre.com/orders/search', {
        headers: { Authorization: 'Bearer ' + accessToken },
        params: { seller: sellerId, limit: LIMIT, offset: offset, sort: 'date_desc' },
        timeout: 30000
      });
      
      const orders = response.data.results || [];
      if (!orders.length) break;
      
      for (var i = 0; i < orders.length; i++) {
        const raw = orders[i];
        let fullOrder = raw;
        try {
          const orderDetail = await axios.get('https://api.mercadolibre.com/orders/' + raw.id, {
            headers: { Authorization: 'Bearer ' + accessToken }
          });
          fullOrder = orderDetail.data;
          await new Promise(function(r) { setTimeout(r, 100); });
        } catch(e) {
          console.error('Error obteniendo detalle de orden ' + raw.id + ':', e.message);
        }
        
        const canonical = normalize.mercadolibre(fullOrder);
        const result = await upsertOrder(integration, canonical);
        
        if (result && (canonical.buyerId || canonical.shipmentId)) {
          await new Promise(function(r) { setTimeout(r, 200); });
          await enrichMercadoLibreOrder(result, accessToken);
        }
      }
      total += orders.length;
      offset += LIMIT;
      if (offset >= (response.data.paging?.total || 0)) break;
    }
    return total;
  },

  async vtex(integration) {
    const apiKey = integration.getKey('apiKey');
    const apiToken = integration.getKey('apiToken');
    const storeUrl = integration.storeUrl;
    let page = 1, total = 0;
    
    while (true) {
      const response = await axios.get(storeUrl + '/api/oms/pvt/orders', {
        headers: { 'X-VTEX-API-AppKey': apiKey, 'X-VTEX-API-AppToken': apiToken },
        params: { page: page, per_page: 100, f_status: 'invoiced,payment-approved' },
        timeout: 30000
      });
      
      const orders = response.data.list || [];
      if (!orders.length) break;
      
      for (var i = 0; i < orders.length; i++) {
        await upsertOrder(integration, normalize.vtex(orders[i]));
      }
      total += orders.length;
      if (orders.length < 100) break;
      page++;
    }
    return total;
  }
};

const startBackgroundSync = function(integration) {
  var syncFn = BULK_SYNC[integration.platform];
  if (!syncFn) return;
  console.log('🔄 Iniciando sync histórico: ' + integration.platform + ' | ' + integration.storeId);
  syncFn(integration)
    .then(function(count) {
      console.log('✅ Sync completo: ' + integration.platform + ' → ' + count + ' órdenes');
      const Integration = require('../../../models/Integration');
      return Integration.findByIdAndUpdate(integration._id, { lastSyncAt: new Date(), errorLog: '' });
    })
    .catch(async function(err) {
      console.error('❌ Sync error [' + integration.platform + ']:', err.message);
      const Integration = require('../../../models/Integration');
      await Integration.findByIdAndUpdate(integration._id, { errorLog: err.message });
    });
};

module.exports = { BULK_SYNC, startBackgroundSync };