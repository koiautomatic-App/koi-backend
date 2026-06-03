// services/integrations/enrich/autoEnrich.js
const Order = require('../../../models/Order');
const Integration = require('../../../models/Integration');
const User = require('../../../models/User');
const { getMLToken } = require('../token/ml');
const { enrichMercadoLibreOrder } = require('./mercadolibre');
const { emitirCAE } = require('../../afip/wsfe');

// Configuración de reintentos por tipo de error
const BATCH_CONFIG = {
  'rate_limit': { retry: true, delayMs: 5 * 60 * 1000, maxAttempts: 3 },     // 5 minutos
  'timeout': { retry: true, delayMs: 5 * 60 * 1000, maxAttempts: 3 },          // 5 minutos
  'ml_error': { retry: true, delayMs: 15 * 60 * 1000, maxAttempts: 3 },        // 15 minutos
  'network': { retry: true, delayMs: 10 * 60 * 1000, maxAttempts: 3 },         // 10 minutos
  'token_expired': { retry: false, delayMs: 60 * 60 * 1000, maxAttempts: 3 },  // 1 hora (batch)
  'no_solution': { retry: false, delayMs: 0, maxAttempts: 0 }
};

/**
 * Enriquecer una orden ML y facturar automáticamente
 * - 2 intentos inmediatos (0s y 5s)
 * - Si tiene DNI → factura con DNI real
 * - Si no tiene DNI → Consumidor Final (99999999)
 * - Respeta la lógica existente de getTipoComprobante
 */
