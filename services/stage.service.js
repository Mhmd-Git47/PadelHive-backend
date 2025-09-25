const pool = require("../db");
const tournamentService = require("./tournament.service");

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

const generateFinalStagePlaceholders = async (tournamentId, clientt) => {
  const client = clientt || (await pool.connect());

  // ---- helpers ------------------------------------------------------------
  const nextPowerOfTwo = (n) => (n <= 1 ? 1 : 1 << Math.ceil(Math.log2(n)));

  // Standard balanced seeding order for a 2^k bracket.
  // Returns an array (length = bracketSize) of seed numbers arranged in bracket order.
  // Example:
  //   size=8  -> [1,8,4,5,2,7,3,6]
  //   size=16 -> [1,16,8,9,5,12,4,13,3,14,6,11,7,10,2,15]
  const buildSeedingOrder = (bracketSize) => {
    let order = [1];
    let size = 1;
    while (size < bracketSize) {
      const next = [];
      const mirror = size * 2 + 1;
      for (const s of order) {
        next.push(s);
        next.push(mirror - s);
      }
      order = next;
      size *= 2;
    }
    return order;
  };

  try {
    await client.query("BEGIN");

    // --- Get final stage ---
    const stages = await getStagesByTournamentId(tournamentId);
    const finalStage = stages.find((s) => s.name === "Final Stage");
    if (!finalStage)
      throw new Error(
        `Final Stage not found for tournament ID ${tournamentId}`
      );
    const stageId = finalStage.id;

    // --- Get group stage ---
    const groupStageIdRes = await client.query(
      `SELECT id FROM stages WHERE tournament_id = $1 AND type = 'round_robin'`,
      [tournamentId]
    );
    const groupStageId = groupStageIdRes.rows?.[0]?.id;
    if (!groupStageId) throw new Error("Group stage not found");

    // --- Get groups (only to know how many) ---
    const groupsRes = await client.query(
      `SELECT * FROM groups WHERE stage_id = $1 ORDER BY group_index ASC`,
      [groupStageId]
    );
    const groups = groupsRes.rows;
    const groupsCount = groups.length;

    // --- How many from each group advance ---
    const tournamentRes = await client.query(
      `SELECT participants_advance FROM tournaments WHERE id = $1`,
      [tournamentId]
    );
    const numAdvanced = Number(tournamentRes.rows[0].participants_advance || 0);
    if (!numAdvanced || groupsCount === 0) {
      throw new Error("No advancing rule or no groups available.");
    }

    // --- Generate participant placeholders in *seed order* (your current order) ---
    // This preserves the behavior that "even counts already looked right."
    const participantPlaceholders = [];
    for (let i = 0; i < groupsCount; i++) {
      const groupChar = String.fromCharCode(65 + i); // A, B, C ...
      for (let j = 1; j <= numAdvanced; j++) {
        participantPlaceholders.push(`${groupChar}${j}`);
      }
    }
    const N = participantPlaceholders.length;
    if (N === 0) throw new Error("No participants advanced from groups.");

    // --- Insert placeholders into stage_participants and keep an ID map ---
    const labelToId = {};
    for (const label of participantPlaceholders) {
      const res = await client.query(
        `INSERT INTO stage_participants (stage_id, participant_label)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [stageId, label]
      );

      // If ON CONFLICT hit, fetch the existing id
      if (!res.rows[0]) {
        const existing = await client.query(
          `SELECT id FROM stage_participants WHERE stage_id = $1 AND participant_label = $2 LIMIT 1`,
          [stageId, label]
        );
        labelToId[label] = existing.rows[0].id;
      } else {
        labelToId[label] = res.rows[0].id;
      }
    }

    // ---- Build bracket slots with proper bye distribution -----------------
    const M = nextPowerOfTwo(N); // full bracket size
    const totalRounds = Math.log2(M); // total rounds in a power-of-two bracket
    const seedOrder = buildSeedingOrder(M); // where each seed number sits

    // Fill slots with participant labels or null (BYE)
    // seed #k corresponds to participantPlaceholders[k-1]
    const slots = Array.from({ length: M }, (_, idx) => {
      const seedNum = seedOrder[idx];
      return seedNum <= N ? participantPlaceholders[seedNum - 1] : null;
    });

    // ---- Round 1 construction --------------------------------------------
    // Pair adjacent slots: (0,1), (2,3), ... If one side is BYE, the other advances to Round 2.
    const round1Pairs = [];
    for (let i = 0; i < M; i += 2) {
      round1Pairs.push([slots[i], slots[i + 1]]); // entries may be null
    }

    const round1MatchIds = new Array(round1Pairs.length).fill(null); // index-aligned with pairs
    const round2Sources = Array.from(
      { length: Math.ceil(round1Pairs.length / 2) },
      () => ({
        p1: null, // { type: 'match'|'seed', id: number, label?: string }
        p2: null,
      })
    );

    // Insert actual Round 1 matches (only where both sides are real)
    const round1Name = getRoundName(1, totalRounds);
    for (let i = 0; i < round1Pairs.length; i++) {
      const [L, R] = round1Pairs[i]; // labels or null
      const bothReal = L && R;

      if (bothReal) {
        const res = await client.query(
          `INSERT INTO matches
             (stage_id, tournament_id, stage_player1_id, stage_player2_id, round, state, identifier, created_at, updated_at, round_name)
           VALUES ($1, $2, $3, $4, $5, 'pending', $6, NOW(), NOW(), $7)
           RETURNING id`,
          [
            stageId,
            tournamentId,
            labelToId[L],
            labelToId[R],
            1,
            `${L} vs ${R} (${round1Name})`,
            round1Name,
          ]
        );
        round1MatchIds[i] = res.rows[0].id;
      }

      // Feed Round 2 sources:
      const parentIndex = Math.floor(i / 2);
      const side = i % 2 === 0 ? "p1" : "p2";

      if (bothReal) {
        round2Sources[parentIndex][side] = {
          type: "match",
          id: round1MatchIds[i],
        };
      } else {
        // One side is BYE → the real participant (if any) advances directly to Round 2
        const advLabel = L || R; // one of them could be null
        if (advLabel) {
          round2Sources[parentIndex][side] = {
            type: "seed",
            id: labelToId[advLabel],
            label: advLabel,
          };
        } else {
          // Both null shouldn't happen, but guard anyway.
          round2Sources[parentIndex][side] = null;
        }
      }
    }

    // ---- Round 2 construction (mix of winners or direct seeds from byes) -
    const round2MatchIds = [];
    if (round2Sources.length > 0) {
      const round2Name = getRoundName(2, totalRounds);
      for (let i = 0; i < round2Sources.length; i++) {
        const s = round2Sources[i];

        const p1_prereq = s.p1?.type === "match" ? s.p1.id : null;
        const p2_prereq = s.p2?.type === "match" ? s.p2.id : null;
        const p1_stage = s.p1?.type === "seed" ? s.p1.id : null;
        const p2_stage = s.p2?.type === "seed" ? s.p2.id : null;

        const leftText = s.p1
          ? s.p1.type === "match"
            ? `Winner of M${s.p1.id}`
            : s.p1.label
          : "TBD";
        const rightText = s.p2
          ? s.p2.type === "match"
            ? `Winner of M${s.p2.id}`
            : s.p2.label
          : "TBD";

        const res = await client.query(
          `INSERT INTO matches
             (stage_id, tournament_id, player1_prereq_match_id, player2_prereq_match_id, stage_player1_id, stage_player2_id,
              round, state, identifier, created_at, updated_at, round_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, NOW(), NOW(), $9)
           RETURNING id`,
          [
            stageId,
            tournamentId,
            p1_prereq,
            p2_prereq,
            p1_stage,
            p2_stage,
            2,
            `${leftText} vs ${rightText} (${round2Name})`,
            round2Name,
          ]
        );

        round2MatchIds.push(res.rows[0].id);
      }
    }

    // ---- Rounds 3..final: pure winners-vs-winners (no more byes) ----------
    let currentRound = 3;
    let previousRoundMatchIds = round2MatchIds;
    while (previousRoundMatchIds.length > 1) {
      const nextRoundMatchIds = [];
      const roundName = getRoundName(currentRound, totalRounds);

      for (let i = 0; i < previousRoundMatchIds.length; i += 2) {
        const leftMatch = previousRoundMatchIds[i];
        const rightMatch = previousRoundMatchIds[i + 1] || null; // if odd, last gets a free pass

        const leftText = `Winner of M${leftMatch}`;
        const rightText = rightMatch ? `Winner of M${rightMatch}` : "BYE";

        const res = await client.query(
          `INSERT INTO matches
             (stage_id, tournament_id, player1_prereq_match_id, player2_prereq_match_id, round, state, identifier, created_at, updated_at, round_name)
           VALUES ($1, $2, $3, $4, $5, 'pending', $6, NOW(), NOW(), $7)
           RETURNING id`,
          [
            stageId,
            tournamentId,
            leftMatch,
            rightMatch,
            currentRound,
            `${leftText} vs ${rightText} (${roundName})`,
            roundName,
          ]
        );

        nextRoundMatchIds.push(res.rows[0].id);
      }

      previousRoundMatchIds = nextRoundMatchIds;
      currentRound++;
    }

    await client.query("COMMIT");
    console.log(
      "✅ Final stage generated with correct byes & bracket structure."
    );
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error generating final stage placeholders:", err);
    throw err;
  } finally {
    // client.release();
  }
};

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
  generateFinalStagePlaceholders,
  createStageParticipant,
  getStageParticipantsByStageId,
  updateStageParticipant,
  deleteStagesByTournamentId,
  saveKnockoutBracket,
};
