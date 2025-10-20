const express = require("express");
const router = express.Router();
const participantController = require("../controllers/participants.controller");
const { authenticateToken } = require("../middleware/auth.middleware");

router.post("/", participantController.createParticipant);
router.patch("/:id", participantController.updateParticipant);
router.patch("/:id/disqualify", participantController.disqualifyParticipant);
router.get("/", participantController.getAllParticipants);

// ✅ MOVE THIS ABOVE `/:id`
router.get("/tournament", participantController.getParticipantsByTournamentId);

// ✅ KEEP THIS LAST
router.delete(
  "/:id",
  authenticateToken,
  participantController.deleteParticipant
);
router.get("/:id", participantController.getParticipantById);

router.post("/check-name", participantController.checkParticipantName);

module.exports = router;

// router.post("/", participantController.createParticipant);
// router.patch("/:id", participantController.updateParticipant);
// router.get("/", participantController.getAllParticipants);
// router.get("/tournament/:tournamentId", participantController.getParticipantsByTournamentId); // clearer
// router.get("/:id", participantController.getParticipantById);
