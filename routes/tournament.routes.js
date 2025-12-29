const express = require("express");
const router = express.Router();
const tournamentController = require("../controllers/tournament.controller");
const multer = require("multer");
const {
  authenticateToken,
  authorizeRoles,
  authorizeSuperAdmin,
  checkTournamentOwnership,
} = require("../middleware/auth.middleware");

// Multer storage config

const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed!"), false);
  }
};

const upload = multer({ storage, fileFilter });
/**
 * ============================
 * PUBLIC ROUTES (Users / Guests)
 * ============================
 * - Can view tournaments without restrictions
 */
router.get("/", tournamentController.getAllTournaments);
router.get("/public", tournamentController.getPublicTournaments);

// user tournaments history
router.get("/user/:userId", tournamentController.getTournamentsByUserId);
router.get(
  "/:tournamentId/users/:userId/registered",
  tournamentController.checkUserRegisteredToTournament
);

router.get("/:id", tournamentController.getTournamentById);
/**
 * ============================
 * ADMIN ROUTES (Require Ownership)
 * ============================
 * - Only admins from the same company as the tournament can create/update/delete
 */

router.get(
  "/:id/featured-sponsor",
  authenticateToken,
  authorizeRoles("company_admin", "location_admin"),
  tournamentController.getFeaturedSponsorByTournamentId
);

router.get(
  "/company/:companyId",
  authenticateToken,
  authorizeRoles("company_admin"),
  tournamentController.getTournamentsByCompanyId
);

router.get(
  "/location/:locationId",
  authenticateToken,
  authorizeRoles("location_admin"),
  tournamentController.getTournamentsByLocationId
);

router.post(
  "/admin",
  authenticateToken,
  authorizeRoles("company_admin", "location_admin"),
  upload.single("image"),
  tournamentController.createTournament
);

router.patch(
  "/admin/:id",
  authenticateToken,
  authorizeRoles("company_admin", "location_admin"),
  checkTournamentOwnership,
  upload.single("image"),
  tournamentController.updateTournament
);

router.delete(
  "/admin/:id",
  authenticateToken,
  authorizeRoles("company_admin", "location_admin"),
  checkTournamentOwnership,
  tournamentController.deleteTournament
);

router.get(
  "/admin/:id",
  authenticateToken,
  authorizeRoles("company_admin", "location_admin"),
  checkTournamentOwnership,
  tournamentController.getTournamentById
);

/**
 * ============================
 * SUPERADMIN ROUTES
 * ============================
 * - Can manage all tournaments regardless of ownership
 */
router.delete(
  "/superadmin/:id",
  authenticateToken,
  authorizeSuperAdmin,
  tournamentController.deleteTournament
);

module.exports = router;
