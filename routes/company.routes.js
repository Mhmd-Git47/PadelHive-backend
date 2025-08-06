const express = require("express");
const router = express.Router();
const companyController = require("../controllers/company.controller");
const {
  authenticateToken,
  authorizeAdmin,
} = require("../middleware/auth.middleware");

router.post(
  "/",
  authenticateToken,
  authorizeAdmin,
  companyController.createCompany
);

router.put(
  "/:id",
  authenticateToken,
  authorizeAdmin,
  companyController.updateCompany
);

// Get company info by ID (only authenticated users)
router.get(
  "/:id",
  authenticateToken,
  authorizeAdmin,
  companyController.getCompanyById
);

module.exports = router;
