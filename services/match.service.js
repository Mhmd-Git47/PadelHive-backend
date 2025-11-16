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
// const groupService = require("./group.service");
const stageService = require("./stage.service");
const finalStageHelper = require("../helpers/finalStage.helper");
const { AppError } = require("../utils/errors");
const { getActorDetails, createActivityLog } = require("./activityLog.service");

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

// to update match without applying any logic for scores
const updateMatchDirect = async (id, updatedData) => {
  const client = await pool.connect();

  if (Object.keys(updatedData).length === 0) {
    throw new Error(`No fields provided to update`);
  }

  try {
    await client.query("BEGIN");

    // ✅ Update only the database row
    const updatedMatch = await updateMatchRow(id, updatedData, client);

    await client.query("COMMIT");

    return updatedMatch;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error in updateMatchDirect:", err);
    throw err;
  } finally {
    client.release();
  }
};

const updateMatch = async (id, updatedData) => {
  const groupService = require("./group.service");
  const stageService = require("./stage.service");

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
      // const groupStandings = await groupService.getGroupStandings(
      //   updatedMatch.tournament_id
      // );
      // if (global.io) {
      //   global.io
      //     .to(`tournament_${updatedMatch.tournament_id}`)
      //     .emit("group-standings-updated", {
      //       tournamentId: updatedMatch.tournament_id,
      //       standings: groupStandings,
      //     });
      // }
    } else {
      // 4️⃣ Handle final stage / knockout
      await handleFinalStage(updatedMatch, client);
    }

    await client.query("COMMIT");

    // WebSocket: emit updated match to all clients
    if (global.io) {
      // 1️⃣ Emit the updated match
      global.io
        .to(`tournament_${updatedMatch.tournament_id}`)
        .emit("match-updated", updatedMatch);

      try {
        // 2️⃣ Recalculate standings after DB update
        const newStandings = await groupService.getSortedGroupStandings(
          updatedMatch.tournament_id
        );

        // 3️⃣ Emit updated standings to all connected clients
        global.io
          .to(`tournament_${updatedMatch.tournament_id}`)
          .emit("group-standings-updated", {
            tournamentId: updatedMatch.tournament_id,
            standings: newStandings,
          });
      } catch (err) {
        console.error("Error recalculating group standings: ", err);
      }
    }

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
  const tournamentRes = await client.query(
    `SELECT competition_type FROM tournaments WHERE id = $1`,
    [match.tournament_id]
  );
  const tournament = tournamentRes.rows[0];
  if (!tournament) throw new Error("Tournament not found");

  // only if competitive, update ELO rate
  if (tournament.competition_type === "competitive") {
    await updateEloForDoublesMatch(match, client);
  }
  await addMatchToUserHistory(match, client);
}

// 3️⃣ Group stage logic
async function handleGroupStage(match, client) {
  const groupService = require("./group.service");

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
  // ⬇️ Unified logic here
  const { isStandard } = await finalStageHelper.getBracketTypeInfo(
    match.tournament_id,
    client
  );

  if (isStandard) {
    // Calculate group rankings & update stage participants
    await processGroupRankings(match, groupMatches, client);
  } else {
    // Check if all groups are completed
    const groupsRes = await client.query(
      `SELECT state FROM groups WHERE tournament_id = $1`,
      [match.tournament_id]
    );
    const allGroupsCompleted = groupsRes.rows.every(
      (g) => g.state === "completed"
    );

    if (allGroupsCompleted) {
      console.log(
        "🎯 All groups done — computing global seeds for dynamic bracket..."
      );
      await finalStageHelper.computeAndApplySeeds(match.tournament_id, client);
    }
  }
}

