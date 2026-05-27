// server.js
require('dotenv').config();
const app = require('./app');
const config = require('./config');
const connectDB = require('./config/database');
const { initPassport } = require('./config/passport');
const setupRoutes = require('./routes');
const { startKeepAlive } = require('./utils/keepAlive');
const { httpsAgent } = require('./utils/afip-tls');
const logger = require('./utils/logger');

// Validar variables de entorno
if (config.validateEnv) config.validateEnv();

// Inicializar Passport
initPassport();

// Conectar a MongoDB
connectDB();

// Configurar rutas
setupRoutes(app);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

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