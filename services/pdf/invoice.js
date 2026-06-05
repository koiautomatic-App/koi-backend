// services/pdf/invoice.js - Versión definitiva con QR y logs de depuración
const { generatePDF } = require('./generate');

// Función para generar la URL del QR de AFIP
const generarQRUrl = async (orden, userId) => {
  if (!orden.caeNumber) return '';
  
  // Obtener el CUIT del usuario
  const User = require('../../models/User');
  const user = await User.findById(userId).select('settings').lean();
  const cuitRaw = user?.settings?.cuit || '20-30978248-9';
  const cuitLimpio = cuitRaw.replace(/\D/g, '');
  
  // Formatear fecha para AFIP (YYYYMMDD)
  const fechaOriginal = orden.orderDate || orden.createdAt || new Date();
  const fechaAFIP = new Date(fechaOriginal).toISOString().slice(0, 10).replace(/-/g, '');
  
  // Determinar tipo de documento del cliente
  const customerDocClean = (orden.customerDoc || '').replace(/\D/g, '');
  let tipoDocRec = 99;  // Consumidor Final por defecto
  let nroDocRec = 0;
  
  if (customerDocClean && customerDocClean !== '99999999' && customerDocClean !== '') {
    if (customerDocClean.length === 11) {
      tipoDocRec = 80;  // CUIT
    } else if (customerDocClean.length === 8) {
      tipoDocRec = 96;  // DNI
    }
    nroDocRec = parseInt(customerDocClean, 10);
  }
  
  const qrData = {
    ver: 1,
    fecha: fechaAFIP,
    cuit: parseInt(cuitLimpio, 10),
    ptoVta: orden.puntoVenta || 1,
    tipoCmp: orden.tipoComprobante || 11,
    nroCmp: orden.nroComprobante || 0,
    importe: Math.abs(orden.amount),
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: tipoDocRec,
    nroDocRec: nroDocRec,
    tipoCodAut: 'E',
    codAut: parseInt(orden.caeNumber, 10)
  };
  
  const b64 = Buffer.from(JSON.stringify(qrData)).toString('base64');
  const qrUrl = `https://quickchart.io/qr?text=https://www.afip.gob.ar/fe/qr/?p=${b64}&size=150&margin=2`;
  return qrUrl;
};

async function generateInvoicePDF(userId, orden) {
  try {
    console.log(`📄 Generando PDF para orden ${orden.externalId}`);
    console.log(`   Cliente: ${orden.customerName}`);
    console.log(`   DNI: ${orden.customerDoc}`);
    console.log(`   Items: ${orden.items?.length || 0}`);
    
    // Obtener datos del usuario (logo, CUIT, etc.)
    const User = require('../../models/User');
    const user = await User.findById(userId).select('settings nombre apellido').lean();
    
    // Datos de la empresa
    const cuitFmt = user?.settings?.cuit || '20-30978248-9';
    const nombreFantasia = user?.settings?.razonSocial || user?.nombre || 'Finisterre Arg';
    const logoUrl = user?.settings?.logoUrl || null;
    
    // Mapear items al formato esperado
    const items = (orden.items || []).map(item => ({
      descripcion: item.nombre || item.name || item.descripcion || 'Producto',
      cantidad: item.cantidad || item.quantity || 1,
      precio: item.precio || item.price || 0
    }));
    
    // Si no hay items, usar el concepto
    if (items.length === 0 && orden.concepto) {
      items.push({
        descripcion: orden.concepto,
        cantidad: 1,
        precio: orden.amount || 0
      });
    }
    
    // Calcular total
    const total = orden.amount || orden.total || items.reduce((sum, i) => sum + (i.cantidad * i.precio), 0);
    
    // Formatear fecha
    const fechaOriginal = orden.orderDate || orden.createdAt || new Date();
    const fechaFormateada = new Date(fechaOriginal).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    
    // Formatear vencimiento CAE
    let caeVtoFormateado = '';
    if (orden.caeExpiry) {
      caeVtoFormateado = new Date(orden.caeExpiry).toLocaleDateString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    }
    
    // Generar QR de AFIP
    const qrImageUrl = await generarQRUrl(orden, userId);
    console.log(`   QR generado: ${qrImageUrl ? '✅ Sí' : '❌ No'}`);
    console.log(`   Logo: ${logoUrl ? '✅ Sí' : '❌ No'}`);
    
    // 👇 LOG DE DEPURACIÓN: Verificar valor del QR antes de enviar
    console.log(`   📱 qrImageUrl (primeros 100 chars): ${qrImageUrl ? qrImageUrl.substring(0, 100) : 'null'}...`);
    
    // Datos completos para la Lambda - CON QR Y LOGO
    const orderData = {
      orderId: orden.externalId,
      nroFormatted: orden.nroFormatted || `FC-${orden.externalId}`,
      items: items,
      total: total,
      fecha: fechaFormateada,
      cliente: {
        nombre: orden.customerName || 'Consumidor Final',
        tipoDoc: 'DNI',
        numeroDoc: orden.customerDoc || '',
        email: orden.customerEmail || ''
      },
      nombreFantasia: nombreFantasia,
      razonSocial: nombreFantasia,
      cuitFmt: cuitFmt,
      tipoFactura: 'FACTURA C',
      impNeto: orden.impNeto,
      impIVA: orden.impIVA,
      caeDisplay: orden.caeNumber || '',
      caeVto: caeVtoFormateado,
      logoUrl: logoUrl,
      qrImageUrl: qrImageUrl
    };
    
    // 👇 LOG DE DEPURACIÓN: Verificar que orderData tiene qrImageUrl
    console.log(`   ✅ orderData.qrImageUrl existe: ${!!orderData.qrImageUrl}`);
    console.log(`   Enviando a Lambda: cliente=${orderData.cliente.nombre}, doc=${orderData.cliente.numeroDoc}`);
    
    const pdfBuffer = await generatePDF(orderData);
    return pdfBuffer;
    
  } catch (error) {
    console.error('❌ Error en generateInvoicePDF:', error);
    throw error;
  }
}

module.exports = { generateInvoicePDF };