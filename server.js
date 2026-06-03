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
// Batch para recuperar errores según tipo:
// - Rate limiting: reintento cada 5 minutos
// - Timeout: reintento cada 5 minutos
// - Error ML: reintento cada 15 minutos
// - Token expirado: reintento cada 1 hora
// - El procesamiento normal ya es inmediato vía webhook (2 intentos en 5 segundos)
const { startAutoEnrich } = require('./services/integrations/enrich/autoEnrich');

// Ejecutar batch cada 5 minutos (para recuperar rate_limit y timeout más rápido)
// La lógica interna de autoEnrich.js manejará diferentes tiempos según el tipo de error
startAutoEnrich(5 * 60 * 1000); // Cada 5 minutos

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