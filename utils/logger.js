// utils/logger.js
const fs = require('fs');
const path = require('path');

// Directorio de logs
const LOG_DIR = path.join(__dirname, '../logs');

// Asegurar que el directorio de logs existe
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Niveles de log
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

// Nivel actual (por defecto INFO en producción, DEBUG en desarrollo)
const CURRENT_LEVEL = process.env.NODE_ENV === 'production' 
  ? LOG_LEVELS.INFO 
  : LOG_LEVELS.DEBUG;

// Formatear fecha
const getTimestamp = () => {
  return new Date().toISOString();
};

// Escribir en archivo
const writeToFile = (level, message, meta = {}) => {
  const date = new Date();
  const dateStr = date.toISOString().split('T')[0];
  const logFile = path.join(LOG_DIR, `${dateStr}.log`);
  
  const logEntry = {
    timestamp: getTimestamp(),
    level,
    message,
    ...meta
  };
  
  const logLine = JSON.stringify(logEntry) + '\n';
  
  fs.appendFile(logFile, logLine, (err) => {
    if (err) console.error('Error writing to log file:', err);
  });
};

// Loggear a consola (con colores)
const logToConsole = (level, message, meta = {}) => {
  const colors = {
    ERROR: '\x1b[31m', // rojo
    WARN: '\x1b[33m',  // amarillo
    INFO: '\x1b[36m',  // cian
    DEBUG: '\x1b[90m'  // gris
  };
  
  const reset = '\x1b[0m';
  const prefix = colors[level] || '';
  
  let logMsg = `${prefix}[${getTimestamp()}] [${level}] ${message}${reset}`;
  if (Object.keys(meta).length > 0) {
    logMsg += ` ${JSON.stringify(meta)}`;
  }
  
  console.log(logMsg);
};

// Logger principal
const logger = {
  error: (message, meta = {}) => {
    if (CURRENT_LEVEL >= LOG_LEVELS.ERROR) {
      logToConsole('ERROR', message, meta);
      writeToFile('ERROR', message, meta);
    }
  },
  
  warn: (message, meta = {}) => {
    if (CURRENT_LEVEL >= LOG_LEVELS.WARN) {
      logToConsole('WARN', message, meta);
      writeToFile('WARN', message, meta);
    }
  },
  
  info: (message, meta = {}) => {
    if (CURRENT_LEVEL >= LOG_LEVELS.INFO) {
      logToConsole('INFO', message, meta);
      writeToFile('INFO', message, meta);
    }
  },
  
  debug: (message, meta = {}) => {
    if (CURRENT_LEVEL >= LOG_LEVELS.DEBUG) {
      logToConsole('DEBUG', message, meta);
      writeToFile('DEBUG', message, meta);
    }
  },
  
  // Para errores de AFIP específicamente
  afipError: (message, error, context = {}) => {
    logger.error(`[AFIP] ${message}`, {
      error: error.message,
      stack: error.stack,
      ...context
    });
  },
  
  // Para webhooks
  webhook: (platform, action, data = {}) => {
    logger.info(`[Webhook] ${platform} - ${action}`, data);
  },
  
  // Para órdenes
  order: (orderId, action, data = {}) => {
    logger.info(`[Order] ${orderId} - ${action}`, data);
  },
  
  // Para AFIP
  afip: (cuit, action, data = {}) => {
    logger.info(`[AFIP] CUIT ${cuit} - ${action}`, data);
  },
  
  // Para suscripciones
  subscription: (userId, action, data = {}) => {
    logger.info(`[Suscripción] ${userId} - ${action}`, data);
  }
};

module.exports = logger;