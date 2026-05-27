const Integration = require('../../../models/Integration');
const { upsertOrder } = require('../upsert');

const handleWebhook = async (platform, secret, getCanonical) => {
  const integration = await Integration.findOne({ 
    platform: platform, 
    webhookSecret: secret, 
    status: 'active' 
  });
  
  if (!integration) {
    console.warn('⚠️ Webhook ' + platform + ': secret desconocido');
    return;
  }
  
  try {
    const canonical = await getCanonical(integration);
    if (canonical) {
      await upsertOrder(integration, canonical);
    }
  } catch(e) {
    console.error('❌ Webhook ' + platform + ':', e.message);
  }
};

module.exports = { handleWebhook };