const mongoose = require('mongoose');
const crypto = require('crypto');
const { encrypt, decrypt } = require('../utils/encrypt');

const IntegrationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  platform: { type: String, required: true, enum: ['woocommerce', 'tiendanube', 'mercadolibre', 'empretienda', 'rappi', 'vtex', 'shopify', 'manual'] },
  storeId: { type: String, required: true },
  storeName: { type: String },
  storeUrl: { type: String },
  status: { type: String, default: 'active', enum: ['active', 'paused', 'error', 'pending'] },
  credentials: { type: mongoose.Schema.Types.Mixed, default: {} },
  webhookSecret: { type: String, default: () => crypto.randomBytes(24).toString('hex'), index: true },
  lastSyncAt: { type: Date },
  errorLog: { type: String },
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

IntegrationSchema.index({ userId: 1, platform: 1, storeId: 1 }, { unique: true });

IntegrationSchema.methods.setKey = function(field, value) {
  this.credentials = { ...this.credentials, [field]: encrypt(value) };
};

IntegrationSchema.methods.getKey = function(field) {
  return decrypt(this.credentials?.[field]);
};

module.exports = mongoose.model('Integration', IntegrationSchema);