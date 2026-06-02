// services/pdf/generate.js
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

// Configurar cliente de Lambda
const lambdaClient = new LambdaClient({
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

/**
 * Genera un PDF a partir de HTML usando AWS Lambda
 * @param {string} html - HTML del comprobante
 * @param {string} orderId - ID de la orden
 * @param {string} nroFormatted - Número de comprobante formateado
 * @returns {Promise<Buffer>} - Buffer del PDF
 */
async function generatePDF(html, orderId, nroFormatted) {
  if (!html) {
    throw new Error('HTML es requerido para generar el PDF');
  }

  try {
    console.log(`📄 Solicitando PDF al microservicio Lambda para orden ${orderId}`);
    
    const payload = {
      body: JSON.stringify({
        html,
        orderId,
        nroFormatted: nroFormatted || `ORDEN-${orderId}`
      })
    };
    
    const command = new InvokeCommand({
      FunctionName: 'koi-pdf-generator',
      Payload: Buffer.from(JSON.stringify(payload))
    });
    
    const response = await lambdaClient.send(command);
    const responsePayload = JSON.parse(Buffer.from(response.Payload).toString());
    const result = JSON.parse(responsePayload.body);
    
    if (result.success && result.pdfUrl) {
      // Descargar el PDF desde la URL generada
      const https = require('https');
      const url = require('url');
      
      const pdfBuffer = await new Promise((resolve, reject) => {
        const parsedUrl = url.parse(result.pdfUrl);
        const options = {
          hostname: parsedUrl.hostname,
          path: parsedUrl.path,
          method: 'GET',
          headers: {
            'Accept': 'application/pdf'
          }
        };
        
        const req = https.request(options, (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const buffer = Buffer.concat(chunks);
            // Verificar que es PDF
            if (buffer.slice(0, 4).toString() === '%PDF') {
              resolve(buffer);
            } else {
              reject(new Error('No se recibió un PDF válido'));
            }
          });
        });
        
        req.on('error', reject);
        req.end();
      });
      
      console.log(`✅ PDF generado correctamente (${pdfBuffer.length} bytes)`);
      return pdfBuffer;
      
    } else {
      throw new Error(result.error || 'Error desconocido del microservicio');
    }

  } catch (error) {
    console.error('❌ Error generando PDF:', error.message);
    console.log('⚠️ Usando fallback: devolviendo HTML en lugar de PDF');
    return Buffer.from(html, 'utf-8');
  }
}

module.exports = { generatePDF };