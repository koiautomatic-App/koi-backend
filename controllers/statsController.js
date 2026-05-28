// controllers/statsController.js
const Order = require('../models/Order');

const obtenerDashboardStats = async (req, res) => {
  try {
    const userId = req.userId;
    const { desde, hasta } = req.query;
    
    // Parsear fechas
    let fechaDesde = null;
    let fechaHasta = null;
    
    if (desde) {
      fechaDesde = new Date(desde);
      fechaDesde.setHours(0, 0, 0, 0);
    }
    if (hasta) {
      fechaHasta = new Date(hasta);
      fechaHasta.setHours(23, 59, 59, 999);
    }
    
    // 1. TOTAL FACTURADO
    const matchFacturado = {
      userId: userId,
      $or: [{ status: 'invoiced' }, { caeNumber: { $exists: true, $ne: null } }]
    };
    if (fechaDesde || fechaHasta) {
      matchFacturado.fechaEmision = {};
      if (fechaDesde) matchFacturado.fechaEmision.$gte = fechaDesde;
      if (fechaHasta) matchFacturado.fechaEmision.$lte = fechaHasta;
    }
    
    const totalResult = await Order.aggregate([
      { $match: matchFacturado },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]);
    
    const totalFacturado = totalResult[0]?.total || 0;
    const totalFacturas = totalResult[0]?.count || 0;
    
    // 2. EMITIDO HOY
    const hoyInicio = new Date();
    hoyInicio.setHours(0, 0, 0, 0);
    const hoyFin = new Date();
    hoyFin.setHours(23, 59, 59, 999);
    
    const hoyResult = await Order.aggregate([
      {
        $match: {
          userId: userId,
          $or: [{ status: 'invoiced' }, { caeNumber: { $exists: true } }],
          fechaEmision: { $gte: hoyInicio, $lte: hoyFin }
        }
      },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]);
    
    // 3. PENDIENTES CAE
    const pendientesCAE = await Order.countDocuments({
      userId: userId,
      caeNumber: { $exists: false },
      status: { $ne: 'invoiced' }
    });
    
    // 4. GRÁFICO DE INGRESOS (últimos 30 días por defecto)
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
    
    const ventasPorDia = await Order.aggregate([
      {
        $match: {
          userId: userId,
          $or: [{ status: 'invoiced' }, { caeNumber: { $exists: true } }],
          fechaEmision: { $gte: graficoDesde, $lte: graficoHasta }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$fechaEmision' } },
          total: { $sum: '$amount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    // Generar array de días entre fechas
    const chartDias = [];
    const chartVentas = [];
    const ventasMap = new Map();
    ventasPorDia.forEach(v => ventasMap.set(v._id, v.total));
    
    let currentDate = new Date(graficoDesde);
    while (currentDate <= graficoHasta) {
      const key = currentDate.toISOString().split('T')[0];
      chartDias.push(currentDate.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }));
      chartVentas.push(ventasMap.get(key) || 0);
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // 5. ÚLTIMAS 50 VENTAS
    const ultimas = await Order.find({ userId: userId })
      .sort({ fechaEmision: -1, createdAt: -1 })
      .limit(50)
      .select('customerName amount currency createdAt fechaEmision caeNumber nroFormatted customerEmail concepto items status')
      .lean();
    
    const ultimasConConcepto = ultimas.map(v => ({
      ...v,
      conceptoMostrar: v.concepto || (v.items?.length ? v.items.map(i => i.nombre).join(', ') : 'Venta')
    }));
    
    // 6. NOTAS DE CRÉDITO
    const notasCreditoAgg = await Order.aggregate([
      {
        $match: {
          userId: userId,
          $or: [{ amount: { $lt: 0 } }, { nroFormatted: { $regex: /^NC/i } }],
          ...(fechaDesde || fechaHasta ? {
            fechaEmision: {
              ...(fechaDesde && { $gte: fechaDesde }),
              ...(fechaHasta && { $lte: fechaHasta })
            }
          } : {})
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
    
    // Respuesta completa
    res.json({
      ok: true,
      totalFacturado,
      totalFacturas,
      hoyMonto: hoyResult[0]?.total || 0,
      hoyCount: hoyResult[0]?.count || 0,
      pendientesCAE,
      notasCredito,
      chartDias,
      chartVentas,
      ultimas: ultimasConConcepto
    });
    
  } catch (error) {
    console.error('obtenerDashboardStats error:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = { obtenerDashboardStats };