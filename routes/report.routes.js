const express = require("express");
const router = express.Router();
const reportController = require("../controllers/report.controller");
const {
  authenticateToken,
  authorizeRoles,
} = require("../middleware/auth.middleware");

// Create report
router.post(
  "/",
  authenticateToken,
  authorizeRoles("superadmin", "company_admin", "location_admin"),
  reportController.createReport
);

// Get all reports
router.get(
  "/",
  authenticateToken,
  authorizeRoles("superadmin"),
  reportController.getReports
);

// Get reports by userId (either reporter or reported)
router.get(
  "/user/:userId",
  authenticateToken,
  authorizeRoles("superadmin"),
  reportController.getReportsByUserId
);

// Update report
router.patch(
  "/:id/update",
  authenticateToken,
  authorizeRoles("superadmin"),
  reportController.updateReport
);

module.exports = router;
