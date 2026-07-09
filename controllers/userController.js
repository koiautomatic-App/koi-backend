// controllers/userController.js
const User = require('../models/User');
const { encrypt } = require('../utils/encrypt');

const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password').lean();
    if (!user) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true, user });
  } catch (error) {
    console.error('GetMe error:', error);
    res.status(500).json({ error: 'Error interno' });
  }
};

const updateSettings = async (req, res) => {
  try {
    const userActual = await User.findById(req.userId).select('email settings').lean();
    const esAdmin = userActual?.email === 'koi.automatic@gmail.com';

      // Campos permitidos para actualización
    const allowed = [
      'factAuto', 'envioAuto', 'categoria', 'condicionFiscal', 'cuit', 'razonSocial',
      'puntoVenta', 'tipoComprobante', 'nombre', 'apellido', 'logoUrl',
      'fechaInicioVinculacion', 'inicioCortesia', 'finCortesia', 'inicioExtension',
      'finExtension', 'fechaSuscripcion', 'ultimoPago', 'proximoPago',
      'fechaCancelacion', 'fechaExpiracion', 'estadoCicloVida', 'planId',
      'planNombre', 'precioSuscripcion', 'arcaStatus', 'suscripcionActiva',
      // 👇 AGREGAR ESTOS 👇
      'contadorEmail', 'contadorNombre'
    ];

    // 🔒 SOLO ADMIN puede modificar fechaVinculacionARCA
    if (req.body.fechaVinculacionARCA) {
      if (esAdmin) {
        allowed.push('fechaVinculacionARCA');
        console.log(`👑 ADMIN modificando fechaVinculacionARCA a: ${req.body.fechaVinculacionARCA}`);
      } else {
        delete req.body.fechaVinculacionARCA;
      }
    }

    const update = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) update[`settings.${k}`] = req.body[k];
    }

    // Encriptar arcaClave si viene
    if (req.body.arcaClave) update['settings.arcaClave'] = encrypt(req.body.arcaClave);

    // ============================================================
    // 1. DETECTAR INICIO DE VINCULACIÓN ARCA
    // ============================================================
    const teniaCuit = userActual?.settings?.cuit && userActual.settings.cuit !== '';
    const ahoraTieneCuit = req.body.cuit && req.body.cuit !== '';
    const teniaClave = userActual?.settings?.arcaClave && userActual.settings.arcaClave !== '';
    const ahoraTieneClave = req.body.arcaClave && req.body.arcaClave !== '';

    if (!teniaCuit && ahoraTieneCuit && !teniaClave && ahoraTieneClave) {
      const ahora = new Date();
      update['settings.fechaInicioVinculacion'] = ahora;
      update['settings.inicioCortesia'] = ahora;
      const finCortesia = new Date(ahora);
      finCortesia.setDate(finCortesia.getDate() + 30);
      update['settings.finCortesia'] = finCortesia;
      console.log(`🔗 Usuario ${req.userId} inició vinculación ARCA`);
    }

    // ============================================================
    // 2. DETECTAR COMPLETADO DE VINCULACIÓN ARCA
    // ============================================================
    const estabaVinculado = userActual?.settings?.arcaStatus === 'vinculado';
    const yaTieneFecha = !!userActual?.settings?.fechaVinculacionARCA;

    if (yaTieneFecha && req.body.fechaVinculacionARCA) {
      console.log(`🔒 Usuario ${req.userId} - Intento BLOQUEADO: fechaVinculacionARCA ya existe`);
      delete req.body.fechaVinculacionARCA;
    }

    const ahoraVinculado = req.body.arcaStatus === 'vinculado' ||
                           (req.body.fechaVinculacionARCA && !yaTieneFecha);

    if (!estabaVinculado && ahoraVinculado) {
      const ahora = new Date();
      update['settings.arcaStatus'] = 'vinculado';

      if (!yaTieneFecha) {
        update['settings.fechaVinculacionARCA'] = req.body.fechaVinculacionARCA || ahora;
        console.log(`✅ Usuario ${req.userId} completó vinculación ARCA`);
      }

      if (!userActual?.settings?.inicioCortesia) {
        update['settings.inicioCortesia'] = ahora;
        const finCortesia = new Date(ahora);
        finCortesia.setDate(finCortesia.getDate() + 30);
        update['settings.finCortesia'] = finCortesia;
      }
    }

    // ============================================================
    // 3. ACTUALIZAR estadoCicloVida si se envió explícitamente
    // ============================================================
    if (req.body.estadoCicloVida) {
      const estadosValidos = ['cortesia_activa', 'cortesia_extendida', 'suscripto', 'expirado', 'suspendido', 'cancelado'];
      if (estadosValidos.includes(req.body.estadoCicloVida)) {
        update['settings.estadoCicloVida'] = req.body.estadoCicloVida;
        console.log(`🔄 Usuario ${req.userId} cambió estado: ${userActual?.settings?.estadoCicloVida || 'null'} → ${req.body.estadoCicloVida}`);
      }
    }

    // ============================================================
    // 4. RECALCULAR ESTADO AUTOMÁTICAMENTE
    // ============================================================
    if (!req.body.estadoCicloVida) {
      const finCortesia = update['settings.finCortesia'] || userActual?.settings?.finCortesia;
      const finExtension = update['settings.finExtension'] || userActual?.settings?.finExtension;
      const fechaSuscripcion = update['settings.fechaSuscripcion'] || userActual?.settings?.fechaSuscripcion;
      const proximoPago = update['settings.proximoPago'] || userActual?.settings?.proximoPago;
      const hoy = new Date();

      let nuevoEstado = null;

      if (fechaSuscripcion && proximoPago && new Date(proximoPago) > hoy) {
        nuevoEstado = 'suscripto';
      } else if (finExtension && new Date(finExtension) > hoy) {
        nuevoEstado = 'cortesia_extendida';
      } else if (finCortesia && new Date(finCortesia) > hoy) {
        nuevoEstado = 'cortesia_activa';
      } else if (finCortesia && new Date(finCortesia) <= hoy) {
        nuevoEstado = 'expirado';
        if (!userActual?.settings?.fechaExpiracion) {
          update['settings.fechaExpiracion'] = hoy;
        }
      }

      if (nuevoEstado && nuevoEstado !== userActual?.settings?.estadoCicloVida) {
        update['settings.estadoCicloVida'] = nuevoEstado;
        console.log(`🤖 Usuario ${req.userId} estado recalculado: ${nuevoEstado}`);
      }
    }

    // ============================================================
    // 5. ACTUALIZAR EN MONGODB
    // ============================================================
    const user = await User.findByIdAndUpdate(
      req.userId,
      { $set: update },
      { new: true, select: '-password' }
    ).lean();

    const responseData = { ok: true, user };

    if (update['settings.fechaVinculacionARCA']) {
      responseData.fechaVinculacionARCA = update['settings.fechaVinculacionARCA'];
    }
    if (update['settings.estadoCicloVida']) {
      responseData.estadoCicloVida = update['settings.estadoCicloVida'];
    }

    res.json(responseData);

  } catch (error) {
    console.error('Error en PATCH /api/me/settings:', error.message);
    res.status(500).json({ error: 'Error al guardar' });
  }
};

