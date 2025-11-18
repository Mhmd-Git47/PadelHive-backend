const pool = require("../db");

const getStagesByTournamentId = async (tournamentId) => {
  const result = await pool.query(
    `SELECT * FROM stages WHERE tournament_id = $1`,
    [tournamentId]
  );

  return result.rows;
};

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

const generateFinalStageSeedsPlaceholders = async (tournamentId, clientt) => {
  const client = clientt || (await pool.connect());

  // --------------------------------------------------------------------------
  // 🧩 Helpers
  // --------------------------------------------------------------------------
  const nextPowerOfTwo = (n) => (n <= 1 ? 1 : 1 << Math.ceil(Math.log2(n)));
  const prevPowerOfTwo = (n) => (n <= 1 ? 1 : 1 << Math.floor(Math.log2(n)));

  // ✅ Decide if play-ins or byes should be used
  const getBracketConfig = (N) => {
    const prevPow = prevPowerOfTwo(N);
    const nextPow = nextPowerOfTwo(N);
    if (N === prevPow)
      return { bracketSize: prevPow, usePlayIns: false, playInCount: 0 };

    const diffPrev = N - prevPow;
    const diffNext = nextPow - N;

    if (diffPrev < diffNext) {
      // Example: 18 → use 16-slot bracket with play-ins
      return {
        bracketSize: prevPow,
        usePlayIns: true,
        playInCount: diffPrev * 2, // number of players in play-ins
      };
    }

    // Example: 10 → use 16 with byes
    return { bracketSize: nextPow, usePlayIns: false, playInCount: 0 };
  };

  // ✅ Balanced seeding pattern (standard 2^k)
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

  // ✅ Round naming
  const nameRound = (round, totalRounds) => {
    if (round === 1) return "Play-In";
    if (round === 2) return "Round of 16";
    if (round === totalRounds) return "Final";
    if (round === totalRounds - 1) return "Semi-Final";
    if (round === totalRounds - 2) return "Quarter-Final";
    return `Round ${round}`;
  };
  const getRoundNameSafe = (r, t) =>
    typeof getRoundName === "function" ? getRoundName(r, t) : nameRound(r, t);

  // --------------------------------------------------------------------------
  try {
    await client.query("BEGIN");

    // --- Get final stage ---
    const stages = await getStagesByTournamentId(tournamentId);
    const finalStage = stages.find((s) => s.name === "Final Stage");
    if (!finalStage)
      throw new Error(`Final Stage not found for tournament ${tournamentId}`);
    const stageId = finalStage.id;

    // --- Get group stage ---
    const groupStageIdRes = await client.query(
      `SELECT id FROM stages WHERE tournament_id=$1 AND type='round_robin'`,
      [tournamentId]
    );
    const groupStageId = groupStageIdRes.rows?.[0]?.id;
    if (!groupStageId) throw new Error("Group stage not found");

    const groupsRes = await client.query(
      `SELECT id, group_index FROM groups WHERE stage_id=$1 ORDER BY group_index ASC`,
      [groupStageId]
    );
    const groups = groupsRes.rows;
    if (groups.length === 0) throw new Error("No groups found");

    const tournamentRes = await client.query(
      `SELECT participants_advance FROM tournaments WHERE id=$1`,
      [tournamentId]
    );
    const numAdvanced = Number(
      tournamentRes.rows?.[0]?.participants_advance || 0
    );
    if (!numAdvanced) throw new Error("No advancing rule configured");

    const N = groups.length * numAdvanced;
    if (N < 2) throw new Error("Not enough qualifiers for knockout");

    // ------------------------------------------------------------------------
    // 🌱 Create stage_participants placeholders
    // ------------------------------------------------------------------------
    const seedLabels = Array.from({ length: N }, (_, i) => `Seed${i + 1}`);
    const labelToId = {};

    for (let i = 0; i < seedLabels.length; i++) {
      const label = seedLabels[i];
      const ins = await client.query(
        `INSERT INTO stage_participants (stage_id, participant_label, placeholder_label, seed, created_at)
         VALUES ($1,$2,$3,$4,NOW())
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [stageId, label, label, i + 1]
      );

      if (ins.rows?.[0]?.id) {
        labelToId[label] = ins.rows[0].id;
      } else {
        const existing = await client.query(
          `SELECT id FROM stage_participants WHERE stage_id=$1 AND seed=$2 LIMIT 1`,
          [stageId, i + 1]
        );
        labelToId[label] = existing.rows[0].id;
      }
    }

    // ------------------------------------------------------------------------
    // ⚖️ Determine bracket configuration
    // ------------------------------------------------------------------------
    const { bracketSize, usePlayIns, playInCount } = getBracketConfig(N);
    const P = usePlayIns ? N - bracketSize : 0; // number of play-in matches

    let playInMatchIds = [];
    let mainBracketN = bracketSize;

    // ------------------------------------------------------------------------
    // 🎯 Create play-in matches dynamically
    // ------------------------------------------------------------------------
    if (usePlayIns && P > 0) {
      const playersInPlayIns = P * 2;
      const firstPlayInSeed = N - playersInPlayIns + 1; // e.g., 15 for N=18
      const lastPlayInSeed = N; // e.g., 18
      const firstReplacedSeed = bracketSize - P + 1; // 15 (for 18)
      const lastReplacedSeed = bracketSize; // 16

      for (let i = 0; i < P; i++) {
        const higherAmongBottom = firstReplacedSeed + i; // 15, 16
        const lowestSeed = lastPlayInSeed - i; // 18, 17
        const sA = `Seed${higherAmongBottom}`;
        const sB = `Seed${lowestSeed}`;

        const res = await client.query(
          `INSERT INTO matches
             (stage_id, tournament_id, stage_player1_id, stage_player2_id,
              round, state, identifier, created_at, updated_at, round_name)
           VALUES ($1,$2,$3,$4,1,'pending',$5,NOW(),NOW(),'Play-In')
           RETURNING id`,
          [
            stageId,
            tournamentId,
            labelToId[sA],
            labelToId[sB],
            `Play-In #${i + 1}: ${sA} vs ${sB}`,
          ]
        );
        playInMatchIds.push(res.rows[0].id);
      }
    }

    // ------------------------------------------------------------------------
    // 🏗️ Build main knockout bracket
    // ------------------------------------------------------------------------
    const M = nextPowerOfTwo(mainBracketN);
    const totalRounds = Math.log2(M) + (usePlayIns ? 1 : 0);
    const seedOrder = buildSeedingOrder(M);

    const firstReplacedSeed = bracketSize - P + 1;
    const lastReplacedSeed = bracketSize;

    const seedNumToLabel = (seedNum) => {
      if (seedNum > N) return null;
      if (
        P > 0 &&
        seedNum >= firstReplacedSeed &&
        seedNum <= lastReplacedSeed
      ) {
        const idx = seedNum - firstReplacedSeed + 1;
        return `Winner Play-In #${idx}`;
      }
      return `Seed${seedNum}`;
    };

    const slots = Array.from({ length: M }, (_, i) =>
      seedNumToLabel(seedOrder[i])
    );
    const startRound = usePlayIns ? 2 : 1;
    const firstRoundName = getRoundNameSafe(startRound, totalRounds);
    const firstRoundMatchIds = [];

    for (let i = 0; i < M; i += 2) {
      const L = slots[i];
      const R = slots[i + 1];
      if (!L && !R) {
        firstRoundMatchIds.push(null);
        continue;
      }

      const resolveSide = (label) => {
        if (!label) return { stage: null, prereq: null, text: "BYE" };
        if (label.startsWith("Winner Play-In")) {
          const idx = Number(label.match(/\d+/)[0]) - 1;
          return { stage: null, prereq: playInMatchIds[idx], text: label };
        }
        return { stage: labelToId[label], prereq: null, text: label };
      };

      const Ls = resolveSide(L);
      const Rs = resolveSide(R);

      const ins = await client.query(
        `INSERT INTO matches
           (stage_id, tournament_id,
            player1_prereq_match_id, player2_prereq_match_id,
            stage_player1_id, stage_player2_id,
            round, state, identifier, created_at, updated_at, round_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,NOW(),NOW(),$9)
         RETURNING id`,
        [
          stageId,
          tournamentId,
          Ls.prereq,
          Rs.prereq,
          Ls.stage,
          Rs.stage,
          startRound,
          `${Ls.text} vs ${Rs.text} (${firstRoundName})`,
          firstRoundName,
        ]
      );
      firstRoundMatchIds.push(ins.rows[0].id);
    }

    // ------------------------------------------------------------------------
    // 🔁 Build later rounds
    // ------------------------------------------------------------------------
    let currentRound = startRound + 1;
    let prevIds = firstRoundMatchIds.filter(Boolean);
    while (prevIds.length > 1) {
      const nextIds = [];
      const roundName = getRoundNameSafe(currentRound, totalRounds);

      for (let i = 0; i < prevIds.length; i += 2) {
        const left = prevIds[i];
        const right = prevIds[i + 1] || null;

        const ins = await client.query(
          `INSERT INTO matches
             (stage_id, tournament_id,
              player1_prereq_match_id, player2_prereq_match_id,
              round, state, identifier, created_at, updated_at, round_name)
           VALUES ($1,$2,$3,$4,$5,'pending',$6,NOW(),NOW(),$7)
           RETURNING id`,
          [
            stageId,
            tournamentId,
            left,
            right,
            currentRound,
            `Winner of M${left} vs ${right ? `Winner of M${right}` : "BYE"}`,
            roundName,
          ]
        );
        nextIds.push(ins.rows[0].id);
      }

      prevIds = nextIds;
      currentRound++;
    }

    await client.query("COMMIT");
    console.log("✅ Dynamic knockout bracket generated successfully.");
    await autoAdvanceByeMatches(tournamentId, client);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Bracket generation failed:", err);
    throw err;
  } finally {
    // client.release();
  }
};

