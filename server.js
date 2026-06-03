// server.js
require('dotenv').config();
const app = require('./app');
const config = require('./config');
const connectDB = require('./config/database');
const { initPassport } = require('./config/passport');
const { startKeepAlive } = require('./utils/keepAlive');
const { httpsAgent } = require('./utils/afip-tls');
const logger = require('./utils/logger');

// Validar variables de entorno
if (config.validateEnv) config.validateEnv();

// Inicializar Passport
initPassport();

// Conectar a MongoDB
connectDB();

// IMPORTAR ROUTER CON VERIFICACIÓN
let router;
try {
  router = require('./routes');
  logger.info('✅ Router cargado correctamente');
  if (!router) {
    throw new Error('Router es undefined');
  }
  if (typeof router.use !== 'function') {
    throw new Error('Router no es un middleware de Express válido');
  }
} catch (err) {
  logger.error('❌ Error cargando router:', err.message);
  process.exit(1);
}

// Configurar rutas
app.use('/', router);

// ============================================================
// INICIAR AUTO-ENRIQUECIMIENTO DE ÓRDENES ML
// ============================================================
// Batch cada 1 hora SOLO para errores recuperables
// (token expirado, problemas de red temporales, etc.)
// El procesamiento normal ya es inmediato vía webhook
const { startAutoEnrich } = require('./services/integrations/enrich/autoEnrich');
startAutoEnrich(60 * 60 * 1000); // Cada 1 hora

// Iniciar servidor
const server = app.listen(config.PORT, () => {
  logger.info(`🚀 KOI-Factura v4.0 | Puerto ${config.PORT} | ${config.BASE_URL}`);
});

// Keep-alive para Render
startKeepAlive();

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM recibido, cerrando servidor...');
  server.close(() => {
    logger.info('Servidor cerrado');
    process.exit(0);
  });
});