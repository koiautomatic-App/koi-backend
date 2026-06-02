const axios = require('axios');

// Configuración del microservicio PDF en AWS Lambda
const PDF_SERVICE_URL = process.env.PDF_SERVICE_URL || 'https://tu-api-gateway-id.execute-api.us-east-1.amazonaws.com/prod/generate-pdf';

/**
 * Genera un PDF a partir de HTML usando el microservicio AWS Lambda
 * @param {string} html - HTML del comprobante
 * @param {string} filename - Nombre del archivo (opcional)
 * @returns {Promise<Buffer>} - Buffer del PDF
 */
async function generatePDF(html, filename = 'comprobante.pdf') {
  if (!html) {
    throw new Error('HTML es requerido para generar el PDF');
  }

  try {
    console.log(`📄 Solicitando PDF al microservicio: ${PDF_SERVICE_URL}`);
    
    const response = await axios.post(PDF_SERVICE_URL, {
      html,
      filename
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      responseType: 'arraybuffer',
      timeout: 30000
    });

    const buffer = Buffer.from(response.data);
    const isPDF = buffer.slice(0, 4).toString() === '%PDF';
    
    if (!isPDF) {
      console.warn('⚠️ La respuesta no parece ser un PDF válido');
      try {
        const text = buffer.toString('utf8');
        const error = JSON.parse(text);
        throw new Error(error.error || 'Error del microservicio');
      } catch(e) {
        // No es JSON, seguir con el buffer original
      }
    }

    console.log(`✅ PDF generado correctamente (${buffer.length} bytes)`);
    return buffer;

  } catch (error) {
    console.error('❌ Error generando PDF:', error.message);
    console.log('⚠️ Usando fallback: devolviendo HTML en lugar de PDF');
    return Buffer.from(html, 'utf-8');
  }
}

module.exports = { generatePDF };