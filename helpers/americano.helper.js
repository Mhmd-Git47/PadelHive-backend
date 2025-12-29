// ============================================================================
// AMERICANO HELPER – Scheduling + Leaderboard
//  - Perfect Americano (when possible): deterministic round-robin pairing,
//    then convert pairs into americano matches (2 pairs -> 1 match),
//    and if courtsCount < N/4, split each perfect round into sub-rounds.
//  - Balanced Americano (fallback): heuristic minimising repetition.
// ============================================================================

// ---------- UTILITIES -------------------------------------------------------

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// For "perfect Americano" feasibility.
// This is your rule, kept as-is, but we also require N even and N>=4.
function isPerfectAmericano(n) {
  // 1. Must be at least 4 players
  // 2. Must be even
  // 3. Total pairings (N*(N-1)/2) must be even so they can form whole matches
  return n >= 4 && n % 2 === 0 && ((n * (n - 1)) / 2) % 2 === 0;
}

// Score a potential match (two teams of 2) given current stats.
// Lower score = “better” (less repetition).
const partnerHistory = {}; // Format: { "player1|player2": lastRoundNumber }

function scoreMatch(
  a1,
  a2,
  b1,
  b2,
  partnerCount,
  opponentCount,
  gamesPlayed,
  sideAssignments,
  currentRound
) {
  let penalty = 0;

  // 1. POSITIONAL PENALTY (CRITICAL)
  if (sideAssignments) {
    if (sideAssignments[a1] === sideAssignments[a2]) penalty += 100000;
    if (sideAssignments[b1] === sideAssignments[b2]) penalty += 100000;
  }

  // 2. PARTNER REPETITION + COOLDOWN
  const pA = partnerCount[a1]?.[a2] || 0;
  const pB = partnerCount[b1]?.[b2] || 0;

  // High penalty for repeating partners at all
  penalty += pA * 20000 + pB * 20000;

  // COOLDOWN: If they played together recently, add a massive penalty
  const keyA = a1 < a2 ? `${a1}|${a2}` : `${a2}|${a1}`;
  const lastRoundA = partnerHistory[keyA] || -100;
  if (currentRound - lastRoundA < 6) {
    // Must wait at least 6 rounds to repeat
    penalty += 50000 / (currentRound - lastRoundA);
  }

  // 3. OPPONENT REPETITION
  const oScore =
    (opponentCount[a1]?.[b1] || 0) +
    (opponentCount[a1]?.[b2] || 0) +
    (opponentCount[a2]?.[b1] || 0) +
    (opponentCount[a2]?.[b2] || 0);
  penalty += oScore * 1000;

  return penalty + Math.random(); // Jitter to prevent loops
}

// Choose best split of 4 players into two teams of 2.
function chooseBestTeams(
  players,
  partnerCount,
  opponentCount,
  gamesPlayed,
  sideAssignments
) {
  const [p1, p2, p3, p4] = players;
  const options = [
    { A: [p1, p2], B: [p3, p4] },
    { A: [p1, p3], B: [p2, p4] },
    { A: [p1, p4], B: [p2, p3] },
  ];

  let best = null;
  let bestScore = Infinity;

  for (const opt of options) {
    const s = scoreMatch(
      opt.A[0],
      opt.A[1],
      opt.B[0],
      opt.B[1],
      partnerCount,
      opponentCount,
      gamesPlayed,
      sideAssignments
    );
    if (s < bestScore) {
      bestScore = s;
      best = opt;
    }
  }
  return best;
}

// Update stats after committing a match
function applyMatchStats(
  match,
  partnerCount,
  opponentCount,
  gamesPlayed,
  lastPartnerRound,
  roundNum
) {
  const players = [...match.teams.A, ...match.teams.B];

  // 1. Increment Games Played
  players.forEach((p) => {
    gamesPlayed[p] = (gamesPlayed[p] || 0) + 1;
  });

  const [a1, a2] = match.teams.A;
  const [b1, b2] = match.teams.B;

  const ensure = (obj, key) => {
    if (!obj[key]) obj[key] = {};
  };

  // 2. Partners & Cooldown
  [
    [a1, a2],
    [b1, b2],
  ].forEach(([p1, p2]) => {
    ensure(partnerCount, p1);
    ensure(partnerCount, p2);
    partnerCount[p1][p2] = (partnerCount[p1][p2] || 0) + 1;
    partnerCount[p2][p1] = partnerCount[p1][p2];

    const key = p1 < p2 ? `${p1}|${p2}` : `${p2}|${p1}`;
    lastPartnerRound[key] = roundNum;
  });

  // 3. Opponents
  const vsPairs = [
    [a1, b1],
    [a1, b2],
    [a2, b1],
    [a2, b2],
  ];
  vsPairs.forEach(([x, y]) => {
    ensure(opponentCount, x);
    ensure(opponentCount, y);
    opponentCount[x][y] = (opponentCount[x][y] || 0) + 1;
    opponentCount[y][x] = opponentCount[x][y];
  });
}

