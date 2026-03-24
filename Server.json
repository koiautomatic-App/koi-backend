const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// 🔐 Middlewares
app.use(express.json());
app.use(cors());

// 🔌 Conexión a MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("🐟 KOI: Conexión exitosa con MongoDB Atlas"))
.catch(err => {
  console.error("❌ Error de conexión:", err);
  process.exit(1);
});

// 🧾 Esquema de venta
const SaleSchema = new mongoose.Schema({
  userId: { type: String, default: 'sono-handmade' },
  cliente: { type: String, required: true },
  monto: { type: Number, required: true },
  fechaOriginal: { type: Date },
  origen: String,
  estadoCAE: { type: String, default: 'pendiente' },
  cae: String,
  payloadAFIP: Object,
  createdAt: { type: Date, default: Date.now }
});

const Sale = mongoose.model('Sale', SaleSchema);

// 📅 Helper para formato AFIP
const formatDateAFIP = (date) => {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
};

// 🧠 Lógica de los 5 días
const prepararPayloadAFIP = (venta) => {
  const hoy = new Date();
  const fechaVenta = venta.fechaOriginal
    ? new Date(venta.fechaOriginal)
    : new Date();

  if (isNaN(fechaVenta)) {
    throw new Error("Fecha inválida");
  }

  const diffTime = hoy.getTime() - fechaVenta.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  const fechaComprobante = diffDays > 5 ? hoy : fechaVenta;

  return {
    concepto: 2,
    fechaComprobante: formatDateAFIP(fechaComprobante),
    fechaServicioDesde: formatDateAFIP(fechaVenta),
    fechaServicioHasta: formatDateAFIP(fechaVenta),
    monto: venta.monto,
    cliente: venta.cliente
  };
};

// 🏠 Ruta base
app.get('/', (req, res) => {
  res.send('🚀 KOI Server Online - Listo para facturar.');
});

// 📥 Webhook de venta
app.post('/api/webhook/venta', async (req, res) => {
  try {
    const { cliente, monto, fechaOriginal, origen } = req.body;

    // ✅ Validación básica
    if (!cliente || typeof monto !== 'number') {
      return res.status(400).json({
        ok: false,
        error: "Datos inválidos: cliente y monto son obligatorios"
      });
    }

    // 🧾 Crear venta
    const nuevaVenta = new Sale({
      cliente,
      monto,
      fechaOriginal,
      origen
    });

    // 🧠 Generar payload AFIP
    const payloadAFIP = prepararPayloadAFIP(nuevaVenta);

    // 💾 Guardar payload en DB
    nuevaVenta.payloadAFIP = payloadAFIP;

    await nuevaVenta.save();

    res.status(201).json({
      ok: true,
      mensaje: "Venta guardada y procesada",
      dataProcesada: payloadAFIP
    });

  } catch (error) {
    console.error("❌ Error en webhook:", error);

    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// 🚀 Arranque del servidor
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 KOI en puerto ${PORT}`);
});