const express = require("express");
const router = express.Router();
const tournamentController = require("../controllers/tournament.controller");
const multer = require("multer");
const {
  authenticateToken,
  authorizeAdmin,
  authorizeSuperAdmin,
  checkTournamentOwnership, 
} = require("../middleware/auth.middleware");

// Multer storage config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "images/tournaments/");
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  },
});

const upload = multer({ storage });

/**
 * ============================
 * PUBLIC ROUTES (Users / Guests)
 * ============================
 * - Can view tournaments without restrictions
 */
router.get("/", tournamentController.getAllTournaments);
router.get("/:id", tournamentController.getTournamentById);
router.get(
  "/company/:companyId",
  tournamentController.getTournamentsByCompanyId
);

/**
 * ============================
 * ADMIN ROUTES (Require Ownership)
 * ============================
 * - Only admins from the same company as the tournament can create/update/delete
 */
router.post(
  "/admin",
  authenticateToken,
  authorizeAdmin,
  upload.single("image"),
  tournamentController.createTournament
);

router.patch(
  "/admin/:id",
  authenticateToken,
  authorizeAdmin,
  checkTournamentOwnership,
  upload.single("image"),
  tournamentController.updateTournament
);

router.delete(
  "/admin/:id",
  authenticateToken,
  authorizeAdmin,
  checkTournamentOwnership,
  tournamentController.deleteTournament
);

router.get(
  "/admin/:id",
  authenticateToken,
  authorizeAdmin,
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
