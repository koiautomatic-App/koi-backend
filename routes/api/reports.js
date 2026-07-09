// routes/api/reports.js
const express = require('express');
const router = express.Router();
const Order = require('../../models/Order');
const User = require('../../models/User');
const { requireAuthAPI } = require('../../middleware/auth');
const { Resend } = require('resend');
const config = require('../../config');

// Inicializar Resend con tu API key
const resend = new Resend(config.RESEND_API_KEY);

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
        
        // 👇 USAR RESEND (tu sistema existente)
        const nombreFantasia = user?.settings?.razonSocial || user?.nombre || 'KOI Factura';
        const replyToEmail = user?.email || 'hola@koi-factura.lat';
        
        const { data, error } = await resend.emails.send({
            from: '"KOI-FACTURA" <hola@koi-factura.lat>',
            reply_to: replyToEmail,
            to: contadorEmail,
            subject: `📊 Reporte mensual - ${nombreMes}`,
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

function generarHTMLReporte(data) {
    const { user, orders, totalFacturado, totalComprobantes, nombreMes, nota, contadorNombre } = data;
    
    // Generar filas de la tabla
    let filasTabla = '';
    if (orders.length > 0) {
        orders.forEach((o, i) => {
            const nroComp = o.nroFormatted || o.externalId || '—';
            const cliente = o.customerName || 'Sin nombre';
            const fecha = o.createdAt ? new Date(o.createdAt).toLocaleDateString('es-AR') : '—';
            const monto = (o.amount || 0).toLocaleString('es-AR');
            const colorFila = i % 2 === 0 ? '#f9fafb' : '#ffffff';
            filasTabla += `
                <tr style="background-color: ${colorFila};">
                    <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${nroComp}</td>
                    <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${cliente}</td>
                    <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${fecha}</td>
                    <td style="padding: 8px 12px; border: 1px solid #e5e7eb; text-align: right; font-weight: 600;">$${monto}</td>
                </tr>
            `;
        });
    } else {
        filasTabla = `
            <tr>
                <td colspan="4" style="padding: 20px; text-align: center; color: #6b7280;">
                    No hay comprobantes emitidos en este período
                </td>
            </tr>
        `;
    }
    
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 800px; margin: 0 auto; padding: 20px; background: #f3f4f6; }
                .container { background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                .header { background: linear-gradient(135deg, #1a1a2e, #16213e); color: white; padding: 30px 40px; }
                .header h1 { margin: 0; font-size: 28px; font-weight: 700; }
                .header p { margin: 8px 0 0; opacity: 0.8; font-size: 16px; }
                .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; padding: 24px 40px; background: #f9fafb; border-bottom: 1px solid #e5e7eb; }
                .stat-card { background: white; padding: 16px 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: center; }
                .stat-card .number { font-size: 28px; font-weight: 700; color: #059669; }
                .stat-card .label { font-size: 14px; color: #6b7280; margin-top: 4px; }
                .content { padding: 24px 40px; }
                .nota { background: #fffbeb; border: 1px solid #fcd34d; padding: 16px 20px; border-radius: 8px; margin-bottom: 24px; }
                .nota strong { color: #92400e; }
                .table-wrapper { overflow-x: auto; margin: 16px 0; border: 1px solid #e5e7eb; border-radius: 8px; }
                table { width: 100%; border-collapse: collapse; font-size: 14px; }
                th { background: #f3f4f6; padding: 12px 16px; text-align: left; border: 1px solid #e5e7eb; font-weight: 600; color: #374151; }
                td { padding: 10px 16px; border: 1px solid #e5e7eb; }
                .footer { padding: 20px 40px; background: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center; color: #6b7280; font-size: 14px; }
                .footer strong { color: #1a1a2e; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>📊 Reporte Mensual</h1>
                    <p><strong>${nombreMes}</strong> · ${user.nombre || 'Mi Negocio'}</p>
                </div>
                
                <div class="stats">
                    <div class="stat-card">
                        <div class="number">$${totalFacturado.toLocaleString('es-AR')}</div>
                        <div class="label">Total Facturado</div>
                    </div>
                    <div class="stat-card">
                        <div class="number">${totalComprobantes}</div>
                        <div class="label">Comprobantes Emitidos</div>
                    </div>
                    <div class="stat-card">
                        <div class="number">${user.settings?.categoria || 'C'}</div>
                        <div class="label">Categoría</div>
                    </div>
                </div>
                
                <div class="content">
                    ${nota ? `
                        <div class="nota">
                            <strong>📝 Nota:</strong><br>
                            ${nota}
                        </div>
                    ` : ''}
                    
                    <h3 style="margin: 0 0 12px 0;">📄 Detalle de Comprobantes</h3>
                    <div class="table-wrapper">
                        <table>
                            <thead>
                                <tr>
                                    <th>N° Comprobante</th>
                                    <th>Cliente</th>
                                    <th>Fecha</th>
                                    <th style="text-align: right;">Monto</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${filasTabla}
                            </tbody>
                        </table>
                    </div>
                </div>
                
                <div class="footer">
                    <p>Este reporte fue generado automáticamente por <strong>KOI Factura</strong></p>
                    ${contadorNombre ? `<p style="font-size: 13px; margin-top: 4px;">Enviado por: ${contadorNombre}</p>` : ''}
                </div>
            </div>
        </body>
        </html>
    `;
}

module.exports = router;