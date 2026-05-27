// models/Order.js - VERSIÓN COMPLETA
const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  integrationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Integration' },
  platform: { type: String, required: true },
  externalId: { type: String, required: true },
  customerName: { type: String, default: '' },
  customerEmail: { type: String, default: '' },
  customerDoc: { type: String, default: '0' },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'ARS' },
  concepto: { type: String, default: '' },
  items: [{
    nombre: { type: String },
    cantidad: { type: Number, default: 1 },
    precio: { type: Number },
    sku: { type: String },
  }],
  orderDate: { type: Date },
  rawPayload: { type: mongoose.Schema.Types.Mixed, default: null },
  status: {
    type: String,
    default: 'pending_invoice',
    enum: ['pending_invoice', 'invoiced', 'error_data', 'error_afip', 'skipped', 'cancelled', 'cancelled_by_nc'],
  },
  // Datos de la factura emitida
  caeNumber: { type: String },
  caeExpiry: { type: Date },
  nroComprobante: { type: Number },
  tipoComprobante: { type: Number },
  puntoVenta: { type: Number },
  fechaEmision: { type: Date },
  errorLog: { type: String },
  nroFormatted: { type: String, default: '' },
  emailSent: { type: Boolean, default: false },
  emailSentAt: { type: Date },
  // Campos para MercadoLibre
  customerZipCode: { type: String, default: '' },
  taxCondition: { type: String, default: 'consumidor_final' },
  customerAddress: { type: mongoose.Schema.Types.Mixed, default: {} },
  shippingType: { type: String, default: '' },
  shippingCarrier: { type: String, default: '' },
  shippingCost: { type: Number, default: 0 },
  shouldIncludeShipping: { type: Boolean, default: false },
  shippingAddress: { type: mongoose.Schema.Types.Mixed, default: {} },
  // Campos para enriquecimiento
  buyerId: { type: String, default: '' },
  shipmentId: { type: String, default: '' },
  buyerFirstName: { type: String, default: '' },
  buyerLastName: { type: String, default: '' },
  buyerIdentificationType: { type: String, default: '' },
  buyerIdentificationNumber: { type: String, default: '' },
  shippingMode: { type: String, default: '' },
  shippingStatus: { type: String, default: '' },
  shippingDestinationAddress: { type: mongoose.Schema.Types.Mixed, default: {} },
  orderEnriched: { type: Boolean, default: false },
  // Relación Factura ↔ Nota de Crédito
  facturaOriginalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  facturaOriginalNro: { type: String, default: '' },
  ncAsociadaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  ncAsociadaNro: { type: String, default: '' },
  canceledAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

OrderSchema.index({ userId: 1, platform: 1, externalId: 1 }, { unique: true });
OrderSchema.index({ userId: 1, status: 1, createdAt: -1 });
OrderSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Order', OrderSchema);