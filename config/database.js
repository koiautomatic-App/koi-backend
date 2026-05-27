// config/database.js
const mongoose = require("mongoose");
const config = require("./index");

const connectDB = async () => {
  try {
    await mongoose.connect(config.MONGO_URI, { 
      maxPoolSize: 10, 
      serverSelectionTimeoutMS: 5000 
    });
    console.log("🐟 KOI: MongoDB conectado");
  } catch (err) {
    console.error("❌ MongoDB:", err.message);
    setTimeout(connectDB, 5000);  // 👈 Reintentar después de 5 segundos
  }
};

module.exports = connectDB;  // 👈 Exportar la función directamente, no como objeto