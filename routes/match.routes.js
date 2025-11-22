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
router.patch(
  "/:matchId/participants",
  authenticateToken,
  authorizeRoles("company_admin", "location_admin"),
  matchesController.updateMatchParticipants
);
router.patch(
  "/:matchId/reset",
  authenticateToken,
  authorizeRoles("company_admin", "location_admin"),
  matchesController.resetMatchScores
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

// delete matches
router.delete(
  "/:tournamentId",
  authenticateToken,
  authorizeRoles("company_admin", "location_admin"),
  matchesController.deleteTournamentMatches
);

module.exports = router;

// router.patch("/:id", matchesController.updateMatch);
// router.post("/generate-group-matches", matchesController.generateMatchesForGroupStage);
// router.get("/stage/:stageId", matchesController.getMatchByStageId);
