const express = require("express");
const router = express.Router();
const reportController = require("../controllers/report.controller");

// Create report
router.post("/", reportController.createReport);

// Get all reports
router.get("/", reportController.getReports);

// Get reports by userId (either reporter or reported)
router.get("/user/:userId", reportController.getReportsByUserId);

// Update report
router.patch("/:id/update", reportController.updateReport);

module.exports = router;
