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
// NUEVO: Esto sirve los archivos de la carpeta 'public' (HTML, CSS, JS)
app.use(express.static('public'));

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

// --- RUTAS DE SISTEMA (BACKEND) ---

// 1. RECEPTOR DE VENTAS (WEBHOOK)
app.post('/webhook/woocommerce', async (req, res) => {
    const data = req.body;
    const amount = parseFloat(data.total);
    let rawDni = data.billing.dni || data.billing.identification || "";
    let cleanDni = rawDni.replace(/\D/g, ""); 
    let status = 'pending_invoice';
    let errorLog = '';

    const ARCA_LIMIT = 380000; 
    const isDniValid = cleanDni.length >= 7 && cleanDni.length <= 11;

    if (!isDniValid) {
        if (amount < ARCA_LIMIT) {
            cleanDni = "999"; 
        } else {
            status = 'error_data';
            errorLog = `Monto alto ($${amount}) requiere DNI. Recibido: "${rawDni}"`;
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
        console.log(`✅ Orden ${data.id} guardada con DNI: ${cleanDni}`);
        res.status(200).send('OK');
    } catch (error) {
        res.status(500).send('Error');
    }
});

// 2. CONEXIÓN OAUTH
app.get('/auth/woo/connect', (req, res) => {
    const { store_url } = req.query; 
    if (!store_url) return res.status(400).send("Falta URL");
    const cleanUrl = store_url.replace(/\/$/, "");
    const host = req.get('host');
    const callback_url = `https://${host}/auth/woo/callback?store_url=${cleanUrl}`; 
    const auth_url = `${cleanUrl}/wc-auth/v1/authorize?app_name=KOI-Factura&scope=read_write&user_id=sono_user_01&return_url=${cleanUrl}&callback_url=${callback_url}`;
    res.redirect(auth_url);
});

app.post('/auth/woo/callback', async (req, res) => {
    const keys = req.body;
    const storeUrl = req.query.store_url;
    res.status(200).json({ status: "success" });
    try {
        await Store.findOneAndUpdate(
            { storeUrl: storeUrl }, 
            { storeUrl, consumerKey: keys.consumer_key, consumerSecret: keys.consumer_secret, userId: keys.user_id }, 
            { upsert: true }
        );
        const webhookUrl = `https://${req.get('host')}/webhook/woocommerce`;
        await axios.post(`${storeUrl}/wp-json/wc/v3/webhooks`, {
            name: 'KOI - Facturación Automática',
            topic: 'order.created',
            delivery_url: webhookUrl,
            status: 'active'
        }, {
            auth: { username: keys.consumer_key, password: keys.consumer_secret }
        });
        console.log(`🔌 Webhook OK en ${storeUrl}`);
    } catch (error) {
        console.error('❌ Error post-conexión:', error.message);
    }
});

// --- NUEVAS RUTAS PARA EL DASHBOARD (DÍA 5) ---

// A. Obtener las últimas ventas
app.get('/api/orders', async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 }).limit(10);
        res.json(orders);
    } catch (err) {
        res.status(500).json({ error: "Error al cargar órdenes" });
    }
});

// B. Obtener las tiendas conectadas
app.get('/api/stores', async (req, res) => {
    try {
        const stores = await Store.find();
        res.json(stores);
    } catch (err) {
        res.status(500).json({ error: "Error al cargar tiendas" });
    }
});

app.listen(PORT, () => console.log(`🚀 KOI corriendo en puerto ${PORT}`));
