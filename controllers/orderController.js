const Order = require('../models/Order');
const User = require('../models/User');
const { emitirCAE } = require('../services/afip/wsfe');
const { enviarFacturaMail } = require('../services/email');
const { generateInvoicePDF } = require('../services/pdf/invoice');

const listarOrdenes = async (req, res) => {
  try {
    const { platform, status, desde, hasta, page = 1, limit = 25, search = '' } = req.query;
    
    const filter = {
      userId: req.userId,
      status: { $ne: 'skipped' },
      $and: [
        {
          $or: [
            { items: { $exists: true, $ne: [] } },
            { concepto: { $exists: true, $ne: '', $nin: ['Venta WooCommerce', 'woocommerce', null] } },
            { platform: 'mercadolibre' }
          ]
        }
      ]
    };
    
    if (platform) filter.platform = platform;
    if (status) filter.status = status;
    
    if (desde || hasta) {
      filter.createdAt = {};
      if (desde) filter.createdAt.$gte = new Date(desde);
      if (hasta) filter.createdAt.$lte = new Date(hasta);
    }
    
    if (search && search.trim()) {
      filter.$and.push({
        $or: [
          { customerName: { $regex: search, $options: 'i' } },
          { customerEmail: { $regex: search, $options: 'i' } },
          { concepto: { $regex: search, $options: 'i' } },
          { externalId: { $regex: search, $options: 'i' } }
        ]
      });
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = Math.min(parseInt(limit), 100);
    
    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Order.countDocuments(filter)
    ]);
    
    const ordersWithSummary = orders.map(order => ({
      ...order,
      emailSent: order.emailSent || false,
      emailSentAt: order.emailSentAt || null,
      itemsSummary: order.items?.map(i => `${i.cantidad}x ${i.nombre}`).join(', ') || order.concepto || ''
    }));
    
    res.json({
      ok: true,
      orders: ordersWithSummary,
      pagination: {
        page: parseInt(page),
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('listarOrdenes error:', error);
    res.status(500).json({ error: 'Error interno' });
  }
};

const obtenerOrden = async (req, res) => {
  try {
    const orden = await Order.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!orden) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    res.json({ ok: true, order: orden });
  } catch (error) {
    console.error('obtenerOrden error:', error);
    res.status(500).json({ error: 'Error interno' });
  }
};

const emitirOrden = async (req, res) => {
  try {
    const orden = await Order.findOne({ _id: req.params.id, userId: req.userId });
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
    if (orden.status === 'invoiced') {
      return res.status(400).json({ error: 'Esta orden ya tiene CAE emitido' });
    }
    
    const user = await User.findById(req.userId).select('settings').lean();
    const result = await emitirCAE(orden._id, user);
    
    res.json({
      ok: true,
      cae: result.cae,
      vto: result.caeExpiry,
      nroCbte: result.nroCbte,
      nroFormatted: result.nroFormatted,
      message: `CAE emitido: ${result.cae}`
    });
  } catch (error) {
    console.error('emitirOrden error:', error);
    res.status(500).json({ error: error.message });
  }
};

const cancelarFactura = async (req, res) => {
  try {
    const orden = await Order.findOne({ _id: req.params.id, userId: req.userId });
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
    if (orden.status !== 'invoiced') {
      return res.status(400).json({ error: 'Solo se pueden cancelar facturas ya emitidas' });
    }
    
    const user = await User.findById(req.userId).select('settings').lean();
    if (!user?.settings?.cuit) {
      return res.status(400).json({ error: 'Configurá tu CUIT antes de emitir notas de crédito' });
    }
    
    // Obtener token AFIP
    const { getAfipToken } = require('../services/afip/wsaa');
    const { getUltimoComprobante } = require('../services/afip/wsfe');
    const axios = require('axios');
    const { DOMParser } = require('@xmldom/xmldom');
    const config = require('../config');
    const { httpsAgent } = require('../utils/afip-tls');
    
    const cuit = user.settings.cuit.replace(/\D/g, '');
    const { token, sign } = await getAfipToken(cuit);
    
    const tipoOriginal = orden.tipoComprobante || 11;
    let tipoNC;
    if (tipoOriginal === 1) tipoNC = 2;
    else if (tipoOriginal === 6) tipoNC = 7;
    else tipoNC = 13;
    
    const ptoVta = parseInt(user.settings.arcaPtoVta || user.settings.puntoVenta || 1);
    const ultimo = await getUltimoComprobante(cuit, ptoVta, tipoNC, token, sign);
    const nroCbte = ultimo + 1;
    
    const fecha = new Date();
    const fechaStr = `${fecha.getFullYear()}${String(fecha.getMonth()+1).padStart(2,'0')}${String(fecha.getDate()).padStart(2,'0')}`;
    
    const docClean = (orden.customerDoc || '99999999').replace(/\D/g, '');
    const tipoDoc = docClean === '99999999' ? 99 : (docClean.length === 11 ? 80 : 96);
    const nroDoc = tipoDoc === 99 ? 0 : parseInt(docClean);
    const importe = Math.abs(orden.amount);
    
    const ptoVtaStrNC = String(ptoVta).padStart(5, '0');
    const nroCbteStrNC = String(nroCbte).padStart(8, '0');
    const tipoLabel = tipoNC === 13 ? 'C' : (tipoNC === 2 ? 'A' : 'B');
    
    const soap = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Header/>
  <soapenv:Body>
    <ar:FECAESolicitar>
      <ar:Auth>
        <ar:Token>${token}</ar:Token>
        <ar:Sign>${sign}</ar:Sign>
        <ar:Cuit>${cuit}</ar:Cuit>
      </ar:Auth>
      <ar:FeCAEReq>
        <ar:FeCabReq>
          <ar:CantReg>1</ar:CantReg>
          <ar:PtoVta>${ptoVta}</ar:PtoVta>
          <ar:CbteTipo>${tipoNC}</ar:CbteTipo>
        </ar:FeCabReq>
        <ar:FeDetReq>
          <ar:FECAEDetRequest>
            <ar:Concepto>1</ar:Concepto>
            <ar:DocTipo>${tipoDoc}</ar:DocTipo>
            <ar:DocNro>${nroDoc}</ar:DocNro>
            <ar:CbteDesde>${nroCbte}</ar:CbteDesde>
            <ar:CbteHasta>${nroCbte}</ar:CbteHasta>
            <ar:CbteFch>${fechaStr}</ar:CbteFch>
            <ar:ImpTotal>${importe}</ar:ImpTotal>
            <ar:ImpTotConc>0</ar:ImpTotConc>
            <ar:ImpNeto>${importe}</ar:ImpNeto>
            <ar:ImpOpEx>0</ar:ImpOpEx>
            <ar:ImpIVA>0</ar:ImpIVA>
            <ar:ImpTrib>0</ar:ImpTrib>
            <ar:MonId>PES</ar:MonId>
            <ar:MonCotiz>1</ar:MonCotiz>
            <ar:CbtesAsoc>
              <ar:CbteAsoc>
                <ar:Tipo>${tipoOriginal}</ar:Tipo>
                <ar:PtoVta>${orden.puntoVenta || 1}</ar:PtoVta>
                <ar:Nro>${orden.nroComprobante}</ar:Nro>
              </ar:CbteAsoc>
            </ar:CbtesAsoc>
          </ar:FECAEDetRequest>
        </ar:FeDetReq>
      </ar:FeCAEReq>
    </ar:FECAESolicitar>
  </soapenv:Body>
</soapenv:Envelope>`;
    
    const wsfeResp = await axios.post(config.AFIP_URLS.wsfe, soap, {
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'http://ar.gov.afip.dif.FEV1/FECAESolicitar' },
      httpsAgent,
      timeout: 30000
    });
    
    const parser = new DOMParser();
    const xml = parser.parseFromString(wsfeResp.data, 'text/xml');
    
    const soapFault = xml.getElementsByTagName('faultstring')[0]?.textContent;
    if (soapFault) throw new Error('AFIP error: ' + soapFault);
    
    const detResp = xml.getElementsByTagName('FECAEDetResponse')[0];
    const result = detResp?.getElementsByTagName('Resultado')[0]?.textContent;
    
    if (result !== 'A') {
      const errMsg = detResp?.getElementsByTagName('Msg')[0]?.textContent || 'Error desconocido';
      throw new Error('AFIP rechazó: ' + errMsg);
    }
    
    const cae = detResp.getElementsByTagName('CAE')[0]?.textContent;
    const caeVto = detResp.getElementsByTagName('CAEFchVto')[0]?.textContent;
    const caeExpiry = caeVto ? new Date(`${caeVto.slice(0,4)}-${caeVto.slice(4,6)}-${caeVto.slice(6,8)}`) : null;
    
    // Crear Nota de Crédito
    const nuevaNC = new Order({
      userId: orden.userId,
      integrationId: orden.integrationId,
      platform: orden.platform,
      externalId: `${orden.externalId}-NC`,
      customerName: orden.customerName,
      customerEmail: orden.customerEmail,
      customerDoc: orden.customerDoc,
      amount: -Math.abs(orden.amount),
      currency: orden.currency,
      concepto: `Nota de Crédito - Factura original #${orden.externalId}`,
      items: orden.items,
      orderDate: orden.orderDate,
      status: 'cancelled',
      caeNumber: cae,
      caeExpiry: caeExpiry,
      tipoComprobante: tipoNC,
      nroComprobante: nroCbte,
      puntoVenta: ptoVta,
      nroFormatted: `NC ${tipoLabel} ${ptoVtaStrNC}-${nroCbteStrNC}`,
      fechaEmision: new Date(),
      errorLog: `Nota de Crédito emitida - Factura original #${orden.externalId}`,
      emailSent: false,
      facturaOriginalId: orden._id,
      facturaOriginalNro: orden.nroFormatted
    });
    
    await nuevaNC.save();
    
    // Actualizar factura original
    await Order.findByIdAndUpdate(req.params.id, {
      status: 'cancelled_by_nc',
      nroFormatted: `${orden.nroFormatted} (ANULADA)`,
      ncAsociadaId: nuevaNC._id,
      ncAsociadaNro: nuevaNC.nroFormatted,
      errorLog: `Factura anulada - Nota de Crédito asociada: ${nuevaNC.nroFormatted}`,
      canceledAt: new Date()
    });
    
    console.log(`✅ Nota de Crédito creada: ${nuevaNC.nroFormatted}`);
    
    res.json({
      ok: true,
      nroNC: nuevaNC.nroFormatted,
      cae: cae,
      message: 'Nota de Crédito emitida correctamente'
    });
    
  } catch (error) {
    console.error('cancelarFactura error:', error);
    res.status(500).json({ error: error.message });
  }
};