// auto advance byes
const autoAdvanceByeMatches = async (tournamentId, client) => {
  console.log("🔁 Auto-advancing BYE matches...");

  const matchesRes = await client.query(
    `SELECT id, stage_player1_id, stage_player2_id
     FROM matches
     WHERE tournament_id = $1 AND state = 'pending' AND round = $2`,
    [tournamentId, 1]
  );

  const now = new Date().toISOString();

  for (const match of matchesRes.rows) {
    const { id, stage_player1_id, stage_player2_id } = match;

    // 🧠 Detect BYE
    if (!stage_player1_id && !stage_player2_id) continue; // invalid slot
    if (stage_player1_id && stage_player2_id) continue; // both filled, normal match

    const winner = stage_player1_id || stage_player2_id;
    if (!winner) continue; // sanity check

    try {
      // ✅ 1. Mark the BYE match as completed
      await client.query(
        `UPDATE matches
         SET state = 'completed',
             completed_at = $1
         WHERE id = $2`,
        [now, id]
      );

      // ✅ 2. Auto-advance the winner to their next match
      await client.query(
        `UPDATE matches
         SET stage_player1_id = COALESCE(stage_player1_id, $1)
         WHERE player1_prereq_match_id = $2`,
        [winner, id]
      );

      await client.query(
        `UPDATE matches
         SET stage_player2_id = COALESCE(stage_player2_id, $1)
         WHERE player2_prereq_match_id = $2`,
        [winner, id]
      );

      console.log(`✅ Match ${id} auto-completed (BYE → Seed ${winner})`);
    } catch (err) {
      console.error(`❌ Failed to auto-advance match ${id}:`, err.message);
    }
  }
};

