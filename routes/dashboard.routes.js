const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboard.controller");
const {
  authenticateToken,
  authorizeRoles,
} = require("../middleware/auth.middleware");

router.get(
  "/stats",
  //   authenticateToken,
  //   authorizeRoles("superadmin"),
  dashboardController.getDashboardStats
);

router.get(
  "/tournaments",
  // authenticateToken,
  // authorizeRoles("superadmin"),
  dashboardController.getTournaments
);

// route
router.get(
  "/system-health",
  authenticateToken,
  authorizeRoles("superadmin"),
  dashboardController.getSystemHealth
);

module.exports = router;
