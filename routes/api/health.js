// routes/health.js
const express = require('express');
const router = express.Router();

// Health check para Render
router.get('/', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

module.exports = router;