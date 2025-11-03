const dashboardService = require(`../services/dashboard.service`);

exports.getDashboardStats = async (req, res, next) => {
  try {
    // const { role, companies_id } = req.user;
    const stats = await dashboardService.getDashboardStats();

    res.status(200).json({
      success: true,
      stats,
    });
  } catch (error) {
    next(error);
  }
};

exports.getTournaments = async (req, res, next) => {
  try {
    // const { role } = req.user;
    // if (role !== "superadmin") {
    //   return res.status(403).json({ message: "Access denied" });
    // }

    // const limit = req.query.limit ? parseInt(req.query.limit) : 5;
    // const orderBy = req.query.orderBy || "created_at";
    // const orderDir = req.query.orderDir || "DESC";

    const tournaments = await dashboardService
      .getAllTournaments
      // limit,
      // orderBy,
      // orderDir
      ();

    res.status(200).json({
      success: true,
      tournaments,
    });
  } catch (err) {
    next(err);
  }
};

// controller
exports.getSystemHealth = async (req, res, next) => {
  try {
    const data = await dashboardService.getHealthStatus();
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};