function nextPowerOfTwo(n) {
  return n <= 1 ? 1 : 1 << Math.ceil(Math.log2(n));
}

/** Build seeding order (standard mirrored pattern) */
function buildSeedingOrder(bracketSize) {
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
}

/** Human-friendly round naming */
function getRoundName(roundNumber, totalRounds) {
  const roundNames = [
    "Round of 64",
    "Round of 32",
    "Round of 16",
    "Quarter Finals",
    "Semi Finals",
    "Final",
  ];
  const index = roundNames.length - (totalRounds - roundNumber + 1);

  if (index < 0) {
    // fallback for smaller tournaments
    if (totalRounds === 1) return "Final";
    if (totalRounds === 2) return roundNumber === 1 ? "Semi Finals" : "Final";
    if (totalRounds === 3)
      return ["Quarter Finals", "Semi Finals", "Final"][roundNumber - 1];
    return `Round ${roundNumber}`;
  }

  return roundNames[index];
}

// check if its standard (4, 8, 16) or dynamic
const getBracketTypeInfo = async (tournamentId, client) => {
  const clientConn = client || (await pool.connect());
  try {
    const { rows: tRows } = await clientConn.query(
      `SELECT participants_advance FROM tournaments WHERE id = $1`,
      [tournamentId]
    );
    if (!tRows.length) throw new Error(`Tournament ${tournamentId} not found`);

    const numAdvanced = Number(tRows[0].participants_advance || 0);
    if (!numAdvanced)
      throw new Error(
        `participants_advance missing for tournament ${tournamentId}`
      );

    const { rows: gRows } = await clientConn.query(
      `SELECT COUNT(*) AS count FROM groups WHERE tournament_id = $1`,
      [tournamentId]
    );
    const groupCount = parseInt(gRows[0].count, 10);
    if (!groupCount)
      throw new Error(`No groups found for tournament ${tournamentId}`);

    const N = groupCount * numAdvanced;
    const isStandard = [4, 8, 16, 32, 64].includes(N);

    return { N, groupCount, numAdvanced, isStandard };
  } finally {
    if (!client) clientConn.release();
  }
};

