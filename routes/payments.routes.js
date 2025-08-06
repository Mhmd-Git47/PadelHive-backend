const express = require("express");

const router = express.Router();

const paymentController = require("../controllers/payments.controller");

router.get("/t/:tournamentId", paymentController.getPaymentsByTournamentId);
router.put("/:id", paymentController.updatePayment);

module.exports = router;
