const axios = require('axios');
const { encrypt, decrypt } = require('../../../utils/encrypt');

const getMLToken = async (integration) => {
  const expiry = new Date(integration.credentials.tokenExpiry || 0);
  const accessToken = decrypt(integration.credentials.accessToken);
  
  if (expiry > new Date(Date.now() + 10 * 60 * 1000)) {
    return accessToken;
  }
  
  const response = await axios.post('https://api.mercadolibre.com/oauth/token', {
    grant_type: 'refresh_token',
    client_id: process.env.ML_CLIENT_ID,
    client_secret: process.env.ML_CLIENT_SECRET,
    refresh_token: decrypt(integration.credentials.refreshToken)
  });
  
  const data = response.data;
  
  const Integration = require('../../../models/Integration');
  await Integration.findByIdAndUpdate(integration._id, {
    'credentials.accessToken': encrypt(data.access_token),
    'credentials.refreshToken': encrypt(data.refresh_token),
    'credentials.tokenExpiry': new Date(Date.now() + data.expires_in * 1000).toISOString()
  });
  
  return data.access_token;
};

module.exports = { getMLToken };