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

  // ──────────────────────────────────────────────
  // Helpers (mirror frontend logic)
  // ──────────────────────────────────────────────
  const nextPowerOfTwo = (n) => (n <= 1 ? 1 : 1 << Math.ceil(Math.log2(n)));
  const prevPowerOfTwo = (n) => (n <= 1 ? 1 : 1 << Math.floor(Math.log2(n)));

  const getBracketConfig = (N) => {
    const prevPow = prevPowerOfTwo(N);
    const nextPow = nextPowerOfTwo(N);

    if (N === prevPow) {
      return { bracketSize: prevPow, usePlayIns: false, playInCount: 0 };
    }

    const diffPrev = N - prevPow;
    const diffNext = nextPow - N;

    if (diffPrev < diffNext) {
      // e.g. 18 → 16-slot bracket + play-ins
      return {
        bracketSize: prevPow,
        usePlayIns: true,
        playInCount: diffPrev * 2,
      };
    }

    // otherwise larger 2^k with byes
    return { bracketSize: nextPow, usePlayIns: false, playInCount: 0 };
  };

  try {
    await client.query("BEGIN");

    // ──────────────────────────────────────────────
    // Final stage
    // ──────────────────────────────────────────────
    const stages = await getStagesByTournamentId(tournamentId);
    const finalStage = stages.find((s) => s.name === "Final Stage");
    if (!finalStage) {
      throw new Error(
        `Final Stage not found for tournament ID ${tournamentId}`
      );
    }
    const stageId = finalStage.id;

    // total participants as sent from frontend draft
    const N =
      draft?.totalParticipants ||
      draft?.rounds?.[0]?.matches?.reduce(
        (acc, m) => acc + (m.player1 ? 1 : 0) + (m.player2 ? 1 : 0),
        0
      ) ||
      0;
    if (!N) throw new Error("Draft has no participants");

    const { bracketSize, usePlayIns } = getBracketConfig(N);

    // ──────────────────────────────────────────────
    // stage_participants (idempotent)
    // ──────────────────────────────────────────────
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

            if (res.rows[0]?.id) {
              participantToStageId[p.id] = res.rows[0].id;
            } else {
              const found = await client.query(
                `SELECT id FROM stage_participants
                 WHERE stage_id = $1 AND participant_id = $2
                 LIMIT 1`,
                [stageId, p.id]
              );
              participantToStageId[p.id] = found.rows[0].id;
            }
          }
        }
      }
    }

    // ──────────────────────────────────────────────
    // Build matches round by round
    // ──────────────────────────────────────────────
    let prevRoundMatchIds = [];

    for (let r = 0; r < draft.rounds.length; r++) {
      const round = draft.rounds[r];
      const roundNumber = round.round;
      const roundName = getRoundName(roundNumber, draft.rounds.length);

      const currentRoundMatchIds = [];
      const prevCount = prevRoundMatchIds.length;
      const currCount = round.matches.length;

      const isFirstRound = prevCount === 0;
      // When we are using play-ins:
      // round index 0  → play-ins
      // round index 1  → main bracket (fed by play-ins)
      const isPlayInMainRound = usePlayIns && r === 1;

      for (let m = 0; m < currCount; m++) {
        const match = round.matches[m];

        let p1_stage = match.player1?.id
          ? participantToStageId[match.player1.id]
          : null;
        let p2_stage = match.player2?.id
          ? participantToStageId[match.player2.id]
          : null;

        let p1_prereq = null;
        let p2_prereq = null;

        if (isFirstRound) {
          // No prereqs in first round; use stage ids as set in draft
        } else if (isPlayInMainRound) {
          // We are in the round *after* the play-ins.
          // Front-end generatePlayInBracket builds it so:
          //   - playIns are round[0]
          //   - main bracket is round[1]
          //   - for the first P matches: one side is a seed, the other is null (waiting for play-in winner)
          //
          // So: each previous match i feeds into current match i on the null side.
          const sourceMatchId = prevRoundMatchIds[m];

          if (sourceMatchId != null) {
            if (!p1_stage) {
              p1_prereq = sourceMatchId;
            } else if (!p2_stage) {
              p2_prereq = sourceMatchId;
            }
          }

          if (p1_prereq) p1_stage = null;
          if (p2_prereq) p2_stage = null;
        } else {
          // Normal knock-out progression (no play-ins in this step)
          // Winners of two previous matches face each other.
          const base = m * 2;
          p1_prereq = prevRoundMatchIds[base] ?? null;
          p2_prereq = prevRoundMatchIds[base + 1] ?? null;

          if (p1_prereq) p1_stage = null;
          if (p2_prereq) p2_stage = null;
        }

        const leftName = match.player1?.name || "TBD";
        const rightName = match.player2?.name || "TBD";
        const identifier = `${leftName} vs ${rightName} (${roundName})`;

        const ins = await client.query(
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

        currentRoundMatchIds.push(ins.rows[0].id);
      }

      prevRoundMatchIds = currentRoundMatchIds;
    }

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
