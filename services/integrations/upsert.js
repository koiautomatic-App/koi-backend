const Order = require('../../models/Order');
const User = require('../../models/User');
const { emitirCAE } = require('../afip/wsfe');

const ARCA_LIMIT = 380000;

const upsertOrder = async (integration, canonical) => {
  if (!canonical) return null;

  const status = canonical.customerDoc === null ? 'error_data' : 'pending_invoice';
  const errorLog = canonical.customerDoc === null
    ? 'Monto $' + canonical.amount + ' ≥ $' + ARCA_LIMIT + ' sin DNI válido'
    : '';
  if (canonical.customerDoc === null) canonical.customerDoc = '0';

  const soloSetOnInsert = {
    userId: integration.userId,
    integrationId: integration._id,
    platform: integration.platform,
    status: status,
    errorLog: errorLog
  };

  var setData = {};
  for (var key in canonical) {
    if (key !== 'userId' && key !== 'integrationId' && key !== 'platform') {
      setData[key] = canonical[key];
    }
  }
  
  setData.buyerId = canonical.buyerId || '';
  setData.shipmentId = canonical.shipmentId || '';
  setData.orderEnriched = canonical.orderEnriched || false;
  setData.taxCondition = canonical.taxCondition || 'consumidor_final';
  setData.buyerFirstName = canonical.buyerFirstName || '';
  setData.buyerLastName = canonical.buyerLastName || '';
  setData.buyerIdentificationType = canonical.buyerIdentificationType || '';
  setData.buyerIdentificationNumber = canonical.buyerIdentificationNumber || '';

  const doc = await Order.findOneAndUpdate(
    { userId: integration.userId, platform: integration.platform, externalId: canonical.externalId },
    { 
      $setOnInsert: soloSetOnInsert,
      $set: setData
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).catch(function(err) {
    console.error('upsert error:', err.message);
    return null;
  });

  if (doc) {
    console.log('📦 Orden ' + canonical.externalId + ': upsert OK');
    if (status === 'pending_invoice') {
      const user = await User.findById(integration.userId).select('settings').lean();
      if (user?.settings?.factAuto && user?.settings?.cuit) {
        emitirCAE(doc._id, user).catch(function(e) {
          console.error('Auto-emit error:', e.message);
        });
      }
    }
  }
  
  return doc;
};

module.exports = { upsertOrder };