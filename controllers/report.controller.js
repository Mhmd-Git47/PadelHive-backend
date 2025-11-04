const reportService = require("../services/report.service");

// Create a new report
const createReport = async (req, res) => {
  try {
    const { reporter_id, reported_id, reason } = req.body;

    if (!reporter_id || !reported_id || !reason) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const userRole = req.user?.role;

    const report = await reportService.createReport(
      reporter_id,
      reported_id,
      reason,
      userRole
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

const updateReport = async (req, res) => {
  try {
    const { id } = req.params;
    const updatedData = req.body;
    if (!id) {
      res.status(400).json({ mesasge: "Report Id is required" });
    }

    const updatedReport = await reportService.updateReport(id, updatedData);
    res.json(updatedReport);
  } catch (err) {
    console.error("Error updating report:", error);
    res.json(500).error({
      message: "Failed to update report. Please try again later.",
      error: "Internal Server Error",
    });
  }
};

const deleteReport = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ mesasge: "Report Id is required" });
    }

    const updatedReport = await reportService.deleteReport(id);
    res.json(updatedReport);
  } catch (err) {
    console.error("Error deleting report:", error);
    res.json(500).error({
      message: "Failed to delete report. Please try again later.",
      error: "Internal Server Error",
    });
  }
};

module.exports = {
  createReport,
  getReports,
  getReportsByUserId,
  updateReport,
};
