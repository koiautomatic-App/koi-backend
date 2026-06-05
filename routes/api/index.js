const express = require("express");
const router = express.Router();

const meRoutes = require("./me");
const ordersRoutes = require("./orders");
const integrationsRoutes = require("./integrations");
const statsRoutes = require("./stats");
const adminRoutes = require("./admin");
const suscripcionRoutes = require("./suscripcion");
const debugRoutes = require("./debug");
const invoicesRoutes = require("./invoices");

router.use("/me", meRoutes);
router.use("/orders", ordersRoutes);
router.use("/integrations", integrationsRoutes);
router.use("/stats", statsRoutes);
router.use("/admin", adminRoutes);
router.use("/suscripcion", suscripcionRoutes);
router.use("/debug", debugRoutes);
router.use("/invoices", invoicesRoutes);

module.exports = router;
