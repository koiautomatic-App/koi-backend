// services/pdf/generate.js - Versión mejorada (envía datos completos)
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const lambdaClient = new LambdaClient({
  region: 'us-east-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

async function generatePDF(orderData) {
  const {
    orderId,
    nroFormatted,
    items,
    total,
    fecha,
    cliente,
    nombreFantasia,
    razonSocial,
    cuitFmt,
    tipoFactura,
    impNeto,
    impIVA,
    caeDisplay,
    caeVto,
    logoUrl
  } = orderData;
  
  console.log(`📄 Solicitando PDF para orden ${orderId}`);
  
  // Envía TODOS los datos que la Lambda necesita
  const payload = {
    orderId,
    nroFormatted,
    items,
    total,
    fecha,
    cliente,
    nombreFantasia: nombreFantasia || 'KOI',
    razonSocial: razonSocial || 'KOI S.R.L.',
    cuitFmt: cuitFmt || '20-30978248-9',
    tipoFactura: tipoFactura || 'FACTURA C',
    impNeto,
    impIVA,
    caeDisplay: caeDisplay || '86228278246278',
    caeVto: caeVto || '13/6/2026',
    logoUrl: logoUrl || null
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