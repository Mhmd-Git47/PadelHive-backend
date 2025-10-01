const express = require("express");

const router = express.Router();

const paymentController = require("../controllers/payments.controller");
const { authenticateToken } = require("../middleware/auth.middleware");

router.get(
  "/t/:tournamentId",
  authenticateToken,
  paymentController.getPaymentsByTournamentId
);
router.get(
  "/:userId/:tournamentId",
  paymentController.getTournamentPaymentsByUserId
);
router.put("/:id", paymentController.updatePayment);

module.exports = router;
