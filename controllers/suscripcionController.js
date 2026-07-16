// controllers/suscripcionController.js
const User = require('../models/User');
const { crearSuscripcionMP, cancelarSuscripcionMP } = require('../services/suscripcion/mercadopago');

// ============================================================
//  CREAR SUSCRIPCIÓN
// ============================================================
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

// ============================================================
//  CANCELAR SUSCRIPCIÓN
// ============================================================
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

// ============================================================
//  VERIFICAR ESTADO
// ============================================================
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
//  WEBHOOK - CONFIGURACIÓN ROBUSTA CON BÚSQUEDA PRIORITARIA
// ============================================================
const webhookSuscripcion = async (req, res) => {
  console.log('🔴🔴🔴 VERSION-WEBHOOK-v2.2 - BÚSQUEDA PRIORITARIA 🔴🔴🔴');
  console.log('📥 WEBHOOK RECIBIDO');
  console.log('📥 Body:', JSON.stringify(req.body, null, 2));
  
  try {
    const { type, data } = req.body;
    
    if (type === 'payment') {
      const paymentId = data.id;
      console.log('💰 ID de pago:', paymentId);
      
      // 👇 CONFIGURACIÓN ROBUSTA
      console.log('🔧 Configurando mercadopago...');
      const mercadopago = require('mercadopago');
      const token = process.env.MP_ACCESS_TOKEN;
      
      if (!token) {
        console.error('❌ Token no disponible');
        return res.status(500).json({ error: 'Token de Mercado Pago no disponible' });
      }
      
      // ✅ CONFIGURAR
      mercadopago.configure({ access_token: token });
      console.log('✅ mercadopago.configure() ejecutado');
      
      // Obtener el pago
      const payment = await mercadopago.payment.findById(paymentId);
      console.log('📊 Estado del pago:', payment.body.status);
      
      if (payment.body.status === 'approved') {
        console.log('✅ Pago APROBADO! Procesando...');
        
        const preapprovalId = payment.body.preapproval_id;
        const email = payment.body.payer?.email;
        const amount = payment.body.transaction_amount;
        
        console.log('🔍 Buscando usuario con email:', email);
        console.log('🔍 Buscando usuario con preapprovalId:', preapprovalId);
        
        // 👇 PRIORIZAR BÚSQUEDA POR EMAIL (más específico)
        let user = null;
        
        // 1. Buscar por email (el pagador)
        if (email) {
          user = await User.findOne({ email: email });
          if (user) {
            console.log('👤 Usuario encontrado por email:', user.email);
          }
        }
        
        // 2. Si no se encuentra por email, buscar por preapprovalId
        if (!user && preapprovalId) {
          user = await User.findOne({ 'settings.preapprovalId': preapprovalId });
          if (user) {
            console.log('👤 Usuario encontrado por preapprovalId:', user.email);
          }
        }
        
        // 3. Si no se encuentra, buscar en todos los usuarios con preapprovalId
        if (!user) {
          console.warn('⚠️ Usuario NO encontrado por email ni preapprovalId');
          console.log('📋 Buscando en todos los usuarios con preapprovalId...');
          const allUsers = await User.find({ 
            'settings.preapprovalId': { $exists: true } 
          }).select('email settings.preapprovalId');
          
          console.log('  Usuarios encontrados:', allUsers.length);
          allUsers.forEach(u => {
            console.log(`  - ${u.email}: ${u.settings?.preapprovalId}`);
          });
          
          return res.status(200).json({ 
            status: 'ok', 
            message: 'Usuario no encontrado',
            debug: { preapprovalId, email }
          });
        }
        
        console.log('👤 Usuario encontrado:', user.email);
        console.log('👤 ID:', user._id);
        
        // ✅ Guardar TODOS los datos del pago
        const fechaActual = new Date();
        const nuevoProximoPago = new Date();
        nuevoProximoPago.setDate(nuevoProximoPago.getDate() + 30);
        
        console.log('📅 Fecha actual:', fechaActual.toISOString());
        console.log('📅 Próximo pago:', nuevoProximoPago.toISOString());
        console.log('💰 Monto:', amount);
        
        await User.findByIdAndUpdate(user._id, {
          'settings.suscripcionActiva': true,
          'settings.estadoCicloVida': 'suscripto',
          'settings.fechaUltimoPago': fechaActual,
          'settings.proximoPago': nuevoProximoPago,
          'settings.ultimoMontoPago': amount,
          'settings.preapprovalId': preapprovalId,
          'plan': 'pro'
        });
        
        console.log('✅ Suscripción ACTIVADA para:', user.email);
        console.log('📅 Fecha del pago:', fechaActual.toISOString());
        console.log('📅 Próximo pago:', nuevoProximoPago.toISOString());
        console.log('💰 Monto:', amount);
        console.log('💳 Plan actualizado a: pro');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        return res.status(200).json({ 
          status: 'ok', 
          message: 'Suscripción activada correctamente',
          usuario: user.email,
          fechaPago: fechaActual.toISOString(),
          proximoPago: nuevoProximoPago.toISOString(),
          monto: amount
        });
      } else {
        console.log('ℹ️ Pago NO aprobado:', payment.body.status);
        return res.status(200).json({ 
          status: 'ok', 
          message: 'Pago no aprobado',
          estadoPago: payment.body.status
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

// ============================================================
//  EXPORTAR TODAS LAS FUNCIONES
// ============================================================
module.exports = { 
  crearSuscripcion, 
  cancelarSuscripcion, 
  verificarEstado, 
  webhookSuscripcion 
};
