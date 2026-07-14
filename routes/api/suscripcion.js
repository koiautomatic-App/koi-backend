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

// ============================================================
//  GET /api/suscripcion/webhook/status - Verificar estado del webhook
// ============================================================
router.get('/webhook/status', requireAuthAPI, async (req, res) => {
    try {
        const userId = req.userId;
        const User = require('../../models/User');
        const user = await User.findById(userId);
        
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Intentar obtener logs de webhook (si existe el modelo)
        let webhookLogs = [];
        try {
            const WebhookLog = require('../../models/WebhookLog');
            webhookLogs = await WebhookLog.find({ userId })
                .sort({ createdAt: -1 })
                .limit(10)
                .lean();
        } catch (e) {
            // Modelo no existe, continuar sin logs
            console.log('ℹ️ Modelo WebhookLog no encontrado (opcional)');
        }
        
        res.json({
            ok: true,
            suscripcionActiva: user.suscripcionActiva || false,
            plan: user.plan || 'free',
            proximoPago: user.settings?.proximoPago || null,
            ultimoPago: user.settings?.ultimoPago || null,
            webhookLogs: webhookLogs,
            mensaje: user.suscripcionActiva 
                ? '✅ Suscripción activa' 
                : '⚠️ Suscripción inactiva'
        });
        
    } catch (error) {
        console.error('❌ Error en webhook/status:', error);
        res.status(500).json({ 
            ok: false, 
            error: error.message 
        });
    }
});

module.exports = router;