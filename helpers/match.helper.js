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

  await stageService.generateFinalStagePlaceholders(tournamentId, clientt);
}

function getKFactor(roundName) {
  if (!roundName) {
    return 28;
  }

  const name = roundName.toLowerCase();
  switch (name) {
    case "final":
      return 40;
    case "semi finals":
      return 36;
    case "quarter finals":
      return 32;
    default:
      return 28;
  }
}

async function updateEloForDoublesMatch(match, client) {
  // Fetch all 4 users from participants (assuming participant has padelhive_user1_id and padelhive_user2_id)
  // You must adapt this fetching depending on how you get the users from match participants

  // Example fetching user data by participant_id, you may have a helper function for this
  const getUserByParticipantId = async (participantId) => {
    const res = await client.query(
      `SELECT id, elo_rate FROM users WHERE id = $1`,
      [participantId]
    );
    if (res.rows.length === 0) {
      throw new Error(`User not found for participant_id ${participantId}`);
    }
    return res.rows[0];
  };

  // Get participants for player1 and player2
  const participant1 = await client.query(
    `SELECT padelhive_user1_id, padelhive_user2_id FROM participants WHERE id = $1`,
    [match.player1_id]
  );
  const participant2 = await client.query(
    `SELECT padelhive_user1_id, padelhive_user2_id FROM participants WHERE id = $1`,
    [match.player2_id]
  );

  if (participant1.rows.length === 0 || participant2.rows.length === 0) {
    throw new Error(
      `Participant not found for player1_id: ${match.player1_id} or player2_id: ${match.player2_id}`
    );
  }

  const p1 = participant1.rows[0];
  const p2 = participant2.rows[0];

  // Fetch the users
  const user1Team1 = await getUserByParticipantId(p1.padelhive_user1_id);
  const user2Team1 = await getUserByParticipantId(p1.padelhive_user2_id);
  const user1Team2 = await getUserByParticipantId(p2.padelhive_user1_id);
  const user2Team2 = await getUserByParticipantId(p2.padelhive_user2_id);

  // Validate and fallback elo_rate if invalid
  [user1Team1, user2Team1, user1Team2, user2Team2].forEach((user) => {
    let parsedElo = Number(user.elo_rate);
    if (isNaN(parsedElo) || parsedElo <= 0) {
      // parsedElo = DEFAULT_ELO;
      console.log(parsedElo);
    }
    user.elo_rate = parsedElo;
  });

  // Calculate average Elo for each team
  const team1Elo = (user1Team1.elo_rate + user2Team1.elo_rate) / 2;
  const team2Elo = (user1Team2.elo_rate + user2Team2.elo_rate) / 2;

  const { margin, dominance } = getMatchStats(
    match.scores_csv,
    match.winner_id,
    match.player1_id
  );
  // Calculate K factor (adjust as per your rules)
  const baseK = getKFactor(match.round_name);

  const dominanceMultiplier = dominanceToMultiplier(dominance, {
    impact: 0.5,
    maxMultiplier: 1.75,
  });

  const K = baseK * dominanceMultiplier;

  const team1Win = Number(match.winner_id) === Number(match.player1_id) ? 1 : 0;

  // Expected scores
  const expectedTeam1 = 1 / (1 + Math.pow(10, (team2Elo - team1Elo) / 400));
  const expectedTeam2 = 1 - expectedTeam1;

  // Calculate new Elo ratings
  const newEloTeam1User1 = user1Team1.elo_rate + K * (team1Win - expectedTeam1);
  const newEloTeam1User2 = user2Team1.elo_rate + K * (team1Win - expectedTeam1);
  const newEloTeam2User1 =
    user1Team2.elo_rate + K * (1 - team1Win - expectedTeam2);
  const newEloTeam2User2 =
    user2Team2.elo_rate + K * (1 - team1Win - expectedTeam2);

  // Update users' Elo ratings in DB
  await Promise.all([
    client.query(`UPDATE users SET elo_rate = $1 WHERE id = $2`, [
      newEloTeam1User1,
      user1Team1.id,
    ]),
    client.query(`UPDATE users SET elo_rate = $1 WHERE id = $2`, [
      newEloTeam1User2,
      user2Team1.id,
    ]),
    client.query(`UPDATE users SET elo_rate = $1 WHERE id = $2`, [
      newEloTeam2User1,
      user1Team2.id,
    ]),
    client.query(`UPDATE users SET elo_rate = $1 WHERE id = $2`, [
      newEloTeam2User2,
      user2Team2.id,
    ]),
  ]);
}

function parseScores(scoresCsv) {
  return scoresCsv.split(",").map((set) => {
    const [p1, p2] = set.split("-").map(Number);
    return { p1, p2 };
  });
}

function parseScoreCsv(scores_csv) {
  if (!scores_csv || typeof scores_csv !== "string") return [];

  return scores_csv
    .split(",")
    .map((s) => s.trim())
    .map((setStr) => {
      const m = setStr.match(/^(\d+)-(\d+)$/);
      if (!m) return null;
      return [Number(m[1]), Number(m[2])];
    })
    .filter(Boolean);
}

function getMatchStats(scoresCsv, winnerId, player1Id) {
  const sets = parseScores(scoresCsv);

  let totalGamesDiff = 0;
  let totalSets = sets.length;

  sets.forEach(({ p1, p2 }) => {
    const diff = Math.abs(p1 - p2);
    totalGamesDiff += diff;
  });

  const margin = totalGamesDiff / totalSets;
  const dominance = margin / 6; // max games difference possible in one set

  return { margin, dominance };
}

function computeAverageMargin(sets) {
  if (!Array.isArray(sets) || sets.length === 0) return 0;
  const totalMargin = sets.reduce(
    (acc, [p1, p2]) => acc + Math.abs(p1 - p2),
    0
  );
  return totalMargin / sets.length;
}

function computeDominance(
  avgMargin,
  { maxGamesPerSet = 6, exponent = 1.5 } = {}
) {
  if (!avgMargin || avgMargin <= 0) return 0;
  const normalized = Math.min(avgMargin / maxGamesPerSet, 1); // 0..1
  const dominance = Math.pow(normalized, exponent);
  return Math.min(Math.max(dominance, 0), 1);
}

function dominanceToMultiplier(
  dominance,
  { impact = 0.3, maxMultiplier = 1.6 } = {}
) {
  const multiplier = 1 + dominance * impact;
  return Math.min(multiplier, maxMultiplier);
}

module.exports = {
  checkMatchesCompleted,
  generateMatchesForStages,
  updateEloForDoublesMatch,
};
