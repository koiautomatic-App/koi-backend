const normalizeWooCommerce = require('./woocommerce');
const normalizeMercadoLibre = require('./mercadolibre');
const normalizeTiendaNube = require('./tiendanube');
const normalizeVTEX = require('./vtex');
const normalizeEmpretienda = require('./empretienda');
const normalizeRappi = require('./rappi');
const normalizeShopify = require('./shopify');

module.exports = {
  woocommerce: normalizeWooCommerce,
  mercadolibre: normalizeMercadoLibre,
  tiendanube: normalizeTiendaNube,
  vtex: normalizeVTEX,
  empretienda: normalizeEmpretienda,
  rappi: normalizeRappi,
  shopify: normalizeShopify
};
