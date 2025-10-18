function checkMatchesCompleted(matches, groupId) {
  const groupMatches = matches.filter((match) => match.group_id === groupId);
  if (groupMatches.length === 0) {
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
  // Helper to safely fetch user by participant ID
  const fetchUserSafe = async (participantId) => {
    if (!participantId) return null; // skip null participant
    const res = await client.query(
      `SELECT id, elo_rate FROM users WHERE id = $1`,
      [participantId]
    );
    return res.rows[0] || null;
  };

  await client.query("BEGIN"); // 🔒 start transaction

  try {
    // Fetch participants for player1 and player2
    const participant1Res = await client.query(
      `SELECT padelhive_user1_id, padelhive_user2_id FROM participants WHERE id = $1`,
      [match.player1_id]
    );
    const participant2Res = await client.query(
      `SELECT padelhive_user1_id, padelhive_user2_id FROM participants WHERE id = $1`,
      [match.player2_id]
    );

    const p1 = participant1Res.rows[0];
    const p2 = participant2Res.rows[0];

    if (!p1 || !p2) {
      console.warn(
        `Participant record missing for player1_id: ${match.player1_id} or player2_id: ${match.player2_id}`
      );
      await client.query("ROLLBACK");
      return; // skip Elo update if participant missing
    }

    // Fetch users safely
    const users = await Promise.all([
      fetchUserSafe(p1.padelhive_user1_id),
      fetchUserSafe(p1.padelhive_user2_id),
      fetchUserSafe(p2.padelhive_user1_id),
      fetchUserSafe(p2.padelhive_user2_id),
    ]);

    // Separate into teams and remove nulls
    const team1Users = users.slice(0, 2).filter(Boolean);
    const team2Users = users.slice(2, 4).filter(Boolean);

    if (team1Users.length === 0 || team2Users.length === 0) {
      console.warn(
        "Not enough valid users to calculate Elo. Skipping Elo update."
      );
      await client.query("ROLLBACK");
      return;
    }

    // Parse Elo safely and fallback baseline if invalid
    const parseElo = (user) => {
      const val = Number(user.elo_rate);
      return isNaN(val) || val <= 0 ? 900 : val;
    };

    const team1Elo =
      team1Users.reduce((sum, u) => sum + parseElo(u), 0) / team1Users.length;
    const team2Elo =
      team2Users.reduce((sum, u) => sum + parseElo(u), 0) / team2Users.length;

    // Calculate match stats (existing helper)
    const { margin, dominance } = getMatchStats(
      match.scores_csv,
      match.winner_id,
      match.player1_id
    );

    // K factor based on round
    const baseK = getKFactor(match.round_name);
    const dominanceMultiplier = dominanceToMultiplier(dominance, {
      impact: 0.5,
      maxMultiplier: 1.75,
    });
    const K = baseK * dominanceMultiplier;

    // Determine winning team
    const team1Win =
      Number(match.winner_id) === Number(match.player1_id) ? 1 : 0;

    // Expected scores
    const expectedTeam1 = 1 / (1 + Math.pow(10, (team2Elo - team1Elo) / 400));
    const expectedTeam2 = 1 - expectedTeam1;

    // Track affected user IDs
    const affectedUserIds = [];

    // Update Elo for team1
    await Promise.all(
      team1Users.map(async (user) => {
        const newElo = parseElo(user) + K * (team1Win - expectedTeam1);
        const newCategory = getCategoryByElo(newElo);
        affectedUserIds.push(user.id);
        await client.query(
          `UPDATE users SET elo_rate = $1, category = $2 WHERE id = $3`,
          [newElo, newCategory, user.id]
        );
      })
    );

    // Update Elo for team2
    await Promise.all(
      team2Users.map(async (user) => {
        const newElo = parseElo(user) + K * (1 - team1Win - expectedTeam2);
        const newCategory = getCategoryByElo(newElo);
        affectedUserIds.push(user.id);
        await client.query(
          `UPDATE users SET elo_rate = $1, category = $2 WHERE id = $3`,
          [newElo, newCategory, user.id]
        );
      })
    );

    // 🔑 Recalculate ranks ONLY for categories affected in this match
    await client.query(
      `
      WITH affected_categories AS (
        SELECT DISTINCT LEFT(category,1) AS base_cat
        FROM users
        WHERE id = ANY($1::uuid[])
      ),
      ranked AS (
        SELECT id,
              ROW_NUMBER() OVER (
                PARTITION BY LEFT(category,1)
                ORDER BY elo_rate DESC
              ) AS new_rank
        FROM users
        WHERE LEFT(category,1) IN (SELECT base_cat FROM affected_categories)
      )
      UPDATE users u
      SET rank = r.new_rank
      FROM ranked r
      WHERE u.id = r.id;

      `,
      [affectedUserIds]
    );

    await client.query("COMMIT"); // ✅ commit transaction

    console.log(
      `✅ Elo updated & ranks recalculated for categories of users: ${affectedUserIds.join(
        ", "
      )}`
    );
  } catch (err) {
    await client.query("ROLLBACK"); // ❌ rollback if failure
    console.error("❌ Failed to update Elo:", err.message);
    throw err;
  }
}

function getCategoryByElo(eloRate) {
  let category;
  let baseElo;

  if (eloRate < 1050) {
    category = "D";
    baseElo = 900;
  } else if (eloRate < 1200) {
    category = "C";
    baseElo = 1050;
  } else if (eloRate < 1350) {
    category = "B";
    baseElo = 1200;
  } else if (eloRate < 1500) {
    category = "A";
    baseElo = 1350;
  } else {
    return "A+";
  }

  const diff = eloRate - baseElo;

  if (diff < 50) category += "-";
  else if (diff < 100) category += "";
  else category += "+";

  return category;
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

function updateMatchHelper(matchId, updatedData) {
  const matchService = require("../services/match.service");
  return matchService.updateMatch(matchId, updatedData);
}

// user_match_history table
async function addMatchToUserHistory(match, client) {
  const resolveParticipant = async (playerId, stagePlayerId) => {
    if (playerId) return playerId;
    if (stagePlayerId) {
      const { rows } = await client.query(
        "SELECT participant_id FROM stage_participants WHERE id = $1",
        [stagePlayerId]
      );
      return rows[0]?.participant_id || null;
    }
    return null;
  };

  const p1 = await resolveParticipant(match.player1_id, match.stage_player1_id);
  const p2 = await resolveParticipant(match.player2_id, match.stage_player2_id);

  const insertHistory = async (participantId, didWin) => {
    if (!participantId) return;
    const {
      rows: [participant],
    } = await client.query(
      "SELECT user_id, padelhive_user1_id, padelhive_user2_id FROM participants WHERE id = $1",
      [participantId]
    );

    const userIds = [
      participant.user_id,
      participant.padelhive_user1_id,
      participant.padelhive_user2_id,
    ].filter(Boolean);

    for (const uid of userIds) {
      const playedAt = match.completed_at || new Date();

      await client.query(
        `INSERT INTO user_match_history (user_id, match_id, participant_id, tournament_id, did_win, played_at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [uid, match.id, participantId, match.tournament_id, didWin, playedAt]
      );
    }
  };
  await insertHistory(p1, match.winner_id === p1);
  await insertHistory(p2, match.winner_id === p2);
}

module.exports = {
  checkMatchesCompleted,
  generateMatchesForStages,
  updateEloForDoublesMatch,
  updateMatchHelper,
  addMatchToUserHistory,
};
