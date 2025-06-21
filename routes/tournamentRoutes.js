const express = require("express");
const router = express.Router();
const controller = require("../controllers/tournamentController");

router.get("/tournaments", controller.getAllTournaments);
router.get("/tournament/:id", controller.getTournament);
router.get("/tournament/:id/participants", controller.getParticipants);
router.get("/tournament/:id/matches", controller.getMatches);
router.get("/standings/:tournamentId", controller.getStandings);
router.get("/tournament/:id/group-standings", controller.getGroupStandings);

module.exports = router;
