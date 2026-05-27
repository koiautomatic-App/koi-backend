const mongoose = require('mongoose');
const Order = require('../models/Order');

const obtenerDashboardStats = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.userId);
    
    let fechaDesde = null;
    let fechaHasta = null;
    
    if (req.query.desde) {
      fechaDesde = new Date(req.query.desde);
      fechaDesde.setHours(0, 0, 0, 0);
    }
    if (req.query.hasta) {
      fechaHasta = new Date(req.query.hasta);
      fechaHasta.setHours(23, 59, 59, 999);
    }
    
    const matchFacturado = {
      userId: userId,
      $or: [
        { status: 'invoiced' },
        { caeNumber: { $exists: true, $ne: null } }
      ]
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
    
    const pendientesCAE = await Order.countDocuments({
      userId: userId,
      caeNumber: { $exists: false },
      status: { $ne: 'invoiced' }
    });
    
    res.json({
      ok: true,
      totalFacturado: totalFacturado,
      totalFacturas: totalFacturas,
      hoyMonto: hoyResult[0]?.total || 0,
      hoyCount: hoyResult[0]?.count || 0,
      pendientesCAE: pendientesCAE
    });
  } catch (error) {
    console.error('obtenerDashboardStats error:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = { obtenerDashboardStats };