const ejs = require('ejs');
const path = require('path');

const generarQRHtml = (url) => {
  if (!url) return '';
  const qrApiUrl = 'https://quickchart.io/qr?text=' + encodeURIComponent(url) + '&size=200&margin=2';
  return '<img src="' + qrApiUrl + '" alt="Código QR AFIP" style="width: 88px; height: 88px;">';
};

const generarFacturaHtml = async (userId, orden, esNC = false) => {
  const User = require('../../models/User');
  const user = await User.findById(userId).select('nombre apellido settings').lean();

  // 👇 DETECTAR NC (del parámetro o de los datos de la orden)
  const esNotaCredito = esNC || orden.nroFormatted?.startsWith('NC') || 
                        orden.externalId?.includes('-NC') ||
                        orden.amount < 0;

  const docLen = (orden.customerDoc || '').replace(/\D/g, '').length;
  const condicionEmisor = user?.settings?.condicionFiscal || 'responsable_inscripto';

  let tipoFactura = 'FACTURA C';
  let impNeto = null;
  let impIVA = null;

  // 👇 SI ES NC, USAR EL TIPO CORRESPONDIENTE
  if (esNotaCredito) {
    if (orden.tipoComprobante === 1 || orden.tipoComprobante === 2) {
      tipoFactura = 'NOTA DE CRÉDITO A';
    } else if (orden.tipoComprobante === 6 || orden.tipoComprobante === 7) {
      tipoFactura = 'NOTA DE CRÉDITO B';
    } else {
      tipoFactura = 'NOTA DE CRÉDITO C';
    }
  } else if (condicionEmisor === 'monotributo' || condicionEmisor === 'exento') {
    tipoFactura = 'FACTURA C';
  } else {
    if (docLen === 11) {
      tipoFactura = 'FACTURA A';
      const total = Math.abs(orden.amount);
      impNeto = total / 1.21;
      impIVA = total - impNeto;
    } else if (docLen >= 7 && docLen <= 8) {
      tipoFactura = 'FACTURA B';
    } else {
      tipoFactura = 'FACTURA C';
    }
  }

  // 👇 DATOS DE LA EMPRESA (MOVIDOS ANTES DEL RETURN)
  const nombreFantasia = user?.settings?.razonSocial
    || (user?.nombre ? user.nombre + ' ' + (user.apellido || '') : 'Sono Handmade');
  const razonSocial = user?.settings?.razonSocial || nombreFantasia;
  const cuitRaw = user?.settings?.cuit || '';
  const cuitFmt = cuitRaw.replace(/(\d{2})(\d{8})(\d)/, '$1-$2-$3');

  const ptoVta = String(orden.puntoVenta || user?.settings?.arcaPtoVta || 1).padStart(4, '0');
  const nroCbte = String(orden.nroComprobante || 0).padStart(8, '0');
  const nroComp = ptoVta + '-' + nroCbte;
  
  const fecha = (orden.orderDate || orden.createdAt)
    ? new Date(orden.orderDate || orden.createdAt).toLocaleDateString('es-AR')
    : '—';

  const fmtARS = (n) => new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  }).format(n || 0);

  const items = orden.items?.length
    ? orden.items
    : [{ nombre: orden.concepto || 'Productos / Servicios', cantidad: 1, precio: Math.abs(orden.amount) }];

  const escapeHtml = (str) => {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  const filasItems = items.map(item => {
    const subtotal = Math.abs((item.precio || 0) * (item.cantidad || 1));
    return '<tr>\n' +
      '   <td style="text-align: left;">' + escapeHtml(item.nombre || 'Producto') + '</td>\n' +
      '   <td style="text-align: center;">' + (item.cantidad || 1) + '</td>\n' +
      '   <td style="text-align: right; padding-right: 8px;">$ ' + fmtARS(Math.abs(item.precio || 0)) + '</td>\n' +
      '   <td style="text-align: right; padding-right: 8px;">$ ' + fmtARS(subtotal) + '</td>\n' +
      '</tr>';
  }).join('');

  const caeNum = orden.caeNumber || null;
  const caeVto = orden.caeExpiry
    ? new Date(orden.caeExpiry).toLocaleDateString('es-AR')
    : '—';
  const caeDisplay = caeNum || '(pendiente)';

  let urlQrAfip = null;
  let qrImageHtml = '';
  if (caeNum && cuitRaw) {
    const qrData = {
      ver: 1,
      fecha: fecha,
      cuit: parseInt(cuitRaw.replace(/\D/g,'')),
      ptoVta: parseInt(ptoVta),
      tipoCmp: orden.tipoComprobante || 11,
      nroCmp: orden.nroComprobante || 0,
      importe: Math.abs(orden.amount),
      moneda: 'PES',
      ctz: 1,
      tipoDocRec: 99,
      nroDocRec: 0,
      tipoCodAut: 'E',
      codAut: parseInt(caeNum)
    };
    const b64 = Buffer.from(JSON.stringify(qrData)).toString('base64');
    urlQrAfip = 'https://www.afip.gob.ar/fe/qr/?p=' + b64;
    qrImageHtml = generarQRHtml(urlQrAfip);
  }

  // 👇 RENDERIZAR EL TEMPLATE CON TODOS LOS DATOS
  return await ejs.renderFile(path.join(__dirname, '../../views', 'factura.ejs'), {
    logoUrl: user?.settings?.logoUrl || '',
    nombreFantasia: nombreFantasia,
    razonSocial: razonSocial,
    cuitFmt: cuitFmt,
    tipoFactura: tipoFactura,
    nroComp: nroComp,
    fecha: fecha,
    filasItems: filasItems,
    total: fmtARS(Math.abs(orden.amount)),
    impNeto: impNeto ? fmtARS(impNeto) : null,
    impIVA: impIVA ? fmtARS(impIVA) : null,
    caeDisplay: caeDisplay,
    caeVto: caeVto,
    urlQrAfip: urlQrAfip,
    qrImageHtml: qrImageHtml,
    sinCae: !caeNum,
    customerName: orden.customerName || orden.customerEmail || 'Cliente',
    // 👇 AGREGAR ESTO PARA EL TEMPLATE
    esNC: esNotaCredito,
    facturaOriginalNro: orden.facturaOriginalNro || null
  });
};

module.exports = { generarFacturaHtml, generarQRHtml };