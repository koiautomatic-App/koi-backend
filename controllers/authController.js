// controllers/authController.js
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');

const SUPPORTED_COUNTRIES = ['AR']; // Solo Argentina por ahora

// ============================================================
// REGISTER (con país)
// ============================================================
const register = async (req, res) => {
  try {
    const { nombre, apellido, email, password, pais } = req.body;
    
    // 👇 VALIDAR PAÍS
    if (!pais) {
      return res.status(400).json({ error: 'Debes seleccionar tu país de residencia' });
    }
    
    if (!SUPPORTED_COUNTRIES.includes(pais)) {
      return res.status(403).json({ 
        error: 'Koi solo está disponible en Argentina por el momento',
        codigo: 'PAIS_NO_SOPORTADO'
      });
    }
    
    if (!nombre || !email || !password) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }
    
    if (password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }
    
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({ error: 'El email ya está registrado' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = await User.create({
      nombre,
      apellido,
      email: email.toLowerCase(),
      password: hashedPassword,
      pais,                    // 👈 AGREGAR
      paisSeleccionado: true,  // 👈 AGREGAR
      paisSeleccionadoEn: new Date() // 👈 AGREGAR
    });
    
    const token = jwt.sign({ id: user._id, email: user.email }, config.JWT_SECRET, { expiresIn: '7d' });
    
    res.cookie('koi_token', token, {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    
    res.json({ ok: true, user: { nombre: user.nombre, email: user.email, pais: user.pais } });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ============================================================
// LOGIN (con país)
// ============================================================
const login = async (req, res) => {
  try {
    const { email, password, pais } = req.body;
    
    // 👇 VALIDAR PAÍS
    if (!pais) {
      return res.status(400).json({ error: 'Debes seleccionar tu país de residencia' });
    }
    
    if (!SUPPORTED_COUNTRIES.includes(pais)) {
      return res.status(403).json({ 
        error: 'Koi solo está disponible en Argentina por el momento',
        codigo: 'PAIS_NO_SOPORTADO'
      });
    }
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }
    
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    
    if (!user || !user.password) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    
    // Actualizar país del usuario
    user.pais = pais;
    user.paisSeleccionado = true;
    user.paisSeleccionadoEn = new Date();
    await user.save();
    
    const token = jwt.sign({ id: user._id, email: user.email }, config.JWT_SECRET, { expiresIn: '7d' });
    
    res.cookie('koi_token', token, {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    
    res.json({ ok: true, user: { nombre: user.nombre, email: user.email, pais: user.pais } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ============================================================
// LOGOUT
// ============================================================
const logout = (req, res) => {
  res.clearCookie('koi_token');
  res.redirect('/login');
};

// ============================================================
// NUEVO: VERIFICAR PAÍS (público)
// ============================================================
const verificarPais = async (req, res) => {
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
        : '❌ Koi solo está disponible en Argentina por el momento'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { register, login, logout, verificarPais };