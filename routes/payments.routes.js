const express = require("express");

const router = express.Router();

const paymentController = require("../controllers/payments.controller");
const {
  authenticateToken,
  authorizeRoles,
} = require("../middleware/auth.middleware");

router.get(
  "/t/:tournamentId",
  authenticateToken,
  authorizeRoles("company_admin", "location_admin"),
  paymentController.getPaymentsByTournamentId
);
router.get(
  "/company/:companyId",
  authenticateToken,
  authorizeRoles("company_admin"),
  paymentController.getPaymentsByCompanyId
);
router.get(
  "/:userId/:tournamentId",
  authenticateToken,
  paymentController.getTournamentPaymentsByUserId
);
router.patch(
  "/:id/pay",
  authenticateToken,
  authorizeRoles("company_admin", "location_admin"),
  paymentController.markPaymentAsPaid
);
router.put(
  "/:id",
  authenticateToken,
  authorizeRoles("company_admin", "location_admin"),
  paymentController.updatePayment
);

module.exports = router;
