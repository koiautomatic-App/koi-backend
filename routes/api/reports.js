// routes/api/reports.js
const express = require('express');
const router = express.Router();
const path = require('path');
const ejs = require('ejs');
const Order = require('../../models/Order');
const User = require('../../models/User');
const { Resend } = require('resend');
const config = require('../../config');
const { requireAuthAPI } = require('../../middleware/auth');

// Inicializar Resend
const resend = new Resend(config.RESEND_API_KEY);

// POST /api/reports/send
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
        }).sort({ createdAt: -1 });
        
        console.log('📄 Comprobantes encontrados:', orders.length);
        
        // Calcular totales
        const totalFacturado = orders.reduce((sum, o) => sum + (o.amount || 0), 0);
        const totalComprobantes = orders.length;
        
        // Datos del usuario para el reporte
        const nombreNegocio = user.nombre || user?.settings?.razonSocial || 'Mi Negocio';
        const cuit = user?.settings?.cuit || 'XX-XXXXXXXX-X';
        const categoria = user?.settings?.categoria || 'C';
        const condicionFiscal = user?.settings?.condicionFiscal || 'monotributo';
        const condicionLabel = condicionFiscal === 'monotributo' ? 'Monotributista' : 'Responsable Inscripto';
        
        // Límites por categoría (valores actualizados 2026)
        const limites = {
            'A': 10277988.13, 'B': 15058447.71, 'C': 21113696.52,
            'D': 26212853.42, 'E': 30833964.37, 'F': 38642048.36,
            'G': 46211109.37, 'H': 70113407.33, 'I': 84124088.79,
            'J': 98144777.00, 'K': 112165465.00
        };
        const limiteCategoria = limites[categoria] || 21113696.52;
        const porcentaje = limiteCategoria > 0 ? (totalFacturado / limiteCategoria) * 100 : 0;
        const margen = limiteCategoria - totalFacturado;
        
        // 👇 GENERAR HTML USANDO LA PLANTILLA EJS
        const nombreMes = fechaInicio.toLocaleString('es-AR', { month: 'long', year: 'numeric' });
        const mesCapitalizado = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);
        
        const html = await ejs.renderFile(
            path.join(__dirname, '../../views/reporte.ejs'),
            {
                nombreMes: mesCapitalizado,
                nombreNegocio,
                cuit,
                categoria,
                condicionLabel,
                totalFacturado,
                totalComprobantes,
                orders,
                nota: nota || '',
                contadorNombre: contadorNombre || '',
                limiteCategoria,
                porcentaje,
                margen
            }
        );
        
        // Enviar email con Resend
        const nombreFantasia = user?.settings?.razonSocial || user?.nombre || 'KOI Factura';
        const replyToEmail = user?.email || 'hola@koi-factura.lat';
        
        const { data, error } = await resend.emails.send({
            from: '"KOI-FACTURA" <hola@koi-factura.lat>',
            reply_to: replyToEmail,
            to: contadorEmail,
            subject: `📊 Reporte mensual - ${mesCapitalizado}`,
            html: html
        });
        
        if (error) {
            console.error('❌ Error Resend:', error);
            throw new Error(error.message);
        }
        
        console.log('✅ Email enviado:', data?.id);
        
        res.json({ 
            ok: true, 
            message: 'Reporte enviado correctamente',
            emailId: data?.id 
        });
        
    } catch (error) {
        console.error('❌ Error enviando reporte:', error);
        res.status(500).json({ 
            ok: false,
            error: error.message 
        });
    }
});

module.exports = router;