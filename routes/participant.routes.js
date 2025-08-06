const express = require("express");
const router = express.Router();
const participantController = require("../controllers/participants.controller");

router.post("/", participantController.createParticipant);
router.patch("/:id", participantController.updateParticipant);
router.get("/", participantController.getAllParticipants);

// ✅ MOVE THIS ABOVE `/:id`
router.get("/tournament", participantController.getParticipantsByTournamentId);

// ✅ KEEP THIS LAST
router.delete("/:id", participantController.deleteParticipant);
router.get("/:id", participantController.getParticipantById);

module.exports = router;

// router.post("/", participantController.createParticipant);
// router.patch("/:id", participantController.updateParticipant);
// router.get("/", participantController.getAllParticipants);
// router.get("/tournament/:tournamentId", participantController.getParticipantsByTournamentId); // clearer
// router.get("/:id", participantController.getParticipantById);
