const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware para entender JSON (Vital para Webhooks)
app.use(express.json());
app.use(cors());

// Conexión a MongoDB Atlas
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('🐟 KOI: Conexión exitosa con MongoDB Atlas'))
  .catch(err => console.error('❌ Error de conexión:', err));

// --- RUTA DEL WEBHOOK (EL CORAZÓN DE HOY) ---
app.post('/webhook/:platform', (req, res) => {
    const { platform } = req.params;
    const data = req.body;

    console.log(`📩 ¡Venta recibida desde ${platform.toUpperCase()}!`);
    
    // Aquí es donde vive la lógica que tenías en Validaciones.gs
    // Por ahora, solo vamos a "espiar" qué nos mandan
    console.log('Datos de la orden:', JSON.stringify(data, null, 2));

    // Siempre respondemos 200 a la tienda para que no reintente el envío
    res.status(200).send('OK - Recibido por KOI');
});

app.get('/', (req, res) => {
    res.send('🚀 KOI-FACTURA Server is Running');
});

app.listen(PORT, () => {
    console.log(`🚀 KOI en puerto ${PORT}`);
});
