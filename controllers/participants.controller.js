const participantService = require("../services/participant.service");

exports.createParticipant = async (req, res) => {
  try {
    const participantData = req.body;
    const result = await participantService.createParticipant(participantData);
    res.status(201).json(result);
  } catch (err) {
    console.error("Error creating participant: ", err.message);
    res.status(500).json({ error: "Failed to create participant" });
  }
};

exports.updateParticipant = async (req, res) => {
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
    res.status(500).json({ error: "Failed to update participant" });
  }
};

exports.getAllParticipants = async (req, res) => {
  try {
    const participants = await participantService.getAllParticipants();
    res.json(participants);
  } catch (err) {
    console.error("Error fetching participants: ", err.message);
    res.status(500).json({ error: "Failed to get participants" });
  }
};

exports.getParticipantById = async (req, res) => {
  try {
    const { id } = req.params;
    const participant = await participantService.getParticipantById(id);
    res.json(participant);
  } catch (err) {
    console.error("Error fetching participant: ", err.message);
    res.status(500).json({ error: "Failed to get participant" });
  }
};

exports.disqualifyParticipant = async (req, res) => {
  try {
    const { tournamentId } = req.query;
    const { id } = req.params;
    const participant = await participantService.disqualifyParticipant(
      tournamentId,
      id
    );
    res.json(participant);
  } catch (err) {
    console.error("Error disqualifying participant: ", err.message);
    res.status(500).json({ error: "Failed to disqualify participant" });
  }
};

exports.getParticipantsByTournamentId = async (req, res) => {
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
    res.status(500).json({ error: "Failed to get participants" });
  }
};

exports.deleteParticipant = async (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: "Missing Participant Id" });
  }

  try {
    const result = await participantService.deleteParticipant(id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Error deleting participant: ", err });
  }
};
