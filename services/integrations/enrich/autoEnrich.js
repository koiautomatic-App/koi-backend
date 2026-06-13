// services/integrations/enrich/autoEnrich.js
const Order = require('../../../models/Order');
const Integration = require('../../../models/Integration');
const User = require('../../../models/User');
const { getMLToken } = require('../token/ml');
const { enrichMercadoLibreOrder } = require('./mercadolibre');
const { emitirCAE } = require('../../afip/wsfe');

// Configuración de reintentos por tipo de error
const BATCH_CONFIG = {
  'rate_limit': { retry: true, delayMs: 5 * 60 * 1000, maxAttempts: 3 },
  'timeout': { retry: true, delayMs: 5 * 60 * 1000, maxAttempts: 3 },
  'ml_error': { retry: true, delayMs: 15 * 60 * 1000, maxAttempts: 3 },
  'network': { retry: true, delayMs: 10 * 60 * 1000, maxAttempts: 3 },
  'token_expired': { retry: false, delayMs: 60 * 60 * 1000, maxAttempts: 3 },
  'no_solution': { retry: false, delayMs: 0, maxAttempts: 0 }
};

/**
 * Enriquecer una orden ML y facturar automáticamente
 */
const enrichAndProcess = async (order) => {
  const MAX_IMMEDIATE_ATTEMPTS = 2;
  const RETRY_DELAY_MS = 5000;
  
  let hasDNI = false;
  let finalCustomerDoc = '0';
  let lastError = null;
  
  console.log(`🔍 [ENRICH] Procesando orden ${order.externalId}`);
  
  if (order.settings?.noSolution === true) {
    console.log(`⏭️ [ENRICH] Orden ${order.externalId} ya marcada sin solución, omitiendo`);
    return { hasDNI: false, reason: 'already_no_solution' };
  }
  
  for (let attempt = 1; attempt <= MAX_IMMEDIATE_ATTEMPTS; attempt++) {
    try {
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
      
      const token = await getMLToken(integration);
      await enrichMercadoLibreOrder(order, token);
      
      const updatedOrder = await Order.findById(order._id);
      const dni = updatedOrder.customerDoc;
      const buyerId = updatedOrder.buyerId;
      
      if (!buyerId || buyerId === '') {
        console.log(`⚠️ [ENRICH] Orden ${order.externalId}: Sin buyerId → Consumidor Final`);
        await marcarSinSolucion(order._id, 'no_buyer_id');
        await facturarOrden(order._id);
        return { hasDNI: false, reason: 'no_buyer_id' };
      }
      
      if (dni && dni !== '0' && dni !== '') {
        hasDNI = true;
        finalCustomerDoc = dni;
        console.log(`✅ [ENRICH] Orden ${order.externalId}: DNI obtenido en intento ${attempt}: ${dni}`);
        break;
      }
      
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
  
  if (!hasDNI) {
    if (lastError) {
      const errorType = classifyError(lastError);
      const config = BATCH_CONFIG[errorType] || BATCH_CONFIG.network;
      
      if (config.retry) {
        console.log(`📦 [ENRICH] Orden ${order.externalId}: Error recuperable (${errorType}) → programando reintento en batch`);
        await marcarParaBatchReintento(order._id, errorType);
        return { hasDNI: false, reason: 'scheduled_for_batch', errorType };
      }
    }
    
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
 * Facturar orden automáticamente y generar PDF
 */
const facturarOrden = async (orderId) => {
  const order = await Order.findById(orderId);
  if (!order) return;
  
  const user = await User.findById(order.userId).select('settings').lean();
  
  if (user?.settings?.factAuto && user?.settings?.cuit) {
    console.log(`📤 [ENRICH] Facturando orden ${order.externalId}...`);
    try {
      // 1. Emitir CAE
      const result = await emitirCAE(orderId, user);
      console.log(`✅ [ENRICH] Factura emitida: ${result.nroFormatted} - CAE: ${result.cae}`);
      
      // 2. Generar PDF automáticamente
      const { generateInvoicePDF } = require('../../pdf/invoice');
      const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
      
      console.log(`📄 [ENRICH] Generando PDF para orden ${order.externalId}...`);
      const pdfBuffer = await generateInvoicePDF(order.userId, order);
      
      const key = `facturas/${order.externalId}-${result.nroFormatted}.pdf`;
      
      const s3 = new S3Client({
        region: 'us-east-2',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
      });
      
      await s3.send(new PutObjectCommand({
        Bucket: 'koi-facturas-pdfs-2',
        Key: key,
        Body: pdfBuffer,
        ContentType: 'application/pdf'
      }));
      
      const pdfUrl = `https://koi-facturas-pdfs-2.s3.us-east-2.amazonaws.com/${key}`;
      await Order.findByIdAndUpdate(orderId, { pdfUrl });
      console.log(`✅ [ENRICH] PDF generado: ${pdfUrl}`);
      
      // 3. Adjuntar a ML automáticamente
      if (order.platform === 'mercadolibre') {
        const { attachInvoiceToML } = require('../../ml/attachInvoice');
        const attached = await attachInvoiceToML(order.userId, order.externalId, pdfUrl);
        if (attached) {
          console.log(`✅ [ENRICH] Factura adjuntada a MercadoLibre`);
          await Order.findByIdAndUpdate(orderId, { emailSent: true, emailSentAt: new Date() });
        }
      }
      
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
  
  const query = {
    platform: 'mercadolibre',
    status: 'pending_invoice',
    'settings.noSolution': { $ne: true },
    $or: [
      { customerDoc: { $in: [null, '', '0', '99999999'] } },
      { buyerIdentificationNumber: { $in: [null, '', '0'] } },
      { rawPayload: null },
      { 'settings.needsBatch': true },
      { 'settings.needsReconnect': true }
    ]
  };
  
  if (userId) query.userId = userId;
  
  const orders = await Order.find(query).limit(limit);
  
  const readyOrders = orders.filter(order => {
    if (order.settings?.batchRetryAt) {
      return new Date(order.settings.batchRetryAt) <= now;
    }
    return true;
  });
  
  console.log(`📊 [BATCH] Procesando ${readyOrders.length} órdenes recuperables (de ${orders.length} encontradas)`);
  console.log(`   - Buscando órdenes sin DNI (aunque tengan orderEnriched=true)`);
  console.log(`   - Incluye órdenes sin rawPayload (órdenes viejas)`);
  
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
    
    console.log(`📋 Orden ${order.externalId}: customerDoc="${order.customerDoc}", orderEnriched=${order.orderEnriched}, rawPayload=${order.rawPayload ? '✅' : '❌'}`);
    
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
  console.log(`   - También procesa órdenes sin rawPayload (órdenes viejas)`);
  
  setTimeout(() => {
    processPendingOrders().catch(e => console.error('Error en batch inicial:', e));
  }, 10000);
  
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