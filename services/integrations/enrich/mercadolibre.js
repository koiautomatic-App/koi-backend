const axios = require('axios');
const Order = require('../../../models/Order');

const cleanDoc = (raw) => String(raw || '').replace(/\D/g, '');

const enrichMercadoLibreOrder = async (order, token) => {
  let updated = false;
  var updates = {};
  
  console.log('🔍 Enriquociendo orden ' + order.externalId + ': buyerId=' + order.buyerId + ', shipmentId=' + order.shipmentId);
  
  if (order.buyerId && (!order.buyerFirstName || !order.buyerIdentificationNumber)) {
    try {
      console.log('   Obteniendo datos del comprador ' + order.buyerId + '...');
      const buyerRes = await axios.get('https://api.mercadolibre.com/users/' + order.buyerId, {
        headers: { Authorization: 'Bearer ' + token }
      });
      const buyer = buyerRes.data;
      
      updates.buyerFirstName = buyer.first_name || '';
      updates.buyerLastName = buyer.last_name || '';
      updates.buyerIdentificationType = buyer.identification?.type || '';
      updates.buyerIdentificationNumber = buyer.identification?.number || '';
      
      const docClean = cleanDoc(updates.buyerIdentificationNumber);
      if (docClean) {
        updates.customerDoc = docClean;
        if (docClean.length === 11) {
          updates.taxCondition = 'responsable_inscripto';
        } else if (docClean.length >= 7 && docClean.length <= 8) {
          updates.taxCondition = 'consumidor_final';
        }
      }
      
      if (updates.buyerFirstName) {
        var lastName = updates.buyerLastName ? ' ' + updates.buyerLastName : '';
        updates.customerName = updates.buyerFirstName + lastName;
      }
      
      updated = true;
      console.log('   ✅ Datos del comprador obtenidos: ' + updates.buyerFirstName + ' ' + updates.buyerLastName);
    } catch(e) {
      console.error('   ❌ Error obteniendo buyer ' + order.buyerId + ':', e.message);
    }
  }
  
  if (order.shipmentId && !order.shippingMode) {
    try {
      console.log('   Obteniendo datos del envío ' + order.shipmentId + '...');
      const shipmentRes = await axios.get('https://api.mercadolibre.com/shipments/' + order.shipmentId, {
        headers: { 
          Authorization: 'Bearer ' + token,
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
      console.log('   ✅ Datos del envío obtenidos: ' + updates.shippingMode);
    } catch(e) {
      console.error('   ❌ Error obteniendo shipment ' + order.shipmentId + ':', e.message);
    }
  }
  
  if (updated) {
    updates.orderEnriched = true;
    await Order.updateOne({ _id: order._id }, { $set: updates });
    console.log('   ✅ Orden ' + order.externalId + ' enriquecida');
  } else {
    console.log('   ⚠️ No se pudo enriquecer orden ' + order.externalId);
  }
  
  return updated;
};

module.exports = { enrichMercadoLibreOrder };