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

module.exports = router;
