const pool = require("../db");
const tournamentService = require("./tournament.service");

const createInitialStagesForTournament = async (
  client,
  tournamentId,
  tournamentType
) => {
  if (tournamentType === "round_robin") {
    await client.query(
      `INSERT INTO stages (tournament_id, name, type, order_index, is_current, created_at)
            VALUES ($1, 'Group Stage', 'round_robin', 0, true, NOW());
        `,
      [tournamentId]
    );

    await client.query(
      `INSERT INTO stages (tournament_id, name, type, order_index, is_current, created_at)
    VALUES ($1, 'Final Stage', 'elimination', 1, false, NOW());`,
      [tournamentId]
    );
  }
};

const getStagesByTournamentId = async (tournamentId) => {
  const result = await pool.query(
    `SELECT * FROM stages WHERE tournament_id = $1`,
    [tournamentId]
  );

  return result.rows;
};

// starting with final stage placeholders
// This function generates placeholders for the final stage based on the group stage participants
const generateFinalStagePlaceholders = async (tournamentId, clientt) => {
  const client = clientt || (await pool.connect());

  try {
    await client.query("BEGIN");

    // get stage id for final stage using tournament id
    const stages = await getStagesByTournamentId(tournamentId);
    const finalStage = stages.find((s) => s.name === "Final Stage");

    if (!finalStage) {
      throw new Error(
        `Final Stage not found for tournament ID ${tournamentId}`
      );
    }

    const stageId = finalStage.id;

    console.log(stageId);

    const groupStageIdRes = await client.query(
      `SELECT id FROM stages WHERE tournament_id = $1 AND type = 'round_robin'`,
      [tournamentId]
    );
    const groupStageId = groupStageIdRes.rows[0].id;

    const groupsRes = await client.query(
      `SELECT * FROM groups WHERE stage_id = $1 ORDER BY group_index ASC`,
      [groupStageId]
    );

    const groups = groupsRes.rows;
    const groupsCount = groups.length;

    // 1. Generate placeholders
    const participantPlaceholders = [];
    for (let i = 0; i < groupsCount; i++) {
      const groupChar = String.fromCharCode(65 + i); // A, B, C...
      participantPlaceholders.push(`${groupChar}1`);
      participantPlaceholders.push(`${groupChar}2`);
    }

    // 2. Insert into stage_participants and map label to ID
    const labelToId = {};
    for (const label of participantPlaceholders) {
      const res = await client.query(
        `INSERT INTO stage_participants (stage_id, participant_label) VALUES ($1, $2) RETURNING id`,
        [stageId, label]
      );
      labelToId[label] = res.rows[0].id;
    }

    // 3. First round pairs: A1 vs H2, B1 vs G2, etc.
    const matchPairs = [];
    for (let i = 0; i < groupsCount; i++) {
      const groupChar = String.fromCharCode(65 + i);
      const opponentChar = String.fromCharCode(65 + (groupsCount - 1 - i));
      matchPairs.push([`${groupChar}1`, `${opponentChar}2`]);
    }

    // Store match IDs for each round
    const rounds = [];

    // 4. Insert first round (round 1)
    const round1Matches = [];
    for (const [label1, label2] of matchPairs) {
      const res = await client.query(
        `INSERT INTO matches
         (stage_id, tournament_id, stage_player1_id, stage_player2_id, round, state, identifier, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, NOW(), NOW())
         RETURNING id`,
        [
          stageId,
          tournamentId,
          labelToId[label1],
          labelToId[label2],
          1,
          `${label1} vs ${label2}`,
        ]
      );
      round1Matches.push(res.rows[0].id);
    }

    rounds.push(round1Matches);

    // 5. Generate next rounds (semi-final, final) based on previous round
    let currentRound = 2;
    let previousRoundMatches = round1Matches;

    while (previousRoundMatches.length > 1) {
      const nextRoundMatches = [];

      for (let i = 0; i < previousRoundMatches.length; i += 2) {
        const prereq1 = previousRoundMatches[i];
        const prereq2 = previousRoundMatches[i + 1];

        const res = await client.query(
          `INSERT INTO matches
           (stage_id, tournament_id, player1_prereq_match_id, player2_prereq_match_id, round, state, identifier, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'pending', $6, NOW(), NOW())
           RETURNING id`,
          [
            stageId,
            tournamentId,
            prereq1,
            prereq2,
            currentRound,
            `Winner of M${prereq1} vs Winner of M${prereq2}`,
          ]
        );

        nextRoundMatches.push(res.rows[0].id);
      }

      rounds.push(nextRoundMatches);
      previousRoundMatches = nextRoundMatches;
      currentRound++;
    }

    await client.query("COMMIT");
    console.log(
      "✅ Final stage with full bracket (placeholders + empty rounds) generated."
    );
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error generating final stage placeholders:", err);
    throw err;
  } finally {
    // client.release();
  }
};

// stage participants db
const createStageParticipant = async ({
  stage_id,
  participant_label,
  participant_id = null,
}) => {
  const result = await pool.query(
    `INSERT INTO stage_participants (stage_id, participant_label, participant_id, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW()) RETURNING *`,
    [stage_id, participant_label, participant_id]
  );
  return result.rows[0];
};

const updateStageParticipant = async (id, updateData) => {
  if (Object.keys(updateData).length === 0) {
    throw new Error(`No Fields provided to update`);
  }

  const fields = [];
  const values = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updateData)) {
    fields.push(`${key} = $${idx}`);
    values.push(value);
    idx++;
  }

  values.push(id);

  fields.push(`updated_at = NOW()`);
  const query = `
    UPDATE stage_participants SET ${fields.join(
      ", "
    )} WHERE id = $${idx} RETURNING *;
  `;

  const result = await pool.query(query, values);
  return result.rows[0];
};

const getStageParticipantsByStageId = async (stageId) => {
  const result = await pool.query(
    `SELECT * FROM stage_participants WHERE stage_id = $1`,
    [stageId]
  );
  return result.rows;
};

module.exports = {
  createInitialStagesForTournament,
  getStagesByTournamentId,
  generateFinalStagePlaceholders,
  createStageParticipant,
  getStageParticipantsByStageId,
  updateStageParticipant,
};
