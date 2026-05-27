const { CUIT_CF } = require('../../../utils/constants');

const normalizeRappi = (raw) => {
  const o = raw.order || raw;
  
  return {
    externalId: String(o.id),
    customerName: o.user?.name || '',
    customerEmail: o.user?.email || '',
    customerDoc: CUIT_CF,
    amount: parseFloat(o.total_products || o.total) || 0,
    currency: 'ARS'
  };
};

module.exports = normalizeRappi;
