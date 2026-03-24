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

// --- MODELOS DE DATOS ---

// 1. Modelo de Ventas (Orders)
const OrderSchema = new mongoose.Schema({
    platform: { type: String, required: true },
    externalId: { type: String, required: true },
    customerName: String,
    customerEmail: String,
    amount: Number,
    status: { type: String, default: 'pending_invoice' },
    createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', OrderSchema);

// 2. Modelo de Tiendas (Para guardar las llaves de los clientes)
const StoreSchema = new mongoose.Schema({
    storeUrl: String,
    consumerKey: String,
    consumerSecret: String,
    userId: String,
    platform: { type: String, default: 'woocommerce' },
    createdAt: { type: Date, default: Date.now }
});
const Store = mongoose.model('Store', StoreSchema);

// --- RUTAS DE WEBHOOKS ---

app.get('/', (req, res) => {
    res.send('🚀 KOI-FACTURA: Servidor Activo y Escuchando');
});

app.post('/webhook/:platform', async (req, res) => {
    const { platform } = req.params;
    const data = req.body;
    console.log(`📩 Nueva notificación desde: ${platform.toUpperCase()}`);

    try {
        const newOrder = new Order({
            platform: platform,
            externalId: data.id || 'sin_id',
            customerName: data.cliente || 'Consumidor Final',
            customerEmail: data.email || '',
            amount: data.monto || 0
        });
        await newOrder.save();
        console.log(`✅ Orden ${newOrder.externalId} guardada.`);
        res.status(200).send({ message: 'Guardado', orderId: newOrder._id });
    } catch (error) {
        console.error('❌ Error webhook:', error);
        res.status(500).send('Error interno');
    }
});

// --- RUTAS DE AUTORIZACIÓN AUTOMÁTICA (WCOAUTH) ---

// 1. Iniciar la conexión (Forzando HTTPS para evitar el error de SSL de Woo)
app.get('/auth/woo/connect', (req, res) => {
    const { store_url } = req.query; 
    if (!store_url) return res.status(400).send("Falta la URL de la tienda");

    // Limpiamos la URL de la tienda por si viene con / al final
    const cleanStoreUrl = store_url.replace(/\/$/, "");
    
    // FORZAMOS HTTPS para el callback: WooCommerce lo exige
    const host = req.get('host');
    const callback_url = `https://${host}/auth/woo/callback`; 
    
    const auth_url = `${cleanStoreUrl}/wc-auth/v1/authorize?` + 
        `app_name=KOI-Factura&` +
        `scope=read_write&` +
        `user_id=sono_user_01&` + 
        `return_url=https://sonohandmade.com&` + 
        `callback_url=${callback_url}`;

    console.log(`🔗 Redirigiendo con SSL forzado a: ${callback_url}`);
    res.redirect(auth_url);
});

// 2. El Callback (Donde WooCommerce nos entrega las llaves "por atrás")
app.post('/auth/woo/callback', async (req, res) => {
    const keys = req.body; 
    console.log("🔑 Recibidas llaves automáticas para:", keys.user_id);

    try {
        // Buscamos si ya existe la tienda para actualizarla o crearla
        const storeData = {
            storeUrl: req.query.store_url || 'N/A',
            consumerKey: keys.consumer_key,
            consumerSecret: keys.consumer_secret,
            userId: keys.user_id
        };

        const newStore = new Store(storeData);
        await newStore.save();
        
        console.log(`✅ Tienda ${keys.user_id} conectada y llaves guardadas en Atlas.`);
        res.status(200).json({ status: "success" });
    } catch (error) {
        console.error('❌ Error guardando llaves:', error);
        res.status(500).send('Error al conectar');
    }
});

// --- INICIO DEL SERVIDOR (SIEMPRE AL FINAL) ---
app.listen(PORT, () => {
    console.log(`🚀 KOI corriendo en puerto ${PORT}`);
});
