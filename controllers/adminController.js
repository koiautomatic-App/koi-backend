const mongoose = require('mongoose');
const User = require('../models/User');
const Order = require('../models/Order');
const Integration = require('../models/Integration');
const { decrypt } = require('../utils/encrypt');

const actualizarPtoVenta = async (req, res) => {
  try {
    const { userId, arcaPtoVta } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'ID de usuario inválido' });
    }
    
    const puntoVenta = parseInt(arcaPtoVta);
    if (isNaN(puntoVenta) || puntoVenta < 1 || puntoVenta > 9999) {
      return res.status(400).json({ error: 'Punto de venta debe ser entre 1 y 9999' });
    }
    
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: { 'settings.arcaPtoVta': puntoVenta } },
      { new: true }
    );
    
    if (!updatedUser) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    res.json({ ok: true, message: 'Punto de venta actualizado', nuevoValor: updatedUser.settings?.arcaPtoVta });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
};

const vincularArca = async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'ID de usuario inválido' });
    }
    
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    
    if (!user.settings?.cuit) {
      return res.status(400).json({ error: 'El usuario no tiene CUIT configurado.' });
    }
    
    if (!user.settings?.arcaClave) {
      return res.status(400).json({ error: 'El usuario no tiene Clave Fiscal configurada.' });
    }
    
    const fechaVinculacion = new Date().toISOString();
    
    await User.findByIdAndUpdate(userId, {
      $set: { 
        'settings.arcaStatus': 'vinculado',
        'settings.fechaVinculacionARCA': fechaVinculacion
      }
    });
    
    res.json({ ok: true, message: 'ARCA vinculado correctamente', fechaVinculacion: fechaVinculacion });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
};

const desvincularArca = async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'ID de usuario inválido' });
    }
    
    await User.findByIdAndUpdate(userId, {
      $set: { 'settings.arcaStatus': 'pendiente' }
    });
    
    res.json({ ok: true, message: 'ARCA desvinculado correctamente' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
};

const verClaveArca = async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'ID de usuario inválido' });
    }
    
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    
    const claveCifrada = user.settings?.arcaClave;
    if (!claveCifrada) {
      return res.json({ ok: true, tieneClave: false });
    }
    
    const claveReal = decrypt(claveCifrada);
    if (!claveReal) {
      return res.json({ ok: true, tieneClave: false });
    }
    
    res.json({ ok: true, tieneClave: true, clave: claveReal, email: user.email });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
};

const getStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const afipLinked = await User.countDocuments({ 'settings.arcaStatus': 'vinculado' });
    const pendingUsers = totalUsers - afipLinked;
    const invoicesToday = await Order.countDocuments({ fechaEmision: { $gte: new Date().setHours(0,0,0) } });
    
    res.json({ ok: true, totalUsers, afipLinked, pendingUsers, invoicesToday });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const listarUsuarios = async (req, res) => {
  try {
    const users = await User.find().select('-password -__v').lean();
    
    const orders = await Order.find({}).lean();
    const statsPorUsuario = {};
    
    orders.forEach(order => {
      if (order.userId && order.amount > 0 && (order.status === 'invoiced' || order.caeNumber)) {
        const userIdStr = order.userId.toString();
        if (!statsPorUsuario[userIdStr]) {
          statsPorUsuario[userIdStr] = { totalFacturas: 0, montoFacturas: 0 };
        }
        statsPorUsuario[userIdStr].totalFacturas++;
        statsPorUsuario[userIdStr].montoFacturas += order.amount;
      }
    });
    
    const usersConStats = users.map(user => ({
      ...user,
      stats: statsPorUsuario[user._id.toString()] || { totalFacturas: 0, montoFacturas: 0 }
    }));
    
    res.json({ ok: true, users: usersConStats });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
};

const exportarCSV = async (req, res) => {
  try {
    const users = await User.find().select('nombre apellido email settings.cuit settings.arcaStatus plan').lean();
    let csv = 'Nombre,Apellido,Email,CUIT,ARCA Status,Plan\n';
    users.forEach(u => {
      csv += '"' + (u.nombre || '') + '","' + (u.apellido || '') + '","' + u.email + '","' + (u.settings?.cuit || '') + '",' + (u.settings?.arcaStatus || 'pendiente') + ',' + u.plan + '\n';
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=usuarios.csv');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const listarIntegraciones = async (req, res) => {
  try {
    const integrations = await Integration.find().select('userId platform storeName status').lean();
    res.json({ ok: true, integrations });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const desvincularUsuario = async (req, res) => {
  try {
    const { userId } = req.body;
    await User.findByIdAndUpdate(userId, { 
      $unset: { 'settings.cuit': '', 'settings.arcaClave': '' },
      $set: { 'settings.arcaStatus': 'pendiente' }
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  actualizarPtoVenta,
  vincularArca,
  desvincularArca,
  verClaveArca,
  getStats,
  listarUsuarios,
  exportarCSV,
  listarIntegraciones,
  desvincularUsuario
};