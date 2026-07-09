// routes/api/reports.js
const express = require('express');
const router = express.Router();
const Order = require('../../models/Order');  // 👈 CORREGIDO
const User = require('../../models/User');    // 👈 CORREGIDO
const nodemailer = require('nodemailer');
const { requireAuthAPI } = require('../../middleware/auth'); // 👈 Esta ruta está bien

// POST /api/reports/send - CON AUTENTICACIÓN
router.post('/send', requireAuthAPI, async (req, res) => {
    try {
        const { contadorEmail, contadorNombre, nota, mes, anio } = req.body;
        const userId = req.userId;
        
        console.log('📤 Enviando reporte a:', contadorEmail);
        console.log('📊 Mes:', mes, 'Año:', anio);
        console.log('📝 Nota:', nota);
        
        if (!contadorEmail) {
            return res.status(400).json({ error: 'Email del contador requerido' });
        }
        
        // Obtener usuario
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Obtener comprobantes del mes
        const fechaInicio = new Date(anio, mes, 1);
        const fechaFin = new Date(anio, mes + 1, 0);
        
        console.log('📅 Fechas:', fechaInicio, 'a', fechaFin);
        
        const orders = await Order.find({
            userId: userId,
            status: 'invoiced',
            createdAt: { $gte: fechaInicio, $lte: fechaFin }
        });
        
        console.log('📄 Comprobantes encontrados:', orders.length);
        
        const totalFacturado = orders.reduce((sum, o) => sum + (o.amount || 0), 0);
        const totalComprobantes = orders.length;
        
        // Generar HTML del reporte
        const nombreMes = fechaInicio.toLocaleString('es-AR', { month: 'long', year: 'numeric' });
        const html = generarHTMLReporte({
            user,
            orders,
            totalFacturado,
            totalComprobantes,
            nombreMes,
            nota,
            contadorNombre
        });
        
        // Configurar transporter
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: process.env.SMTP_PORT || 587,
            secure: false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
        
        // Enviar email
        const info = await transporter.sendMail({
            from: `"${user.nombre || 'KOI Factura'}" <${process.env.SMTP_USER}>`,
            to: contadorEmail,
            subject: `📊 Reporte mensual - ${nombreMes}`,
            html: html
        });
        
        console.log('✅ Email enviado:', info.messageId);
        
        res.json({ 
            ok: true, 
            message: 'Reporte enviado correctamente',
            emailId: info.messageId 
        });
        
    } catch (error) {
        console.error('❌ Error enviando reporte:', error);
        res.status(500).json({ 
            ok: false,
            error: error.message 
        });
    }
});

function generarHTMLReporte(data) {
    // ... (el resto del código igual)
}

module.exports = router;