const pool = require("../db");
const {
  checkMatchesCompleted,
  updateEloForDoublesMatch,
  addMatchToUserHistory,
} = require("../helpers/match.helper");
const {
  updatePlacementsForTournament,
  updatePlacementsToTournamentHistory,
} = require("../helpers/tournament.helper");
const { generateRoundRobin } = require("../helpers/roundRobin");
const groupService = require("./group.service");
const stageService = require("./stage.service");

const getAllMatches = async () => {
  const matches = await pool.query(`SELECT * FROM matches ORDER BY id`);
  return matches.rows;
};

const getMatchesByTournamentId = async (tournamentId) => {
  const matches = await pool.query(
    "SELECT * FROM matches WHERE tournament_id = $1 ORDER BY id",
    [tournamentId]
  );

  return matches.rows;
};

const getMatchById = async (id) => {
  const match = await pool.query(`SELECT * FROM matches WHERE id = $1`, [id]);
  return match.rows[0];
};

const getMatchesByStageId = async (stageId) => {
  const matches = await pool.query(
    `SELECT * FROM matches WHERE stage_id = $1 ORDER BY round, id`,
    [stageId]
  );
  return matches.rows;
};

const createMatch = async (data) => {
  const { name, tournament_id, player1_id, player2_id } = data;
  const result = await pool.query(
    `INSERT INTO matches(name, tournament_id, player1_id, player2_id) VALUES($1, $2, $3, $4) RETURNING *;`,
    [name, tournament_id, player1_id, player2_id]
  );
  return result.rows[0];
};

const updateMatch = async (id, updatedData) => {
  const client = await pool.connect();

  if (Object.keys(updatedData).length === 0) {
    throw new Error(`No fields provided to update`);
  }

  try {
    await client.query("BEGIN");

    // 1️⃣ Update match
    const updatedMatch = await updateMatchRow(id, updatedData, client);

    // 2️⃣ Handle completed match logic
    if (updatedMatch.state === "completed" && updatedMatch.winner_id) {
      await handleCompletedMatch(updatedMatch, client);
    }

    // 3️⃣ Handle group stage
    if (updatedMatch.group_id !== null) {
      await handleGroupStage(updatedMatch, client);
    } else {
      // 4️⃣ Handle final stage / knockout
      await handleFinalStage(updatedMatch, client);
    }

    await client.query("COMMIT");
    return updatedMatch;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error in updateMatch:", err);
    throw err;
  } finally {
    client.release();
  }
};

// ------------------------ HELPERS ------------------------

// 1️⃣ Update match row
async function updateMatchRow(id, updatedData, client) {
  const fields = [];
  const values = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updatedData)) {
    fields.push(`${key} = $${idx}`);
    values.push(value);
    idx++;
  }

  fields.push(`updated_at = NOW()`);
  values.push(id);

  const query = `UPDATE matches SET ${fields.join(
    ", "
  )} WHERE id = $${idx} RETURNING *;`;
  const result = await client.query(query, values);
  const match = result.rows[0];
  if (!match) throw new Error(`No match found with id ${id}`);
  return match;
}

// 2️⃣ Completed match logic
async function handleCompletedMatch(match, client) {
  await updateEloForDoublesMatch(match, client);
  await addMatchToUserHistory(match, client);
}

// 3️⃣ Group stage logic
async function handleGroupStage(match, client) {
  const groupMatchesRes = await client.query(
    `SELECT * FROM matches WHERE group_id = $1 ORDER BY round, id`,
    [match.group_id]
  );
  const groupMatches = groupMatchesRes.rows;

  const allCompleted = groupMatches.every((m) => m.state === "completed");
  if (!allCompleted) return;

  await groupService.updateGroup(
    match.group_id,
    { state: "completed", completed_at: new Date() },
    client
  );

  // Calculate group rankings & update stage participants
  await processGroupRankings(match, groupMatches, client);
}

async function processGroupRankings(match, groupMatches, client) {
  const participantStats = {};

  groupMatches.forEach((m) => {
    const { player1_id, player2_id, winner_id, scores_csv } = m;
    if (!player1_id || !player2_id || !winner_id) return;

    [player1_id, player2_id].forEach((pid) => {
      if (!participantStats[pid]) {
        participantStats[pid] = {
          participant_id: pid,
          wins: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          matchesPlayed: 0,
        };
      }
    });

    participantStats[winner_id].wins += 1;
    participantStats[player1_id].matchesPlayed += 1;
    participantStats[player2_id].matchesPlayed += 1;

    const sets = scores_csv ? scores_csv.split(",") : [];
    sets.forEach((set) => {
      const [p1Score, p2Score] = set.trim().split("-").map(Number);
      if (!isNaN(p1Score) && !isNaN(p2Score)) {
        participantStats[player1_id].pointsFor += p1Score;
        participantStats[player1_id].pointsAgainst += p2Score;
        participantStats[player2_id].pointsFor += p2Score;
        participantStats[player2_id].pointsAgainst += p1Score;
      }
    });
  });

  // Rank participants
  const ranked = Object.values(participantStats)
    .map((p) => ({ ...p, matchDiff: p.pointsFor - p.pointsAgainst }))
    .sort(
      (a, b) =>
        b.wins - a.wins ||
        b.matchDiff - a.matchDiff ||
        b.pointsFor - a.pointsFor
    );

  // Get tournament info
  const tournamentRes = await client.query(
    `SELECT participants_advance FROM tournaments WHERE id = $1`,
    [match.tournament_id]
  );
  const tournament = tournamentRes.rows[0];
  const qualifiedTeams = ranked.slice(0, tournament.participants_advance);

  // Map stage participants
  const groupRes = await client.query(`SELECT * FROM groups WHERE id = $1`, [
    match.group_id,
  ]);
  const group = groupRes.rows[0];
  const groupLetter = String.fromCharCode(65 + group.group_index);

  const finalStageRes = await client.query(
    `SELECT id FROM stages WHERE tournament_id = $1 AND name = 'Final Stage' LIMIT 1`,
    [match.tournament_id]
  );
  const finalStageId = finalStageRes.rows[0]?.id;

  const spRes = await client.query(
    `SELECT id, participant_label FROM stage_participants WHERE stage_id = $1`,
    [finalStageId]
  );
  const labelToId = {};
  for (const row of spRes.rows) labelToId[row.participant_label] = row.id;

  for (let i = 0; i < qualifiedTeams.length; i++) {
    const label = `${groupLetter}${i + 1}`;
    const spId = labelToId[label];
    if (!spId) continue;
    await stageService.updateStageParticipant(spId, {
      participant_id: qualifiedTeams[i].participant_id,
    });
  }
}

