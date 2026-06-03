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
// WOOCOMMERCE OAUTH
// ============================================================
router.get('/woo/connect', requireAuth, (req, res) => {
  // ... (tu código existente)
});

router.post('/woo/callback', async (req, res) => {
  // ... (tu código existente)
});

// ============================================================
// MERCADOLIBRE OAUTH
// ============================================================
router.get('/ml/connect', requireAuth, (req, res) => {
  console.log('🟢 [ML] /auth/ml/connect llamado');
  
  const state = jwt.sign({ userId: req.userId }, process.env.JWT_SECRET, { expiresIn: '15m' });
  const scopes = 'read write offline_access invoices orders.read shipments.read';
  const redirectUri = `${process.env.BASE_URL}/auth/ml/callback`;
  
  const authUrl = `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=${process.env.ML_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&scope=${scopes}`;
  
  console.log('🔄 [ML] Redirigiendo a:', authUrl);
  res.redirect(authUrl);
});

router.get('/ml/callback', async (req, res) => {
  console.log('📞 [ML] Callback recibido');
  console.log('  Query params:', req.query);
  
  const { code, state } = req.query;
  
  if (!code) {
    console.error('❌ [ML] Missing code');
    return res.redirect('/dashboard?error=ml_denied');
  }
  
  try {
    const { userId } = jwt.verify(state, process.env.JWT_SECRET);
    console.log(`✅ [ML] State decodificado: userId=${userId}`);
    
    const { data: token } = await axios.post('https://api.mercadolibre.com/oauth/token', {
      grant_type: 'authorization_code',
      client_id: process.env.ML_CLIENT_ID,
      client_secret: process.env.ML_CLIENT_SECRET,
      code,
      redirect_uri: `${process.env.BASE_URL}/auth/ml/callback`
    });
    
    console.log('✅ [ML] Token obtenido');
    
    const { data: seller } = await axios.get('https://api.mercadolibre.com/users/me', {
      headers: { Authorization: `Bearer ${token.access_token}` }
    });
    
    const sellerId = String(token.user_id || seller.id);
    console.log(`✅ [ML] Seller ID: ${sellerId}, Nickname: ${seller.nickname}`);
    
    await Integration.findOneAndUpdate(
      { userId, platform: 'mercadolibre', storeId: sellerId },
      { 
        $set: { 
          storeName: seller.nickname || `ML ${sellerId}`, 
          status: 'active',
          credentials: { 
            accessToken: encrypt(token.access_token), 
            refreshToken: encrypt(token.refresh_token),
            tokenExpiry: new Date(Date.now() + token.expires_in * 1000).toISOString(),
            sellerId 
          },
          updatedAt: new Date()
        },
        $setOnInsert: { 
          userId, 
          platform: 'mercadolibre', 
          storeId: sellerId, 
          createdAt: new Date() 
        }
      },
      { upsert: true }
    );
    
    console.log(`✅ MercadoLibre conectado: ${seller.nickname}`);
    res.redirect('/dashboard?ml=connected');
    
  } catch (error) {
    console.error('❌ [ML] Error en callback:', error.message);
    res.redirect('/dashboard?error=ml_failed');
  }
});

module.exports = router;