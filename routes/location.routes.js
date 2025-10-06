const express = require("express");
const router = express.Router();
const locationController = require("../controllers/location.controller");
const {
  authenticateToken,
  authorizeSuperAdmin,
  authorizeRoles,
} = require("../middleware/auth.middleware");

// Create location — superadmin only
router.post(
  "/",
  authenticateToken,
  authorizeSuperAdmin,
  locationController.createLocation
);

// Get all locations
router.get(
  "/",
  authenticateToken,
  authorizeRoles("superadmin", "company_admin"),
  locationController.getLocations
);

router.get("/cities", locationController.fetchAllCities);

// Get single location by ID
router.get("/:id", locationController.getLocationById);

// Update location — company admin or location admin for their own location
router.patch(
  "/:id",
  authenticateToken,
  authorizeRoles("superadmin", "company_admin"),
  locationController.updateLocation
);

// Delete location — company admin or superadmin only
router.delete("/:id", locationController.deleteLocation);

module.exports = router;
