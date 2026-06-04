// services/pdf/generate.js - MODIFICADO
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const lambdaClient = new LambdaClient({
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

async function generatePDF(orderData) {
  const { orderId, nroFormatted, items, total, cliente } = orderData;
  
  console.log(`📄 Solicitando PDF para orden ${orderId}`);
  
  // ✅ Envía datos estructurados, NO HTML
  const payload = {
    orderId,
    nroFormatted,
    items,
    total,
    fecha: new Date().toISOString(),
    cliente
  };
  
  const command = new InvokeCommand({
    FunctionName: 'koi-pdf-generator',
    Payload: JSON.stringify({ body: JSON.stringify(payload) })
  });
  
  try {
    const response = await lambdaClient.send(command);
    const responsePayload = JSON.parse(Buffer.from(response.Payload).toString());
    const result = JSON.parse(responsePayload.body);
    
    if (result.success && result.pdfUrl) {
      // Descargar el PDF desde S3
      const https = require('https');
      const pdfBuffer = await new Promise((resolve, reject) => {
        https.get(result.pdfUrl, (res) => {
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', reject);
      });
      
      console.log(`✅ PDF generado (${pdfBuffer.length} bytes)`);
      return pdfBuffer;
    } else {
      throw new Error(result.error || 'Error desconocido');
    }
  } catch (error) {
    console.error('❌ Error generando PDF:', error);
    throw error;
  }
}

module.exports = { generatePDF };