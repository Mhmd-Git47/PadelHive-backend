const challonge = require("../services/challongeService");

exports.getAllTournaments = async (req, res) => {
  try {
    const data = await challonge.getAllTournaments();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getTournament = async (req, res) => {
  try {
    const data = await challonge.getTournament(req.params.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getParticipants = async (req, res) => {
  try {
    const data = await challonge.getParticipants(req.params.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getMatches = async (req, res) => {
  try {
    const data = await challonge.getMatches(req.params.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getStandings = async (req, res) => {
  try {
    const data = await challonge.getStandings(req.params.tournamentId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getGroupStandings = async (req, res) => {
  try {
    const data = await challonge.getGroupStandings(req.params.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
