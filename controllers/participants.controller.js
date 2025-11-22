const participantService = require("../services/participant.service");

exports.createParticipant = async (req, res, next) => {
  try {
    const participantData = req.body;
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const result = await participantService.createParticipant(
      participantData,
      userId,
      userRole
    );
    res.status(201).json(result);
  } catch (err) {
    console.error("Error creating participant: ", err.message);
    next(err);
  }
};

exports.updateParticipant = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updatedData = req.body;

    const result = await participantService.updateParticipant(id, updatedData);

    if (!result) {
      return res.status(404).json({ error: "Participant not found" });
    }

    res.json(result);
  } catch (err) {
    console.error("Error updating participants: ", err.message);
    next(err);
  }
};

exports.getAllParticipants = async (req, res, next) => {
  try {
    const participants = await participantService.getAllParticipants();
    res.json(participants);
  } catch (err) {
    console.error("Error fetching participants: ", err.message);
    next(err);
  }
};

exports.getParticipantById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const participant = await participantService.getParticipantById(id);
    res.json(participant);
  } catch (err) {
    console.error("Error fetching participant: ", err.message);
    next(err);
  }
};

exports.disqualifyParticipant = async (req, res, next) => {
  try {
    const { tournamentId } = req.query;
    const { id } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const participant = await participantService.disqualifyParticipant(
      tournamentId,
      id,
      userId,
      userRole
    );
    res.json(participant);
  } catch (err) {
    console.error("Error disqualifying participant: ", err.message);
    next(err);
  }
};

exports.getParticipantsByTournamentId = async (req, res, next) => {
  try {
    const { tournament_id } = req.query;

    if (!tournament_id) {
      return res.status(400).json({ error: "Missing tournament_id in query" });
    }

    const participants = await participantService.getParticipantsByTournamentId(
      tournament_id
    );

    res.json(participants);
  } catch (err) {
    console.error("Error fetching participants:", err.message);
    next(err);
  }
};

exports.deleteParticipant = async (req, res, next) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: "Missing Participant Id" });
  }

  const userId = req.user?.id;
  const userRole = req.user?.role;

  try {
    const result = await participantService.deleteParticipant(
      id,
      userId,
      userRole
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
};

exports.checkParticipantName = async (req, res, next) => {
  try {
    const { name, tournamentId } = req.body;

    if (!name || !tournamentId) {
      return res
        .status(400)
        .json({ error: "Name and tournamentId are required" });
    }

    const available = await participantService.isParticipantNameValid(
      name,
      tournamentId
    );

    res.status(200).json({ available });
  } catch (err) {
    console.error("Error checking participant name:", err);
    next(err);
  }
};

exports.switchParticipants = async (req, res, next) => {
  try {
    const { tournamentId, p1Id, p2Id } = req.body;

    if (!tournamentId || !p1Id || !p2Id) {
      throw new AppError("Missing required fields", 400);
    }

    const result = await participantService.switchParticipantsInTournament(
      p1Id,
      p2Id,
      tournamentId
    );

    res.status(200).json({
      success: true,
      message: "Participants switched successfully",
    });
  } catch (err) {
    next(err);
  }
};
