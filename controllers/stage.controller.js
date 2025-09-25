const stageServices = require("../services/stage.service");

exports.getStagesByTournamentId = async (req, res) => {
  const { tournamentId } = req.params;

  try {
    const stages = await stageServices.getStagesByTournamentId(tournamentId);

    if (!stages.length) {
      return res
        .status(404)
        .json({ message: "No stages found for this tournament." });
    }
    return res.json(stages);
  } catch (err) {
    console.error(`Failed fetching stages: ${err}`);
    return res
      .status(500)
      .json({ error: "Server error while fetching stages." });
  }
};

exports.generateFinalStagePlaceholders = async (req, res) => {
  const { stageId, tournamentId } = req.body;

  try {
    const placeholders = await stageServices.generateFinalStagePlaceholders(
      stageId,
      tournamentId
    );
    return res.json(placeholders);
  } catch (err) {
    console.error(`Failed generating placeholders: ${err}`);
    return res
      .status(500)
      .json({ error: "Server error while generating placeholders." });
  }
};

exports.updateStageParticipant = async (req, res) => {
  const { id } = req.query;
  const updateData = req.body;

  try {
    const updatedParticipant = await stageServices.updateStageParticipant(
      id,
      updateData
    );
    return res.json(updatedParticipant);
  } catch (err) {
    console.error(`Failed updating stage participant: ${err}`);
    return res
      .status(500)
      .json({ error: "Server error while updating stage participant." });
  }
};

exports.saveKnockoutBracket = async (req, res) => {
  const { tournamentId } = req.params;
  const { draft } = req.body;

  if (!draft || !draft.rounds) {
    return res.status(400).json({ error: "Invalid draft format" });
  }

  try {
    const matchIdMap = await stageServices.saveKnockoutBracket(
      tournamentId,
      draft
    );
    return res.json({
      message: "Knockout bracket saved successfully",
      matchIdMap,
    });
  } catch (err) {
    console.error(`Failed saving knockout bracket: ${err}`);
    return res
      .status(500)
      .json({ error: "Server error while saving knockout bracket." });
  }
};

exports.getStageParticipantsByStageId = async (req, res) => {
  const { stageId } = req.params;

  try {
    const participants = await stageServices.getStageParticipantsByStageId(
      stageId
    );
    return res.json(participants);
  } catch (err) {
    console.error(`Failed fetching stage participants: ${err}`);
    return res
      .status(500)
      .json({ error: "Server error while fetching stage participants." });
  }
};
