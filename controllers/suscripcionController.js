// controllers/suscripcionController.js
const User = require('../models/User');
const { crearSuscripcionMP, cancelarSuscripcionMP } = require('../services/suscripcion/mercadopago');
// 👇 IMPORTAR MERCADOPAGO DIRECTAMENTE (configurado en app.js)
const mercadopago = require('mercadopago');

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

// ============================================================
//  WEBHOOK MEJORADO - VERSIÓN DEFINITIVA
// ============================================================
const webhookSuscripcion = async (req, res) => {
  try {
    console.log('📥 Webhook recibido');
    console.log('📥 Body:', JSON.stringify(req.body, null, 2));
    
    const { type, data } = req.body;
    
    if (type === 'payment') {
      const paymentId = data.id;
      console.log('💰 ID de pago:', paymentId);
      
      // 👇 USAR MERCADOPAGO DIRECTAMENTE
      if (!mercadopago.config) {
        console.error('❌ mercadopago no está configurado');
        return res.status(500).json({ error: 'mercadopago no configurado' });
      }
      
      const payment = await mercadopago.payment.findById(paymentId);
      console.log('📊 Estado del pago:', payment.body.status);
      console.log('📊 Preapproval ID:', payment.body.preapproval_id);
      console.log('📊 Email del pagador:', payment.body.payer?.email);
      
      if (payment.body.status === 'approved') {
        const preapprovalId = payment.body.preapproval_id;
        const amount = payment.body.transaction_amount;
        const email = payment.body.payer?.email;
        
        let user = await User.findOne({ 
          $or: [
            { 'settings.preapprovalId': preapprovalId },
            { email: email }
          ]
        });
        
        if (!user) {
          console.warn('⚠️ Usuario no encontrado');
          return res.status(200).json({ 
            status: 'ok', 
            message: 'Usuario no encontrado' 
          });
        }
        
        console.log('👤 Usuario encontrado:', user.email);
        
        const nuevoProximoPago = new Date();
        nuevoProximoPago.setDate(nuevoProximoPago.getDate() + 30);
        
        await User.findByIdAndUpdate(user._id, {
          'settings.suscripcionActiva': true,
          'settings.estadoCicloVida': 'suscripto',
          'settings.fechaUltimoPago': new Date(),
          'settings.proximoPago': nuevoProximoPago,
          'settings.ultimoMontoPago': amount,
          'settings.preapprovalId': preapprovalId,
          'plan': 'pro'
        });
        
        console.log('✅ Suscripción activada para:', user.email);
        
        return res.status(200).json({ 
          status: 'ok', 
          message: 'Suscripción activada correctamente' 
        });
      } else {
        console.log('ℹ️ Pago no aprobado:', payment.body.status);
        return res.status(200).json({ 
          status: 'ok', 
          message: 'Pago no aprobado' 
        });
      }
    }
    
    console.log('ℹ️ Evento ignorado:', type);
    res.status(200).json({ status: 'ignored' });
    
  } catch (error) {
    console.error('❌ Webhook error:', error);
    console.error('❌ Stack:', error.stack);
    res.status(500).json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

module.exports = { 
  crearSuscripcion, 
  cancelarSuscripcion, 
  verificarEstado, 
  webhookSuscripcion 
};