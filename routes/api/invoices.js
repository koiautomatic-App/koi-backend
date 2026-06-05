// routes/api/invoices.js
const express = require('express');
const router = express.Router();
const Order = require('../../models/Order');
const { generateInvoicePDF } = require('../../services/pdf-generator');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { requireAuthAPI } = require('../../middleware/auth');

// Configurar S3
const s3 = new S3Client({
  region: 'us-east-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// Endpoint para regenerar PDF de una orden específica
router.post('/regenerate/:orderId', requireAuthAPI, async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    
    if (!order) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    
    console.log(`📄 Regenerando PDF para orden ${order.externalId}...`);
    
    // Generar PDF
    const pdfBuffer = await generateInvoicePDF(req.userId, order);
    
    // Subir a S3
    const key = `facturas/${order.externalId}-${order.nroFormatted}.pdf`;
    await s3.send(new PutObjectCommand({
      Bucket: 'koi-facturas-pdfs-2',
      Key: key,
      Body: pdfBuffer,
      ContentType: 'application/pdf'
    }));
    
    // Actualizar orden con URL
    const pdfUrl = `https://koi-facturas-pdfs-2.s3.us-east-2.amazonaws.com/${key}`;
    order.pdfUrl = pdfUrl;
    await order.save();
    
    console.log(`✅ PDF regenerado: ${pdfUrl}`);
    res.json({ success: true, pdfUrl, message: 'PDF generado exitosamente' });
    
  } catch (error) {
    console.error('❌ Error regenerando PDF:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;