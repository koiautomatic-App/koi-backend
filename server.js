// ════════════════════════════════════════════════════════════
//  API — DASHBOARD & STATS (v3.1 con Filtro Temporal)
// ════════════════════════════════════════════════════════════

app.get('/api/stats/dashboard', requireAuthAPI, async (req, res) => {
  const { period } = req.query; // 'month', 'year' o 'all'
  const userId = new mongoose.Types.ObjectId(req.userId);

  try {
    // 1. Construir el filtro de fecha
    let dateFilter = { userId };
    const ahora = new Date();

    if (period === 'month') {
      const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
      dateFilter.createdAt = { $gte: inicioMes };
    } else if (period === 'year') {
      const inicioAnio = new Date(ahora.getFullYear(), 0, 1);
      dateFilter.createdAt = { $gte: inicioAnio };
    }
    // Si es 'all', no agregamos filtro de fecha a dateFilter

    // 2. Ejecutar agregación para Totales
    const stats = await Order.aggregate([
      { $match: dateFilter },
      { 
        $group: { 
          _id: null, 
          total: { $sum: "$amount" }, 
          count: { $sum: 1 } 
        } 
      }
    ]);

    // 3. Obtener órdenes para el Mapa de Calor (Heatmap)
    // Para el mapa de calor siempre mandamos una buena cantidad para que se vea lleno
    const ventas = await Order.find(dateFilter)
      .sort({ createdAt: -1 })
      .limit(period === 'all' ? 1000 : 200) 
      .select('amount createdAt externalId')
      .lean();

    // 4. Verificar si hay integraciones activas
    const integration = await Integration.findOne({ userId, status: 'active' });

    res.json({
      ok: true,
      connected: !!integration,
      totalFacturado: stats[0]?.total || 0,
      totalVentas: stats[0]?.count || 0,
      ventas: ventas
    });

  } catch (e) {
    console.error('Dash Stats Error:', e.message);
    res.status(500).json({ error: 'Error al calcular estadísticas' });
  }
});