// ============================================================================
// PERFECT AMERICANO (FIXED)
// - Build (N-1) round-robin rounds of PAIRS using circle method.
// - Convert PAIRS into americano matches: (pair0 vs pair1), (pair2 vs pair3), ...
// - If courtsCount < matchesPerRound (N/4), split into sub-rounds (chunking).
// ============================================================================

// -------------------- PACKING HELPERS --------------------

/**
 * Global packer:
 * - tries to pack each match into the earliest round it fits (first-fit)
 * - guarantees: no player repeats within a round, and max courtsCount per round
 */

// -------------------- PERFECT AMERICANO --------------------

/**
 * Perfect Americano match generation:
 * - generates ALL matches using circle method
 * - then globally packs them into rounds using packMatchesIntoRounds()
 */
function buildRoundRobinPairs(ids) {
  const N = ids.length;
  if (N < 2 || N % 2 !== 0) return [];

  let arr = [...ids];
  const rounds = [];

  for (let r = 0; r < N - 1; r++) {
    const pairs = [];
    for (let i = 0; i < N / 2; i++) {
      pairs.push([arr[i], arr[N - 1 - i]]);
    }
    rounds.push(pairs);

    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop());
    arr = [fixed, ...rest];
  }

  return rounds;
}

function shuffleWithSeed(arr, seed) {
  const a = [...arr];
  let s = seed + 1;

  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }

  return a;
}

function playersInMatch(match) {
  return [...match.teams.A, ...match.teams.B];
}

function normalizeId(x) {
  // choose ONE canonical type everywhere:
  // string is safest for DB + JS objects + Set keys
  return String(x);
}

function normalizeParticipants(participants) {
  // also guard against duplicates
  const ids = participants.map((p) => normalizeId(p.id));
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new Error(`Duplicate participant id after normalization: ${id}`);
    }
    seen.add(id);
  }
  return ids;
}

/**
 * Packs matches into rounds:
 * - each round has up to courtsCount matches
 * - no player repeats within a round
 * - tries to fill rounds as much as possible (so most rounds == courtsCount)
 * - only the final overall round may have fewer matches
 */

function validateSchedule(rounds, ids, courtsCount) {
  const N = ids.length;
  const idSet = new Set(ids);

  const expectedMatches = (N - 1) * (N / 4); // valid because isPerfectAmericano ensures divisibility
  const expectedGamesPerPlayer = N - 1;

  const games = Object.fromEntries(ids.map((id) => [id, 0]));
  const partnerSeen = new Set(); // unordered pair "a|b"
  const matchSeen = new Set(); // matchKey

  let matchCount = 0;

  const pairKey = (a, b) => {
    const x = String(a),
      y = String(b);
    return x < y ? `${x}|${y}` : `${y}|${x}`;
  };

  for (let r = 0; r < rounds.length; r++) {
    const round = rounds[r];
    if (round.length > courtsCount) {
      throw new Error(
        `Round ${r + 1} exceeds courtsCount (${round.length} > ${courtsCount})`
      );
    }

    const used = new Set();

    for (const m of round) {
      const A = m.teams?.A;
      const B = m.teams?.B;
      if (!A || !B || A.length !== 2 || B.length !== 2) {
        throw new Error(`Invalid match structure in round ${r + 1}`);
      }

      const players = [...A, ...B].map(String);

      // All 4 distinct
      if (new Set(players).size !== 4) {
        throw new Error(
          `Match has duplicate player(s) in round ${r + 1}: ${players.join(
            ","
          )}`
        );
      }

      // All players exist
      for (const p of players) {
        if (!idSet.has(p))
          throw new Error(`Unknown player id "${p}" in round ${r + 1}`);
      }

      // No player repeats in the round
      for (const p of players) {
        if (used.has(p))
          throw new Error(`Player "${p}" repeats in round ${r + 1}`);
        used.add(p);
      }

      // Match uniqueness
      const mk = matchKey({
        teams: { A: players.slice(0, 2), B: players.slice(2, 4) },
      });
      if (matchSeen.has(mk)) throw new Error(`Duplicate match detected: ${mk}`);
      matchSeen.add(mk);

      // Partner uniqueness
      const pA = pairKey(A[0], A[1]);
      const pB = pairKey(B[0], B[1]);
      if (partnerSeen.has(pA)) throw new Error(`Repeated partner pair: ${pA}`);
      if (partnerSeen.has(pB)) throw new Error(`Repeated partner pair: ${pB}`);
      partnerSeen.add(pA);
      partnerSeen.add(pB);

      // Games count
      for (const p of players) games[p]++;

      matchCount++;
    }
  }

  if (matchCount !== expectedMatches) {
    throw new Error(
      `Total matches ${matchCount} != expected ${expectedMatches}`
    );
  }

  for (const id of ids) {
    if (games[id] !== expectedGamesPerPlayer) {
      throw new Error(
        `Player ${id} games ${games[id]} != expected ${expectedGamesPerPlayer}`
      );
    }
  }

  // Note: with N=12, courts=2 => expectedMatches=33 => rounds will be 17, last round will have 1 match.
  // That is mathematically unavoidable unless you add a "dummy match" or allow repeats.
  return true;
}

