// utils/normalizers.js
const config = require('../config');

// ============================================================
// HELPERS INTERNOS
// ============================================================
const _cleanDoc = (raw) => String(raw || '').replace(/\D/g, '');
const _resolveDoc = (doc, amount) => {
  if (doc.length >= 7 && doc.length <= 11) return doc;
  return amount >= config.ARCA_LIMIT ? null : config.CUIT_CF;
};

// ============================================================
// NORMALIZERS POR PLATAFORMA
// ============================================================
const normalize = {
  woocommerce: (raw) => {
    const b = raw.billing || {};
    const doc = _cleanDoc(b.dni || b.identification || b.cpf || '');
    const items = (raw.line_items || []).map(i => ({
      nombre: i.name || 'Producto',
      cantidad: i.quantity || 1,
      precio: parseFloat(i.price || i.subtotal || 0),
      sku: i.sku || '',
    }));
    const concepto = items.length
      ? items.map(i => i.nombre).join(', ')
      : 'Venta WooCommerce';
    
    return {
      externalId: String(raw.id),
      customerName: `${b.first_name || ''} ${b.last_name || ''}`.trim(),
      customerEmail: b.email || '',
      customerDoc: _resolveDoc(doc, parseFloat(raw.total) || 0),
      amount: parseFloat(raw.total) || 0,
      currency: raw.currency || 'ARS',
      concepto,
      items,
      orderDate: raw.date_created ? new Date(raw.date_created) : undefined,
      rawPayload: raw,
    };
  },

  tiendanube: (raw) => {
    const doc = _cleanDoc(raw.billing_info?.document || '');
    const items = (raw.products || []).map(i => ({
      nombre: i.name || i.product_name || 'Producto',
      cantidad: i.quantity || 1,
      precio: parseFloat(i.price || 0),
      sku: i.sku || '',
    }));
    const concepto = items.length
      ? items.map(i => i.nombre).join(', ')
      : 'Venta Tienda Nube';
    
    return {
      externalId: String(raw.id),
      customerName: raw.contact?.name || '',
      customerEmail: raw.contact?.email || '',
      customerDoc: _resolveDoc(doc, parseFloat(raw.total) || 0),
      amount: parseFloat(raw.total) || 0,
      currency: raw.currency || 'ARS',
      concepto,
      items,
      orderDate: raw.paid_at ? new Date(raw.paid_at) : raw.created_at ? new Date(raw.created_at) : undefined,
    };
  },

  mercadolibre: (raw) => {
    // Extraer DNI/CUIT desde billing_info
    let docNumber = '';
    let docType = '';
    let fiscalCondition = 'Consumidor Final';
    
    if (raw.billing_info?.doc_number) {
      docNumber = raw.billing_info.doc_number;
      docType = raw.billing_info.doc_type;
    } else if (raw.buyer?.billing_info?.doc_number) {
      docNumber = raw.buyer.billing_info.doc_number;
      docType = raw.buyer.billing_info.doc_type;
    }
    
    // Extraer nombre completo
    let firstName = '';
    let lastName = '';
    
    if (raw.billing_info?.additional_info) {
      for (const item of raw.billing_info.additional_info) {
        if (item.type === 'FIRST_NAME') firstName = item.value;
        if (item.type === 'LAST_NAME') lastName = item.value;
        if (item.type === 'TAXPAYER_TYPE_ID') fiscalCondition = item.value;
      }
    }
    
    if (!firstName && !lastName) {
      firstName = raw.buyer?.first_name || '';
      lastName = raw.buyer?.last_name || '';
    }
    
    const customerName = firstName && lastName 
      ? `${firstName} ${lastName}`.trim()
      : firstName || raw.buyer?.nickname || '';
    
    // Determinar condición fiscal
    const docClean = docNumber.replace(/\D/g, '');
    let taxCondition = 'consumidor_final';
    let customerDoc = '0';
    
    if (docClean) {
      if (docClean.length === 11) {
        taxCondition = 'responsable_inscripto';
        customerDoc = docClean;
      } else if (docClean.length >= 7 && docClean.length <= 8) {
        taxCondition = 'consumidor_final';
        customerDoc = docClean;
      } else {
        customerDoc = docClean;
      }
    }
    
    // Dirección de envío
    const shipping = raw.shipping || {};
    const address = shipping.receiver_address || {};
    const customerAddress = {
      street: address.street_name || '',
      streetNumber: address.street_number || '',
      city: address.city?.name || '',
      state: address.state?.name || '',
      zipCode: address.zip_code || '',
      country: address.country?.name || ''
    };
    
    // Tipo de envío
    let shippingType = 'unknown';
    let shippingCarrier = '';
    let shippingCost = 0;
    let shouldIncludeShipping = false;
    
    if (shipping.shipping_mode) shippingType = shipping.shipping_mode;
    if (shipping.tags && shipping.tags.includes('fulfillment')) shippingType = 'fulfillment';
    
    if (shippingType === 'flex' || shippingType === 'self_service') {
      shippingCarrier = 'MercadoEnvíos Flex';
      shouldIncludeShipping = true;
    } else if (shippingType === 'custom') {
      shippingCarrier = 'Envío personalizado';
      shouldIncludeShipping = true;
    } else if (shippingType === 'fulfillment') {
      shippingCarrier = 'MercadoEnvíos Full';
      shouldIncludeShipping = false;
    } else if (shippingType === 'me2') {
      shippingCarrier = 'MercadoEnvíos';
      shouldIncludeShipping = false;
    } else {
      shippingCarrier = shipping.shipping_option?.name || 'Envío a convenir';
      shouldIncludeShipping = false;
    }
    
    if (shouldIncludeShipping && shipping.shipping_option?.cost) {
      shippingCost = parseFloat(shipping.shipping_option.cost) || 0;
    }
    
    // Productos
    const items = (raw.order_items || []).map(i => ({
      nombre: i.item?.title || 'Producto',
      cantidad: i.quantity || 1,
      precio: parseFloat(i.unit_price || 0),
      sku: i.item?.seller_sku || '',
    }));
    
    // Concepto (incluir envío si aplica)
    let concepto = items.length 
      ? items.map(i => i.nombre).join(', ') 
      : 'Venta Mercado Libre';
    
    if (shouldIncludeShipping && shippingCost > 0) {
      concepto += ` + Envío (${shippingCarrier})`;
    }
    
    // Agregar item de envío si corresponde
    const allItems = [...items];
    if (shouldIncludeShipping && shippingCost > 0) {
      allItems.push({
        nombre: `Envío - ${shippingCarrier}`,
        cantidad: 1,
        precio: shippingCost,
        sku: 'SHIPPING',
      });
    }
    
    return {
      externalId: String(raw.id),
      customerName,
      customerEmail: raw.buyer?.email || '',
      customerDoc,
      taxCondition,
      customerZipCode: address.zip_code || '',
      customerAddress,
      shippingType,
      shippingCarrier,
      shippingCost: shouldIncludeShipping ? shippingCost : 0,
      shouldIncludeShipping,
      amount: parseFloat(raw.total_amount) || 0,
      currency: raw.currency_id || 'ARS',
      concepto,
      items: allItems,
      orderDate: raw.date_created ? new Date(raw.date_created) : undefined,
      buyerId: raw.buyer?.id || '',
      shipmentId: raw.shipping?.id || '',
      buyerFirstName: firstName,
      buyerLastName: lastName,
      buyerIdentificationType: docType,
      buyerIdentificationNumber: docClean,
      fiscal_condition: fiscalCondition,
      orderEnriched: true,
    };
  },

  vtex: (raw) => {
    const c = raw.clientProfileData || {};
    const doc = _cleanDoc(c.document || '');
    return {
      externalId: raw.orderId || String(raw.id),
      customerName: `${c.firstName || ''} ${c.lastName || ''}`.trim(),
      customerEmail: c.email || '',
      customerDoc: _resolveDoc(doc, (parseFloat(raw.value) || 0) / 100),
      amount: (parseFloat(raw.value) || 0) / 100,
      currency: raw.currencyCode || 'ARS',
      concepto: 'Venta VTEX',
      items: [],
      orderDate: raw.createdAt ? new Date(raw.createdAt) : undefined,
    };
  },

  empretienda: (raw) => {
    const doc = _cleanDoc(raw.customer?.dni || '');
    return {
      externalId: String(raw.order_id || raw.id),
      customerName: raw.customer?.name || '',
      customerEmail: raw.customer?.email || '',
      customerDoc: _resolveDoc(doc, parseFloat(raw.total_price || raw.total) || 0),
      amount: parseFloat(raw.total_price || raw.total) || 0,
      currency: 'ARS',
      concepto: 'Venta Empretienda',
      items: (raw.products || []).map(p => ({
        nombre: p.name || 'Producto',
        cantidad: p.quantity || 1,
        precio: parseFloat(p.price || 0),
        sku: p.sku || '',
      })),
      orderDate: raw.created_at ? new Date(raw.created_at) : undefined,
    };
  },

  rappi: (raw) => {
    const o = raw.order || raw;
    return {
      externalId: String(o.id),
      customerName: o.user?.name || '',
      customerEmail: o.user?.email || '',
      customerDoc: config.CUIT_CF,
      amount: parseFloat(o.total_products || o.total) || 0,
      currency: 'ARS',
      concepto: 'Venta Rappi',
      items: (o.products || []).map(p => ({
        nombre: p.name || 'Producto',
        cantidad: p.quantity || 1,
        precio: parseFloat(p.price || 0),
        sku: p.sku || '',
      })),
      orderDate: o.created_at ? new Date(o.created_at) : undefined,
    };
  },

  shopify: (raw) => {
    const a = raw.billing_address || raw.shipping_address || {};
    const doc = _cleanDoc(raw.note_attributes?.find(x => x.name === 'dni')?.value || '');
    return {
      externalId: String(raw.id),
      customerName: `${a.first_name || ''} ${a.last_name || ''}`.trim(),
      customerEmail: raw.email || '',
      customerDoc: _resolveDoc(doc, parseFloat(raw.total_price) || 0),
      amount: parseFloat(raw.total_price) || 0,
      currency: raw.currency || 'ARS',
      concepto: 'Venta Shopify',
      items: (raw.line_items || []).map(i => ({
        nombre: i.title || 'Producto',
        cantidad: i.quantity || 1,
        precio: parseFloat(i.price || 0),
        sku: i.sku || '',
      })),
      orderDate: raw.created_at ? new Date(raw.created_at) : undefined,
    };
  },

  manual: (raw) => {
    return {
      externalId: `manual_${Date.now()}`,
      customerName: raw.customerName || '',
      customerEmail: raw.customerEmail || '',
      customerDoc: _resolveDoc(_cleanDoc(raw.customerDoc || ''), raw.amount || 0),
      amount: parseFloat(raw.amount) || 0,
      currency: 'ARS',
      concepto: raw.concepto || 'Venta manual',
      items: [{
        nombre: raw.concepto || 'Producto',
        cantidad: 1,
        precio: parseFloat(raw.amount) || 0,
        sku: '',
      }],
      orderDate: new Date(),
    };
  },
};

module.exports = { normalize, _cleanDoc, _resolveDoc };