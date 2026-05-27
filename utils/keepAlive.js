// utils/keepAlive.js
const axios = require('axios');
const config = require('../config');
const logger = require('./logger');

const startKeepAlive = () => {
  if (!config.BASE_URL || config.NODE_ENV === 'development') {
    logger.debug('Keep-alive desactivado en desarrollo');
    return;
  }
  
  const ping = async () => {
    try {
      const res = await axios.get(`${config.BASE_URL}/health`, { timeout: 15000 });
      if (res.status === 200) {
        logger.debug(`🏓 Keep-alive OK`);
      }
    } catch (e) {
      logger.warn(`⚠️ Ping falló: ${e.message}`);
      setTimeout(ping, 30000);
    }
  };
  
  setTimeout(ping, 5000);
  setInterval(ping, 5 * 60 * 1000);
  logger.info('Keep-alive iniciado (cada 5 minutos)');
};

module.exports = { startKeepAlive };