function normalizeTeam(team) {
  return [...team].map(String).sort();
}

function matchKey(match) {
  const A = normalizeTeam(match.teams.A);
  const B = normalizeTeam(match.teams.B);

  const aKey = A.join("|");
  const bKey = B.join("|");

  // Order-independent key: A vs B === B vs A
  return aKey < bKey ? `${aKey}__VS__${bKey}` : `${bKey}__VS__${aKey}`;
}

function splitLogicalRounds(rrPairRounds, courtsCount) {
  const physicalRounds = [];

  for (const logicalRound of rrPairRounds) {
    // logicalRound = array of matches (already conflict-free)
    for (let i = 0; i < logicalRound.length; i += courtsCount) {
      physicalRounds.push(logicalRound.slice(i, i + courtsCount));
    }
  }

  return physicalRounds;
}

function regroupByLogicalRound(physicalRounds, courtsCount) {
  const map = new Map();

  for (const round of physicalRounds) {
    for (const match of round) {
      const lr = match.meta.logicalRound;
      if (!map.has(lr)) map.set(lr, []);
      map.get(lr).push(match);
    }
  }

  const regroupedRounds = [];

  for (const [, matches] of [...map.entries()].sort((a, b) => a[0] - b[0])) {
    for (let i = 0; i < matches.length; i += courtsCount) {
      regroupedRounds.push(matches.slice(i, i + courtsCount));
    }
  }

  return regroupedRounds;
}

function validatePhysicalRound(roundMatches) {
  const seenPlayers = new Set();
  for (const match of roundMatches) {
    const players = [...match.teams.A, ...match.teams.B];
    for (const p of players) {
      if (seenPlayers.has(p)) return false; // Double booking detected!
      seenPlayers.add(p);
    }
  }
  return true;
}

function buildPerfectAmericanoRounds(participants, courtsCount) {
  const ids = participants.map((p) => String(p.id));
  const N = ids.length;

  if (!isPerfectAmericano(N)) {
    throw new Error("Perfect Americano conditions not met.");
  }

  // 1. Generate all unique matches (33 for 12 players)
  const logicalPairRounds = buildRoundRobinPairs(ids);
  let matchPool = [];

  logicalPairRounds.forEach((roundPairs, roundIdx) => {
    // Shuffling within the pool helps variability
    const shuffledPairs = shuffle(roundPairs);
    for (let i = 0; i < shuffledPairs.length; i += 2) {
      matchPool.push({
        meta: { logicalRound: roundIdx + 1 },
        teams: { A: shuffledPairs[i], B: shuffledPairs[i + 1] },
      });
    }
  });

  // 2. Greedy Packing into Physical Rounds
  const physicalRounds = [];

  while (matchPool.length > 0) {
    const currentRound = [];
    const playersInRound = new Set();

    for (let i = 0; i < matchPool.length; i++) {
      const match = matchPool[i];
      const playersInMatch = [...match.teams.A, ...match.teams.B];
      const hasConflict = playersInMatch.some((p) => playersInRound.has(p));

      if (!hasConflict) {
        currentRound.push(match);
        playersInMatch.forEach((p) => playersInRound.add(p));
        matchPool.splice(i, 1);
        i--;

        if (currentRound.length === courtsCount) break;
      }
    }

    if (currentRound.length > 0) {
      physicalRounds.push(currentRound);
    } else {
      // Logic fallback: If packing gets stuck, it's usually due to a bad random shuffle.
      // In a real app, you could retry with a different seed here.
      throw new Error("Could not pack matches without conflicts.");
    }
  }

  // ============================================================
  // CRITICAL FIX: Ensure the short round is always the LAST round
  // ============================================================
  physicalRounds.sort((a, b) => b.length - a.length);

  return physicalRounds;
}

