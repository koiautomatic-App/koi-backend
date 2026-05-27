const { cleanDoc, resolveDoc } = require('../../../utils/constants');

const normalizeShopify = (raw) => {
  const a = raw.billing_address || raw.shipping_address || {};
  let dniAttr = null;
  if (raw.note_attributes) {
    for (let i = 0; i < raw.note_attributes.length; i++) {
      if (raw.note_attributes[i].name === 'dni') {
        dniAttr = raw.note_attributes[i];
        break;
      }
    }
  }
  const doc = cleanDoc(dniAttr ? dniAttr.value : '');
  
  return {
    externalId: String(raw.id),
    customerName: (a.first_name || '') + ' ' + (a.last_name || ''),
    customerEmail: raw.email || '',
    customerDoc: resolveDoc(doc, parseFloat(raw.total_price) || 0),
    amount: parseFloat(raw.total_price) || 0,
    currency: raw.currency || 'ARS'
  };
};

module.exports = normalizeShopify;