const enviarMailOrden = async (req, res) => {
  try {
    const orden = await Order.findOne({ _id: req.params.id, userId: req.userId });
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

    // ════════════════════════════════════════════════════════════
    // MERCADOLIBRE: Adjuntar a la plataforma (no enviar email)
    // ════════════════════════════════════════════════════════════
    if (orden.platform === 'mercadolibre') {
      const Integration = require('../models/Integration');
      const { getMLToken } = require('../services/integrations/token/ml');
      const axios = require('axios');
      const FormData = require('form-data');

      // Buscar integración activa de ML
      const mlIntegration = await Integration.findOne({ 
        userId: req.userId, 
        platform: 'mercadolibre',
        status: 'active'
      });
      
      if (!mlIntegration) {
        return res.status(400).json({ error: 'MercadoLibre no está conectado' });
      }
      
      const accessToken = await getMLToken(mlIntegration);
      
      // Obtener el pack_id de la orden
      const orderDetail = await axios.get(`https://api.mercadolibre.com/orders/${orden.externalId}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      const packId = orderDetail.data.pack_id || orden.externalId;
      
      // Generar el PDF usando el microservicio
      const pdfBuffer = await generateInvoicePDF(req.userId, orden);
      
      // Crear FormData con el PDF
      const form = new FormData();
      form.append('fiscal_document', pdfBuffer, {
        filename: `${orden.nroFormatted || 'comprobante'}.pdf`,
        contentType: 'application/pdf'
      });
      
      // Subir a Mercado Libre
      await axios.post(
        `https://api.mercadolibre.com/packs/${packId}/fiscal_documents`,
        form,
        {
          headers: {
            ...form.getHeaders(),
            'Authorization': `Bearer ${accessToken}`
          },
          timeout: 30000
        }
      );
      
      await Order.findByIdAndUpdate(orden._id, { 
        emailSent: true, 
        emailSentAt: new Date() 
      });
      
      return res.json({ 
        ok: true, 
        message: '✅ Comprobante adjuntado a Mercado Libre. El comprador lo verá en su cuenta.',
        platform: 'mercadolibre'
      });
    }

    // ════════════════════════════════════════════════════════════
    // OTRAS PLATAFORMAS: Enviar email normal
    // ════════════════════════════════════════════════════════════
    if (!orden.customerEmail) {
      return res.status(400).json({ error: 'El cliente no tiene email registrado' });
    }
    
    const enviado = await enviarFacturaMail(orden._id);
    
    if (enviado.ok) {
      res.json({
        ok: true,
        message: 'Factura enviada por email',
        email: orden.customerEmail
      });
    } else {
      res.status(500).json({ error: enviado.error || 'Error al enviar el email' });
    }
  } catch (error) {
    console.error('enviarMailOrden error:', error);
    res.status(500).json({ error: 'Error al enviar el email: ' + error.message });
  }
};

