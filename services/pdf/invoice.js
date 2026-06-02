const { generarFacturaHtml } = require('../email/templates');
const { generatePDF } = require('./generate');

/**
 * Genera el PDF de una factura/NC usando el microservicio AWS Lambda
 * @param {string} userId - ID del usuario
 * @param {object} orden - Objeto de la orden
 * @returns {Promise<Buffer>} - Buffer del PDF
 */
async function generateInvoicePDF(userId, orden) {
  try {
    // 1. Generar el HTML usando la función existente
    const html = await generarFacturaHtml(userId, orden);
    
    // 2. Generar nombre de archivo
    const filename = `${orden.nroFormatted || 'comprobante'}.pdf`;
    
    // 3. Llamar al microservicio para convertir HTML a PDF
    const pdfBuffer = await generatePDF(html, filename);
    
    return pdfBuffer;
    
  } catch (error) {
    console.error('❌ Error en generateInvoicePDF:', error.message);
    
    // Fallback: devolver HTML como buffer
    const html = await generarFacturaHtml(userId, orden);
    return Buffer.from(html, 'utf-8');
  }
}

module.exports = { generateInvoicePDF };
