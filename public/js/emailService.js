// emailService.js
const nodemailer = require('nodemailer');

// Configuración única del servidor SMTP
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: process.env.SMTP_PORT === '465',
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
      replyTo: emailNegocio,
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
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Factura ${orden.nroFormatted || orden.nroComprobante}</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          background-color: #faf7f2;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          padding: 48px 24px;
          line-height: 1.5;
        }

        .email-container {
          max-width: 580px;
          margin: 0 auto;
          background: #ffffff;
          border-radius: 32px;
          overflow: hidden;
          box-shadow: 0 20px 40px -12px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.02);
        }

        .accent-bar {
          height: 4px;
          background: linear-gradient(90deg, #d4a373 0%, #e9edc9 50%, #d4a373 100%);
        }

        .header {
          padding: 36px 36px 24px;
          text-align: center;
          border-bottom: 1px solid #efe8df;
        }

        .logo-icon {
          width: 48px;
          height: 48px;
          background: #d4a373;
          border-radius: 16px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: 700;
          font-size: 20px;
          font-family: 'Syne', monospace;
          box-shadow: 0 4px 12px rgba(212, 163, 115, 0.2);
        }

        .empresa-nombre {
          font-family: 'Syne', 'Inter', sans-serif;
          font-size: 26px;
          font-weight: 700;
          color: #1a1a1a;
          letter-spacing: -0.8px;
          margin-bottom: 8px;
        }

        .empresa-info {
          font-size: 13px;
          color: #5c5a5a;
          letter-spacing: 0.3px;
        }

        .cuit-line {
          font-size: 11px;
          color: #b0a89c;
          margin-top: 6px;
          font-weight: 400;
        }

        .body {
          padding: 32px 36px 36px;
        }

        .saludo {
          font-size: 15px;
          font-weight: 500;
          color: #1a1a1a;
          margin-bottom: 8px;
        }

        .mensaje {
          font-size: 14px;
          color: #5c5a5a;
          margin-bottom: 32px;
          line-height: 1.5;
          border-left: 2px solid #d4a373;
          padding-left: 16px;
        }

        .datos-card {
          background: #fefcf8;
          border-radius: 24px;
          padding: 24px;
          margin-bottom: 28px;
          border: 1px solid #efe8df;
        }

        .datos-row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          padding: 10px 0;
          border-bottom: 1px solid #f0ebe3;
        }

        .datos-row:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }

        .datos-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: #b0a89c;
        }

        .datos-valor {
          font-size: 15px;
          font-weight: 600;
          color: #1a1a1a;
        }

        .total-valor {
          font-size: 28px;
          font-weight: 800;
          color: #d4a373;
          font-family: 'Syne', monospace;
          letter-spacing: -0.5px;
        }

        .qr-cae-container {
          background: #fefcf8;
          border-radius: 24px;
          padding: 20px 24px;
          margin-bottom: 28px;
          display: flex;
          align-items: center;
          gap: 24px;
          border: 1px solid #efe8df;
        }

        .qr-wrapper {
          flex-shrink: 0;
        }

        .qr-placeholder {
          width: 88px;
          height: 88px;
          background: #ffffff;
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          color: #d4a373;
          border: 1px solid #efe8df;
          font-weight: 600;
          text-align: center;
          line-height: 1.3;
        }

        .cae-info {
          flex: 1;
        }

        .cae-label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: #d4a373;
          margin-bottom: 8px;
        }

        .cae-num {
          font-family: 'Syne', monospace;
          font-size: 16px;
          font-weight: 700;
          color: #1a1a1a;
          margin-bottom: 6px;
          letter-spacing: -0.3px;
        }

        .cae-vto {
          font-size: 12px;
          color: #5c5a5a;
        }

        .cae-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-top: 12px;
          background: #f0f4e8;
          padding: 6px 12px;
          border-radius: 40px;
        }

        .badge-dot {
          width: 6px;
          height: 6px;
          background: #6b8c42;
          border-radius: 50%;
        }

        .badge-text {
          font-size: 10px;
          font-weight: 600;
          color: #6b8c42;
          letter-spacing: 0.3px;
        }

        .btn-descarga {
          display: block;
          background: #d4a373;
          color: #ffffff;
          text-align: center;
          padding: 16px 24px;
          border-radius: 60px;
          text-decoration: none;
          font-weight: 600;
          font-size: 14px;
          letter-spacing: 0.8px;
          margin-top: 28px;
          box-shadow: 0 2px 8px rgba(212, 163, 115, 0.2);
        }

        .productos {
          border-top: 1px solid #efe8df;
          padding-top: 24px;
        }

        .productos-titulo {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: #b0a89c;
          margin-bottom: 16px;
        }

        .producto-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 0;
          font-size: 14px;
          color: #1a1a1a;
          border-bottom: 1px solid #f5f0ea;
        }

        .producto-item:last-child {
          border-bottom: none;
        }

        .producto-nombre {
          flex: 1;
          font-weight: 500;
        }

        .producto-precio {
          font-weight: 700;
          color: #d4a373;
        }

        .footer {
          padding: 24px 36px;
          text-align: center;
          background: #080810;
          border-top: 1px solid rgba(0, 230, 118, 0.08);
        }

        .footer-text {
          font-size: 11px;
          color: rgba(0, 230, 118, 0.5);
          letter-spacing: 0.8px;
        }

        .footer-text strong {
          color: #00e676;
          font-weight: 600;
        }

        .footer-url {
          font-size: 9px;
          color: rgba(0, 230, 118, 0.25);
          margin-top: 8px;
          letter-spacing: 0.5px;
        }

        @media (max-width: 600px) {
          body { padding: 20px 16px; }
          .header { padding: 28px 24px 20px; }
          .body { padding: 24px 24px 28px; }
          .qr-cae-container { flex-direction: column; text-align: center; }
          .producto-item { flex-direction: column; align-items: flex-start; gap: 6px; }
          .empresa-nombre { font-size: 22px; }
          .total-valor { font-size: 24px; }
        }

        @media print {
          body { background: white; padding: 0; }
          .btn-descarga { display: none; }
          .footer { background: #f5f5f5; }
          .footer-text strong { color: #1a1a1a; }
        }
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="accent-bar"></div>

        <div class="header">
          <div class="logo-icon">K</div>
          <div class="empresa-nombre">${nombreNegocio}</div>
          <div class="empresa-info">${nombreNegocio}</div>
          <div class="cuit-line">CUIT ${cuit}</div>
        </div>

        <div class="body">
          <div class="saludo">Estimado/a <strong>${orden.customerName || 'Cliente'}</strong>,</div>
          <div class="mensaje">Adjuntamos el comprobante correspondiente a tu compra.</div>

          <div class="datos-card">
            <div class="datos-row">
              <span class="datos-label">COMPROBANTE</span>
              <span class="datos-valor">${orden.nroFormatted || orden.nroComprobante}</span>
            </div>
            <div class="datos-row">
              <span class="datos-label">FECHA</span>
              <span class="datos-valor">${fecha}</span>
            </div>
            <div class="datos-row">
              <span class="datos-label">TOTAL</span>
              <span class="datos-valor total-valor">$ ${monto}</span>
            </div>
          </div>

          <div class="qr-cae-container">
            <div class="qr-wrapper">
              <div class="qr-placeholder">CÓDIGO QR<br>AFIP</div>
            </div>
            <div class="cae-info">
              <div class="cae-label">VALIDACIÓN AFIP</div>
              <div class="cae-num">${caeDisplay}</div>
              <div class="cae-vto">Vencimiento: ${caeVto}</div>
              <div class="cae-badge">
                <div class="badge-dot"></div>
                <div class="badge-text">COMPROBANTE AUTORIZADO</div>
              </div>
            </div>
          </div>

          <div class="productos">
            <div class="productos-titulo">DETALLE</div>
            <div class="producto-item">
              <span class="producto-nombre">${orden.concepto || 'Productos / Servicios'}</span>
              <span class="producto-precio">$ ${monto}</span>
            </div>
          </div>

          <a href="${process.env.BASE_URL}/api/orders/${orden._id}/pdf" class="btn-descarga" target="_blank">📄 DESCARGAR COMPROBANTE</a>
        </div>

        <div class="footer">
          <div class="footer-text"><strong>KOI-FACTURA</strong> · Sistema de Facturación Electrónica</div>
          <div class="footer-url">Documento válido fiscalmente</div>
        </div>
      </div>
    </body>
    </html>
  `;
}

module.exports = { enviarFacturaEmail, generarHtmlFactura };
