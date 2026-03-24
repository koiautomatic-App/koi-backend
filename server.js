const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// --- CONFIGURACIÓN DE MIDDLEWARES ---
app.use(express.json());
app.use(cors());

// --- CONEXIÓN A BASE DE DATOS ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('🐟 KOI: Conexión exitosa con MongoDB Atlas'))
  .catch(err => console.error('❌ Error de conexión:', err));

// --- MODELO DE DATOS (ESQUEMA DE ORDEN) ---
// Aquí definimos qué datos de la venta queremos recordar para siempre
const OrderSchema = new mongoose.Schema({
    platform: { type: String, required: true }, // tiendanube, mercadolibre, etc.
    externalId: { type: String, required: true },
    customerName: String,
    customerEmail: String,
    amount: Number,
    status: { type: String, default: 'pending_invoice' }, // Estado: pendiente de factura
    createdAt: { type: Date, default: Date.now }
});

const Order = mongoose.model('Order', OrderSchema);

// --- RUTAS ---

// 1. Ruta de Bienvenida
app.get('/', (req, res) => {
    res.send('🚀 KOI-FACTURA: Servidor Activo y Escuchando');
});

// 2. WEBHOOK UNIVERSAL (El "Oído" de KOI)
app.post('/webhook/:platform', async (req, res) => {
    const { platform } = req.params;
    const data = req.body;

    console.log(`📩 Nueva notificación desde: ${platform.toUpperCase()}`);

    try {
        // Mapeamos los datos que llegan (Adaptador inicial)
        // Nota: Ajustaremos estos nombres según cada plataforma en el Día 3
        const newOrder = new Order({
            platform: platform,
            externalId: data.id || 'sin_id',
            customerName: data.cliente || 'Consumidor Final',
            customerEmail: data.email || '',
            amount: data.monto || 0
        });

        // Guardamos en la base de datos
        await newOrder.save();
        
        console.log(`✅ Orden ${newOrder.externalId} guardada exitosamente.`);
        
        // Respondemos 200 para que la tienda sepa que recibimos el paquete
        res.status(200).send({
            message: 'Recibido y Guardado por KOI',
            orderId: newOrder._id
        });

    } catch (error) {
        console.error('❌ Error al procesar el webhook:', error);
        res.status(500).send('Error interno en KOI');
    }
});

// --- INICIO DEL SERVIDOR ---
app.listen(PORT, () => {
    console.log(`🚀 KOI corriendo en puerto ${PORT}`);
});