// 4️⃣ Final stage / knockout
async function handleFinalStage(match, client) {
  // 1️⃣ Handle next match based on prereq
  const nextMatchRes = await client.query(
    `SELECT * FROM matches WHERE player1_prereq_match_id = $1 OR player2_prereq_match_id = $1`,
    [match.id]
  );
  const nextMatch = nextMatchRes.rows[0];

  if (nextMatch) {
    const winnerStagePlayerId =
      match.winner_id === match.player1_id
        ? match.stage_player1_id
        : match.stage_player2_id;

    if (!winnerStagePlayerId)
      throw new Error("Could not determine winner stage player ID");

    if (nextMatch.id === nextMatch.player1_prereq_match_id) {
      await client.query(
        `UPDATE matches SET player1_id = $1, stage_player1_id = $2 WHERE id = $3`,
        [match.winner_id, winnerStagePlayerId, nextMatch.id]
      );
    } else if (nextMatch.id === nextMatch.player2_prereq_match_id) {
      await client.query(
        `UPDATE matches SET player2_id = $1, stage_player2_id = $2 WHERE id = $3`,
        [match.winner_id, winnerStagePlayerId, nextMatch.id]
      );
    }
    return; // there’s still next match, tournament not finished
  }

  // 2️⃣ Check if all stage matches are completed
  const stageMatchesRes = await client.query(
    `SELECT * FROM matches WHERE stage_id = $1`,
    [match.stage_id]
  );
  const stageMatches = stageMatchesRes.rows;
  const allStageCompleted = stageMatches.every((m) => m.state === "completed");

  if (!allStageCompleted) return;

  // 3️⃣ Mark stage completed
  await client.query(
    `UPDATE stages SET state = 'completed', completed_at = NOW() WHERE id = $1`,
    [match.stage_id]
  );

  // 4️⃣ Update tournament placements
  const finalMatchesRes = await client.query(
    `SELECT * FROM matches WHERE stage_id = $1 ORDER BY round DESC, id DESC`,
    [match.stage_id]
  );

  if (finalMatchesRes.rows.length > 0) {
  }

  // 5️⃣ Check if all stages in tournament are completed
  const tournamentStagesRes = await client.query(
    `SELECT * FROM stages WHERE tournament_id = $1`,
    [match.tournament_id]
  );

  const allTournamentCompleted = tournamentStagesRes.rows.every(
    (s) => s.state === "completed"
  );

  if (!allTournamentCompleted) return;

  // 6️⃣ Mark tournament completed
  await client.query(
    `UPDATE tournaments SET state = 'completed', completed_at = NOW() WHERE id = $1`,
    [match.tournament_id]
  );

  // 7️⃣ Update user_tournaments_history for all participants (registered users)
  await client.query(
    `UPDATE user_tournaments_history
     SET status = 'completed',
         completed_at = NOW(),
         updated_at = NOW()
     WHERE tournament_id = $1
       AND status = 'registered'`,
    [match.tournament_id]
  );

  await updatePlacementsForTournament(finalMatchesRes.rows[0], client);
}

const generateMatchesForGroupStage = async (tournamentId, stageId, clientt) => {
  const client = clientt || (await pool.connect());

  try {
    await client.query("BEGIN");

    const groupRes = await client.query(
      `SELECT id FROM groups WHERE tournament_id = $1 AND stage_id = $2`,
      [tournamentId, stageId]
    );

    const matches = [];

    for (const group of groupRes.rows) {
      const groupId = group.id;
      const participantRes = await client.query(
        `
        SELECT participant_id FROM group_participants WHERE group_id = $1`,
        [groupId]
      );
      const participants = participantRes.rows.map((p) => p.participant_id);

      const groupMatches = await generateRoundRobin(participants);
      for (const match of groupMatches) {
        const matchRes = await client.query(
          `
          INSERT INTO matches (tournament_id, group_id, player1_id, player2_id, round, state, created_at, updated_at, stage_id)
          VALUES ($1, $2, $3, $4, $5, 'pending', NOW(), NOW(), $6) RETURNING *
        `,
          [
            tournamentId,
            groupId,
            match.player1,
            match.player2,
            match.round,
            stageId,
          ]
        );
        matches.push(matchRes.rows[0]);
      }
    }

    await client.query("COMMIT");
    return matches;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    // client.release();
  }
};

// user_match_history table
const getMatchesByUserId = async (userId) => {
  const matches = await pool.query(
    `SELECT * FROM user_match_history WHERE user_id = $1 ORDER BY created_at desc`,
    [userId]
  );
  return matches.rows;
};

module.exports = {
  getAllMatches,
  getMatchesByTournamentId,
  getMatchById,
  getMatchesByStageId,
  createMatch,
  updateMatch,
  generateMatchesForGroupStage,
  getMatchesByUserId,
};
