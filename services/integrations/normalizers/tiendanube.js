const { cleanDoc, resolveDoc } = require('../../../utils/constants');

const normalizeTiendaNube = (raw) => {
  const doc = cleanDoc(raw.billing_info?.document || '');
  const items = (raw.products || []).map(i => ({
    nombre: i.name || i.product_name || 'Producto',
    cantidad: i.quantity || 1,
    precio: parseFloat(i.price || 0),
    sku: i.sku || ''
  }));
  const concepto = items.length
    ? items.map(i => i.nombre).join(', ')
    : 'Venta Tienda Nube';
  
  return {
    externalId: String(raw.id),
    customerName: raw.contact?.name || '',
    customerEmail: raw.contact?.email || '',
    customerDoc: resolveDoc(doc, parseFloat(raw.total) || 0),
    amount: parseFloat(raw.total) || 0,
    currency: raw.currency || 'ARS',
    concepto: concepto,
    items: items,
    orderDate: raw.paid_at ? new Date(raw.paid_at) : (raw.created_at ? new Date(raw.created_at) : undefined)
  };
};

module.exports = normalizeTiendaNube;
