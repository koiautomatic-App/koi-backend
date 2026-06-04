// services/pdf/invoice.js - MODIFICADO
const { generatePDF } = require('./generate');

async function generateInvoicePDF(userId, orden) {
  try {
    console.log(`📄 Generando PDF para orden ${orden.externalId}`);
    
    // ✅ Ya NO llamas a generarFacturaHtml()
    // ✅ Envías los datos directamente al Lambda
    
    const items = orden.items.map(item => ({
      descripcion: item.name || item.descripcion,
      cantidad: item.quantity || item.cantidad,
      precio: item.price || item.precio
    }));
    
    const orderData = {
      orderId: orden.externalId,
      nroFormatted: orden.nroFormatted,
      items: items,
      total: orden.total,
      cliente: {
        nombre: orden.cliente?.nombre || orden.user?.name,
        tipoDoc: orden.cliente?.tipoDoc || 'DNI',
        numeroDoc: orden.cliente?.numeroDoc || orden.user?.documento,
        email: orden.cliente?.email || orden.user?.email
      }
    };
    
    const pdfBuffer = await generatePDF(orderData);
    return pdfBuffer;
    
  } catch (error) {
    console.error('❌ Error en generateInvoicePDF:', error);
    throw error;
  }
}

module.exports = { generateInvoicePDF };