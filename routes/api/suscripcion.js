cat > routes/api/suscripcion.js << 'EOF'
const express = require('express');
const router = express.Router();
const { requireAuthAPI } = require('../../middleware/auth');
const {
  crearSuscripcion,
  cancelarSuscripcion,
  verificarEstado,
  webhookSuscripcion
} = require('../../controllers/suscripcionController');

router.post('/crear', requireAuthAPI, crearSuscripcion);
router.post('/cancelar', requireAuthAPI, cancelarSuscripcion);
router.get('/estado', requireAuthAPI, verificarEstado);
router.post('/webhook', webhookSuscripcion);

module.exports = router;
EOF