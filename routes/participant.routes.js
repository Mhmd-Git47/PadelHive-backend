const express = require("express");
const router = express.Router();
const participantController = require("../controllers/participants.controller");
const {
  authenticateToken,
  authorizeRoles,
} = require("../middleware/auth.middleware");

router.post("/", authenticateToken, participantController.createParticipant);
router.patch(
  "/:id",
  authenticateToken,
  authorizeRoles("company_admin", "location_admin"),
  participantController.updateParticipant
);
router.patch(
  "/:id/disqualify",
  authenticateToken,
  authorizeRoles("company_admin", "location_admin"),
  participantController.disqualifyParticipant
);
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
