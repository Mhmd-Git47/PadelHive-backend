const express = require("express");
const router = express.Router();
const tournamentController = require("../controllers/tournament.controller");

// router.post("/", tournamentController.createTournament);

// router.patch("/:id", tournamentController.updateTournament);

// router.get("/tournaments", tournamentController.getAllTournaments);
// router.get("/tournaments/:id", tournamentController.getTournamentById);
// router.get(
//   "/tournaments/company/:company_id",
//   tournamentController.getTournamentsByCompanyId
// );



router.post("/", tournamentController.createTournament);
router.patch("/:id", tournamentController.updateTournament);
router.get("/", tournamentController.getAllTournaments); // changed from /tournaments
router.get("/:id", tournamentController.getTournamentById);
router.get("/company/:companyId", tournamentController.getTournamentsByCompanyId);

module.exports = router;