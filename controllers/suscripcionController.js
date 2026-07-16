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
//  WEBHOOK - CONFIGURACIÓN FORZADA EN CADA PETICIÓN (v2.0)
// ============================================================
const webhookSuscripcion = async (req, res) => {
  // 👇 MARCADOR DE VERSIÓN - BUSCAR ESTO EN LOGS DE RENDER
  console.log('🔴🔴🔴 VERSION-WEBHOOK-v2.0 - 2026-07-16 🔴🔴🔴');
  console.log('📅 Timestamp:', new Date().toISOString());
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📥 WEBHOOK RECIBIDO');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📥 Headers:', JSON.stringify(req.headers, null, 2));
  console.log('📥 Body:', JSON.stringify(req.body, null, 2));
  
  try {
    const { type, data } = req.body;
    console.log('📥 Type:', type);
    console.log('📥 Data:', data);
    
    if (type === 'payment') {
      const paymentId = data.id;
      console.log('💰 ID de pago:', paymentId);
      
      // 👇 CONFIGURAR MERCADOPAGO FORZADAMENTE AQUÍ
      console.log('🔧 Configurando mercadopago...');
      const mercadopago = require('mercadopago');
      const token = process.env.MP_ACCESS_TOKEN;
      
      console.log('🔍 Token disponible:', !!token);
      console.log('🔍 Token length:', token?.length || 0);
      
      if (!token) {
        console.error('❌ Token no disponible');
        return res.status(500).json({ 
          error: 'Token de Mercado Pago no disponible' 
        });
      }
      
      // ✅ CONFIGURAR FORZADAMENTE
      mercadopago.configure({
        access_token: token
      });
      console.log('✅ mercadopago configurado (forzado)');
      console.log('🔍 mercadopago.config:', !!mercadopago.config);
      
      // Verificar configuración
      if (!mercadopago.config) {
        console.error('❌ Configuración falló');
        return res.status(500).json({ 
          error: 'mercadopago no configurado',
          debug: { hasConfig: false }
        });
      }
      
      console.log('🔧 Consultando pago...');
      const payment = await mercadopago.payment.findById(paymentId);
      console.log('📊 Estado del pago:', payment.body.status);
      
      if (payment.body.status === 'approved') {
        console.log('✅ Pago APROBADO!');
        const preapprovalId = payment.body.preapproval_id;
        const email = payment.body.payer?.email;
        const amount = payment.body.transaction_amount;
        
        console.log('🔍 Buscando usuario con preapprovalId:', preapprovalId);
        console.log('🔍 O con email:', email);
        
        let user = await User.findOne({ 
          $or: [
            { 'settings.preapprovalId': preapprovalId },
            { email: email }
          ]
        });
        
        if (!user) {
          console.warn('⚠️ Usuario NO encontrado');
          console.log('📋 Todos los usuarios con preapprovalId:');
          try {
            const allUsers = await User.find({ 'settings.preapprovalId': { $exists: true } })
              .select('email settings.preapprovalId');
            console.log('  Usuarios encontrados:', allUsers.length);
            allUsers.forEach(u => {
              console.log(`  - ${u.email}: ${u.settings?.preapprovalId}`);
            });
          } catch (e) {
            console.error('Error consultando usuarios:', e.message);
          }
          
          return res.status(200).json({ 
            status: 'ok', 
            message: 'Usuario no encontrado',
            debug: { preapprovalId, email }
          });
        }
        
        console.log('👤 Usuario encontrado:', user.email);
        console.log('👤 ID:', user._id);
        
        const nuevoProximoPago = new Date();
        nuevoProximoPago.setDate(nuevoProximoPago.getDate() + 30);
        
        console.log('📅 Actualizando suscripción...');
        await User.findByIdAndUpdate(user._id, {
          'settings.suscripcionActiva': true,
          'settings.estadoCicloVida': 'suscripto',
          'settings.fechaUltimoPago': new Date(),
          'settings.proximoPago': nuevoProximoPago,
          'settings.ultimoMontoPago': amount,
          'settings.preapprovalId': preapprovalId,
          'plan': 'pro'
        });
        
        console.log('✅ Suscripción ACTIVADA para:', user.email);
        console.log('📅 Próximo pago:', nuevoProximoPago.toISOString());
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        return res.status(200).json({ 
          status: 'ok', 
          message: 'Suscripción activada correctamente',
          usuario: user.email,
          proximoPago: nuevoProximoPago.toISOString()
        });
      } else {
        console.log('ℹ️ Pago NO aprobado:', payment.body.status);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        return res.status(200).json({ 
          status: 'ok', 
          message: 'Pago no aprobado',
          estadoPago: payment.body.status
        });
      }
    }
    
    console.log('ℹ️ Evento ignorado:', type);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    res.status(200).json({ status: 'ignored' });
    
  } catch (error) {
    console.error('❌ Webhook error:', error);
    console.error('❌ Stack:', error.stack);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
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
