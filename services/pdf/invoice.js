// services/pdf/invoice.js - Versión mejorada
const { generatePDF } = require('./generate');

async function generateInvoicePDF(userId, orden) {
  try {
    console.log(`📄 Generando PDF para orden ${orden.externalId}`);
    
    // Mapear items al formato esperado
    const items = orden.items.map(item => ({
      descripcion: item.name || item.descripcion,
      cantidad: item.quantity || item.cantidad,
      precio: item.price || item.precio
    }));
    
    // Calcular total si no viene
    const total = orden.total || items.reduce((sum, i) => sum + (i.cantidad * i.precio), 0);
    
    // Datos completos para la Lambda
    const orderData = {
      orderId: orden.externalId,
      nroFormatted: orden.nroFormatted,
      items: items,
      total: total,
      fecha: orden.fecha || orden.createdAt || new Date().toISOString(),
      cliente: {
        nombre: orden.cliente?.nombre || orden.user?.name,
        tipoDoc: orden.cliente?.tipoDoc || 'DNI',
        numeroDoc: orden.cliente?.numeroDoc || orden.user?.documento,
        email: orden.cliente?.email || orden.user?.email
      },
      // Datos de la empresa (los tomas de la orden o de configuración)
      nombreFantasia: orden.nombreFantasia || 'Finisterre Arg',
      razonSocial: orden.razonSocial || 'Finisterre Arg',
      cuitFmt: orden.cuitFmt || '20-30978248-9',
      tipoFactura: orden.tipoFactura || 'FACTURA C',
      impNeto: orden.impNeto,
      impIVA: orden.impIVA,
      caeDisplay: orden.caeDisplay,
      caeVto: orden.caeVto,
      logoUrl: orden.logoUrl || null
    };
    
    const pdfBuffer = await generatePDF(orderData);
    return pdfBuffer;
    
  } catch (error) {
    console.error('❌ Error en generateInvoicePDF:', error);
    throw error;
  }
}

module.exports = { generateInvoicePDF };