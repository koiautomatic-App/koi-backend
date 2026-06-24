const express = require('express');
const router = express.Router();
const { requireAuthAPI, requireAdmin } = require('../../middleware/auth');
const {
  actualizarPtoVenta,
  vincularArca,
  desvincularArca,
  verClaveArca,
  getStats,
  listarUsuarios,
  exportarCSV,
  listarIntegraciones,
  desvincularUsuario
} = require('../../controllers/adminController');
const User = require('../../models/User');
const Notification = require('../../models/Notification');

// ============================================================
//  RUTAS EXISTENTES
// ============================================================
router.post('/actualizar-pto-venta', requireAuthAPI, requireAdmin, actualizarPtoVenta);
router.post('/vincular-arca', requireAuthAPI, requireAdmin, vincularArca);
router.post('/desvincular-arca', requireAuthAPI, requireAdmin, desvincularArca);
router.get('/user/:userId/arca-clave', requireAuthAPI, requireAdmin, verClaveArca);
router.get('/stats', requireAuthAPI, requireAdmin, getStats);
router.get('/users', requireAuthAPI, requireAdmin, listarUsuarios);
router.get('/export-csv', requireAuthAPI, requireAdmin, exportarCSV);
router.get('/integrations', requireAuthAPI, requireAdmin, listarIntegraciones);
router.post('/desvincular', requireAuthAPI, requireAdmin, desvincularUsuario);

// ============================================================
//  NOTIFICACIONES - ADMIN
//  POST /api/admin/notifications/send
// ============================================================
router.post('/notifications/send', requireAuthAPI, requireAdmin, async (req, res) => {
    try {
        const { userId, titulo, mensaje, tipo } = req.body;
        
        console.log('📨 Enviando notificación:');
        console.log('  👤 userId:', userId);
        console.log('  📌 titulo:', titulo);
        console.log('  📝 mensaje:', mensaje);
        console.log('  🏷️ tipo:', tipo);
        
        // Validar campos requeridos
        if (!userId) {
            return res.status(400).json({ error: 'El userId es requerido' });
        }
        if (!titulo || titulo.trim().length === 0) {
            return res.status(400).json({ error: 'El titulo es requerido' });
        }
        if (!mensaje || mensaje.trim().length === 0) {
            return res.status(400).json({ error: 'El mensaje es requerido' });
        }
        if (mensaje.trim().length < 5) {
            return res.status(400).json({ error: 'El mensaje debe tener al menos 5 caracteres' });
        }
        
        // Verificar que el usuario existe
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Crear notificación
        const notification = new Notification({
            userId,
            titulo: titulo.trim(),
            mensaje: mensaje.trim(),
            tipo: tipo || 'info',
            leida: false,
            fechaCreacion: new Date()
        });
        
        await notification.save();
        
        console.log(`✅ Notificación enviada a ${user.nombre || user.email}: ${titulo}`);
        
        res.json({
            ok: true,
            notification,
            message: `Notificación enviada a ${user.nombre || user.email || 'KOI-FACTURA'}`
        });
        
    } catch (error) {
        console.error('❌ Error enviando notificación:', error);
        res.status(500).json({ 
            error: 'Error al enviar la notificación: ' + error.message 
        });
    }
});

module.exports = router;