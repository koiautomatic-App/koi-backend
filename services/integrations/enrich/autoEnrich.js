// services/integrations/enrich/autoEnrich.js
const Order = require('../../../models/Order');
const Integration = require('../../../models/Integration');
const { getMLToken } = require('../token/ml');
const { enrichMercadoLibreOrder } = require('./mercadolibre');

/**
 * Enriquecer una orden específica con reintentos
 * @param {Object} order - Orden de MongoDB
 * @param {number} maxRetries - Máximo de reintentos (default: 3)
 * @returns {Promise<boolean>} - true si se enriqueció, false si no
 */
const enrichOrderWithRetry = async (order, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 [ENRICH] Intento ${attempt}/${maxRetries} para orden ${order.externalId}`);
      
      const integration = await Integration.findOne({
        userId: order.userId,
        platform: 'mercadolibre',
        status: 'active'
      });
      
      if (!integration) {
        console.log(`⚠️ [ENRICH] No hay integración ML para usuario ${order.userId}`);
        return false;
      }
      
      const token = await getMLToken(integration);
      const updated = await enrichMercadoLibreOrder(order, token);
      
      if (updated) {
        console.log(`✅ [ENRICH] Orden ${order.externalId} enriquecida en intento ${attempt}`);
        return true;
      }
      
      console.log(`⚠️ [ENRICH] Intento ${attempt} falló para orden ${order.externalId}`);
      
      // Espera progresiva: 1s, 2s, 3s
      await new Promise(r => setTimeout(r, 1000 * attempt));
      
    } catch (error) {
      console.error(`❌ [ENRICH] Error en intento ${attempt} para orden ${order.externalId}:`, error.message);
      
      if (attempt === maxRetries) {
        // Marcar para reintentar después
        await Order.findByIdAndUpdate(order._id, {
          $set: {
            'settings.needsEnrich': true,
            'settings.enrichAttempts': attempt,
            'settings.enrichError': error.message
          }
        });
      }
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  return false;
};

/**
 * Enriquecer órdenes pendientes (batch processing)
 * @param {string|null} userId - ID de usuario específico (opcional)
 * @param {number} limit - Máximo de órdenes a procesar
 * @returns {Promise<{enriched: number, total: number}>}
 */
const enrichPendingOrders = async (userId = null, limit = 100) => {
  const query = {
    platform: 'mercadolibre',
    $or: [
      { buyerIdentificationNumber: { $in: [null, '', '0'] } },
      { customerDoc: { $in: [null, '', '0'] } },
      { orderEnriched: false },
      { 'settings.needsEnrich': true }
    ]
  };
  
  if (userId) {
    query.userId = userId;
  }
  
  const orders = await Order.find(query)
    .limit(limit)
    .sort({ createdAt: -1 });
  
  console.log(`📊 [ENRICH] Encontradas ${orders.length} órdenes para enriquecer`);
  
  let enriched = 0;
  let errors = 0;
  
  for (const order of orders) {
    try {
      const success = await enrichOrderWithRetry(order);
      if (success) {
        enriched++;
      } else {
        errors++;
      }
    } catch (error) {
      errors++;
      console.error(`❌ [ENRICH] Error procesando orden ${order.externalId}:`, error.message);
    }
    
    // Pausa entre órdenes para no saturar la API
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log(`✅ [ENRICH] Completado: ${enriched} enriquecidas, ${errors} errores, ${orders.length} total`);
  return { enriched, errors, total: orders.length };
};

/**
 * Programar enriquecimiento automático periódico
 * @param {number} intervalMs - Intervalo en milisegundos (default: 1 hora)
 */
const startAutoEnrich = (intervalMs = 60 * 60 * 1000) => {
  console.log(`🕐 [ENRICH] Auto-enriquecimiento programado cada ${intervalMs / 1000 / 60} minutos`);
  
  setInterval(async () => {
    console.log('🔄 [ENRICH] Ejecutando auto-enriquecimiento...');
    try {
      await enrichPendingOrders();
    } catch (error) {
      console.error('❌ [ENRICH] Error en auto-enriquecimiento:', error);
    }
  }, intervalMs);
};

module.exports = {
  enrichOrderWithRetry,
  enrichPendingOrders,
  startAutoEnrich
};