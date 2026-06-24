const express = require('express');
const router = express.Router();
const { requireAuthAPI } = require('../../middleware/auth');

// ============================================================
//  GET /api/notifications - Obtener notificaciones del usuario
// ============================================================
router.get('/', requireAuthAPI, async (req, res) => {
    try {
        console.log('🔔 GET /api/notifications - Iniciando...');
        console.log('📌 Usuario ID:', req.user?._id);
        console.log('📌 Usuario email:', req.user?.email);
        console.log('📌 req.userId:', req.userId);
        
        // Importar modelo dentro de la función para ver si hay error
        let Notification;
        try {
            Notification = require('../../models/Notification');
            console.log('✅ Modelo Notification cargado correctamente');
        } catch (err) {
            console.error('❌ Error cargando modelo Notification:', err.message);
            return res.status(500).json({ 
                error: 'Error cargando modelo',
                details: err.message 
            });
        }

        const userId = req.userId || req.user?._id;
        
        if (!userId) {
            console.error('❌ No se encontró userId');
            return res.status(401).json({ error: 'Usuario no autenticado' });
        }
        
        const { limit = 20, page = 1, soloNoLeidas = false } = req.query;
        
        console.log(`📋 Filtros: limit=${limit}, page=${page}, soloNoLeidas=${soloNoLeidas}`);
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        // Construir filtro
        const filter = { userId };
        if (soloNoLeidas === 'true') {
            filter.leida = false;
        }
        
        console.log('🔍 Buscando con filtro:', JSON.stringify(filter));
        
        // Obtener notificaciones
        const notifications = await Notification.find(filter)
            .sort({ fechaCreacion: -1 })
            .skip(skip)
            .limit(parseInt(limit));
        
        console.log(`✅ Encontradas ${notifications.length} notificaciones`);
        
        // Contar total y no leídas
        const total = await Notification.countDocuments({ userId });
        const noLeidas = await Notification.countDocuments({ userId, leida: false });
        
        console.log(`📊 Total: ${total}, No leídas: ${noLeidas}`);
        
        res.json({
            ok: true,
            notifications,
            noLeidas,
            total,
            page: parseInt(page),
            totalPages: Math.ceil(total / parseInt(limit))
        });
        
    } catch (error) {
        console.error('❌ ERROR DETALLADO:', error);
        console.error('❌ Stack:', error.stack);
        console.error('❌ Mensaje:', error.message);
        res.status(500).json({ 
            error: 'Error al obtener notificaciones',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// ============================================================
//  POST /api/notifications/:id/read - Marcar como leída
// ============================================================
router.post('/:id/read', requireAuthAPI, async (req, res) => {
    try {
        let Notification;
        try {
            Notification = require('../../models/Notification');
        } catch (err) {
            return res.status(500).json({ 
                error: 'Error cargando modelo',
                details: err.message 
            });
        }

        const userId = req.userId || req.user?._id;
        
        if (!userId) {
            return res.status(401).json({ error: 'Usuario no autenticado' });
        }
        
        const notificationId = req.params.id;
        
        console.log(`📖 Marcando notificación ${notificationId} como leída para usuario ${userId}`);
        
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
        
        console.log('✅ Notificación marcada como leída');
        
        res.json({
            ok: true,
            notification
        });
        
    } catch (error) {
        console.error('❌ Error marcando notificación:', error);
        res.status(500).json({ 
            error: 'Error al marcar la notificación',
            details: error.message 
        });
    }
});

// ============================================================
//  POST /api/notifications/read-all - Marcar todas como leídas
// ============================================================
router.post('/read-all', requireAuthAPI, async (req, res) => {
    try {
        let Notification;
        try {
            Notification = require('../../models/Notification');
        } catch (err) {
            return res.status(500).json({ 
                error: 'Error cargando modelo',
                details: err.message 
            });
        }

        const userId = req.userId || req.user?._id;
        
        if (!userId) {
            return res.status(401).json({ error: 'Usuario no autenticado' });
        }
        
        console.log(`📖 Marcando todas las notificaciones como leídas para usuario ${userId}`);
        
        const result = await Notification.updateMany(
            { userId, leida: false },
            { leida: true, fechaLectura: new Date() }
        );
        
        console.log(`✅ ${result.modifiedCount} notificaciones marcadas como leídas`);
        
        res.json({
            ok: true,
            message: 'Todas las notificaciones marcadas como leídas',
            modifiedCount: result.modifiedCount
        });
        
    } catch (error) {
        console.error('❌ Error marcando todas:', error);
        res.status(500).json({ 
            error: 'Error al marcar notificaciones',
            details: error.message 
        });
    }
});

module.exports = router;