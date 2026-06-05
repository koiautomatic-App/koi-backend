// services/integrations/ml/attachInvoice.js
const axios = require('axios');
const FormData = require('form-data');
const { getMLToken } = require('../token/ml');
const Integration = require('../../../models/Integration');

/**
 * Adjuntar factura a una orden de Mercado Libre
 * @param {string} userId - ID del usuario
 * @param {string} orderId - externalId de la orden en ML
 * @param {string} pdfUrl - URL del PDF en S3
 * @returns {Promise<boolean>}
 */
const attachInvoiceToML = async (userId, orderId, pdfUrl) => {
  try {
    console.log(`📎 [ML] Adjuntando factura a orden ${orderId}`);

    // 1. Buscar integración activa
    const integration = await Integration.findOne({
      userId: userId,
      platform: 'mercadolibre',
      status: 'active'
    });

    if (!integration) {
      console.error('❌ [ML] No hay integración activa');
      return false;
    }

    // 2. Obtener token válido
    const token = await getMLToken(integration);
    console.log(`✅ [ML] Token obtenido`);

    // 3. Descargar el PDF
    const pdfResponse = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
    const pdfBuffer = Buffer.from(pdfResponse.data);
    console.log(`✅ [ML] PDF descargado (${pdfBuffer.length} bytes)`);

    // 4. Subir archivo a ML como attachment
    const formData = new FormData();
    formData.append('file', pdfBuffer, {
      filename: 'factura.pdf',
      contentType: 'application/pdf'
    });
    formData.append('tag', 'post_sale');
    formData.append('site_id', 'MLA');

    const uploadRes = await axios.post(
      'https://api.mercadolibre.com/messages/attachments',
      formData,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          ...formData.getHeaders()
        }
      }
    );

    const fileId = uploadRes.data.id;
    console.log(`✅ [ML] Archivo subido, file_id: ${fileId}`);

    // 5. Adjuntar a la orden como mensaje
    const attachRes = await axios.post(
      `https://api.mercadolibre.com/orders/${orderId}/messages`,
      {
        text: `Factura electrónica - Comprobante N° ${orderId}`,
        attachments: [{ id: fileId }],
        tags: ['post_sale', 'invoice']
      },
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    );

    console.log(`✅ [ML] Factura adjuntada a orden ${orderId}`);
    return true;

  } catch (error) {
    console.error(`❌ [ML] Error:`, error.response?.data || error.message);
    return false;
  }
};

module.exports = { attachInvoiceToML };