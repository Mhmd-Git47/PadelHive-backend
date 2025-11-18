const express = require("express");
const router = express.Router();
const stageController = require("../controllers/stage.controller");

const {
  authenticateToken,
  authorizeRoles,
} = require("../middleware/auth.middleware");

router.get(
  "/tournament/:tournamentId",
  stageController.getStagesByTournamentId
);

router.get(
  "/participants/:stageId",
  stageController.getStageParticipantsByStageId
);

router.post(
  "/generate-placeholders",
  stageController.generateFinalStagePlaceholders
);
router.post(
  "/:tournamentId/knockout-bracket",
  stageController.saveKnockoutBracket
);

router.post(
  "/:tournamentId/stages/:stageId/custom-bracket",
  authenticateToken,
  authorizeRoles("company_admin", "location_admin"),
  stageController.generateCustomizationBracket
);

router.put("/stage-participant", stageController.updateStageParticipant);

router.delete(
  "/:tournamentId/final-stage/participants",
  authenticateToken,
  authorizeRoles("company_admin", "location_admin"),
  stageController.removeFinalStageParticipants
);

module.exports = router;

// router.get("/tournament/:tournamentId", stageController.getStagesByTournamentId);
// router.get("/:stageId/participants", stageController.getStageParticipantsByStageId);
// router.post("/:stageId/generate-placeholders", stageController.generateFinalStagePlaceholders);
// router.put("/stage-participant", stageController.updateStageParticipant); // consider moving to /participants/update
