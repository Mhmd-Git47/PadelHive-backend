const express = require("express");
const router = express.Router();
const companyController = require("../controllers/company.controller");
const {
  authenticateToken,
  authorizeAdmin,
  authorizeRoles,
  authorizeSuperAdmin,
} = require("../middleware/auth.middleware");

router.post(
  "/",
  authenticateToken,
  authorizeSuperAdmin,
  companyController.createCompany
);

router.put(
  "/:id",
  authenticateToken,
  authorizeRoles("company_admin"),
  companyController.updateCompany
);

// Get company info by ID (only authenticated users)
router.get(
  "/:id",
  authenticateToken,
  authorizeRoles("company_admin", "location_admin", "superadmin"),
  companyController.getCompanyById
);

router.get("/:id/public", companyController.getPublicCompanyInfo);

module.exports = router;
