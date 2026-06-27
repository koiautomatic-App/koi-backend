// routes/api/pais.js
const express = require('express');
const router = express.Router();
const { requireAuthAPI } = require('../../middleware/auth');
const User = require('../../models/User');

const SUPPORTED_COUNTRIES = ['AR']; // Solo Argentina por ahora

// ✅ Pública: verificar si un país es soportado
router.get('/verificar', async (req, res) => {
  try {
    const { pais } = req.query;
    if (!pais) {
      return res.status(400).json({ error: 'País requerido' });
    }
    const soportado = SUPPORTED_COUNTRIES.includes(pais.toUpperCase());
    res.json({
      ok: true,
      pais: pais.toUpperCase(),
      soportado,
      mensaje: soportado 
        ? '✅ País disponible' 
        : '❌ Koi solo está disponible en Argentina por el momento',
      paisesSoportados: SUPPORTED_COUNTRIES
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Pública: lista de países soportados
router.get('/soportados', (req, res) => {
  res.json({
    ok: true,
    paises: SUPPORTED_COUNTRIES,
    mensaje: 'Koi solo está disponible en Argentina por el momento'
  });
});

// ✅ Protegida: obtener país del usuario
router.get('/me', requireAuthAPI, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('pais paisSeleccionado');
    res.json({
      ok: true,
      pais: user?.pais || 'AR',
      seleccionado: user?.paisSeleccionado || false,
      soportado: SUPPORTED_COUNTRIES.includes(user?.pais || 'AR')
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Protegida: seleccionar/actualizar país
router.put('/seleccionar', requireAuthAPI, async (req, res) => {
  try {
    const { pais } = req.body;
    if (!pais) {
      return res.status(400).json({ error: 'País requerido' });
    }
    if (!SUPPORTED_COUNTRIES.includes(pais)) {
      return res.status(403).json({ 
        error: 'Koi solo está disponible en Argentina por el momento',
        codigo: 'PAIS_NO_SOPORTADO'
      });
    }
    const user = await User.findByIdAndUpdate(
      req.userId,
      {
        pais,
        paisSeleccionado: true,
        paisSeleccionadoEn: new Date()
      },
      { new: true }
    ).select('pais paisSeleccionado');
    res.json({
      ok: true,
      message: 'País actualizado correctamente',
      pais: user.pais
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;