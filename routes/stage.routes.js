const express = require("express");
const router = express.Router();
const stageController = require("../controllers/stage.controller");

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

router.put("/stage-participant", stageController.updateStageParticipant);

module.exports = router;


// router.get("/tournament/:tournamentId", stageController.getStagesByTournamentId);
// router.get("/:stageId/participants", stageController.getStageParticipantsByStageId);
// router.post("/:stageId/generate-placeholders", stageController.generateFinalStagePlaceholders);
// router.put("/stage-participant", stageController.updateStageParticipant); // consider moving to /participants/update
