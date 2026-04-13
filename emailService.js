// emailService.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

transporter.verify((error, success) => {
  if (error) {
    console.error('❌ Error de conexión SMTP:', error.message);
  } else {
    console.log('✅ Servidor de correo listo');
  }
});

async function enviarFacturaEmail(para, nombreNegocio, emailNegocio, asunto, htmlContent, pdfBuffer = null) {
  try {
    const mailOptions = {
      from: process.env.SMTP_FROM || `"KOI Facturación" <${process.env.SMTP_USER}>`,
      replyTo: emailNegocio,
      to: para,
      subject: asunto,
      html: htmlContent,
    };

    if (pdfBuffer) {
      mailOptions.attachments = [{
        filename: 'factura.pdf',
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
        .total { font-size: 20px; font-weight: bold; color: #e28a71; text-align: right; margin: 20px 0; }
        .cae { background: #e8f5e9; padding: 10px; border-radius: 5px; margin: 20px 0; text-align: center; }
        .footer { font-size: 12px; color: #888; text-align: center; margin-top: 30px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">${nombreNegocio}</div>
          <p>CUIT: ${cuit || '—'}</p>
        </div>
        
        <h3>Factura N° ${orden.nroFormatted || orden.nroComprobante}</h3>
        <p><strong>Fecha:</strong> ${fecha}</p>
        <p><strong>Cliente:</strong> ${orden.customerName || 'Consumidor Final'}</p>
        <p><strong>Concepto:</strong> ${orden.concepto || 'Productos / Servicios'}</p>
        <p><strong>Monto:</strong> $${monto}</p>
        
        <div class="cae">
          <strong>CAE N°:</strong> ${caeDisplay}<br>
          <strong>Vencimiento:</strong> ${caeVto}
        </div>
        
        <div class="total">TOTAL: $${monto}</div>
        
        <div class="footer">
          <p>Comprobante válido fiscalmente | Generado por KOI-FACTURA</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

module.exports = { enviarFacturaEmail, generarHtmlFactura };
