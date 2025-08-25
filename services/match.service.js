const pool = require("../db");
const {
  checkMatchesCompleted,
  updateEloForDoublesMatch,
} = require("../helpers/match.helper");
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
    console.log("Running update query:", updateQuery);
    console.log("With values:", values);

    // Update the match
    const result = await client.query(updateQuery, values);
    const updatedMatch = result.rows[0];
    if (!updatedMatch) {
      throw new Error(`No match found with id ${id} to update`);
    }
    console.log("Match updated successfully:", updatedMatch);

    if (updatedMatch.state === "completed" && updatedMatch.winner_id) {
      console.log("Match completed, updating Elo ratings...");
      await updateEloForDoublesMatch(updatedMatch, client);
      console.log("Elo ratings updated.");
    }

    if (updatedMatch.group_id !== null) {
      console.log("Match is in group stage, checking group completion...");
      if (updatedMatch.group_id) {
        const groupMatchesRes = await client.query(
          `SELECT * FROM matches WHERE group_id = $1 ORDER BY round, id`,
          [updatedMatch.group_id]
        );
        const groupMatches = groupMatchesRes.rows;
        console.log(
          `Found ${groupMatches.length} matches in group ${updatedMatch.group_id}`
        );

        const allCompleted = groupMatches.every((m) => m.state === "completed");
        console.log("All group matches completed?", allCompleted);

        if (allCompleted) {
          console.log(
            "All matches completed in group, updating group state..."
          );
          await groupService.updateGroup(
            updatedMatch.group_id,
            { state: "completed", completed_at: new Date() },
            client
          );
          console.log("Group marked as completed.");

          // Calculate group standings
          const participantStats = {};
          groupMatches.forEach((match) => {
            const { player1_id, player2_id, winner_id, scores_csv } = match;
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

          const ranked = Object.values(participantStats).map((p) => ({
            ...p,
            matchDiff: p.pointsFor - p.pointsAgainst,
          }));

          ranked.sort((a, b) => {
            if (b.wins !== a.wins) return b.wins - a.wins;
            if (b.matchDiff !== a.matchDiff) return b.matchDiff - a.matchDiff;
            return b.pointsFor - a.pointsFor;
          });

          console.log("Ranked participants:", ranked);

          const tournamentRes = await client.query(
            `SELECT participants_advance FROM tournaments WHERE id = $1`,
            [updatedMatch.tournament_id]
          );

          const tournament = tournamentRes.rows[0];

          const numAdvanced = tournament.participants_advance;
          const qualifiedTeams = ranked.slice(0, numAdvanced);
          console.log("Qualified teams:", qualifiedTeams);

          const groupRes = await client.query(
            `SELECT * FROM groups WHERE id = $1`,
            [updatedMatch.group_id]
          );
          const group = groupRes.rows[0];
          if (!group) {
            throw new Error(`Group with id ${updatedMatch.group_id} not found`);
          }
          const groupLetter = String.fromCharCode(65 + group.group_index);
          console.log("Group letter:", groupLetter);

          const finalStageRes = await client.query(
            `SELECT id FROM stages WHERE tournament_id = $1 AND name = 'Final Stage' LIMIT 1`,
            [updatedMatch.tournament_id]
          );
          const finalStageId = finalStageRes.rows[0]?.id;
          console.log(`Final Stage ID: ${finalStageId}`);
          if (!finalStageId) throw new Error("Final stage not found");

          const spRes = await client.query(
            `SELECT id, participant_label FROM stage_participants WHERE stage_id = $1`,
            [finalStageId]
          );
          const labelToId = {};
          for (const row of spRes.rows) {
            labelToId[row.participant_label] = row.id;
          }
          console.log("Stage participants label to ID map:", labelToId);

          for (let i = 0; i < qualifiedTeams.length; i++) {
            const label = `${groupLetter}${i + 1}`;
            const spId = labelToId[label];
            if (!spId) {
              console.warn(`No stage_participant found for label ${label}`);
              continue;
            }

            console.log(
              `Updating stage_participant ${spId} with participant ${qualifiedTeams[i].participant_id}`
            );
            await stageService.updateStageParticipant(spId, {
              participant_id: qualifiedTeams[i].participant_id,
            });
          }
          console.log("Stage participants updated.");
        }
      }
    } else {
      // 🏆 Final Stage (group_id is null)
      if (updatedMatch.state === "completed") {
        const matchRes = await client.query(
          `SELECT * FROM matches WHERE player1_prereq_match_id = $1 OR player2_prereq_match_id = $1`,
          [updatedMatch.id]
        );

        const nextMatch = matchRes.rows[0];
        console.log("Next match based on prereq:", nextMatch);

        if (nextMatch) {
          let winnerStagePlayerId = null;
          if (updatedMatch.winner_id === updatedMatch.player1_id) {
            winnerStagePlayerId = updatedMatch.stage_player1_id;
          } else if (updatedMatch.winner_id === updatedMatch.player2_id) {
            winnerStagePlayerId = updatedMatch.stage_player2_id;
          }

          if (!winnerStagePlayerId) {
            throw new Error("Could not determine winner's stage player ID");
          }

          if (updatedMatch.id === nextMatch.player1_prereq_match_id) {
            const updatedNextMatchRes = await client.query(
              `UPDATE matches SET player1_id = $1, stage_player1_id = $2 WHERE id = $3 RETURNING *`,
              [updatedMatch.winner_id, winnerStagePlayerId, nextMatch.id]
            );
            console.log(
              "✅ Updated next match (player1):",
              updatedNextMatchRes.rows[0]
            );
          } else if (updatedMatch.id === nextMatch.player2_prereq_match_id) {
            const updatedNextMatchRes = await client.query(
              `UPDATE matches SET player2_id = $1, stage_player2_id = $2 WHERE id = $3 RETURNING *`,
              [updatedMatch.winner_id, winnerStagePlayerId, nextMatch.id]
            );
            console.log(
              "✅ Updated next match (player2):",
              updatedNextMatchRes.rows[0]
            );
          }
        } else {
          console.log(
            "ℹ️ No next match found for prereq match ID:",
            updatedMatch.id
          );
        }

        const stageMatchesRes = await client.query(
          `SELECT * FROM matches WHERE stage_id = $1`,
          [updatedMatch.stage_id]
        );

        const stageMatches = stageMatchesRes.rows;

        const allStageCompleted = stageMatches.every(
          (m) => m.state === "completed"
        );

        // if all matches have completed state, update stage and tournament to have completed state
        if (allStageCompleted) {
          await client.query(
            `UPDATE stages SET state = 'completed', completed_at = NOW() WHERE id = $1`,
            [updatedMatch.stage_id]
          );

          await client.query(
            `UPDATE tournaments SET state = 'completed', completed_at = NOW() WHERE id = $1`,
            [updatedMatch.tournament_id]
          );
        }
      }
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
