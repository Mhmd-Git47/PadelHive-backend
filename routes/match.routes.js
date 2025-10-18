const express = require("express");
const router = express.Router();

const matchesController = require("../controllers/match.controller");

const {
  authenticateToken,
  authorizeRoles,
} = require("../middleware/auth.middleware");

// router.post("/", matchesController.createMatch);
router.patch(
  "/:id/update",
  authenticateToken,
  authorizeRoles("superadmin", "company_admin", "location_admin"),
  matchesController.updateMatch
);
router.patch(
  "/:id/direct",
  authenticateToken,
  authorizeRoles("superadmin", "company_admin", "location_admin"),
  matchesController.updateMatchDirect
);
// router.get("/", matchesController.getAllMatchs);
// router.get("/:id", matchesController.getMatchById);

router.post(
  "/generate-group-matches",
  authenticateToken,
  authorizeRoles("superadmin", "company_admin", "location_admin"),
  matchesController.generateMatchesForGroupStage
);
router.get("/stage/:stageId", matchesController.getMatchByStageId);
router.get("/", matchesController.getMatchesByTournamentId);
router.get("/user/:userId", matchesController.getMatchesByUserId);
router.get("/:id", matchesController.getMatchById);

module.exports = router;

// router.patch("/:id", matchesController.updateMatch);
// router.post("/generate-group-matches", matchesController.generateMatchesForGroupStage);
// router.get("/stage/:stageId", matchesController.getMatchByStageId);
