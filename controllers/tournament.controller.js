const tournamentService = require("../services/tournament.service");

exports.createTournament = async (req, res) => {
  try {
    const tournament = await tournamentService.createTournament(req.body);
    res.status(201).json(tournament);
  } catch (err) {
    console.error(`Error creating tournament: ${err}`);
    res.status(500).json({ error: "Failed to create tournament" });
  }
};

exports.updateTournament = async (req, res) => {
  try {
    const { id } = req.params;
    const updatedData = req.body;

    const result = await tournamentService.updateTournament(id, updatedData);

    if (!result) {
      return res.status(404).json({ error: "Tournament not found" });
    }

    res.json(result);
  } catch (err) {
    console.error("Error updating tournaments: ", err.message);
    res.status(500).json({ error: "Failed to update tournament" });
  }
};

exports.getAllTournaments = async (req, res) => {
  try {
    const result = await tournamentService.getAllTournaments();
    res.json(result);
  } catch (err) {
    console.error("Failed fetching tournaments: ", err.message);
    res.status(500).json({ error: "Failed loading tournaments" });
  }
};

exports.getTournamentsByCompanyId = async (req, res) => {
  const { companyId } = req.params;
  try {
    const result = await tournamentService.getTournamentsByCompanyId(
      companyId
    );
    res.json(result);
  } catch (err) {
    console.error("Failed fetching tournaments: ", err.message);
    res.status(500).json({ error: "Failed loading tournaments" });
  }
};

exports.getTournamentById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await tournamentService.getTournamentById(id);
    res.json(result);
  } catch (err) {
    console.error("Failed fetching tournament: ", err.message);
    res.status(500).json({ error: "Failed loading tournament" });
  }
};