// ============================================================
//  USUARIO - Desconectar ARCA
// ============================================================
const desconectarArca = async (req, res) => {
  try {
    const userId = req.userId;
    console.log(`🔓 Usuario ${userId} solicita desconectar ARCA`);

    await User.findByIdAndUpdate(userId, {
      $set: {
        'settings.arcaStatus': 'pendiente',
        'settings.cuit': '',
        'settings.arcaClave': ''
      }
    });

    console.log(`✅ ARCA desconectada para usuario ${userId}`);
    res.json({ ok: true, message: 'ARCA desconectada correctamente' });
  } catch (error) {
    console.error('❌ Error al desconectar ARCA:', error);
    res.status(500).json({ error: error.message });
  }
};

// ============================================================
//  CONSULTAR ESTADO DE ARCA
// ============================================================
const getArcaStatus = async (req, res) => {
  try {
    const user = await User.findById(req.userId)
      .select('settings.cuit settings.arcaStatus settings.arcaClave settings.fechaVinculacionARCA')
      .lean();

    const tieneCUIT = user?.settings?.cuit && user.settings.cuit.trim() !== '';
    const tieneClave = user?.settings?.arcaClave && user.settings.arcaClave.trim() !== '';
    const status = user?.settings?.arcaStatus || 'pendiente';
    const fechaVinculacion = user?.settings?.fechaVinculacionARCA || null;

    const conectada = (tieneCUIT && tieneClave && status === 'vinculado');

    res.json({
      ok: true,
      conectada,
      tieneCUIT,
      tieneClave,
      status,
      cuit: tieneCUIT ? user.settings.cuit : null,
      fechaVinculacion
    });
  } catch (error) {
    console.error('❌ Error consultando estado ARCA:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = { getMe, updateSettings, desconectarArca, getArcaStatus };