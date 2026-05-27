const normalizeMercadoLibre = (raw) => {
  let docNumber = '';
  let firstName = '';
  let lastName = '';
  
  if (raw.billing_info && raw.billing_info.doc_number) {
    docNumber = raw.billing_info.doc_number;
  }
  
  if (raw.billing_info && raw.billing_info.additional_info) {
    for (const item of raw.billing_info.additional_info) {
      if (item.type === 'FIRST_NAME') firstName = item.value;
      if (item.type === 'LAST_NAME') lastName = item.value;
    }
  }
  
  if (!firstName && !lastName) {
    firstName = raw.buyer?.first_name || '';
    lastName = raw.buyer?.last_name || '';
  }
  
  const customerName = firstName && lastName 
    ? firstName + ' ' + lastName
    : firstName || raw.buyer?.nickname || '';
  
  const docClean = docNumber.replace(/\D/g, '');
  let customerDoc = '0';
  
  if (docClean && (docClean.length === 11 || docClean.length === 8)) {
    customerDoc = docClean;
  }
  
  const items = (raw.order_items || []).map(i => ({
    nombre: i.item?.title || 'Producto',
    cantidad: i.quantity || 1,
    precio: parseFloat(i.unit_price || 0),
    sku: i.item?.seller_sku || ''
  }));
  
  let concepto = items.length 
    ? items.map(i => i.nombre).join(', ') 
    : 'Venta Mercado Libre';
  
  return {
    externalId: String(raw.id),
    customerName: customerName,
    customerEmail: raw.buyer?.email || '',
    customerDoc: customerDoc,
    amount: parseFloat(raw.total_amount) || 0,
    currency: raw.currency_id || 'ARS',
    concepto: concepto,
    items: items,
    orderDate: raw.date_created ? new Date(raw.date_created) : undefined,
    buyerId: raw.buyer?.id || '',
    shipmentId: raw.shipping?.id || '',
    buyerFirstName: firstName,
    buyerLastName: lastName
  };
};

module.exports = normalizeMercadoLibre;