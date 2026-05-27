const { cleanDoc, resolveDoc } = require('../../../utils/constants');

const normalizeEmpretienda = (raw) => {
  const doc = cleanDoc(raw.customer?.dni || '');
  
  return {
    externalId: String(raw.order_id || raw.id),
    customerName: raw.customer?.name || '',
    customerEmail: raw.customer?.email || '',
    customerDoc: resolveDoc(doc, parseFloat(raw.total_price || raw.total) || 0),
    amount: parseFloat(raw.total_price || raw.total) || 0,
    currency: 'ARS'
  };
};

module.exports = normalizeEmpretienda;