async function processGroupRankings(match, groupMatches, client) {
  const stageService = require("./stage.service");

  const participantStats = {};

  // Step 1️⃣ — Aggregate all stats
  groupMatches.forEach((m) => {
    const { player1_id, player2_id, winner_id, scores_csv } = m;
    if (!player1_id || !player2_id) return;

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

    if (winner_id) participantStats[winner_id].wins += 1;

    participantStats[player1_id].matchesPlayed += 1;
    participantStats[player2_id].matchesPlayed += 1;

    const sets = scores_csv ? scores_csv.split(",") : [];
    sets.forEach((set) => {
      const scores = set.trim().split("-").map(Number);
      const p1Score = scores[0];
      const p2Score = scores[1];
      if (!isNaN(p1Score) && !isNaN(p2Score)) {
        participantStats[player1_id].pointsFor += p1Score;
        participantStats[player1_id].pointsAgainst += p2Score;
        participantStats[player2_id].pointsFor += p2Score;
        participantStats[player2_id].pointsAgainst += p1Score;
      }
    });
  });

  // Step 2️⃣ — Calculate matchDiff
  const ranked = Object.values(participantStats).map((p) => ({
    ...p,
    matchDiff: p.pointsFor - p.pointsAgainst,
  }));

  // Step 3️⃣ — Primary sort: wins → matchDiff
  ranked.sort((a, b) => b.wins - a.wins || b.matchDiff - a.matchDiff);

  // Step 4️⃣ — Handle multi-way ties with head-to-head
  const groupedByWinsAndDiff = {};
  ranked.forEach((p) => {
    const key = p.wins + "-" + p.matchDiff;
    if (!groupedByWinsAndDiff[key]) groupedByWinsAndDiff[key] = [];
    groupedByWinsAndDiff[key].push(p);
  });

  Object.keys(groupedByWinsAndDiff).forEach((key) => {
    const tiedPlayers = groupedByWinsAndDiff[key];
    if (tiedPlayers.length <= 1) return;

    const miniStats = {};
    tiedPlayers.forEach((p) => {
      miniStats[p.participant_id] = {
        id: p.participant_id,
        wins: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      };
    });

    groupMatches.forEach((m) => {
      const { player1_id, player2_id, winner_id, scores_csv } = m;

      if (
        tiedPlayers.some((tp) => tp.participant_id === player1_id) &&
        tiedPlayers.some((tp) => tp.participant_id === player2_id)
      ) {
        if (winner_id && miniStats[winner_id]) miniStats[winner_id].wins++;

        const sets = scores_csv ? scores_csv.split(",") : [];
        sets.forEach((set) => {
          const scores = set.trim().split("-").map(Number);
          const p1Score = scores[0];
          const p2Score = scores[1];
          if (!isNaN(p1Score) && !isNaN(p2Score)) {
            if (miniStats[player1_id]) {
              miniStats[player1_id].pointsFor += p1Score;
              miniStats[player1_id].pointsAgainst += p2Score;
            }
            if (miniStats[player2_id]) {
              miniStats[player2_id].pointsFor += p2Score;
              miniStats[player2_id].pointsAgainst += p1Score;
            }
          }
        });
      }
    });

    const allZeroWins = Object.values(miniStats).every((ms) => ms.wins === 0);

    const miniRank = allZeroWins
      ? tiedPlayers.sort(
          (a, b) => b.matchDiff - a.matchDiff || b.pointsFor - a.pointsFor
        )
      : Object.values(miniStats)
          .sort(
            (a, b) =>
              b.wins - a.wins ||
              b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst) ||
              b.pointsFor - a.pointsFor
          )
          .map((ms) => tiedPlayers.find((tp) => tp.participant_id === ms.id));

    groupedByWinsAndDiff[key] = miniRank;
  });

  const newRanked = Object.values(groupedByWinsAndDiff).flat();

  // Step 5️⃣ — Get advancing participants
  const tournamentRes = await client.query(
    `SELECT participants_advance FROM tournaments WHERE id = $1`,
    [match.tournament_id]
  );
  const tournament = tournamentRes.rows[0];
  const qualifiedTeams = newRanked.slice(0, tournament.participants_advance);

  // Step 6️⃣ — Map stage participants
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
  spRes.rows.forEach((row) => {
    labelToId[row.participant_label] = row.id;
  });

  for (let i = 0; i < qualifiedTeams.length; i++) {
    const label = groupLetter + (i + 1);
    const spId = labelToId[label];
    if (!spId) continue;

    const existing = await client.query(
      `SELECT id FROM stage_participants WHERE stage_id = $1 AND participant_id = $2`,
      [finalStageId, qualifiedTeams[i].participant_id]
    );

    if (existing.rows.length === 0) {
      await stageService.updateStageParticipant(spId, {
        participant_id: qualifiedTeams[i].participant_id,
      });
    } else {
      console.log(
        `⚠️ Participant ${qualifiedTeams[i].participant_id} already in stage ${finalStageId}, skipping.`
      );
    }
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
  console.log(
    `✅ Query success: ${nextMatchRes.rowCount} matches found for prereq ${match.id}`
  );

  if (!nextMatch) {
    console.log(`No next match found for match ${match.id} (probably final)`);
  } else {
    const winnerStagePlayerId =
      match.winner_id === match.player1_id
        ? match.stage_player1_id
        : match.stage_player2_id;

    if (!winnerStagePlayerId)
      throw new Error("Could not determine winner stage player ID");

    if (match.id === nextMatch.player1_prereq_match_id) {
      await client.query(
        `UPDATE matches SET player1_id = $1, stage_player1_id = $2 WHERE id = $3`,
        [match.winner_id, winnerStagePlayerId, nextMatch.id]
      );
    } else if (match.id === nextMatch.player2_prereq_match_id) {
      await client.query(
        `UPDATE matches SET player2_id = $1, stage_player2_id = $2 WHERE id = $3`,
        [match.winner_id, winnerStagePlayerId, nextMatch.id]
      );
    }
    const updatedNextMatchRes = await client.query(
      `SELECT * FROM matches WHERE id = $1`,
      [nextMatch.id]
    );
    const updatedNextMatch = updatedNextMatchRes.rows[0];

    if (global.io && updatedNextMatch) {
      global.io
        .to(`tournament_${updatedNextMatch.tournament_id}`)
        .emit("match-updated", updatedNextMatch);
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

// delete matches groupstage + final stage
const deleteTournamentMatches = async (tournamentId, userId, userRole) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Fetch tournament info for validation + logging
    const tournamentRes = await client.query(
      `SELECT id, name, company_id FROM tournaments WHERE id = $1`,
      [tournamentId]
    );

    if (tournamentRes.rowCount === 0) {
      throw new AppError("Tournament not available.", 420);
    }

    const tournament = tournamentRes.rows[0];
    const actor = await getActorDetails(userId, userRole);

    // 2️⃣ Get Final Stage ID
    const finalStageRes = await client.query(
      `SELECT id FROM stages WHERE tournament_id = $1 AND name = $2`,
      [tournamentId, "Final Stage"]
    );

    const finalStageId = finalStageRes.rows?.[0]?.id;

    if (!finalStageId) {
      throw new AppError("Final Stage not found.", 421);
    }

    // 3️⃣ Delete stage participants (for fresh matches)
    await client.query(`DELETE FROM stage_participants WHERE stage_id = $1`, [
      finalStageId,
    ]);

    // 4️⃣ Delete matches for the tournament
    const deleteRes = await client.query(
      `DELETE FROM matches WHERE tournament_id = $1 RETURNING id`,
      [tournamentId]
    );

    const deletedCount = deleteRes.rowCount;

    // 5️⃣ Commit transaction
    await client.query("COMMIT");

    // 🟢 6️⃣ Log success
    try {
      await createActivityLog(
        {
          scope: "company",
          company_id: tournament.company_id,
          actor_id: userId,
          actor_role: userRole,
          actor_name: actor.name,
          action_type: "DELETE_TOURNAMENT_MATCHES",
          entity_id: null,
          entity_type: "match",
          description: `${deletedCount} match(es) deleted from tournament "${tournament.name}" (Final Stage ID: ${finalStageId}) by ${actor.name}.`,
          status: "Success",
          tournament_id: tournamentId,
        },
        client
      );
    } catch (logErr) {
      console.error("⚠️ Failed to log match deletion success:", logErr);
    }

    // 🔔 Optional: Emit socket event
    if (global.io) {
      global.io.to(`tournament_${tournamentId}`).emit("matches-deleted", {
        tournamentId,
        message: "All matches were deleted successfully.",
      });
    }

    return { message: `${deletedCount} matches deleted successfully.` };
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error deleting tournament matches:", err);

    // 🔴 Log failure
    try {
      let actorDetails = null;
      try {
        actorDetails = await getActorDetails(userId, userRole);
      } catch (actorErr) {
        console.warn("⚠️ Could not fetch actor details:", actorErr);
      }

      const tournamentRes = await pool.query(
        `SELECT id, name, company_id FROM tournaments WHERE id = $1`,
        [tournamentId]
      );
      const tournament = tournamentRes.rows[0];

      await createActivityLog({
        scope: "company",
        company_id: tournament.company_id,
        actor_id: userId,
        actor_role: userRole,
        actor_name: actorDetails?.name || "Unknown",
        action_type: "DELETE_TOURNAMENT_MATCHES_FAILED",
        entity_id: null,
        entity_type: "match",
        description: `Failed to delete matches for tournament "${
          tournament?.name || tournamentId
        }". Error: ${err.message}`,
        status: "Failed",
        tournament_id: tournamentId,
      });
    } catch (logErr) {
      console.error("⚠️ Failed to log match deletion failure:", logErr);
    }

    throw new AppError("Failed removing matches", 400);
  } finally {
    client.release();
  }
};

module.exports = {
  getAllMatches,
  getMatchesByTournamentId,
  getMatchById,
  getMatchesByStageId,
  createMatch,
  updateMatch,
  updateMatchDirect,
  generateMatchesForGroupStage,
  getMatchesByUserId,
  deleteTournamentMatches,
};
