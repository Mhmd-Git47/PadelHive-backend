const tournamentService = require("../services/tournament.service");
const stageService = require("../services/stage.service");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

exports.createTournament = async (req, res) => {
  try {
    let posterFilename = null;

    if (req.file) {
      posterFilename = `poster-${Date.now()}.webp`;
      const outputPath = path.join(
        __dirname,
        "..",
        "assets",
        "images",
        "tournaments",
        posterFilename
      );

      const processedImage = await sharp(req.file.buffer)
        .resize({ width: 1080, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();

      fs.writeFileSync(outputPath, processedImage);
    }

    const tournamentData = {
      ...req.body,
      poster_url: posterFilename,
    };
    // get authenticated user id (null if not provided)
    const userId = req.user?.id ?? null;
    const userRole = req.user?.role ?? null;

    const tournament = await tournamentService.createTournament(
      tournamentData,
      userId,
      userRole
    );
    res.status(201).json(tournament);
  } catch (err) {
    console.error(`Error creating tournament: ${err}`);
    res.status(500).json({ error: "Failed to create tournament" });
  }
};

exports.updateTournament = async (req, res) => {
  try {
    const { id } = req.params;
    const existingTournament = await tournamentService.getTournamentById(id);

    if (!existingTournament) {
      return res.status(404).json({ error: "Tournament not found" });
    }

    const updatedData = { ...req.body };

    if (req.file) {
      const posterFilename = `poster-${Date.now()}.webp`;
      const outputPath = path.join(
        __dirname,
        "..",
        "assets",
        "images",
        "tournaments",
        posterFilename
      );

      const processedImage = await sharp(req.file.buffer)
        .resize({ width: 1080, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();

      fs.writeFileSync(outputPath, processedImage);

      // delete old poster if exists
      if (existingTournament.poster_url) {
        const oldPath = path.join(
          __dirname,
          "..",
          "assets",
          "images",
          "tournaments",
          existingTournament.poster_url
        );
        fs.unlink(oldPath, (err) => {
          if (err) console.warn(err);
        });
      }

      updatedData.poster_url = posterFilename;
    }

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

exports.getTournamentsByLocationId = async (req, res) => {
  const { locationId } = req.params;
  try {
    const result = await tournamentService.getTournamentsByLocationId(
      locationId
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

exports.deleteTournament = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const result = await tournamentService.deleteTournament(
      id,
      userId,
      userRole
    );

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

exports.getFeaturedSponsorByTournamentId = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    // if (!id) {
    //   return res
    //     .status(400)
    //     .json({ error: "Tournament ID is required and must be a number." });
    // }
    const featuredSponsor =
      await tournamentService.getFeaturedSponsorByTournamentId(id);
    res.status(200).json(featuredSponsor);
  } catch (err) {
    next(err);
  }
};