const eliminarOrden = async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, userId: req.userId });
    if (!order) return res.status(404).json({ error: 'Orden no encontrada' });
    
    await Order.findByIdAndDelete(req.params.id);
    res.json({ ok: true, message: 'Orden eliminada' });
  } catch (error) {
    console.error('eliminarOrden error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ✅ FUNCIÓN ACTUALIZADA - Permite modificar rawPayload.status
const actualizarOrden = async (req, res) => {
  try {
    const { id } = req.params;
    const allowedUpdates = ['nroFormatted', 'emailSent', 'emailSentAt', 'concepto', 'amount', 'caeNumber', 'status'];
    const updates = {};
    
    for (const key of allowedUpdates) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }
    
    // 👇 PERMITIR ACTUALIZAR rawPayload.status
    const order = await Order.findOne({ _id: id, userId: req.userId });
    if (!order) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    
    // Actualizar rawPayload.status si viene en la petición
    if (req.body.rawPayload && req.body.rawPayload.status) {
      order.rawPayload.status = req.body.rawPayload.status;
      await order.save();
      return res.json({ ok: true, order });
    }
    
    // Actualizar otros campos
    const updatedOrder = await Order.findOneAndUpdate(
      { _id: id, userId: req.userId },
      { $set: updates },
      { new: true }
    );
    
    res.json({ ok: true, order: updatedOrder });
  } catch (error) {
    console.error('actualizarOrden error:', error);
    res.status(500).json({ error: error.message });
  }
};

const generarPDF = async (req, res) => {
  try {
    let orden = await Order.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

    // 👇 DETECTAR SI ES NC
    const esNC = orden.nroFormatted?.startsWith('NC') || 
                 orden.externalId?.includes('-NC') ||
                 orden.amount < 0;

    // Si es NC, generar PDF de Nota de Crédito
    if (esNC) {
      const { generarFacturaHtml } = require('../services/email');
      // 👇 PASAR esNC al template
      const html = await generarFacturaHtml(req.userId, orden, true);
      
      // 👇 USAR nroFormatted para el nombre
      const nombreArchivo = orden.nroFormatted 
        ? orden.nroFormatted.replace(/\s/g, '') 
        : `NOTA_DE_CREDITO-${String(orden.puntoVenta || 1).padStart(4, '0')}-${String(orden.nroComprobante || 0).padStart(8, '0')}`;
      
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `inline; filename="${nombreArchivo}.html"`);
      return res.send(html);
    }

    // Si la orden está cancelada, buscar la NC asociada
    if (orden.status === 'cancelled' || orden.status === 'cancelled_by_nc') {
      let nc = null;
      
      if (orden._id) {
        nc = await Order.findOne({ 
          userId: req.userId,
          facturaOriginalId: orden._id
        }).lean();
      }
      
      if (!nc && orden.externalId) {
        nc = await Order.findOne({ 
          userId: req.userId,
          externalId: { $regex: `^${orden.externalId}-NC$` }
        }).lean();
      }
      
      if (nc) {
        const { generarFacturaHtml } = require('../services/email');
        const html = await generarFacturaHtml(req.userId, nc, true);
        
        const nombreArchivo = nc.nroFormatted 
          ? nc.nroFormatted.replace(/\s/g, '') 
          : `NOTA_DE_CREDITO-${String(nc.puntoVenta || 1).padStart(4, '0')}-${String(nc.nroComprobante || 0).padStart(8, '0')}`;
        
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Disposition', `inline; filename="${nombreArchivo}.html"`);
        return res.send(html);
      }
    }

    // Si es factura normal
    const { generarFacturaHtml } = require('../services/email');
    const html = await generarFacturaHtml(req.userId, orden, false);

    const nombreArchivo = orden.nroFormatted 
      ? `FACTURA-${orden.nroFormatted.replace(/\s/g, '')}`
      : `FACTURA-${String(orden.puntoVenta || 1).padStart(4, '0')}-${String(orden.nroComprobante || 0).padStart(8, '0')}`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${nombreArchivo}.html"`);
    res.send(html);
    
  } catch (error) {
    console.error('generarPDF error:', error);
    res.status(500).json({ error: 'Error generando comprobante: ' + error.message });
  }
};

module.exports = {
  listarOrdenes,
  obtenerOrden,
  emitirOrden,
  cancelarFactura,
  enviarMailOrden,
  eliminarOrden,
  actualizarOrden,
  generarPDF
};