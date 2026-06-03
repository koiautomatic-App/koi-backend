// services/integrations/enrich/autoEnrich.js
const Order = require('../../../models/Order');
const Integration = require('../../../models/Integration');
const User = require('../../../models/User');
const { getMLToken } = require('../token/ml');
const { enrichMercadoLibreOrder } = require('./mercadolibre');
const { emitirCAE } = require('../../afip/wsfe');

/**
 * Enriquecer una orden ML y facturar automáticamente
 * - 2 intentos máximos (0s y 5s)
 * - Si no tiene buyerId → Consumidor Final inmediato
 * - Si no tiene DNI después de 2 intentos → Consumidor Final
 * - Respeta la lógica existente de getTipoComprobante
 */
const enrichAndProcess = async (order) => {
  const MAX_ATTEMPTS = 2;
  const RETRY_DELAY_MS = 5000; // 5 segundos entre intentos
  
  let hasDNI = false;
  let finalCustomerDoc = '0';
  
  console.log(`🔍 [ENRICH] Procesando orden ${order.externalId}`);
  
  // Verificación rápida: ¿Ya es una orden sin solución?
  if (order.settings?.noSolution === true) {
    console.log(`⏭️ [ENRICH] Orden ${order.externalId} ya marcada sin solución (${order.settings?.noSolutionReason}), omitiendo`);
    return { hasDNI: false, finalCustomerDoc: order.customerDoc, reason: 'already_no_solution' };
  }
  
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // 1. Obtener integración de ML
      const integration = await Integration.findOne({
        userId: order.userId,
        platform: 'mercadolibre',
        status: 'active'
      });
      
      if (!integration) {
        console.log(`⚠️ [ENRICH] Orden ${order.externalId}: No hay integración ML`);
        await marcarSinSolucion(order._id, 'no_integration');
        return { hasDNI: false, finalCustomerDoc: '99999999', reason: 'no_integration' };
      }
      
      // 2. Obtener token (renovación automática incluida)
      const token = await getMLToken(integration);
      
      // 3. Intentar enriquecer
      await enrichMercadoLibreOrder(order, token);
      
      // 4. Verificar resultado
      const updatedOrder = await Order.findById(order._id);
      const dni = updatedOrder.customerDoc;
      const buyerId = updatedOrder.buyerId;
      
      // 🔥 MEJORA #2: Si no tiene buyerId, nunca se podrá enriquecer
      if (!buyerId || buyerId === '') {
        console.log(`⚠️ [ENRICH] Orden ${order.externalId}: Sin buyerId → Consumidor Final inmediato`);
        await marcarSinSolucion(order._id, 'no_buyer_id');
        await facturarOrden(order._id);
        return { hasDNI: false, finalCustomerDoc: '99999999', reason: 'no_buyer_id' };
      }
      
      // Verificar si se obtuvo DNI
      if (dni && dni !== '0' && dni !== '') {
        hasDNI = true;
        finalCustomerDoc = dni;
        console.log(`✅ [ENRICH] Orden ${order.externalId}: DNI obtenido en intento ${attempt} (${dni})`);
        break;
      }
      
      // Si es el primer intento y no hay DNI, esperar y reintentar
      if (attempt < MAX_ATTEMPTS) {
        console.log(`⏳ [ENRICH] Orden ${order.externalId}: Sin DNI en intento ${attempt}, reintento en ${RETRY_DELAY_MS/1000}s...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      }
      
    } catch (error) {
      console.error(`❌ [ENRICH] Orden ${order.externalId} - Error en intento ${attempt}:`, error.message);
      
      // Si es error de autenticación persistente
      if (error.message.includes('401') || error.message.includes('unauthorized')) {
        console.log(`⚠️ [ENRICH] Orden ${order.externalId}: Error de autenticación → requiere reconexión`);
        await marcarParaReconexion(order._id);
        return { hasDNI: false, finalCustomerDoc: '0', reason: 'auth_error' };
      }
      
      if (attempt < MAX_ATTEMPTS) {
        console.log(`⏳ [ENRICH] Reintentando en ${RETRY_DELAY_MS/1000}s...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }
  
  // 🔥 MEJORA #1: Si no hay DNI después de 2 intentos, Consumidor Final
  if (!hasDNI) {
    finalCustomerDoc = '99999999';
    console.log(`📝 [ENRICH] Orden ${order.externalId}: Sin DNI después de ${MAX_ATTEMPTS} intentos → Consumidor Final`);
    
    await Order.findByIdAndUpdate(order._id, {
      $set: {
        customerDoc: finalCustomerDoc,
        taxCondition: 'consumidor_final',
        'settings.sinDNI': true,
        'settings.enrichStatus': 'consumer_final',
        'settings.noSolution': true,
        'settings.noSolutionReason': 'no_dni_after_attempts'
      }
    });
  }
  
  // Facturar automáticamente
  await facturarOrden(order._id);
  
  return { hasDNI, finalCustomerDoc, reason: hasDNI ? 'success' : 'consumer_final' };
};

/**
 * Marcar orden como sin solución (Consumidor Final)
 */
const marcarSinSolucion = async (orderId, reason) => {
  await Order.findByIdAndUpdate(orderId, {
    $set: {
      customerDoc: '99999999',
      taxCondition: 'consumidor_final',
      'settings.sinDNI': true,
      'settings.noSolution': true,
      'settings.noSolutionReason': reason,
      'settings.enrichStatus': 'consumer_final'
    }
  });
};

/**
 * Marcar orden para reconexión manual
 */
const marcarParaReconexion = async (orderId) => {
  await Order.findByIdAndUpdate(orderId, {
    $set: {
      'settings.needsReconnect': true,
      'settings.enrichStatus': 'needs_reconnect',
      'settings.enrichAttempts': 0
    }
  });
};

/**
 * Facturar orden automáticamente
 */
const facturarOrden = async (orderId) => {
  const order = await Order.findById(orderId);
  if (!order) return;
  
  const user = await User.findById(order.userId).select('settings').lean();
  
  if (user?.settings?.factAuto && user?.settings?.cuit) {
    console.log(`📤 [ENRICH] Facturando orden ${order.externalId}...`);
    try {
      const result = await emitirCAE(orderId, user);
      console.log(`✅ [ENRICH] Factura emitida: ${result.nroFormatted} - ${result.cae}`);
      return result;
    } catch (error) {
      console.error(`❌ [ENRICH] Error al facturar orden ${order.externalId}:`, error.message);
    }
  } else {
    console.log(`⏸️ [ENRICH] Facturación automática desactivada para orden ${order.externalId}`);
  }
};

/**
 * Procesar órdenes pendientes (batch)
 */
const processPendingOrders = async (userId = null, limit = 20) => {
  const query = {
    platform: 'mercadolibre',
    status: 'pending_invoice',
    $or: [
      { customerDoc: { $in: [null, '', '0'] } },
      { 'settings.needsReconnect': true }
    ],
    'settings.noSolution': { $ne: true }
  };
  
  if (userId) query.userId = userId;
  
  const orders = await Order.find(query)
    .limit(limit)
    .sort({ createdAt: -1 });
  
  console.log(`📊 [ENRICH] Batch procesando ${orders.length} órdenes recuperables`);
  
  let results = {
    total: orders.length,
    success: 0,
    consumerFinal: 0,
    errors: 0
  };
  
  for (const order of orders) {
    try {
      const result = await enrichAndProcess(order);
      if (result.hasDNI) {
        results.success++;
      } else if (result.reason === 'consumer_final') {
        results.consumerFinal++;
      }
    } catch (error) {
      results.errors++;
      console.error(`❌ [ENRICH] Error procesando orden ${order.externalId}:`, error.message);
    }
    
    // Pausa entre órdenes
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log(`📊 [ENRICH] Resultados: ${results.success} con DNI, ${results.consumerFinal} Consumidor Final, ${results.errors} errores`);
  
  return results;
};

/**
 * Iniciar auto-enriquecimiento programado
 */
const startAutoEnrich = (intervalMs = 60 * 60 * 1000) => {
  console.log(`🕐 [ENRICH] Auto-enriquecimiento programado cada ${intervalMs / 1000 / 60} minutos`);
  
  // Ejecutar inmediatamente al inicio
  setTimeout(() => {
    processPendingOrders().catch(e => console.error('Error en auto-enrich inicial:', e));
  }, 10000);
  
  // Luego cada intervalo
  setInterval(async () => {
    try {
      await processPendingOrders();
    } catch (error) {
      console.error('❌ [ENRICH] Error en auto-enriquecimiento:', error);
    }
  }, intervalMs);
};

module.exports = {
  enrichAndProcess,
  processPendingOrders,
  startAutoEnrich,
  facturarOrden,
  marcarSinSolucion
};