const { Resend } = require('resend');
const config = require('../../config');
const { generarFacturaHtml } = require('./templates');

const resend = new Resend(config.RESEND_API_KEY);

const enviarFacturaMail = async (orderId) => {
  const Order = require('../../models/Order');
  const User = require('../../models/User');
  
  const orden = await Order.findById(orderId).lean();
  if (!orden?.customerEmail) {
    console.log('❌ No se puede enviar email: orden sin email');
    return { ok: false, error: 'Orden sin email' };
  }
  
  try {
    const user = await User.findById(orden.userId).select('settings nombre apellido email').lean();
    const facturaHtml = await generarFacturaHtml(orden.userId, orden);
    
    const nombreFantasia = user?.settings?.razonSocial
      || (user?.nombre ? user.nombre + ' ' + (user.apellido || '') : 'Sono Handmade');
    
    const replyToEmail = user?.email || 'koi.automatic@gmail.com';
    const subject = '✅ Tu factura de ' + nombreFantasia + ' - Compra #' + (orden.externalId || orden._id.slice(-6));
    
    const { data, error } = await resend.emails.send({
      from: '"KOI-FACTURA" <hola@koi-factura.lat>',
      reply_to: replyToEmail,
      to: orden.customerEmail,
      subject: subject,
      html: facturaHtml
    });
    
    if (error) throw new Error(error.message);
    
    await Order.findByIdAndUpdate(orderId, { emailSent: true, emailSentAt: new Date() });
    
    console.log('📧 Factura enviada a ' + orden.customerEmail);
    return { ok: true, messageId: data.id };
  } catch (error) {
    console.error('❌ Error enviando factura:', error.message);
    return { ok: false, error: error.message };
  }
};

module.exports = { enviarFacturaMail };