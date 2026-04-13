// emailService.js
const nodemailer = require('nodemailer');

// Configuración única del servidor SMTP
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: process.env.SMTP_PORT === '465', // true para puerto 465, false para otros
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Verificar conexión al iniciar
transporter.verify((error, success) => {
  if (error) {
    console.error('❌ Error de conexión SMTP:', error.message);
  } else {
    console.log('✅ Servidor de correo listo');
  }
});

/**
 * Envía una factura por email
 * @param {string} para - Email del destinatario (cliente)
 * @param {string} nombreNegocio - Nombre del negocio (ej: "Sono Handmade")
 * @param {string} emailNegocio - Email de contacto del negocio (para Reply-To)
 * @param {string} asunto - Asunto del email
 * @param {string} htmlContent - Contenido HTML del email
 * @param {Buffer} pdfBuffer - Buffer del PDF adjunto (opcional)
 */
async function enviarFacturaEmail(para, nombreNegocio, emailNegocio, asunto, htmlContent, pdfBuffer = null) {
  try {
    const mailOptions = {
      from: process.env.SMTP_FROM || `"KOI Facturación" <${process.env.SMTP_USER}>`,
      replyTo: emailNegocio,  // Las respuestas van al negocio, no a KOI
      to: para,
      subject: asunto,
      html: htmlContent,
    };

    // Adjuntar PDF si viene
    if (pdfBuffer) {
      mailOptions.attachments = [{
        filename: `factura.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      }];
    }

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email enviado a ${para}:`, info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Error enviando email:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Genera el HTML de la factura para el email
 * @param {Object} orden - Objeto de la orden
 * @param {string} nombreNegocio - Nombre del negocio
 * @param {string} cuit - CUIT del negocio
 * @param {string} caeDisplay - Número de CAE
 * @param {string} caeVto - Fecha de vencimiento del CAE
 */
function generarHtmlFactura(orden, nombreNegocio, cuit, caeDisplay, caeVto) {
  const fecha = orden.fechaEmision 
    ? new Date(orden.fechaEmision).toLocaleDateString('es-AR')
    : new Date(orden.createdAt).toLocaleDateString('es-AR');
  
  const monto = orden.amount.toLocaleString('es-AR', { minimumFractionDigits: 2 });
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Factura ${orden.nroFormatted || orden.nroComprobante}</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; border-bottom: 2px solid #e28a71; padding-bottom: 20px; margin-bottom: 20px; }
        .logo { font-size: 24px; font-weight: bold; color: #e28a71; }
        .factura-nro { font-size: 18px; font-weight: bold; margin: 20px 0; }
        .detalle { background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .total { font-size: 20px; font-weight: bold; color: #e28a71; text-align: right; margin: 20px 0; }
        .cae { background: #e8f5e9; padding: 10px; border-radius: 5px; margin: 20px 0; text-align: center; }
        .footer { font-size: 12px; color: #888; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; }
        .btn { display: inline-block; background: #e28a71; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">${nombreNegocio}</div>
          <p>CUIT: ${cuit || '—'}</p>
        </div>
        
        <div class="factura-nro">
          Factura N° ${orden.nroFormatted || orden.nroComprobante}
        </div>
        
        <p><strong>Fecha de emisión:</strong> ${fecha}</p>
        <p><strong>Cliente:</strong> ${orden.customerName || 'Consumidor Final'}</p>
        
        <div class="detalle">
          <h3>Detalle de la compra</h3>
          <p><strong>Concepto:</strong> ${orden.concepto || 'Productos / Servicios'}</p>
          <p><strong>Monto:</strong> $${monto}</p>
        </div>
        
        <div class="cae">
          <strong>CAE N°:</strong> ${caeDisplay}<br>
          <strong>Vencimiento CAE:</strong> ${caeVto}
        </div>
        
        <div class="total">
          TOTAL: $${monto}
        </div>
        
        <p style="text-align: center;">
          <a href="${process.env.BASE_URL}/api/orders/${orden._id}/pdf" class="btn">Ver/Descargar Factura Completa</a>
        </p>
        
        <div class="footer">
          <p>Este comprobante es válido fiscalmente según normativa AFIP.</p>
          <p>Generado por KOI-FACTURA - Sistema de Facturación Electrónica</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

module.exports = { enviarFacturaEmail, generarHtmlFactura };
