const tournamentService = require("../services/tournament.service");
const stageService = require("../services/stage.service");
const fs = require("fs");
const path = require("path");

exports.createTournament = async (req, res) => {
  try {
    const posterUrl = req.file
      ? `${req.protocol}://${req.get("host")}/images/tournaments/${
          req.file.filename
        }`
      : null;

    const tournamentData = {
      ...req.body,
      poster_url: posterUrl,
    };

    const tournament = await tournamentService.createTournament(tournamentData);
    res.status(201).json(tournament);
  } catch (err) {
    console.error(`Error creating tournament: ${err}`);
    res.status(500).json({ error: "Failed to create tournament" });
  }
};

exports.updateTournament = async (req, res) => {
  try {
    const { id } = req.params;

    // Get current tournament from DB
    const existingTournament = await tournamentService.getTournamentById(id);
    if (!existingTournament) {
      return res.status(404).json({ error: "Tournament not found" });
    }

    const updatedData = { ...req.body };

    if (req.file) {
      // Construct new poster URL
      const newPosterUrl = `${req.protocol}://${req.get(
        "host"
      )}/images/tournaments/${req.file.filename}`;
      updatedData.poster_url = newPosterUrl;

      // Delete old image file if exists
      if (existingTournament.poster_url) {
        const oldImagePath = path.join(
          __dirname,
          "..",
          "images",
          "tournaments",
          path.basename(existingTournament.poster_url)
        );

        fs.unlink(oldImagePath, (err) => {
          if (err) {
            console.warn("Failed to delete old poster image:", err.message);
          }
        });
      }
    }

    // Update tournament record in DB
    const result = await tournamentService.updateTournament(id, updatedData);

    if (!result) {
      return res.status(404).json({ error: "Tournament not found" });
    }

    res.json(result);
  } catch (err) {
    console.error("Error updating tournament: ", err.message);
    res.status(500).json({ error: "Failed to update tournament" });
  }
};

exports.getAllTournaments = async (req, res) => {
  try {
    const result = await tournamentService.getAllTournaments();
    res.json(result);
  } catch (err) {
    console.error("Failed fetching tournaments: ", err.message);
    console.error("DB query failed:", err);
    res.status(500).json({ error: "Failed loading tournaments" });
  }
};

exports.getTournamentsByCompanyId = async (req, res) => {
  const { companyId } = req.params;
  try {
    const result = await tournamentService.getTournamentsByCompanyId(companyId);
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

exports.deleteTournament = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await tournamentService.deleteTournament(id);

    if (result.notFound) {
      return res.status(404).json({ error: "Tournament not found" });
    }

    res.json({ success: true, message: "Tournament deleted successfully" });
  } catch (err) {
    console.error("Failed deleting tournament: ", err);
    res.status(500).json({ error: "failed deleting tournament" });
  }
};

exports.getTournamentsByUserId = async (req, res) => {
  try {
    const { userId } = req.params;
    const results = await tournamentService.getTournamentsByUserId(userId);
    res.json(results);
  } catch (err) {
    console.error("Failed fetching tournaments: ", err);
    res.status(500).json({ error: "failed fetching tournaments" });
  }
};

exports.checkUserRegisteredToTournament = async (req, res) => {
  try {
    const { userId, tournamentId } = req.params;
    const isRegistered = await tournamentService.isUserRegisteredToTournament(
      userId,
      tournamentId
    );

    res.json({ isRegistered });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
};
