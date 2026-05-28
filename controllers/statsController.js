// controllers/statsController.js
const Order = require('../models/Order');
const mongoose = require('mongoose');

const obtenerDashboardStats = async (req, res) => {
  try {
    const userId = req.userId;
    const { desde, hasta } = req.query;
    
    // Convertir userId a ObjectId para asegurar consistencia
    const userIdObj = new mongoose.Types.ObjectId(userId);
    
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
    
    // ============================================================
    // 1. TOTAL FACTURADO - Usando el mismo filtro que funciona en /api/orders
    // ============================================================
    const matchFacturado = {
      userId: userIdObj,
      status: 'invoiced'  // Simplificado - solo facturadas
    };
    
    // Aplicar filtro de fechas si existe
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
    // 2. EMITIDO HOY - Órdenes facturadas hoy
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
    // 3. PENDIENTES CAE - Órdenes sin facturar
    // ============================================================
    const pendientesCAE = await Order.countDocuments({
      userId: userIdObj,
      status: { $ne: 'invoiced' },
      amount: { $gt: 0 }
    });
    
    // ============================================================
    // 4. GRÁFICO DE INGRESOS - TODAS las ventas (facturadas + pendientes)
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
    
    // Limitar a la fecha actual (no días futuros)
    const hoy = new Date();
    hoy.setHours(23, 59, 59, 999);
    if (graficoHasta > hoy) {
      graficoHasta = hoy;
    }
    
    // ✅ TODAS las órdenes con monto positivo (sin importar status)
    const ventasPorDia = await Order.aggregate([
      {
        $match: {
          userId: userIdObj,
          amount: { $gt: 0 },
          createdAt: { $gte: graficoDesde, $lte: graficoHasta }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
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
      chartDias.push(currentDate.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }));
      chartVentas.push(ventasMap.get(key) || 0);
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // ============================================================
    // 5. ÚLTIMAS 50 VENTAS (todas las órdenes)
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
    
    // ============================================================
    // RESPUESTA COMPLETA
    // ============================================================
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