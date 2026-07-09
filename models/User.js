// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  nombre: { type: String, trim: true },
  apellido: { type: String, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, select: false },
  googleId: { type: String, sparse: true },
  avatar: { type: String },
  plan: { type: String, default: 'free', enum: ['free', 'pro'] },
  
  // 👇 NUEVOS CAMPOS DE PAÍS
  pais: {
    type: String,
    default: 'AR',
    enum: ['AR', 'MX', 'CO', 'CL', 'PE', 'BR', 'UY', 'PY', 'BO', 'VE', 'EC', 'GT', 'HN', 'NI', 'CR', 'PA', 'DO', 'PR']
  },
  paisSeleccionado: {
    type: Boolean,
    default: false
  },
  paisSeleccionadoEn: {
    type: Date,
    default: null
  },
  
  settings: {
    factAuto: { type: Boolean, default: true },
    envioAuto: { type: Boolean, default: true },
    categoria: { type: String, default: 'C' },
    condicionFiscal: { type: String, default: 'responsable_inscripto', enum: ['responsable_inscripto', 'monotributo', 'exento'] },
    cuit: { type: String },
    razonSocial: { type: String },
    puntoVenta: { type: Number },
    tipoComprobante: { type: Number, default: 11 },
    arcaClave: { type: String },
    arcaStatus: { type: String, default: 'pendiente', enum: ['pendiente', 'vinculado'] },
    arcaPtoVta: { type: Number, default: 1 },
    logoUrl: { type: String, default: '' },
    fechaVinculacionARCA: { type: Date, default: null },
    fechaInicioVinculacion: { type: Date, default: null },
    suscripcionActiva: { type: Boolean, default: false },
    fechaUltimoPago: { type: Date, default: null },
    proximoPago: { type: Date, default: null },
    estadoCicloVida: { type: String, default: 'cortesia_activa', enum: ['cortesia_activa', 'cortesia_extendida', 'suscripto', 'expirado', 'suspendido', 'cancelado'] },
    paymentId: { type: String, default: '' },
    preapprovalId: { type: String, default: null },
    ultimoMontoPago: { type: Number, default: 40000 },
    // 👇 NUEVOS CAMPOS PARA CONTADOR 👇
    contadorEmail: { type: String, default: '' },
    contadorNombre: { type: String, default: '' }
  },
  ultimoAcceso: { type: Date, default: Date.now },
  creadoEn: { type: Date, default: Date.now }
});

UserSchema.methods.checkPassword = async function(password) {
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('User', UserSchema);