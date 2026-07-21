// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Lista de países (extraída para mejor mantenimiento)
const PAISES_VALIDOS = [
  'AR', 'MX', 'CO', 'CL', 'PE', 'BR', 'UY', 'PY', 'BO', 
  'VE', 'EC', 'GT', 'HN', 'NI', 'CR', 'PA', 'DO', 'PR'
];

const UserSchema = new mongoose.Schema({
  nombre: { type: String, trim: true },
  apellido: { type: String, trim: true },
  email: { 
    type: String, 
    required: true, 
    unique: true, 
    lowercase: true, 
    trim: true 
  },
  password: { type: String, select: false },
  googleId: { type: String, sparse: true, unique: true },
  avatar: { type: String },
  plan: { 
    type: String, 
    default: 'free', 
    enum: ['free', 'pro'] 
  },
  
  // 👇 CAMPOS DE PAÍS
  pais: {
    type: String,
    default: 'AR',
    enum: PAISES_VALIDOS
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
    envioReporteAuto: { type: Boolean, default: false }, // 👈 NUEVO CAMPO
    categoria: { type: String, default: 'C' },
    condicionFiscal: { 
      type: String, 
      default: 'responsable_inscripto', 
      enum: ['responsable_inscripto', 'monotributo', 'exento'] 
    },
    cuit: { type: String },
    razonSocial: { type: String },
    puntoVenta: { type: Number },
    tipoComprobante: { type: Number, default: 11 },
    arcaClave: { type: String, select: false }, // 👈 Oculto por seguridad
    arcaStatus: { 
      type: String, 
      default: 'pendiente', 
      enum: ['pendiente', 'vinculado'] 
    },
    arcaPtoVta: { type: Number, default: 1 },
    logoUrl: { type: String, default: '' },
    fechaVinculacionARCA: { type: Date, default: null },
    fechaInicioVinculacion: { type: Date, default: null },
    suscripcionActiva: { type: Boolean, default: false },
    fechaUltimoPago: { type: Date, default: null },
    proximoPago: { type: Date, default: null },
    estadoCicloVida: { 
      type: String, 
      default: 'cortesia_activa', 
      enum: ['cortesia_activa', 'cortesia_extendida', 'suscripto', 'expirado', 'suspendido', 'cancelado'] 
    },
    paymentId: { type: String, default: '' },
    preapprovalId: { type: String, default: null },
    ultimoMontoPago: { type: Number, default: 40000 },
    // 👇 CAMPOS PARA CONTADOR
    contadorEmail: { type: String, default: '' },
    contadorNombre: { type: String, default: '' }
  },
  ultimoAcceso: { type: Date, default: Date.now }
}, {
  timestamps: { 
    createdAt: 'creadoEn', 
    updatedAt: 'actualizadoEn' 
  }
});

// 📌 ÍNDICES PARA RENDIMIENTO
UserSchema.index({ email: 1 });
UserSchema.index({ googleId: 1 }, { sparse: true, unique: true });
UserSchema.index({ 'settings.arcaStatus': 1 });
UserSchema.index({ plan: 1 });
UserSchema.index({ pais: 1 });

// 🔐 MIDDLEWARE: Hash de contraseña antes de guardar
UserSchema.pre('save', async function(next) {
  // Solo hashear si la contraseña fue modificada
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// 🛠️ MÉTODOS DE INSTANCIA
UserSchema.methods.checkPassword = async function(password) {
  if (!this.password) return false;
  return bcrypt.compare(password, this.password);
};

// 🔍 MÉTODOS ESTÁTICOS
UserSchema.statics.findByEmailWithPassword = function(email) {
  return this.findOne({ email }).select('+password');
};

UserSchema.statics.findByEmail = function(email) {
  return this.findOne({ email });
};

UserSchema.statics.findByGoogleId = function(googleId) {
  return this.findOne({ googleId });
};

// 📊 VIRTUALES (propiedades calculadas)
UserSchema.virtual('nombreCompleto').get(function() {
  const partes = [this.nombre, this.apellido].filter(Boolean);
  return partes.length > 0 ? partes.join(' ') : 'Usuario';
});

UserSchema.virtual('tieneARCA').get(function() {
  return this.settings.arcaStatus === 'vinculado';
});

UserSchema.virtual('esPro').get(function() {
  return this.plan === 'pro';
});

// ⚙️ CONFIGURACIÓN PARA VIRTUALES EN JSON/OBJECT
UserSchema.set('toJSON', { virtuals: true });
UserSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('User', UserSchema);