const enrichAndProcess = async (order) => {
  const MAX_IMMEDIATE_ATTEMPTS = 2;
  const RETRY_DELAY_MS = 5000; // 5 segundos
  
  let hasDNI = false;
  let finalCustomerDoc = '0';
  let lastError = null;
  
  console.log(`🔍 [ENRICH] Procesando orden ${order.externalId}`);
  
  // Verificar si ya es una orden sin solución
  if (order.settings?.noSolution === true) {
    console.log(`⏭️ [ENRICH] Orden ${order.externalId} ya marcada sin solución, omitiendo`);
    return { hasDNI: false, reason: 'already_no_solution' };
  }
  
  for (let attempt = 1; attempt <= MAX_IMMEDIATE_ATTEMPTS; attempt++) {
    try {
      // Obtener integración de ML
      const integration = await Integration.findOne({
        userId: order.userId,
        platform: 'mercadolibre',
        status: 'active'
      });
      
      if (!integration) {
        console.log(`⚠️ [ENRICH] Orden ${order.externalId}: No hay integración ML`);
        await marcarSinSolucion(order._id, 'no_integration');
        await facturarOrden(order._id);
        return { hasDNI: false, reason: 'no_integration' };
      }
      
      // Obtener token (renovación automática incluida)
      const token = await getMLToken(integration);
      
      // Intentar enriquecer
      await enrichMercadoLibreOrder(order, token);
      
      // Verificar resultado
      const updatedOrder = await Order.findById(order._id);
      const dni = updatedOrder.customerDoc;
      const buyerId = updatedOrder.buyerId;
      
      // Verificar si tiene buyerId (sin buyerId no se puede obtener DNI)
      if (!buyerId || buyerId === '') {
        console.log(`⚠️ [ENRICH] Orden ${order.externalId}: Sin buyerId → Consumidor Final`);
        await marcarSinSolucion(order._id, 'no_buyer_id');
        await facturarOrden(order._id);
        return { hasDNI: false, reason: 'no_buyer_id' };
      }
      
      // Verificar si se obtuvo DNI
      if (dni && dni !== '0' && dni !== '') {
        hasDNI = true;
        finalCustomerDoc = dni;
        console.log(`✅ [ENRICH] Orden ${order.externalId}: DNI obtenido en intento ${attempt}: ${dni}`);
        break;
      }
      
      // Si es el primer intento y no hay DNI, esperar y reintentar
      if (attempt < MAX_IMMEDIATE_ATTEMPTS) {
        console.log(`⏳ [ENRICH] Orden ${order.externalId}: Sin DNI en intento ${attempt}, reintento en ${RETRY_DELAY_MS/1000}s...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      }
      
    } catch (error) {
      lastError = error;
      const errorType = classifyError(error);
      console.error(`❌ [ENRICH] Orden ${order.externalId} - Error en intento ${attempt}: ${errorType} - ${error.message}`);
      
      if (attempt < MAX_IMMEDIATE_ATTEMPTS) {
        console.log(`⏳ [ENRICH] Reintentando en ${RETRY_DELAY_MS/1000}s...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }
  
  // Si no hay DNI después de los intentos inmediatos
  if (!hasDNI) {
    // Verificar si el error es recuperable (rate_limit, timeout, etc.)
    if (lastError) {
      const errorType = classifyError(lastError);
      const config = BATCH_CONFIG[errorType] || BATCH_CONFIG.network;
      
      if (config.retry) {
        console.log(`📦 [ENRICH] Orden ${order.externalId}: Error recuperable (${errorType}) → programando reintento en batch`);
        await marcarParaBatchReintento(order._id, errorType);
        return { hasDNI: false, reason: 'scheduled_for_batch', errorType };
      }
    }
    
    // Si no es recuperable o no hay error, Consumidor Final
    finalCustomerDoc = '99999999';
    console.log(`📝 [ENRICH] Orden ${order.externalId}: Sin DNI → Consumidor Final`);
    
    await Order.findByIdAndUpdate(order._id, {
      $set: {
        customerDoc: finalCustomerDoc,
        taxCondition: 'consumidor_final',
        'settings.sinDNI': true,
        'settings.noSolution': true,
        'settings.noSolutionReason': 'no_dni_after_attempts',
        'settings.enrichStatus': 'consumer_final'
      }
    });
  }
  
  // Facturar automáticamente (solo si tiene DNI o ya es Consumidor Final)
  if (hasDNI || finalCustomerDoc === '99999999') {
    await facturarOrden(order._id);
  }
  
  return { hasDNI, finalCustomerDoc, reason: hasDNI ? 'success' : 'consumer_final' };
};

/**
 * Clasificar el tipo de error
 */
const classifyError = (error) => {
  const message = error.message?.toLowerCase() || '';
  const status = error.response?.status;
  
  if (status === 429 || message.includes('rate') || message.includes('too many')) {
    return 'rate_limit';
  }
  if (status === 500 || status === 502 || status === 503 || message.includes('internal server')) {
    return 'ml_error';
  }
  if (message.includes('timeout') || message.includes('etimedout')) {
    return 'timeout';
  }
  if (message.includes('network') || message.includes('enotfound') || message.includes('econnrefused')) {
    return 'network';
  }
  if (status === 401 || message.includes('token') || message.includes('unauthorized')) {
    return 'token_expired';
  }
  return 'unknown';
};

/**
 * Marcar orden para reintento programado (batch) según el tipo de error
 */
const marcarParaBatchReintento = async (orderId, errorType) => {
  const config = BATCH_CONFIG[errorType] || BATCH_CONFIG.network;
  const retryAt = new Date(Date.now() + config.delayMs);
  
  console.log(`📦 [BATCH] Orden ${orderId}: programada para reintento en ${config.delayMs/1000/60} minutos (${errorType})`);
  
  await Order.findByIdAndUpdate(orderId, {
    $set: {
      'settings.needsBatch': true,
      'settings.batchError': errorType,
      'settings.batchRetryAt': retryAt,
      'settings.batchAttempts': 0,
      'settings.enrichStatus': 'scheduled_for_batch'
      // NOTA: NO modificamos orderEnriched aquí, se mantiene el valor original
    }
  });
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
      console.log(`✅ [ENRICH] Factura emitida: ${result.nroFormatted} - CAE: ${result.cae}`);
      return result;
    } catch (error) {
      console.error(`❌ [ENRICH] Error al facturar orden ${order.externalId}:`, error.message);
    }
  } else {
    console.log(`⏸️ [ENRICH] Facturación automática desactivada para orden ${order.externalId}`);
  }
};

/**
 * Procesar órdenes pendientes en batch
 */
const processPendingOrders = async (userId = null, limit = 30) => {
  const now = new Date();
  
  // 🔥 IMPORTANTE: Buscar órdenes sin DNI (independientemente de orderEnriched)
  // El enriquecimiento puede tener datos de envío (shipping) pero no DNI
  const query = {
    platform: 'mercadolibre',
    status: 'pending_invoice',
    'settings.noSolution': { $ne: true },
    $or: [
      // Sin DNI (prioritario)
      { customerDoc: { $in: [null, '', '0'] } },
      { buyerIdentificationNumber: { $in: [null, '', '0'] } },
      // Errores recuperables
      { 'settings.needsBatch': true },
      { 'settings.needsReconnect': true }
    ]
  };
  
  if (userId) query.userId = userId;
  
  const orders = await Order.find(query).limit(limit);
  
  // Filtrar órdenes listas para reintentar (según batchRetryAt)
  const readyOrders = orders.filter(order => {
    if (order.settings?.batchRetryAt) {
      return new Date(order.settings.batchRetryAt) <= now;
    }
    return true;
  });
  
  console.log(`📊 [BATCH] Procesando ${readyOrders.length} órdenes recuperables (de ${orders.length} encontradas)`);
  console.log(`   - Buscando órdenes sin DNI (aunque tengan orderEnriched=true)`);
  
  let results = {
    total: readyOrders.length,
    recovered: 0,
    consumerFinal: 0,
    scheduled: 0,
    errors: 0,
    byError: {}
  };
  
  for (const order of readyOrders) {
    const errorType = order.settings?.batchError || 'unknown';
    const tieneDNI = order.customerDoc && order.customerDoc !== '0' && order.customerDoc !== '';
    
    console.log(`📋 Orden ${order.externalId}: customerDoc="${order.customerDoc}", orderEnriched=${order.orderEnriched}`);
    
    try {
      const result = await enrichAndProcess(order);
      
      if (result.hasDNI) {
        results.recovered++;
        results.byError[errorType] = (results.byError[errorType] || 0) + 1;
        console.log(`✅ [BATCH] Orden ${order.externalId} recuperada con DNI: ${result.finalCustomerDoc}`);
      } else if (result.reason === 'consumer_final') {
        results.consumerFinal++;
        console.log(`📝 [BATCH] Orden ${order.externalId} → Consumidor Final`);
      } else if (result.reason === 'scheduled_for_batch') {
        results.scheduled++;
        console.log(`⏳ [BATCH] Orden ${order.externalId} reprogramada para batch (${result.errorType})`);
      } else {
        results.errors++;
      }
      
    } catch (error) {
      results.errors++;
      console.error(`❌ [BATCH] Error procesando orden ${order.externalId}:`, error.message);
      
      // Incrementar contador de intentos
      const attempts = (order.settings?.batchAttempts || 0) + 1;
      const config = BATCH_CONFIG[errorType] || BATCH_CONFIG.network;
      
      if (attempts < (config.maxAttempts || 3)) {
        const retryAt = new Date(Date.now() + config.delayMs);
        await Order.findByIdAndUpdate(order._id, {
          $set: {
            'settings.batchAttempts': attempts,
            'settings.batchRetryAt': retryAt,
            'settings.batchError': errorType
          }
        });
        console.log(`⏳ [BATCH] Orden ${order.externalId}: reintento programado en ${config.delayMs/1000/60} minutos (intento ${attempts}/${config.maxAttempts})`);
      } else {
        await marcarSinSolucion(order._id, `max_attempts_${errorType}`);
        console.log(`❌ [BATCH] Orden ${order.externalId}: superó intentos máximos → Consumidor Final`);
      }
    }
    
    // Pausa entre órdenes
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log(`📊 [BATCH] Resultados: ${results.recovered} recuperadas, ${results.consumerFinal} consumidor final, ${results.scheduled} reprogramadas, ${results.errors} errores`);
  
  return results;
};

/**
 * Iniciar auto-enriquecimiento programado
 */
const startAutoEnrich = (intervalMs = 5 * 60 * 1000) => {
  console.log(`🕐 [BATCH] Auto-enriquecimiento programado cada ${intervalMs / 1000 / 60} minutos`);
  console.log(`   Configuración de reintentos:`);
  console.log(`   - Rate limiting: cada 5 minutos`);
  console.log(`   - Timeout: cada 5 minutos`);
  console.log(`   - Error ML: cada 15 minutos`);
  console.log(`   - Network: cada 10 minutos`);
  console.log(`   - Token expirado: cada 1 hora`);
  console.log(`   - Máximo 3 intentos por orden`);
  console.log(`   - Busca órdenes sin DNI (independientemente de orderEnriched)`);
  
  // Ejecutar inmediatamente al inicio
  setTimeout(() => {
    processPendingOrders().catch(e => console.error('Error en batch inicial:', e));
  }, 10000);
  
  // Luego cada intervalo
  setInterval(async () => {
    try {
      await processPendingOrders();
    } catch (error) {
      console.error('❌ [BATCH] Error en auto-enriquecimiento:', error);
    }
  }, intervalMs);
};

module.exports = {
  enrichAndProcess,
  processPendingOrders,
  startAutoEnrich,
  facturarOrden,
  marcarSinSolucion,
  classifyError
};