// services/integrations/enrich/mercadolibre.js
const axios = require('axios');
const Order = require('../../../models/Order');

const cleanDoc = (raw) => String(raw || '').replace(/\D/g, '');

const enrichMercadoLibreOrder = async (order, token) => {
  let updated = false;
  let updates = {};

  console.log(`🔍 Enriquociendo orden ${order.externalId}: buyerId=${order.buyerId}, shipmentId=${order.shipmentId}`);

  // ============================================================
  // 1. PRIMERO: Verificar billing_info del rawPayload
  //    (El DNI puede estar aquí, no en la API de users)
  // ============================================================
  if (order.rawPayload?.billing_info?.doc_number) {
    const docNumber = order.rawPayload.billing_info.doc_number;
    const docType = order.rawPayload.billing_info.doc_type;
    const docClean = cleanDoc(docNumber);
    
    if (docClean && (docClean.length === 8 || docClean.length === 11)) {
      updates.customerDoc = docClean;
      updates.buyerIdentificationNumber = docClean;
      updates.buyerIdentificationType = docType || 'DNI';
      updates.taxCondition = docClean.length === 11 ? 'responsable_inscripto' : 'consumidor_final';
      updated = true;
      console.log(`✅ DNI obtenido de billing_info: ${docClean} (${docType || 'DNI'})`);
      
      // También actualizar nombre si está disponible
      if (order.rawPayload.billing_info.additional_info) {
        for (const item of order.rawPayload.billing_info.additional_info) {
          if (item.type === 'FIRST_NAME') updates.buyerFirstName = item.value;
          if (item.type === 'LAST_NAME') updates.buyerLastName = item.value;
        }
        if (updates.buyerFirstName) {
          updates.customerName = `${updates.buyerFirstName} ${updates.buyerLastName || ''}`.trim();
        }
      }
    }
  }

  // ============================================================
  // 2. SEGUNDO: Si no hay DNI en billing_info, consultar API de users
  // ============================================================
  if (!updated && order.buyerId && (!order.buyerFirstName || !order.buyerIdentificationNumber)) {
    try {
      console.log(`   Obteniendo datos del comprador ${order.buyerId} desde API de users...`);
      const buyerRes = await axios.get(`https://api.mercadolibre.com/users/${order.buyerId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const buyer = buyerRes.data;

      updates.buyerFirstName = buyer.first_name || '';
      updates.buyerLastName = buyer.last_name || '';
      updates.buyerIdentificationType = buyer.identification?.type || '';
      updates.buyerIdentificationNumber = buyer.identification?.number || '';

      const docClean = cleanDoc(updates.buyerIdentificationNumber);
      if (docClean) {
        updates.customerDoc = docClean;
        updates.taxCondition = docClean.length === 11 ? 'responsable_inscripto' : 'consumidor_final';
        updated = true;
        console.log(`✅ DNI obtenido de API de users: ${docClean}`);
      }

      if (updates.buyerFirstName) {
        updates.customerName = `${updates.buyerFirstName} ${updates.buyerLastName || ''}`.trim();
        console.log(`   Nombre del comprador: ${updates.customerName}`);
      }
      
    } catch(e) {
      console.error(`   ❌ Error obteniendo buyer ${order.buyerId} desde API:`, e.message);
    }
  }

  // ============================================================
  // 3. TERCERO: Datos del envío (si aplica)
  // ============================================================
  if (order.shipmentId && !order.shippingMode) {
    try {
      console.log(`   Obteniendo datos del envío ${order.shipmentId}...`);
      const shipmentRes = await axios.get(`https://api.mercadolibre.com/shipments/${order.shipmentId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'x-format-new': 'true'
        }
      });
      const shipment = shipmentRes.data;

      updates.shippingMode = shipment.logistic?.mode || shipment.mode || 'unknown';
      updates.shippingStatus = shipment.status || '';

      if (shipment.destination?.shipping_address) {
        const addr = shipment.destination.shipping_address;
        updates.shippingDestinationAddress = {
          street: addr.street_name || '',
          streetNumber: addr.street_number || '',
          city: addr.city?.name || '',
          state: addr.state?.name || '',
          zipCode: addr.zip_code || '',
          country: addr.country?.name || ''
        };
      }

      if (updates.shippingMode === 'flex') {
        updates.shouldIncludeShipping = true;
        updates.shippingCarrier = 'MercadoEnvíos Flex';
      } else if (updates.shippingMode === 'me2') {
        updates.shouldIncludeShipping = false;
        updates.shippingCarrier = 'MercadoEnvíos';
      }

      updated = true;
      console.log(`   ✅ Datos del envío obtenidos: ${updates.shippingMode}`);
    } catch(e) {
      console.error(`   ❌ Error obteniendo shipment ${order.shipmentId}:`, e.message);
    }
  }

  // ============================================================
  // 4. Guardar cambios en la orden
  // ============================================================
  if (updated) {
    // Solo marcar orderEnriched = true si realmente tiene DNI
    const hasDNI = updates.customerDoc && updates.customerDoc !== '0' && updates.customerDoc !== '';
    
    if (hasDNI) {
      updates.orderEnriched = true;
      console.log(`   ✅ Orden ${order.externalId} ENRIQUECIDA con DNI: ${updates.customerDoc}`);
    } else {
      updates.orderEnriched = false;
      console.log(`   ⚠️ Orden ${order.externalId} actualizada pero SIN DNI (se reintentará después)`);
    }
    
    await Order.updateOne({ _id: order._id }, { $set: updates });
    console.log(`   ✅ Cambios guardados en orden ${order.externalId}`);
  } else {
    console.log(`   ⚠️ No se pudo enriquecer orden ${order.externalId} (sin datos disponibles)`);
  }

  return updated;
};

module.exports = { enrichMercadoLibreOrder };