function buildPerfectAmericanoRoundsWithRetries(
  participants,
  courtsCount,
  stableSeed
) {
  // stableSeed could be tournamentId/stageId hash for reproducibility
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      return buildPerfectAmericanoRounds(
        participants,
        courtsCount,
        stableSeed + attempt
      );
    } catch (e) {
      // retry next seed
      if (attempt === 49) throw e;
    }
  }
}

async function generatePerfectAmericanoStageMatches({
  tournamentId,
  stageId,
  participants,
  courtsCount,
  client,
}) {
  const stableSeed = Number(String(tournamentId).slice(-6)) || 1;

  // Just generate and persist
  const rounds = buildPerfectAmericanoRoundsWithRetries(
    participants,
    courtsCount,
    stableSeed
  );

  return persistRounds(rounds, tournamentId, stageId, client);
}

// ============================================================================
// BALANCED AMERICANO (your heuristic; unchanged logic)
// ============================================================================

function buildBalancedAmericanoRounds(
  participants,
  courtsCount,
  sideAssignments
) {
  const playerIds = participants.map((p) => String(p.id));
  const N = playerIds.length;
  if (N < 4) return [];

  const gamesPlayed = {};
  const partnerCount = {};
  const opponentCount = {};
  const lastPartnerRound = {};

  const rounds = [];
  const totalMatchesTarget = Math.floor((N * (N - 1)) / 4);
  let matchesCreated = 0;

  // Safety limit for rounds to avoid infinite loops
  for (let r = 1; r <= 100; r++) {
    const roundMatches = [];
    const usedThisRound = new Set();

    for (let c = 0; c < courtsCount; c++) {
      const available = playerIds.filter((id) => !usedThisRound.has(id));
      if (available.length < 4) break;

      available.sort((a, b) => (gamesPlayed[a] || 0) - (gamesPlayed[b] || 0));
      const pool = available.slice(0, Math.min(available.length, 10));

      let bestCombo = null;
      let bestScore = Infinity;

      // Exhaustive search of the top pool
      for (let i = 0; i < pool.length; i++) {
        for (let j = i + 1; j < pool.length; j++) {
          for (let k = j + 1; k < pool.length; k++) {
            for (let l = k + 1; l < pool.length; l++) {
              const four = [pool[i], pool[j], pool[k], pool[l]];
              const options = [
                { A: [four[0], four[1]], B: [four[2], four[3]] },
                { A: [four[0], four[2]], B: [four[1], four[3]] },
                { A: [four[0], four[3]], B: [four[1], four[2]] },
              ];

              for (const opt of options) {
                let s = 0;
                const [p1, p2] = opt.A;
                const [p3, p4] = opt.B;

                // 1. Positional Penalty
                if (sideAssignments) {
                  if (sideAssignments[p1] === sideAssignments[p2]) s += 200000;
                  if (sideAssignments[p3] === sideAssignments[p4]) s += 200000;
                }

                // 2. Partner Cooldown & Repetition
                [
                  [p1, p2],
                  [p3, p4],
                ].forEach(([a, b]) => {
                  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
                  const diff = r - (lastPartnerRound[key] || -100);
                  if (diff < N / 2) s += 100000 / diff;
                  s += (partnerCount[a]?.[b] || 0) * 20000;
                });

                // 3. Opponent Variety
                [
                  [p1, p3],
                  [p1, p4],
                  [p2, p3],
                  [p2, p4],
                ].forEach(([a, b]) => {
                  s += (opponentCount[a]?.[b] || 0) * 1000;
                });

                // 4. Jitter
                s += Math.random();

                if (s < bestScore) {
                  bestScore = s;
                  bestCombo = opt;
                }
              }
            }
          }
        }
      }

      if (bestCombo) {
        roundMatches.push({ teams: bestCombo });
        applyMatchStats(
          { teams: bestCombo },
          partnerCount,
          opponentCount,
          gamesPlayed,
          lastPartnerRound,
          r
        );
        [...bestCombo.A, ...bestCombo.B].forEach((p) => usedThisRound.add(p));
        matchesCreated++;
        if (matchesCreated >= totalMatchesTarget) break;
      }
    }

    if (roundMatches.length > 0) rounds.push(roundMatches);
    if (matchesCreated >= totalMatchesTarget) break;
  }
  return rounds;
}

