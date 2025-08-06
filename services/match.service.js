const pool = require("../db");
const { checkMatchesCompleted } = require("../helpers/match.helper");
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
    throw new Error(`No Fields provided to update`);
  }

  const fields = [];
  const values = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updatedData)) {
    fields.push(`${key} = $${idx}`);
    values.push(value);
    idx++;
  }

  values.push(id);

  const updateQuery = `
    UPDATE matches SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *;
  `;

  try {
    await client.query("BEGIN");

    // Update the match
    const result = await client.query(updateQuery, values);
    const updatedMatch = result.rows[0];

    // if group stage so if group_id != null
    if (updatedMatch.group_id !== null) {
      // Check if all matches in the group are completed
      if (updatedMatch.group_id) {
        const groupMatches = await client.query(
          `SELECT * FROM matches WHERE group_id = $1 ORDER BY round, id`,
          [updatedMatch.group_id]
        );

        const allCompleted = groupMatches.rows.every(
          (m) => m.state === "completed"
        );

        if (allCompleted) {
          // 1. Mark group as completed
          await groupService.updateGroup(
            updatedMatch.group_id,
            {
              state: "completed",
              completed_at: new Date(),
            },
            client
          );

          // 2. Calculate group standings
          const participantStats = {};

          groupMatches.rows.forEach((match) => {
            const { player1_id, player2_id, winner_id, scores_csv } = match;
            if (!player1_id || !player2_id || !winner_id) return;

            for (const pid of [player1_id, player2_id]) {
              if (!participantStats[pid]) {
                participantStats[pid] = {
                  participant_id: pid,
                  wins: 0,
                  pointsFor: 0,
                  pointsAgainst: 0,
                  matchesPlayed: 0,
                };
              }
            }

            participantStats[winner_id].wins += 1;

            participantStats[player1_id].matchesPlayed += 1;
            participantStats[player2_id].matchesPlayed += 1;

            const sets = scores_csv?.split(",") || [];
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

          const ranked = Object.values(participantStats).map((p) => ({
            ...p,
            matchDiff: p.pointsFor - p.pointsAgainst,
          }));

          ranked.sort((a, b) => {
            if (b.wins !== a.wins) return b.wins - a.wins;
            if (b.matchDiff !== a.matchDiff) return b.matchDiff - a.matchDiff;
            return b.pointsFor - a.pointsFor;
          });

          const qualifiedTeams = ranked.slice(0, 2); // top 2

          // 3. Determine group letter (A, B, C...)
          const groupRes = await client.query(
            `SELECT * FROM groups WHERE id = $1`,
            [updatedMatch.group_id]
          );
          const group = groupRes.rows[0];
          const groupLetter = String.fromCharCode(65 + group.group_index); // A, B, C...

          // 4. Get final stage ID
          const finalStageRes = await client.query(
            `SELECT id FROM stages WHERE tournament_id = $1 AND name = 'Final Stage' LIMIT 1`,
            [updatedMatch.tournament_id]
          );
          const finalStageId = finalStageRes.rows[0]?.id;
          console.log(`Final Stage ID: ${finalStageId}`);
          if (!finalStageId) throw new Error("Final stage not found");

          // 5. Get all final stage participants to map label => ID
          const spRes = await client.query(
            `SELECT id, participant_label FROM stage_participants WHERE stage_id = $1`,
            [finalStageId]
          );
          const labelToId = {};
          for (const row of spRes.rows) {
            labelToId[row.participant_label] = row.id;
          }

          // 6. Update stage_participants with qualified teams
          for (let i = 0; i < qualifiedTeams.length; i++) {
            const label = `${groupLetter}${i + 1}`; // A1, A2...
            const spId = labelToId[label];
            if (!spId) {
              console.warn(`No stage_participant found for label ${label}`);
              continue;
            }

            await stageService.updateStageParticipant(spId, {
              participant_id: qualifiedTeams[i].participant_id,
            });
          }
        }
      }
    }

    // If not a group stage match (can be final stage)
    else {
      if (updatedMatch.state === "completed") {
        const matchRes = await client.query(
          `SELECT * FROM matches WHERE player1_prereq_match_id = $1 OR player2_prereq_match_id = $1`,
          [updatedMatch.id]
        );

        const match = matchRes.rows[0];

        if (match) {
          // Determine the winner's stage player ID
          let winnerStagePlayerId = null;

          if (updatedMatch.winner_id === updatedMatch.player1_id) {
            winnerStagePlayerId = updatedMatch.stage_player1_id;
          } else if (updatedMatch.winner_id === updatedMatch.player2_id) {
            winnerStagePlayerId = updatedMatch.stage_player2_id;
          }

          if (!winnerStagePlayerId) {
            throw new Error("Could not determine winner's stage player ID");
          }

          // Update the next match depending on prereq position
          if (updatedMatch.id === match.player1_prereq_match_id) {
            const updatedMatchPreReqRes = await client.query(
              `UPDATE matches SET player1_id = $1, stage_player1_id = $2 WHERE id = $3 RETURNING *`,
              [updatedMatch.winner_id, winnerStagePlayerId, match.id]
            );
            console.log(
              "✅ Updated match (player1):",
              updatedMatchPreReqRes.rows[0]
            );
          } else if (updatedMatch.id === match.player2_prereq_match_id) {
            const updatedMatchPreReqRes = await client.query(
              `UPDATE matches SET player2_id = $1, stage_player2_id = $2 WHERE id = $3 RETURNING *`,
              [updatedMatch.winner_id, winnerStagePlayerId, match.id]
            );
            console.log(
              "✅ Updated match (player2):",
              updatedMatchPreReqRes.rows[0]
            );
          }
        } else {
          console.log(
            "ℹ️ No match found for prereq match ID:",
            updatedMatch.id
          );
        }
      }
    }
    await client.query("COMMIT");
    return updatedMatch;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

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

module.exports = {
  getAllMatches,
  getMatchesByTournamentId,
  getMatchById,
  getMatchesByStageId,
  createMatch,
  updateMatch,
  generateMatchesForGroupStage,
};
