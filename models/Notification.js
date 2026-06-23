const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    mensaje: {
        type: String,
        required: true
    },
    tipo: {
        type: String,
        enum: ['info', 'success', 'warning', 'error', 'update', 'promo'],
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
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Notification', notificationSchema);