function updateStats(
  match,
  partnerCount,
  opponentCount,
  lastPartnerRound,
  roundNum
) {
  const teams = [match.teams.A, match.teams.B];
  teams.forEach((team) => {
    const [a, b] = team;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    partnerCount[a] = partnerCount[a] || {};
    partnerCount[a][b] = (partnerCount[a][b] || 0) + 1;
    partnerCount[b] = partnerCount[b] || {};
    partnerCount[b][a] = (partnerCount[b][a] || 0) + 1;
    lastPartnerRound[key] = roundNum;
  });
}

// ============================================================================
// PERSISTENCE HELPERS
// ============================================================================

async function persistRounds(rounds, tournamentId, stageId, client) {
  const createdMatches = [];

  for (let r = 0; r < rounds.length; r++) {
    for (const match of rounds[r]) {
      const [A1, A2] = match.teams.A;
      const [B1, B2] = match.teams.B;

      const spA = await client.query(
        `INSERT INTO stage_participants
         (stage_id, player1_id, player2_id, created_at, updated_at)
         VALUES ($1,$2,$3,NOW(),NOW())
         RETURNING id`,
        [stageId, A1, A2]
      );

      const spB = await client.query(
        `INSERT INTO stage_participants
         (stage_id, player1_id, player2_id, created_at, updated_at)
         VALUES ($1,$2,$3,NOW(),NOW())
         RETURNING id`,
        [stageId, B1, B2]
      );

      const matchRes = await client.query(
        `INSERT INTO matches
         (tournament_id, stage_id,
          stage_player1_id, stage_player2_id,
          state, round, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'pending',$5,NOW(),NOW())
         RETURNING *`,
        [tournamentId, stageId, spA.rows[0].id, spB.rows[0].id, r + 1]
      );

      createdMatches.push(matchRes.rows[0]);
    }
  }

  return createdMatches;
}

// ============================================================================
// GENERATORS (PUBLIC)
// ============================================================================

async function generateBalancedAmericanoStageMatches({
  tournamentId,
  stageId,
  participants,
  courtsCount,
  client,
}) {
  const rounds = buildBalancedAmericanoRounds(participants, courtsCount);
  return persistRounds(rounds, tournamentId, stageId, client);
}

// Convenience wrapper if you want a single entry-point:
// - perfect if feasible
// - else balanced
async function generateAmericanoStageMatches({
  tournamentId,
  stageId,
  participants,
  courtsCount,
  client,
  sideAssignments,
}) {
  const n = participants?.length || 0;

  // If we have side assignments, we MUST use the balanced heuristic.
  // The 'Perfect' circle method cannot handle L/R constraints.
  if (isPerfectAmericano(n) && !sideAssignments) {
    const stableSeed = Number(String(tournamentId).slice(-6)) || 1;
    try {
      const rounds = buildPerfectAmericanoRoundsWithRetries(
        participants,
        courtsCount,
        stableSeed
      );
      return persistRounds(rounds, tournamentId, stageId, client);
    } catch (e) {
      // Fallback to balanced if perfect fails packing
    }
  }

  const rounds = buildBalancedAmericanoRounds(
    participants,
    courtsCount,
    sideAssignments
  );
  return persistRounds(rounds, tournamentId, stageId, client);
}

// ============================================================================
// AMERICANO LEADERBOARD CALCULATION
// ============================================================================

