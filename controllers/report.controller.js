const reportService = require("../services/report.service");

// Create a new report
const createReport = async (req, res) => {
  try {
    const { reporter_id, reported_id, reason } = req.body;

    if (!reporter_id || !reported_id || !reason) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const report = await reportService.createReport(
      reporter_id,
      reported_id,
      reason
    );
    res.status(201).json(report);
  } catch (error) {
    console.error("Error creating report:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Get all reports
const getReports = async (req, res) => {
  try {
    const reports = await reportService.getReports();
    res.json(reports);
  } catch (error) {
    console.error("Error fetching reports:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Get reports by user (either reporter or reported)
const getReportsByUserId = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const reports = await reportService.getReportsByUserId(userId);
    res.json(reports);
  } catch (error) {
    console.error("Error fetching reports by user ID:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = {
  createReport,
  getReports,
  getReportsByUserId,
};
