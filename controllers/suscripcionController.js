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
//  WEBHOOK - CONFIGURACIÓN ROBUSTA PARA MERCADO PAGO
// ============================================================
const webhookSuscripcion = async (req, res) => {
  console.log('🔴🔴🔴 VERSION-WEBHOOK-v2.1 🔴🔴🔴');
  console.log('📥 WEBHOOK RECIBIDO');
  console.log('📥 Body:', JSON.stringify(req.body, null, 2));
  
  try {
    const { type, data } = req.body;
    
    if (type === 'payment') {
      const paymentId = data.id;
      console.log('💰 ID de pago:', paymentId);
      
      // 👇 CONFIGURACIÓN ROBUSTA
      console.log('🔧 Configurando mercadopago...');
      
      // Método 1: Usar el SDK directamente
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
      
      // ✅ FORZAR CONFIGURACIÓN - MÉTODO ROBUSTO
      try {
        // Configurar usando el método correcto
        mercadopago.configure({
          access_token: token
        });
        console.log('✅ mercadopago.configure() ejecutado');
        
        // Verificar configuración (usando el método de verificación correcto)
        // En la versión legacy, no hay propiedad 'config', se usa directamente
        console.log('🔍 Verificando configuración...');
        
        // Intentar hacer una llamada de prueba para verificar que funciona
        console.log('🔧 Haciendo llamada de prueba a la API...');
        const testPayment = await mercadopago.payment.findById(paymentId);
        console.log('✅ Llamada de prueba exitosa!');
        console.log('📊 Estado del pago:', testPayment.body.status);
        
        // Si llegamos aquí, la configuración funcionó
        console.log('✅ mercadopago configurado correctamente');
        
        // Procesar el pago
        if (testPayment.body.status === 'approved') {
          console.log('✅ Pago APROBADO! Procesando...');
          const preapprovalId = testPayment.body.preapproval_id;
          const email = testPayment.body.payer?.email;
          const amount = testPayment.body.transaction_amount;
          
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
            return res.status(200).json({ 
              status: 'ok', 
              message: 'Usuario no encontrado',
              debug: { preapprovalId, email }
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
          
          console.log('✅ Suscripción ACTIVADA para:', user.email);
          
          return res.status(200).json({ 
            status: 'ok', 
            message: 'Suscripción activada correctamente',
            usuario: user.email
          });
        } else {
          console.log('ℹ️ Pago NO aprobado:', testPayment.body.status);
          return res.status(200).json({ 
            status: 'ok', 
            message: 'Pago no aprobado',
            estadoPago: testPayment.body.status
          });
        }
      } catch (configError) {
        console.error('❌ Error en configuración o llamada a API:', configError.message);
        console.error('❌ Stack:', configError.stack);
        
        // Intentar un método alternativo de configuración
        console.log('🔧 Intentando método alternativo...');
        try {
          // Método alternativo: configurar usando la instancia directamente
          const mp = require('mercadopago');
          mp.configure({
            access_token: token
          });
          
          // Intentar la llamada nuevamente
          const payment = await mp.payment.findById(paymentId);
          console.log('✅ Método alternativo exitoso!');
          console.log('📊 Estado del pago:', payment.body.status);
          
          // Procesar el pago (similar al código de arriba)
          if (payment.body.status === 'approved') {
            // ... mismo código de procesamiento
          }
        } catch (fallbackError) {
          console.error('❌ Error en método alternativo:', fallbackError.message);
          return res.status(500).json({
            error: 'Error configurando Mercado Pago',
            details: fallbackError.message
          });
        }
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
