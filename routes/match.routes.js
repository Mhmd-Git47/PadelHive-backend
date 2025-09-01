const express = require("express");
const router = express.Router();

const matchesController = require("../controllers/match.controller");

// router.post("/", matchesController.createMatch);
router.patch("/:id/update", matchesController.updateMatch);
// router.get("/", matchesController.getAllMatchs);
// router.get("/:id", matchesController.getMatchById);

router.post(
  "/generate-group-matches",
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