async function calculateAmericanoLeaderboard(tournamentId, stageId, client) {
  const matchesRes = await client.query(
    `
    SELECT 
      m.id,
      m.scores_csv,
      m.winner_id,

      spa.player1_id AS a1, pA1.name AS a1_name,
      spa.player2_id AS a2, pA2.name AS a2_name,

      spb.player1_id AS b1, pB1.name AS b1_name,
      spb.player2_id AS b2, pB2.name AS b2_name

    FROM matches m
      JOIN stage_participants spa ON m.stage_player1_id = spa.id
      JOIN stage_participants spb ON m.stage_player2_id = spb.id

      LEFT JOIN participants pA1 ON pA1.id = spa.player1_id
      LEFT JOIN participants pA2 ON pA2.id = spa.player2_id
      LEFT JOIN participants pB1 ON pB1.id = spb.player1_id
      LEFT JOIN participants pB2 ON pB2.id = spb.player2_id

    WHERE m.tournament_id = $1
      AND m.stage_id = $2

    ORDER BY m.round, m.id
    `,
    [tournamentId, stageId]
  );

  const matches = matchesRes.rows;
  if (matches.length === 0) return [];

  const stats = {};

  function ensure(pId, pName) {
    if (!pId) return;

    if (!stats[pId]) {
      stats[pId] = {
        participant_id: pId,
        name: pName || null,
        pointsFor: 0,
        pointsAgainst: 0,
        totalPoints: 0,
        matchDiff: 0,
        wins: 0,
        matchesPlayed: 0,
      };
    }
  }

  for (const m of matches) {
    const playersA = [
      { id: m.a1, name: m.a1_name },
      { id: m.a2, name: m.a2_name },
    ].filter((p) => p.id);

    const playersB = [
      { id: m.b1, name: m.b1_name },
      { id: m.b2, name: m.b2_name },
    ].filter((p) => p.id);

    playersA.forEach((p) => ensure(p.id, p.name));
    playersB.forEach((p) => ensure(p.id, p.name));

    if (m.scores_csv) {
      const sets = m.scores_csv.split(",");
      for (const set of sets) {
        const [rawA, rawB] = set.trim().split("-").map(Number);
        if (isNaN(rawA) || isNaN(rawB)) continue;

        playersA.forEach((p) => {
          stats[p.id].pointsFor += rawA;
          stats[p.id].pointsAgainst += rawB;
        });

        playersB.forEach((p) => {
          stats[p.id].pointsFor += rawB;
          stats[p.id].pointsAgainst += rawA;
        });
      }
    }

    if (m.winner_id) {
      if (playersA.some((p) => p.id === m.winner_id)) {
        playersA.forEach((p) => stats[p.id].wins++);
      } else if (playersB.some((p) => p.id === m.winner_id)) {
        playersB.forEach((p) => stats[p.id].wins++);
      }
    }

    playersA.forEach((p) => stats[p.id].matchesPlayed++);
    playersB.forEach((p) => stats[p.id].matchesPlayed++);
  }

  Object.values(stats).forEach((s) => {
    s.totalPoints = s.pointsFor;
    s.matchDiff = s.pointsFor - s.pointsAgainst;
  });

  let ranked = Object.values(stats).sort(
    (a, b) =>
      b.totalPoints - a.totalPoints ||
      b.matchDiff - a.matchDiff ||
      b.wins - a.wins
  );

  ranked = applyHeadToHeadTiebreak(matches, ranked);

  return ranked;
}

// ============================================================================
// HEAD-TO-HEAD BETWEEN EXACTLY TWO TIED PLAYERS
// ============================================================================

function applyHeadToHeadTiebreak(matches, ranked) {
  const out = [...ranked];

  for (let i = 0; i < out.length - 1; i++) {
    const p1 = out[i];
    const p2 = out[i + 1];

    const tie =
      p1.totalPoints === p2.totalPoints &&
      p1.matchDiff === p2.matchDiff &&
      p1.wins === p2.wins;

    if (!tie) continue;

    let p1Points = 0;
    let p2Points = 0;

    for (const m of matches) {
      const allPlayers = [m.a1, m.a2, m.b1, m.b2];
      const involved =
        allPlayers.includes(p1.participant_id) &&
        allPlayers.includes(p2.participant_id);

      if (!involved || !m.scores_csv) continue;

      const sets = m.scores_csv.split(",");
      for (const set of sets) {
        const [sa, sb] = set.trim().split("-").map(Number);
        if (isNaN(sa) || isNaN(sb)) continue;

        const p1IsA = m.a1 === p1.participant_id || m.a2 === p1.participant_id;
        const p2IsA = m.a1 === p2.participant_id || m.a2 === p2.participant_id;

        if (p1IsA && !p2IsA) {
          p1Points += sa;
          p2Points += sb;
        } else if (!p1IsA && p2IsA) {
          p1Points += sb;
          p2Points += sa;
        }
      }
    }

    if (p1Points < p2Points) {
      out[i] = p2;
      out[i + 1] = p1;
    }
  }

  return out;
}

module.exports = {
  // recommended single entry-point:
  generateAmericanoStageMatches,

  // if you still want direct calls:
  generateBalancedAmericanoStageMatches,
  generatePerfectAmericanoStageMatches,

  calculateAmericanoLeaderboard,

  // exported for testing/debug:
  isPerfectAmericano,
};
