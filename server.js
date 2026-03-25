const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// --- MIDDLEWARES ---
app.use(express.json());
app.use(cors());

// --- CONEXIÓN A DB ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('🐟 KOI: Motor de base de datos encendido'))
  .catch(err => console.error('❌ Error Mongo:', err));

// --- MODELOS ---
const OrderSchema = new mongoose.Schema({
    platform: String,
    externalId: String,
    customerName: String,
    customerEmail: String,
    customerDoc: String,
    amount: Number,
    status: { type: String, default: 'pending_invoice' },
    errorLog: String,
    createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', OrderSchema);

const StoreSchema = new mongoose.Schema({
    storeUrl: String,
    consumerKey: String,
    consumerSecret: String,
    userId: String,
    platform: { type: String, default: 'woocommerce' }
});
const Store = mongoose.model('Store', StoreSchema);

// --- RUTAS ---

app.get('/', (req, res) => res.send('🚀 KOI-FACTURA: Motor de Inteligencia Activo (Día 4)'));

// 1. WEBHOOK RECEPTOR CON VALIDACIÓN DE DNI/ARCA
app.post('/webhook/woocommerce', async (req, res) => {
    const data = req.body;
    const amount = parseFloat(data.total);
    
    // Extraer y limpiar DNI (solo números)
    let rawDni = data.billing.dni || data.billing.identification || "";
    let cleanDni = rawDni.replace(/\D/g, ""); 

    let status = 'pending_invoice';
    let errorLog = '';

    // LÓGICA DE INTELIGENCIA FISCAL
    const ARCA_LIMIT = 380000; // Límite para Consumidor Final anónimo (ajustable)
    const isDniValid = cleanDni.length >= 7 && cleanDni.length <= 11;

    if (!isDniValid) {
        if (amount < ARCA_LIMIT) {
            cleanDni = "999"; // Código interno KOI para "Anónimo aceptado"
            console.log(`⚠️ Venta menor a $${ARCA_LIMIT}. Facturaremos como Anónimo.`);
        } else {
            status = 'error_data';
            errorLog = `Monto alto ($${amount}) requiere DNI válido. Recibido: "${rawDni}"`;
        }
    }

    try {
        const newOrder = new Order({
            platform: 'woocommerce',
            externalId: data.id.toString(),
            customerName: `${data.billing.first_name} ${data.billing.last_name}`,
            customerEmail: data.billing.email,
            customerDoc: cleanDni,
            amount: amount,
            status: status,
            errorLog: errorLog
        });

        await newOrder.save();
        console.log(`✅ Orden ${data.id} procesada. Status: ${status}`);
        res.status(200).send('OK');
    } catch (error) {
        console.error('❌ Error al guardar orden:', error);
        res.status(500).send('Error');
    }
});

// 2. CONEXIÓN OAUTH (Inicia el flujo)
app.get('/auth/woo/connect', (req, res) => {
    const { store_url } = req.query; 
    if (!store_url) return res.status(400).send("Falta URL");
    const cleanUrl = store_url.replace(/\/$/, "");
    const host = req.get('host');
    const callback_url = `https://${host}/auth/woo/callback?store_url=${cleanUrl}`; 
    
    const auth_url = `${cleanUrl}/wc-auth/v1/authorize?` + 
        `app_name=KOI-Factura&scope=read_write&user_id=sono_user_01&` + 
        `return_url=${cleanUrl}&callback_url=${callback_url}`;

    res.redirect(auth_url);
});

// 3. CALLBACK (Guarda llaves y AUTO-INSTALA WEBHOOK)
app.post('/auth/woo/callback', async (req, res) => {
    const keys = req.body;
    const storeUrl = req.query.store_url;

    try {
        // Guardar tienda con URL correcta
        await Store.findOneAndUpdate(
            { storeUrl: storeUrl }, 
            {
                storeUrl: storeUrl,
                consumerKey: keys.consumer_key,
                consumerSecret: keys.consumer_secret,
                userId: keys.user_id
            }, 
            { upsert: true }
        );

        // INSTALACIÓN AUTOMÁTICA DEL WEBHOOK
        // KOI se conecta a la tienda y se "auto-invita" a escuchar pedidos
        const webhookData = {
            name: 'KOI - Facturación Automática',
            topic: 'order.created',
            delivery_url: `https://${req.get('host')}/webhook/woocommerce`
        };

        await axios.post(`${storeUrl}/wp-json/wc/v3/webhooks`, webhookData, {
            auth: { username: keys.consumer_key, password: keys.consumer_secret }
        });

        console.log(`🔌 Conexión total: Webhook instalado en ${storeUrl}`);
        res.status(200).json({ status: "success" });

    } catch (error) {
        console.error('❌ Error en handshake:', error.response?.data || error.message);
        res.status(500).send('Error en conexión');
    }
});

app.listen(PORT, () => console.log(`🚀 KOI corriendo en puerto ${PORT}`));
