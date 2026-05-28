const { cleanDoc, resolveDoc } = require('../../../utils/constants');

const normalizeWooCommerce = (raw) => {
  // 👇 SOLO PROCESAR ÓRDENES COMPLETADAS
  if (raw.status !== 'completed') {
    console.log(`⏭️ Orden ${raw.id} ignorada - Estado: ${raw.status} (solo completed)`);
    return null;
  }
  
  const b = raw.billing || {};
  const doc = cleanDoc(b.dni || b.identification || b.cpf || '');
  const items = (raw.line_items || []).map(i => ({
    nombre: i.name || 'Producto',
    cantidad: i.quantity || 1,
    precio: parseFloat(i.price || i.subtotal || 0),
    sku: i.sku || ''
  }));
  const concepto = items.length
    ? items.map(i => i.nombre).join(', ')
    : 'Venta WooCommerce';
  
  return {
    externalId: String(raw.id),
    customerName: (b.first_name || '') + ' ' + (b.last_name || ''),
    customerEmail: b.email || '',
    customerDoc: resolveDoc(doc, parseFloat(raw.total) || 0),
    amount: parseFloat(raw.total) || 0,
    currency: raw.currency || 'ARS',
    concepto: concepto,
    items: items,
    orderDate: raw.date_created ? new Date(raw.date_created) : undefined,
    wooStatus: raw.status  // 👈 Guardar el estado original
  };
};

module.exports = normalizeWooCommerce;
