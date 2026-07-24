// services/integrations/upsert.js

const Order = require('../../models/Order');
const User = require('../../models/User');
const { emitirCAE } = require('../afip/wsfe');
const { enviarFacturaMail } = require('../email');
const { generateInvoicePDF } = require('../pdf/invoice');
const { attachInvoiceToML } = require('./ml/attachInvoice');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// Configurar S3
const s3 = new S3Client({
  region: 'us-east-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const ARCA_LIMIT = 380000;

const upsertOrder = async (integration, canonical) => {
  if (!canonical) return null;

  const status = canonical.customerDoc === null ? 'error_data' : 'pending_invoice';
  const errorLog = canonical.customerDoc === null
    ? 'Monto $' + canonical.amount + ' ≥ $' + ARCA_LIMIT + ' sin DNI válido'
    : '';
  if (canonical.customerDoc === null) canonical.customerDoc = '0';

  const soloSetOnInsert = {
    userId: integration.userId,
    integrationId: integration._id,
    platform: integration.platform,
    status: status,
    errorLog: errorLog
  };

  var setData = {};
  for (var key in canonical) {
    if (key !== 'userId' && key !== 'integrationId' && key !== 'platform') {
      setData[key] = canonical[key];
    }
  }
  
  setData.buyerId = canonical.buyerId || '';
  setData.shipmentId = canonical.shipmentId || '';
  setData.orderEnriched = canonical.orderEnriched || false;
  setData.taxCondition = canonical.taxCondition || 'consumidor_final';
  setData.buyerFirstName = canonical.buyerFirstName || '';
  setData.buyerLastName = canonical.buyerLastName || '';
  setData.buyerIdentificationType = canonical.buyerIdentificationType || '';
  setData.buyerIdentificationNumber = canonical.buyerIdentificationNumber || '';

  const doc = await Order.findOneAndUpdate(
    { userId: integration.userId, platform: integration.platform, externalId: canonical.externalId },
    { 
      $setOnInsert: soloSetOnInsert,
      $set: setData
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).catch(function(err) {
    console.error('upsert error:', err.message);
    return null;
  });

  if (doc) {
    console.log('📦 Orden ' + canonical.externalId + ': upsert OK');
    
    if (status === 'pending_invoice') {
      const user = await User.findById(integration.userId).select('settings').lean();
      
      // 🔥 FACTURACIÓN AUTOMÁTICA
      if (user?.settings?.factAuto && user?.settings?.cuit) {
        try {
          console.log(`📤 [AUTO] Emitiendo CAE para orden ${canonical.externalId}...`);
          const result = await emitirCAE(doc._id, user);
          
          // Actualizar la orden con los datos de emisión
          await Order.findByIdAndUpdate(doc._id, {
            caeNumber: result.cae,
            caeExpiry: result.caeExpiry,
            nroComprobante: result.nroCbte,
            puntoVenta: result.ptoVta,
            nroFormatted: result.nroFormatted,
            status: 'invoiced',
            fechaEmision: new Date()
          });
          
          console.log(`✅ [AUTO] Factura emitida: ${result.nroFormatted} - CAE: ${result.cae}`);
          
          // 🔥 ENVÍO AUTOMÁTICO - VERIFICAR envioAuto
          const envioAuto = user?.settings?.envioAuto === true;
          
          if (envioAuto) {
            // ============================================================
            // MERCADO LIBRE: Adjuntar PDF en la plataforma
            // ============================================================
            if (doc.platform === 'mercadolibre') {
              try {
                console.log(`📎 [AUTO-ML] Adjuntando comprobante a Mercado Libre para orden ${doc.externalId}...`);
                
                // Generar PDF
                const pdfBuffer = await generateInvoicePDF(integration.userId, doc);
                
                // Subir a S3
                const key = `facturas/${doc.externalId}-${result.nroFormatted}.pdf`;
                await s3.send(new PutObjectCommand({
                  Bucket: 'koi-facturas-pdfs-2',
                  Key: key,
                  Body: pdfBuffer,
                  ContentType: 'application/pdf'
                }));
                
                const pdfUrl = `https://koi-facturas-pdfs-2.s3.us-east-2.amazonaws.com/${key}`;
                await Order.findByIdAndUpdate(doc._id, { pdfUrl });
                
                // Adjuntar a Mercado Libre
                const attached = await attachInvoiceToML(integration.userId, doc.externalId, pdfUrl);
                
                if (attached) {
                  await Order.findByIdAndUpdate(doc._id, { 
                    emailSent: true, 
                    emailSentAt: new Date() 
                  });
                  console.log(`✅ [AUTO-ML] Comprobante adjuntado a Mercado Libre para orden ${doc.externalId}`);
                } else {
                  console.warn(`⚠️ [AUTO-ML] No se pudo adjuntar a Mercado Libre para orden ${doc.externalId}`);
                }
                
              } catch (mlError) {
                console.error(`❌ [AUTO-ML] Error adjuntando a Mercado Libre:`, mlError.message);
              }
            } 
            
            // ============================================================
            // OTRAS PLATAFORMAS (WooCommerce, Tienda Nube, etc.): Enviar email
            // ============================================================
            else if (doc.customerEmail) {
              try {
                console.log(`📧 [AUTO-EMAIL] Enviando comprobante automáticamente a ${doc.customerEmail}...`);
                const enviado = await enviarFacturaMail(doc._id);
                
                if (enviado.ok) {
                  await Order.findByIdAndUpdate(doc._id, { 
                    emailSent: true,
                    emailSentAt: new Date()
                  });
                  console.log(`✅ [AUTO-EMAIL] Email enviado automáticamente a ${doc.customerEmail}`);
                } else {
                  console.error(`❌ [AUTO-EMAIL] Error enviando email:`, enviado.error);
                }
              } catch (emailErr) {
                console.error(`❌ [AUTO-EMAIL] Error enviando email:`, emailErr.message);
              }
            } else {
              console.warn(`⚠️ [AUTO-EMAIL] Orden ${doc._id} no tiene email del cliente`);
            }
          } else {
            console.log(`📧 [AUTO] Envío automático desactivado para orden ${doc.externalId}`);
          }
          
        } catch (emitError) {
          console.error(`❌ [AUTO] Error emitiendo CAE para orden ${doc.externalId}:`, emitError.message);
        }
      }
    }
  }
  
  return doc;
};

module.exports = { upsertOrder };