const matchService = require("../services/match.service");

exports.createMatch = async (req, res) => {
  try {
    const matchData = req.body;
    const result = await matchService.createMatch(matchData);
    res.status(201).json(result);
  } catch (err) {
    console.error("Error creating match: ", err.message);
    res.status(500).json({ error: "Failed to create match" });
  }
};

exports.updateMatch = async (req, res) => {
  try {
    console.log("begin");
    const { id } = req.params;
    const updatedData = req.body;

    const result = await matchService.updateMatch(id, updatedData);

    if (!result) {
      return res.status(404).json({ error: "Match not found" });
    }

    res.json(result);
  } catch (err) {
    console.error("Error updating matches: ", err.message);
    res.status(500).json({ error: "Failed to update match" });
  }
};

exports.updateMatchDirect = async (req, res) => {
  const { id } = req.params;
  const updatedData = req.body;

  try {
    const updatedMatch = await matchService.updateMatchDirect(id, updatedData);
    return res.status(200).json({
      success: true,
      message: "Match updated successfully (direct update)",
      data: updatedMatch,
    });
  } catch (err) {
    console.error("updateMatchDirect controller error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to update match directly",
    });
  }
};

exports.getAllMatches = async (req, res) => {
  try {
    const matches = await matchService.getAllMatches();
    res.json(matches);
  } catch (err) {
    console.error("Error fetching matches: ", err.message);
    res.status(500).json({ error: "Failed to get matches" });
  }
};

exports.getMatchesByTournamentId = async (req, res) => {
  try {
    const { tournamentId } = req.query;

    const matches = await matchService.getMatchesByTournamentId(tournamentId);
    res.json(matches);
  } catch (err) {
    console.error("Error fetching matches: ", err.message);
    res.status(500).json({ error: "Failed to get matches" });
  }
};

exports.getMatchById = async (req, res) => {
  try {
    const { id } = req.params;
    const match = await matchService.getMatchById(id);
    res.json(match);
  } catch (err) {
    console.error("Error fetching match: ", err.message);
    res.status(500).json({ error: "Failed to get match" });
  }
};

exports.getMatchByStageId = async (req, res) => {
  try {
    const { stageId } = req.params;
    const match = await matchService.getMatchesByStageId(stageId);
    res.json(match);
  } catch (err) {
    console.error("Error fetching matches: ", err.message);
    res.status(500).json({ error: "Failed to get matches" });
  }
};

exports.generateMatchesForGroupStage = async (req, res) => {
  try {
    const { stage_id, tournament_id } = req.body;

    const result = await matchService.generateMatchesForGroupStage(
      tournament_id,
      stage_id
    );
    res.status(201).json(result);
  } catch (err) {
    console.error("Error generating group matches: ", err.message);
    res.status(500).json({ error: "Failed to generate group matches" });
  }
};

exports.getMatchesByUserId = async (req, res) => {
  const { userId } = req.params;

  try {
    const matches = await matchService.getMatchesByUserId(userId);

    res.status(200).json(matches);
  } catch (err) {
    console.error("Error fetching matches: ", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.deleteTournamentMatches = async (req, res, next) => {
  const tournamentId = parseInt(req.params.tournamentId, 10);

  if (isNaN(tournamentId)) {
    return res.status(400).json({ message: "Invalid tournament ID" });
  }

  const userId = req.user?.id;
  const userRole = req.user?.role;

  try {
    await matchService.deleteTournamentMatches(tournamentId, userId, userRole);
    return res.status(200).json({ message: "Matches successfully deleted." });
  } catch (error) {
    next(error);
  }
};

exports.updateMatchParticipants = async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const { player1Id, player2Id } = req.body;

    const result = await matchService.updateMatchParticipants(
      matchId,
      player1Id,
      player2Id
    );

    return res.json({
      message: `Match participants updated`,
      result,
    });
  } catch (err) {
    next(err);
  }
};
