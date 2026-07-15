// config/mercadopago.js
const mercadopago = require('mercadopago');

const token = process.env.MP_ACCESS_TOKEN;

if (!token) {
  console.error('❌ MP_ACCESS_TOKEN no está definido en variables de entorno');
  console.error('💡 Agregá MP_ACCESS_TOKEN en las variables de entorno de Render');
} else {
  try {
    mercadopago.configure({
      access_token: token
    });
    console.log('✅ Mercado Pago configurado correctamente');
    console.log('🔍 Token length:', token.length);
    console.log('🔍 Token preview:', token.substring(0, 10) + '...');
  } catch (error) {
    console.error('❌ Error configurando Mercado Pago:', error.message);
  }
}

// 👇 EXPORTAR LA INSTANCIA CONFIGURADA
module.exports = mercadopago;