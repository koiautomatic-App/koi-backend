// server.js
require('dotenv').config();
const { app } = require('./app');  // 👈 DESESTRUCTURAR app
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
const { startAutoEnrich } = require('./services/integrations/enrich/autoEnrich');

// Iniciar servidor PRIMERO
const server = app.listen(config.PORT, () => {
  logger.info(`🚀 KOI-Factura v4.0 | Puerto ${config.PORT} | ${config.BASE_URL}`);
  
  // Iniciar batch processing DESPUÉS de que el servidor esté corriendo
  // Delay de 10 segundos para asegurar que todo esté inicializado
  setTimeout(() => {
    logger.info('🔄 Iniciando batch processing (después de delay de 10 segundos)...');
    startAutoEnrich(5 * 60 * 1000);
  }, 10000);
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