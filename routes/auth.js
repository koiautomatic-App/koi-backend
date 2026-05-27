// routes/auth.js
const express = require('express');
const passport = require('passport');
const router = express.Router();
const { register, login, logout } = require('../controllers/authController');
const { signToken, setTokenCookie } = require('../middleware/auth');

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
    scope: ['profile', 'email'],
    prompt: 'select_account'
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

module.exports = router;