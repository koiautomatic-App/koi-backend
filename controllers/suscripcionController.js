const User = require('../models/User');
const { crearSuscripcionMP, cancelarSuscripcionMP } = require('../services/suscripcion/mercadopago');

const crearSuscripcion = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    
    if (!user.email) {
      return res.status(400).json({ error: 'Usuario sin email' });
    }
    
    const subscription = await crearSuscripcionMP(user.email, user._id);
    
    await User.findByIdAndUpdate(req.userId, {
      'settings.preapprovalId': subscription.id,
      'settings.suscripcionActiva': false,
      'settings.estadoCicloVida': 'cortesia_activa'
    });
    
    res.json({
      init_point: subscription.init_point,
      preapproval_id: subscription.id
    });
  } catch (error) {
    console.error('Error creando suscripción:', error);
    res.status(500).json({ 
      error: error.message,
      mp_status: error.response?.status,
      mp_data: error.response?.data
    });
  }
};

const cancelarSuscripcion = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    
    if (user.settings?.preapprovalId) {
      await cancelarSuscripcionMP(user.settings.preapprovalId);
    }
    
    await User.findByIdAndUpdate(req.userId, {
      'settings.suscripcionActiva': false,
      'settings.estadoCicloVida': 'cortesia_activa',
      'settings.preapprovalId': null,
      'plan': 'free'
    });
    
    res.json({ ok: true, message: 'Suscripción cancelada' });
  } catch (error) {
    console.error('Error cancelando suscripción:', error);
    res.status(500).json({ error: error.message });
  }
};

const verificarEstado = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    const activa = user?.settings?.suscripcionActiva === true || user?.plan === 'pro';
    res.json({ activa });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const webhookSuscripcion = async (req, res) => {
  try {
    const { type, data } = req.body;
    console.log('Webhook recibido:', { type, data });
    
    if (type === 'payment') {
      const paymentId = data.id;
      const mercadopago = require('mercadopago');
      const payment = await mercadopago.payment.findById(paymentId);
      
      if (payment.body.status === 'approved') {
        const preapprovalId = payment.body.preapproval_id;
        const amount = payment.body.transaction_amount;
        
        const user = await User.findOne({ 'settings.preapprovalId': preapprovalId });
        
        if (user) {
          const nuevoProximoPago = new Date();
          nuevoProximoPago.setDate(nuevoProximoPago.getDate() + 30);
          
          await User.findByIdAndUpdate(user._id, {
            'settings.suscripcionActiva': true,
            'settings.estadoCicloVida': 'suscripto',
            'settings.fechaUltimoPago': new Date(),
            'settings.proximoPago': nuevoProximoPago,
            'settings.ultimoMontoPago': amount,
            'plan': 'pro'
          });
          
          console.log('✅ Suscripción activada para usuario ' + user.email);
        }
      }
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Error');
  }
};

module.exports = { crearSuscripcion, cancelarSuscripcion, verificarEstado, webhookSuscripcion };