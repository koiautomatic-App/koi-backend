// routes/auth.js
const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const router = express.Router();
const { register, login, logout } = require('../controllers/authController');
const { signToken, setTokenCookie, requireAuth } = require('../middleware/auth');
const Integration = require('../models/Integration');
const { encrypt } = require('../utils/encrypt');

// ============================================================
// LOCAL AUTH
// ============================================================
router.post('/register', register);
router.post('/login', login);
router.get('/logout', logout);

// ============================================================
// GOOGLE OAUTH
// ============================================================
router.get('/google',
  passport.authenticate('google', { 
    scope: ['profile', 'email']
  })
);

router.get('/google/callback',
  passport.authenticate('google', { 
    failureRedirect: '/login?error=google_failed',
    failureMessage: true
  }),
  (req, res) => {
    console.log('✅ Google auth successful for:', req.user?.email);
    const token = signToken(req.user);
    setTokenCookie(res, token);
    res.redirect('/dashboard');
  }
);

// ============================================================
// WOOCOMMERCE OAUTH - VERSIÓN CORREGIDA (GET)
// ============================================================
router.get('/woo/connect', requireAuth, (req, res) => {
  console.log('🟢 [WOO] /auth/woo/connect llamado');
  const { store_url } = req.query;
  
  if (!store_url) {
    console.error('❌ [WOO] Falta store_url');
    return res.status(400).send('Falta store_url');
  }
  
  const clean = store_url.replace(/\/$/, '').toLowerCase();
  console.log(`📦 [WOO] Store URL: ${clean}`);
  console.log(`👤 [WOO] User ID: ${req.userId}`);
  
  const state = jwt.sign(
    { userId: req.userId, storeUrl: clean }, 
    process.env.JWT_SECRET, 
    { expiresIn: '15m' }
  );
  
  const callback = `${process.env.BASE_URL}/auth/woo/callback`;
  const returnUrl = `${process.env.BASE_URL}/dashboard?woo=connected`;
  
  const wooAuthUrl = `${clean}/wc-auth/v1/authorize?app_name=KOI-Factura&scope=read_write&user_id=${req.userId}&return_url=${encodeURIComponent(returnUrl)}&callback_url=${encodeURIComponent(callback)}`;
  
  console.log('🔄 [WOO] Redirigiendo a:', wooAuthUrl);
  res.redirect(wooAuthUrl);
});

// ✅ CAMBIADO DE POST A GET
router.get('/woo/callback', async (req, res) => {
  console.log('📞 [WOO] Callback GET recibido');
  console.log('  Query params:', req.query);
  
  // WooCommerce envía todo por query string en GET
  const { state, consumer_key, consumer_secret } = req.query;
  
  console.log('  state:', state ? '✅ presente' : '❌ ausente');
  console.log('  consumer_key:', consumer_key ? '✅ presente' : '❌ ausente');
  console.log('  consumer_secret:', consumer_secret ? '✅ presente' : '❌ ausente');
  
  // Validaciones
  if (!state) {
    console.error('❌ [WOO] Missing state parameter');
    return res.status(400).send('Missing state parameter');
  }
  
  if (!consumer_key || !consumer_secret) {
    console.error('❌ [WOO] Missing consumer credentials');
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Error de conexión</title></head>
        <body style="font-family: sans-serif; text-align: center; margin-top: 100px;">
          <h1 style="color: #ef4444;">❌ Error de conexión</h1>
          <p>No se recibieron las credenciales de WooCommerce.</p>
          <p>Verificá que las claves API estén configuradas correctamente en tu tienda.</p>
          <a href="/dashboard">Volver al dashboard</a>
        </body>
      </html>
    `);
  }
  
  try {
    // Decodificar state
    const decoded = jwt.verify(state, process.env.JWT_SECRET);
    const userId = decoded.userId;
    const storeUrl = decoded.storeUrl;
    
    console.log(`✅ [WOO] State decodificado: userId=${userId}, storeUrl=${storeUrl}`);
    
    // TESTEAR credenciales antes de guardar
    console.log('🔍 [WOO] Probando credenciales...');
    const testResponse = await axios.get(`${storeUrl}/wp-json/wc/v3/system_status`, {
      auth: { username: consumer_key, password: consumer_secret },
      timeout: 10000
    });
    
    console.log('✅ [WOO] Credenciales válidas! Status:', testResponse.status);
    
    // Guardar integración
    console.log('💾 [WOO] Guardando integración...');
    const integration = await Integration.findOneAndUpdate(
      { userId, platform: 'woocommerce', storeId: storeUrl },
      { 
        $set: { 
          storeName: storeUrl.replace(/^https?:\/\//, ''), 
          storeUrl, 
          status: 'active', 
          errorLog: '',
          credentials: { 
            consumerKey: encrypt(consumer_key), 
            consumerSecret: encrypt(consumer_secret) 
          },
          updatedAt: new Date() 
        },
        $setOnInsert: { 
          userId, 
          platform: 'woocommerce', 
          storeId: storeUrl, 
          createdAt: new Date() 
        } 
      },
      { upsert: true, new: true }
    );
    
    console.log(`✅ [WOO] WooCommerce conectado exitosamente: ${storeUrl}`);
    
    // Responder con HTML para cerrar la ventana emergente
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Conectado a WooCommerce</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container {
              text-align: center;
              background: white;
              padding: 40px;
              border-radius: 20px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            }
            h1 { color: #333; margin-bottom: 20px; }
            p { color: #666; font-size: 16px; }
            .success { color: #10b981; font-size: 48px; margin-bottom: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success">✓</div>
            <h1>¡Conexión Exitosa!</h1>
            <p>Tu tienda WooCommerce ha sido conectada correctamente.</p>
            <p>Esta ventana se cerrará automáticamente...</p>
          </div>
          <script>
            setTimeout(() => {
              if (window.opener) {
                window.opener.postMessage({ 
                  type: 'woocommerce_connected', 
                  success: true,
                  storeUrl: '${storeUrl}'
                }, '*');
              }
              window.close();
            }, 2000);
          </script>
        </body>
      </html>
    `);
    
  } catch(error) {
    console.error('❌ [WOO] Error en callback:', error.message);
    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Error de conexión</title></head>
        <body style="font-family: sans-serif; text-align: center; margin-top: 100px;">
          <h1 style="color: #ef4444;">❌ Error de conexión</h1>
          <p>${error.message}</p>
          <a href="/dashboard">Volver al dashboard</a>
        </body>
      </html>
    `);
  }
});

module.exports = router;