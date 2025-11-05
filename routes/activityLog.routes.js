const activityLogController = require(`../controllers/activityLog.controller`);
const express = require("express");
const {
  authenticateToken,
  authorizeSuperAdmin,
  authorizeRoles,
} = require("../middleware/auth.middleware");
const router = express.Router();

router.get(
  "/",
  authenticateToken,
  authorizeSuperAdmin,
  activityLogController.getSuperAdmLog
);

router.get(
  "/:companyId",
  authenticateToken,
  authorizeRoles("company_admin"),
  activityLogController.getCompanyAdmLog
);

router.get(
  "/:tournamentId/tournament",
  authenticateToken,
  authorizeRoles("company_admin", "location_admin"),
  activityLogController.getTournamentLog
);

module.exports = router;