// applying seeds
/**
 * Compute and apply seeding for participants advancing to the final stage
 * based on group-stage performance.
 *
 * - Step 1: Reads sorted group standings (from round robin stage)
 * - Step 2: Flattens top-ranked participants (1st & 2nd) from each group
 * - Step 3: Sorts all 1st places globally, then all 2nd places
 * - Step 4: Assigns seeds (1–N)
 * - Step 5: Saves seeds into participants + stage_participants
 */
async function computeAndApplySeeds(tournamentId, clientt) {
  const localClient = clientt || (await pool.connect());
  const shouldCommit = !clientt;

  const { getSortedGroupStandings } = require("../services/group.service");

  try {
    if (shouldCommit) await localClient.query("BEGIN");

    console.log("🔹 Computing seeds for tournament:", tournamentId);

    // --- Step 1: Get Final Stage ---
    const finalStageRes = await localClient.query(
      `SELECT id FROM stages WHERE tournament_id = $1 AND name ILIKE 'Final Stage' LIMIT 1`,
      [tournamentId]
    );
    const stageId = finalStageRes.rows?.[0]?.id;
    if (!stageId) throw new Error("Final Stage not found.");

    // --- Step 2: Verify placeholders exist ---
    const placeholdersRes = await localClient.query(
      `SELECT COUNT(*) FROM stage_participants WHERE stage_id = $1`,
      [stageId]
    );
    if (parseInt(placeholdersRes.rows[0].count, 10) === 0) {
      throw new Error(
        `Final Stage placeholders not generated yet. Run generateFinalStageSeedsPlaceholders() first.`
      );
    }

    // --- Step 3: Fetch group standings ---
    const groupedStats = await getSortedGroupStandings(tournamentId);
    if (!groupedStats || Object.keys(groupedStats).length === 0) {
      throw new Error("No group standings found or groups not completed.");
    }

    // --- Step 4: Fetch groups (letters & indexes) ---
    const groupsRes = await localClient.query(
      `SELECT id, group_index FROM groups WHERE tournament_id = $1 ORDER BY group_index ASC`,
      [tournamentId]
    );
    const groups = groupsRes.rows;
    if (!groups.length) throw new Error("No groups found for tournament.");

    const allParticipants = [];

    for (const g of groups) {
      const groupLetter = String.fromCharCode(65 + g.group_index);
      const standings = groupedStats[g.id] || [];
      standings.forEach((s, i) => {
        allParticipants.push({
          participant_id: s.participant_id,
          group: groupLetter,
          rank: i + 1,
          matchWins: s.matchWins,
          matchDiffs: s.match_diffs,
          totalScore: s.totalScore,
          groupId: g.id,
        });
      });
    }

    // --- Step 5: Split 1st & 2nd place finishers ---
    const winners = allParticipants.filter((p) => p.rank === 1);
    const runners = allParticipants.filter((p) => p.rank === 2);

    // --- Step 6: Sort by comparator ---
    const matchesRes = await localClient.query(
      `SELECT id, player1_id, player2_id, winner_id, group_id
       FROM matches WHERE tournament_id = $1 AND state = 'completed'`,
      [tournamentId]
    );
    const matches = matchesRes.rows;

    const comparator = (a, b) => {
      if (b.matchWins !== a.matchWins) return b.matchWins - a.matchWins;
      if (b.matchDiffs !== a.matchDiffs) return b.matchDiffs - a.matchDiffs;
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;

      if (a.groupId === b.groupId) {
        const h2h = matches.find(
          (m) =>
            (m.player1_id === a.participant_id &&
              m.player2_id === b.participant_id) ||
            (m.player1_id === b.participant_id &&
              m.player2_id === a.participant_id)
        );
        if (h2h?.winner_id === a.participant_id) return -1;
        if (h2h?.winner_id === b.participant_id) return 1;
      }

      return a.participant_id - b.participant_id;
    };

    winners.sort(comparator);
    runners.sort(comparator);

    winners.forEach((w, i) => (w.seed = i + 1));
    runners.forEach((r, i) => (r.seed = winners.length + i + 1));

    const seeded = [...winners, ...runners];

    // --- Step 7: Update DB placeholders ---
    for (const s of seeded) {
      const placeholder = `${s.group}${s.rank}`;
      await localClient.query(
        `UPDATE participants SET seed = $1 WHERE id = $2`,
        [s.seed, s.participant_id]
      );

      const placeholderRes = await localClient.query(
        `SELECT id FROM stage_participants 
   WHERE stage_id = $1 
     AND seed = $2
   LIMIT 1`,
        [stageId, s.seed]
      );

      if (placeholderRes.rowCount > 0) {
        const spId = placeholderRes.rows[0].id;
        await localClient.query(
          `UPDATE stage_participants
           SET participant_id = $1,
               seed = $2,
               updated_at = NOW()
           WHERE id = $3`,
          [s.participant_id, s.seed, spId]
        );
      } else {
        console.warn(
          `⚠️ No placeholder found for ${placeholder} (group ${s.group}, rank ${s.rank})`
        );
      }
    }

    if (shouldCommit) await localClient.query("COMMIT");
    console.log("✅ Seeding completed and stored successfully.");
    return seeded;
  } catch (err) {
    if (shouldCommit) await localClient.query("ROLLBACK");
    console.error("❌ Error computing seeds:", err);
    throw err;
  } finally {
    if (!clientt) localClient.release();
  }
}

module.exports = {
  nextPowerOfTwo,
  buildSeedingOrder,
  getRoundName,
  generateFinalStagePlaceholders,
  generateFinalStageSeedsPlaceholders,
  getBracketTypeInfo,
  computeAndApplySeeds,
  autoAdvanceByeMatches,
};
