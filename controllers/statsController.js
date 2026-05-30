// controllers/statsController.js
const Order = require('../models/Order');
const User = require('../models/User');
const mongoose = require('mongoose');

const obtenerDashboardStats = async (req, res) => {
  try {
    const userId = req.userId;
    const { desde, hasta } = req.query;
    
    const userIdObj = new mongoose.Types.ObjectId(userId);
    
    let fechaDesde = null;
    let fechaHasta = null;
    
    if (desde) {
      fechaDesde = new Date(desde + 'T00:00:00-03:00');
    }
    if (hasta) {
      fechaHasta = new Date(hasta + 'T23:59:59-03:00');
    }
    
    // ============================================================
    // 1. OBTENER USUARIO Y CATEGORÍA
    // ============================================================
    const user = await User.findById(userId).select('settings').lean();
    const categoria = user?.settings?.categoria || 'C';
    const condicionFiscal = user?.settings?.condicionFiscal || 'responsable_inscripto';
    
    // Límites anuales de monotributo 2026 (actualizar según ARCA)
   const limitesAnuales = {
  'A': 10277988.13,
  'B': 15058447.71,
  'C': 21113696.52,
  'D': 26212853.42,
  'E': 30833964.37,
  'F': 38642048.36,
  'G': 46211109.37,
  'H': 70113407.33,
  'I': 84124088.79,
  'J': 98144777.00,
  'K': 112165465.00
};
    
    const limiteAnual = limitesAnuales[categoria] || limitesAnuales['C'];
    const limiteMensual = limiteAnual / 12;
    
    // ============================================================
    // 2. FACTURACIÓN ACUMULADA - ÚLTIMOS 12 MESES
    // ============================================================
    const hoy = new Date();
    const hace12Meses = new Date();
    hace12Meses.setMonth(hoy.getMonth() - 12);
    hace12Meses.setHours(0, 0, 0, 0);
    
    const total12MesesResult = await Order.aggregate([
      {
        $match: {
          userId: userIdObj,
          status: 'invoiced',
          amount: { $gt: 0 },
          createdAt: { $gte: hace12Meses }
        }
      },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    const total12Meses = total12MesesResult[0]?.total || 0;
    const porcentaje12Meses = (total12Meses / limiteAnual) * 100;
    const porcentajeMensual = (total12Meses / limiteAnual) * 100; // Para el mes actual
    
    // ============================================================
    // 3. TOTAL FACTURADO DEL PERÍODO SELECCIONADO
    // ============================================================
    const matchFacturado = {
      userId: userIdObj,
      status: 'invoiced'
    };
    
    if (fechaDesde || fechaHasta) {
      matchFacturado.createdAt = {};
      if (fechaDesde) matchFacturado.createdAt.$gte = fechaDesde;
      if (fechaHasta) matchFacturado.createdAt.$lte = fechaHasta;
    }
    
    const totalResult = await Order.aggregate([
      { $match: matchFacturado },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]);
    
    const totalFacturado = totalResult[0]?.total || 0;
    const totalFacturas = totalResult[0]?.count || 0;
    
    // ============================================================
    // 4. EMITIDO HOY
    // ============================================================
    const hoyInicio = new Date();
    hoyInicio.setHours(0, 0, 0, 0);
    const hoyFin = new Date();
    hoyFin.setHours(23, 59, 59, 999);
    
    const hoyResult = await Order.aggregate([
      {
        $match: {
          userId: userIdObj,
          status: 'invoiced',
          createdAt: { $gte: hoyInicio, $lte: hoyFin }
        }
      },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]);
    
   // ============================================================
// 5. PENDIENTES CAE (solo del período seleccionado)
// ============================================================
const pendientesCAE = await Order.countDocuments({
  userId: userIdObj,
  $or: [
    { status: 'pending_invoice' },
    { status: 'error_afip' }
  ],
  amount: { $gt: 0 },
  createdAt: { $gte: fechaDesde || graficoDesde, $lte: fechaHasta || graficoHasta }
});
    
    // ============================================================
    // 6. GRÁFICO DE INGRESOS
    // ============================================================
    let graficoDesde = fechaDesde;
    let graficoHasta = fechaHasta;
    
    if (!graficoDesde) {
      graficoDesde = new Date();
      graficoDesde.setDate(graficoDesde.getDate() - 30);
      graficoDesde.setHours(0, 0, 0, 0);
    }
    if (!graficoHasta) {
      graficoHasta = new Date();
      graficoHasta.setHours(23, 59, 59, 999);
    }
    
    if (graficoHasta > hoy) graficoHasta = hoy;
    
    const ventasPorDia = await Order.aggregate([
      {
        $match: {
          userId: userIdObj,
          amount: { $gt: 0 },
          createdAt: { $gte: graficoDesde, $lte: graficoHasta }
        }
      },
      {
        $project: {
          amount: 1,
          fechaLocal: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$createdAt',
              timezone: 'America/Argentina/Buenos_Aires'
            }
          }
        }
      },
      {
        $group: {
          _id: '$fechaLocal',
          total: { $sum: '$amount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    const chartDias = [];
    const chartVentas = [];
    const ventasMap = new Map();
    ventasPorDia.forEach(v => ventasMap.set(v._id, v.total));
    
    let currentDate = new Date(graficoDesde);
    while (currentDate <= graficoHasta) {
      const key = currentDate.toISOString().split('T')[0];
      const diaStr = currentDate.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
      chartDias.push(diaStr);
      chartVentas.push(ventasMap.get(key) || 0);
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // ============================================================
    // 7. ÚLTIMAS 50 VENTAS
    // ============================================================
    const ultimas = await Order.find({ 
      userId: userIdObj,
      amount: { $gt: 0 }
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('customerName amount currency createdAt caeNumber nroFormatted customerEmail concepto items status')
      .lean();
    
    // ============================================================
    // 8. NOTAS DE CRÉDITO
    // ============================================================
    const notasCreditoAgg = await Order.aggregate([
      {
        $match: {
          userId: userIdObj,
          amount: { $lt: 0 }
        }
      },
      {
        $group: {
          _id: null,
          montoTotal: { $sum: { $abs: '$amount' } },
          cantidad: { $sum: 1 }
        }
      }
    ]);
    
    const notasCredito = {
      montoTotal: notasCreditoAgg[0]?.montoTotal || 0,
      cantidad: notasCreditoAgg[0]?.cantidad || 0
    };
    
    // ============================================================
    // RESPUESTA COMPLETA
    // ============================================================
    res.json({
      ok: true,
      // Facturación acumulada (últimos 12 meses)
      facturacionAcumulada: total12Meses,
      limiteAnual: limiteAnual,
      limiteMensual: limiteMensual,
      porcentajeAnual: Math.min(porcentaje12Meses, 100),
      porcentajeMensual: Math.min(porcentajeMensual, 100),
      categoria: categoria,
      condicionFiscal: condicionFiscal,
      // Métricas del período
      totalFacturado,
      totalFacturas,
      hoyMonto: hoyResult[0]?.total || 0,
      hoyCount: hoyResult[0]?.count || 0,
      pendientesCAE,
      notasCredito,
      chartDias,
      chartVentas,
      ultimas
    });
    
  } catch (error) {
    console.error('obtenerDashboardStats error:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = { obtenerDashboardStats };