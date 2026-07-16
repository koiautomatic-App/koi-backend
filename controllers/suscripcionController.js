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
//  WEBHOOK - CONFIGURACIÓN DIRECTA DENTRO DEL WEBHOOK
// ============================================================
const webhookSuscripcion = async (req, res) => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📥 WEBHOOK RECIBIDO');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📥 Body completo:', JSON.stringify(req.body, null, 2));
  console.log('📥 Headers:', req.headers);
  console.log('📥 IP:', req.ip);
  console.log('📥 Método:', req.method);
  console.log('📥 URL:', req.url);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  try {
    const { type, data } = req.body;
    console.log('📥 Type:', type);
    console.log('📥 Data:', data);
    
    if (type === 'payment') {
      const paymentId = data.id;
      console.log('💰 ID de pago:', paymentId);
      
      // 👇 IMPORTAR Y CONFIGURAR AQUÍ
      console.log('🔧 Cargando módulo mercadopago...');
      const mercadopago = require('mercadopago');
      console.log('🔧 mercadopago cargado');
      console.log('🔧 mercadopago.config ANTES de configurar:', !!mercadopago.config);
      
      const token = process.env.MP_ACCESS_TOKEN;
      console.log('🔍 Token existe:', !!token);
      console.log('🔍 Token length:', token?.length || 0);
      console.log('🔍 Token preview:', token ? token.substring(0, 10) + '...' : 'NO TOKEN');
      
      if (!mercadopago.config) {
        console.log('🔧 Configurando mercadopago desde el webhook...');
        try {
          mercadopago.configure({
            access_token: token
          });
          console.log('✅ mercadopago configurado desde el webhook');
        } catch (configError) {
          console.error('❌ Error al configurar:', configError.message);
          console.error('❌ Stack:', configError.stack);
          return res.status(500).json({ 
            error: 'Error configurando Mercado Pago: ' + configError.message 
          });
        }
      }
      
      console.log('🔧 mercadopago.config DESPUÉS de configurar:', !!mercadopago.config);
      
      if (!mercadopago.config) {
        console.error('❌ mercadopago NO está configurado');
        return res.status(500).json({ 
          error: 'mercadopago no configurado',
          debug: {
            tokenExists: !!token,
            tokenLength: token?.length || 0,
            hasConfig: !!mercadopago.config
          }
        });
      }
      
      console.log('🔧 Consultando pago en Mercado Pago...');
      try {
        const payment = await mercadopago.payment.findById(paymentId);
        console.log('📊 Pago encontrado:');
        console.log('  ID:', payment.body.id);
        console.log('  Status:', payment.body.status);
        console.log('  Preapproval ID:', payment.body.preapproval_id);
        console.log('  Payer Email:', payment.body.payer?.email);
        console.log('  Amount:', payment.body.transaction_amount);
        
        if (payment.body.status === 'approved') {
          console.log('✅ Pago APROBADO! Procesando...');
          const preapprovalId = payment.body.preapproval_id;
          const amount = payment.body.transaction_amount;
          const email = payment.body.payer?.email;
          
          console.log('🔍 Buscando usuario con preapprovalId:', preapprovalId);
          console.log('🔍 O con email:', email);
          
          // 👇 LOGS PARA DEPURAR LA BÚSQUEDA
          console.log('📋 Buscando usuario con:');
          console.log('  preapprovalId:', preapprovalId);
          console.log('  email:', email);
          
          let user = await User.findOne({ 
            $or: [
              { 'settings.preapprovalId': preapprovalId },
              { email: email }
            ]
          });
          
          if (!user) {
            console.warn('⚠️ Usuario NO encontrado!');
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
      } catch (mpError) {
        console.error('❌ Error consultando Mercado Pago:', mpError.message);
        console.error('❌ Stack:', mpError.stack);
        console.error('❌ Response:', mpError.response?.data);
        return res.status(500).json({ 
          error: 'Error consultando Mercado Pago',
          details: mpError.message,
          mpResponse: mpError.response?.data
        });
      }
    }
    
    console.log('ℹ️ Evento ignorado (no es payment):', type);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    res.status(200).json({ status: 'ignored', type });
    
  } catch (error) {
    console.error('❌ Webhook error GENERAL:', error);
    console.error('❌ Stack:', error.stack);
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
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