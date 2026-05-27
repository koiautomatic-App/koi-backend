const { cleanDoc, resolveDoc } = require('../../../utils/constants');

const normalizeVTEX = (raw) => {
  const c = raw.clientProfileData || {};
  const doc = cleanDoc(c.document || '');
  
  return {
    externalId: raw.orderId || String(raw.id),
    customerName: (c.firstName || '') + ' ' + (c.lastName || ''),
    customerEmail: c.email || '',
    customerDoc: resolveDoc(doc, (parseFloat(raw.value) || 0) / 100),
    amount: (parseFloat(raw.value) || 0) / 100,
    currency: raw.currencyCode || 'ARS'
  };
};

module.exports = normalizeVTEX;
