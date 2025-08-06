function checkMatchesCompleted(matches, groupId) {
  const groupMatches = matches.filter((match) => match.group_id === groupId);
  if (groupMatches.length === 0) {
    console.log("No matches found for the group: ", groupId);
    return false;
  }

  const allMatchesCompleted = groupMatches.every((match) => {
    return match.state === "completed";
  });

  if (allMatchesCompleted) {
    return true;
  }
  console.log("Not all matches are completed for the group: ", groupId);
  return false;
}

async function generateMatchesForStages(tournamentId, stageId, clientt) {
  const matchService = require("../services/match.service");
  const stageService = require("../services/stage.service");

  // for generating matches for group stage
  await matchService.generateMatchesForGroupStage(
    tournamentId,
    stageId,
    clientt
  );

  // for now i generated stage id + 1 since always the next stage is final stage
  // this will be changed later when we have more stages
  await stageService.generateFinalStagePlaceholders(tournamentId, clientt);
}

module.exports = {
  checkMatchesCompleted,
  generateMatchesForStages,
};
