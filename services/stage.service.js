const pool = require("../db");
const { getSortedGroupStandings } = require("./group.service");
const tournamentService = require("./tournament.service");
const finalStageHelper = require("../helpers/finalStage.helper");

const createInitialStagesForTournament = async (
  client,
  tournamentId,
  tournamentFormat
) => {
  if (tournamentFormat === "round_robin") {
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
  } else if (tournamentFormat === "single") {
    await client.query(
      `INSERT INTO stages (tournament_id, name, type, order_index, is_current, created_at)
            VALUES ($1, 'Final Stage', 'single', 0, true, NOW());
        `,
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
const nextPowerOf2 = (n) => Math.pow(2, Math.ceil(Math.log2(n)));

// to switch final stage generation
async function generateFinalStage(tournamentId, client) {
  const clientConn = client || (await pool.connect());

  try {
    await clientConn.query("BEGIN");

    const { N, isStandard, groupCount, numAdvanced } =
      await finalStageHelper.getBracketTypeInfo(tournamentId, clientConn);

    console.log(`📊 ${groupCount} groups × ${numAdvanced} advancers = ${N}`);

    if (isStandard) {
      await finalStageHelper.generateFinalStagePlaceholders(
        tournamentId,
        clientConn
      );
    } else {
      await finalStageHelper.generateFinalStageSeedsPlaceholders(
        tournamentId,
        clientConn
      );
    }

    await clientConn.query("COMMIT");
  } catch (err) {
    await clientConn.query("ROLLBACK");
    throw err;
  } finally {
    if (!client) clientConn.release();
  }
}

// generate round placeholders
function getRoundName(roundNumber, totalRounds) {
  const roundNames = [
    "Round of 64",
    "Round of 32",
    "Round of 16",
    "Quarter Finals",
    "Semi Finals",
    "Final",
  ];

  // Calculate the index from the end (Final is last)
  const index = roundNames.length - (totalRounds - roundNumber + 1);

  if (index < 0) {
    // For very small tournaments (less than known rounds), fallback:
    if (totalRounds === 1) return "Final";
    if (totalRounds === 2) return roundNumber === 1 ? "Semi Finals" : "Final";
    if (totalRounds === 3) {
      return ["Quarter Finals", "Semi Finals", "Final"][roundNumber - 1];
    }
    return `Round ${roundNumber}`;
  }

  return roundNames[index];
}

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

// when confirming participants, save them
const saveKnockoutBracket = async (tournamentId, draft, clientt) => {
  const client = clientt || (await pool.connect());

  try {
    await client.query("BEGIN");

    // --- Get Final Stage ---
    const stages = await getStagesByTournamentId(tournamentId);
    const finalStage = stages.find((s) => s.name === "Final Stage");
    if (!finalStage)
      throw new Error(
        `Final Stage not found for tournament ID ${tournamentId}`
      );
    const stageId = finalStage.id;

    // --- Insert stage_participants for real participants ---
    const participantToStageId = {};
    for (const round of draft.rounds) {
      for (const match of round.matches) {
        for (const side of ["player1", "player2"]) {
          const p = match[side];
          if (p && p.id && !participantToStageId[p.id]) {
            const res = await client.query(
              `INSERT INTO stage_participants (stage_id, participant_id)
               VALUES ($1, $2)
               ON CONFLICT (stage_id, participant_id) DO NOTHING
               RETURNING id`,
              [stageId, p.id]
            );

            participantToStageId[p.id] =
              res.rows[0]?.id ||
              (
                await client.query(
                  `SELECT id FROM stage_participants WHERE stage_id = $1 AND participant_id = $2 LIMIT 1`,
                  [stageId, p.id]
                )
              ).rows[0].id;
          }
        }
      }
    }

    // ---- Build matches round by round ----------
    let prevRoundMatchIds = []; // IDs of previous round matches

    for (let r = 0; r < draft.rounds.length; r++) {
      const round = draft.rounds[r];
      const roundNumber = round.round;
      const roundName = getRoundName(roundNumber, draft.rounds.length);

      const currentRoundMatchIds = [];

      for (let m = 0; m < round.matches.length; m++) {
        const match = round.matches[m];

        let p1_stage = match.player1
          ? participantToStageId[match.player1.id]
          : null;
        let p2_stage = match.player2
          ? participantToStageId[match.player2.id]
          : null;
        let p1_prereq = null;
        let p2_prereq = null;

        if (r === 1) {
          // ROUND 2: assign prereqs only for player2 if previous round exists
          if (!match.player2 && prevRoundMatchIds[m] != null) {
            p2_prereq = prevRoundMatchIds[m]; // winner of corresponding round 1 match
            p2_stage = null;
          }
          // player1 is the seed who had bye, keep as stage_player1_id
        } else if (r > 1) {
          // Later rounds: both sides may be winners of previous matches
          const prevIndex = m * 2;
          p1_prereq = prevRoundMatchIds[prevIndex] || null;
          p2_prereq = prevRoundMatchIds[prevIndex + 1] || null;
          p1_stage = null;
          p2_stage = null;
        }

        const identifier = `${match.player1?.name || "TBD"} vs ${
          match.player2?.name || "TBD"
        } (${roundName})`;

        const res = await client.query(
          `INSERT INTO matches
             (stage_id, tournament_id,
              stage_player1_id, stage_player2_id,
              player1_prereq_match_id, player2_prereq_match_id,
              round, state, identifier, created_at, updated_at, round_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,NOW(),NOW(),$9)
           RETURNING id`,
          [
            stageId,
            tournamentId,
            p1_stage,
            p2_stage,
            p1_prereq,
            p2_prereq,
            roundNumber,
            identifier,
            roundName,
          ]
        );

        currentRoundMatchIds.push(res.rows[0].id);
      }

      prevRoundMatchIds = currentRoundMatchIds;
    }

    // await finalStageHelper.computeAndApplySeeds(tournamentId);

    await client.query("COMMIT");
    console.log("✅ Knockout bracket saved successfully!");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error saving knockout bracket:", err);
    throw err;
  } finally {
    if (!clientt) client.release();
  }
};

const getStageParticipantsByStageId = async (stageId) => {
  const result = await pool.query(
    `SELECT * FROM stage_participants WHERE stage_id = $1`,
    [stageId]
  );
  return result.rows;
};

const deleteStagesByTournamentId = async (tournamentId, client) => {
  try {
    const result = await client.query(
      "DELETE FROM stages WHERE tournament_id = $1",
      [tournamentId]
    );
    return result.rowCount;
  } catch (error) {
    throw error;
  }
};

module.exports = {
  createInitialStagesForTournament,
  getStagesByTournamentId,
  createStageParticipant,
  generateFinalStage,
  getStageParticipantsByStageId,
  updateStageParticipant,
  deleteStagesByTournamentId,
  saveKnockoutBracket,
};
