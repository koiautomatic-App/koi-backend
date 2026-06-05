// services/pdf/invoice.js - Versión corregida
const { generatePDF } = require('./generate');

async function generateInvoicePDF(userId, orden) {
  try {
    console.log(`📄 Generando PDF para orden ${orden.externalId}`);
    console.log(`   Cliente: ${orden.customerName}`);
    console.log(`   DNI: ${orden.customerDoc}`);
    console.log(`   Items: ${orden.items?.length || 0}`);
    
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
    
    // Datos completos para la Lambda - CORREGIDO
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
      nombreFantasia: orden.nombreFantasia || 'Finisterre Arg',
      razonSocial: orden.razonSocial || 'Finisterre Arg',
      cuitFmt: orden.cuitFmt || '20-30978248-9',
      tipoFactura: orden.tipoFactura || 'FACTURA C',
      impNeto: orden.impNeto,
      impIVA: orden.impIVA,
      caeDisplay: orden.caeNumber || orden.caeDisplay || '',
      caeVto: caeVtoFormateado || orden.caeVto || '',
      logoUrl: orden.logoUrl || null
    };
    
    console.log(`   Enviando a Lambda: cliente=${orderData.cliente.nombre}, doc=${orderData.cliente.numeroDoc}`);
    
    const pdfBuffer = await generatePDF(orderData);
    return pdfBuffer;
    
  } catch (error) {
    console.error('❌ Error en generateInvoicePDF:', error);
    throw error;
  }
}

module.exports = { generateInvoicePDF };