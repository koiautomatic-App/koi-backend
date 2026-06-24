const express = require('express');
const router = express.Router();
const { requireAuthAPI } = require('../../middleware/auth');
const Notification = require('../../models/Notification');

// ============================================================
//  GET /api/notifications - Obtener notificaciones del usuario
// ============================================================
router.get('/', requireAuthAPI, async (req, res) => {
    try {
        const userId = req.user._id;
        const { limit = 20, page = 1, soloNoLeidas = false } = req.query;
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        // Construir filtro
        const filter = { userId };
        if (soloNoLeidas === 'true') {
            filter.leida = false;
        }
        
        // Obtener notificaciones
        const notifications = await Notification.find(filter)
            .sort({ fechaCreacion: -1 })
            .skip(skip)
            .limit(parseInt(limit));
        
        // Contar total y no leídas
        const total = await Notification.countDocuments({ userId });
        const noLeidas = await Notification.countDocuments({ userId, leida: false });
        
        res.json({
            ok: true,
            notifications,
            noLeidas,
            total,
            page: parseInt(page),
            totalPages: Math.ceil(total / parseInt(limit))
        });
        
    } catch (error) {
        console.error('Error obteniendo notificaciones:', error);
        res.status(500).json({ error: 'Error al obtener notificaciones' });
    }
});

// ============================================================
//  POST /api/notifications/:id/read - Marcar como leída
// ============================================================
router.post('/:id/read', requireAuthAPI, async (req, res) => {
    try {
        const userId = req.user._id;
        const notificationId = req.params.id;
        
        const notification = await Notification.findOne({
            _id: notificationId,
            userId
        });
        
        if (!notification) {
            return res.status(404).json({ error: 'Notificación no encontrada' });
        }
        
        notification.leida = true;
        notification.fechaLectura = new Date();
        await notification.save();
        
        res.json({
            ok: true,
            notification
        });
        
    } catch (error) {
        console.error('Error marcando notificación:', error);
        res.status(500).json({ error: 'Error al marcar la notificación' });
    }
});

// ============================================================
//  POST /api/notifications/read-all - Marcar todas como leídas
// ============================================================
router.post('/read-all', requireAuthAPI, async (req, res) => {
    try {
        const userId = req.user._id;
        
        await Notification.updateMany(
            { userId, leida: false },
            { leida: true, fechaLectura: new Date() }
        );
        
        res.json({
            ok: true,
            message: 'Todas las notificaciones marcadas como leídas'
        });
        
    } catch (error) {
        console.error('Error marcando todas:', error);
        res.status(500).json({ error: 'Error al marcar notificaciones' });
    }
});

module.exports = router;