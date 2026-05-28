// controllers/statsController.js
const Order = require('../models/Order');
const mongoose = require('mongoose');

const obtenerDashboardStats = async (req, res) => {
  try {
    const userId = req.userId;
    const { desde, hasta } = req.query;
    
    // Convertir userId a ObjectId
    const userIdObj = new mongoose.Types.ObjectId(userId);
    
    // Parsear fechas (asegurando zona horaria Argentina)
    let fechaDesde = null;
    let fechaHasta = null;
    
    if (desde) {
      fechaDesde = new Date(desde + 'T00:00:00-03:00'); // Forzar zona Argentina
    }
    if (hasta) {
      fechaHasta = new Date(hasta + 'T23:59:59-03:00'); // Forzar zona Argentina
    }
    
    // ============================================================
    // 1. TOTAL FACTURADO
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
    // 2. EMITIDO HOY
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
    // 3. PENDIENTES CAE
    // ============================================================
    const pendientesCAE = await Order.countDocuments({
      userId: userIdObj,
      status: { $ne: 'invoiced' },
      amount: { $gt: 0 }
    });
    
    // ============================================================
    // 4. GRÁFICO DE INGRESOS - CON ZONA HORARIA CORREGIDA
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
    
    // Limitar a la fecha actual
    const hoy = new Date();
    hoy.setHours(23, 59, 59, 999);
    if (graficoHasta > hoy) graficoHasta = hoy;
    
    // ✅ USAR ZONA HORARIA DE ARGENTINA (UTC-3)
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
              timezone: 'America/Argentina/Buenos_Aires'  // 👈 FORZAR ZONA ARGENTINA
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
    
    // Generar array de días
    const chartDias = [];
    const chartVentas = [];
    const ventasMap = new Map();
    ventasPorDia.forEach(v => ventasMap.set(v._id, v.total));
    
    let currentDate = new Date(graficoDesde);
    while (currentDate <= graficoHasta) {
      const key = currentDate.toISOString().split('T')[0];
      // Formatear la fecha para mostrar (día/mes)
      const diaStr = currentDate.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
      chartDias.push(diaStr);
      chartVentas.push(ventasMap.get(key) || 0);
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // ============================================================
    // 5. ÚLTIMAS 50 VENTAS
    // ============================================================
    const ultimas = await Order.find({ 
      userId: userIdObj,
      amount: { $gt: 0 }
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('customerName amount currency createdAt caeNumber nroFormatted customerEmail concepto items status')
      .lean();
    
    const ultimasConConcepto = ultimas.map(v => ({
      ...v,
      conceptoMostrar: v.concepto || (v.items?.length ? v.items.map(i => i.nombre).join(', ') : 'Venta')
    }));
    
    // ============================================================
    // 6. NOTAS DE CRÉDITO
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
    
    // Respuesta
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