const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    titulo: {
        type: String,
        required: true,
        trim: true
    },
    mensaje: {
        type: String,
        required: true,
        trim: true
    },
    tipo: {
        type: String,
        enum: ['info', 'success', 'warning', 'error', 'factura', 'cae', 'sistema', 'suscripcion', 'integracion', 'arca'],
        default: 'info'
    },
    leida: {
        type: Boolean,
        default: false,
        index: true
    },
    fechaCreacion: {
        type: Date,
        default: Date.now,
        index: true
    },
    fechaLectura: {
        type: Date
    },
    data: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
}, {
    timestamps: { 
        createdAt: 'fechaCreacion',
        updatedAt: false
    }
});

// Índice compuesto para consultas rápidas
notificationSchema.index({ userId: 1, leida: 1, fechaCreacion: -1 });

module.exports = mongoose.model('Notification', notificationSchema);