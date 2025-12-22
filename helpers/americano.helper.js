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
  return n >= 4 && n % 2 === 0 && (n * (n - 1)) % 4 === 0;
}

// Score a potential match (two teams of 2) given current stats.
// Lower score = “better” (less repetition).
function scoreMatch(a1, a2, b1, b2, partnerCount, opponentCount, gamesPlayed) {
  const partnerScore =
    (partnerCount[a1]?.[a2] || 0) + (partnerCount[b1]?.[b2] || 0);

  const opponentScore =
    (opponentCount[a1]?.[b1] || 0) +
    (opponentCount[a1]?.[b2] || 0) +
    (opponentCount[a2]?.[b1] || 0) +
    (opponentCount[a2]?.[b2] || 0) +
    (opponentCount[b1]?.[a1] || 0) +
    (opponentCount[b1]?.[a2] || 0) +
    (opponentCount[b2]?.[a1] || 0) +
    (opponentCount[b2]?.[a2] || 0);

  const gamesScore =
    (gamesPlayed[a1] || 0) +
    (gamesPlayed[a2] || 0) +
    (gamesPlayed[b1] || 0) +
    (gamesPlayed[b2] || 0);

  // weights can be tuned; partners/opponents more important than gamesPlayed
  return partnerScore * 10 + opponentScore * 2 + gamesScore;
}

// Choose best split of 4 players into two teams of 2.
function chooseBestTeams(players, partnerCount, opponentCount, gamesPlayed) {
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
      gamesPlayed
    );
    if (s < bestScore) {
      bestScore = s;
      best = opt;
    }
  }

  return best;
}

// Update stats after committing a match
function applyMatchStats(match, partnerCount, opponentCount, gamesPlayed) {
  const players = [...match.teams.A, ...match.teams.B];

  for (const p of players) {
    gamesPlayed[p] = (gamesPlayed[p] || 0) + 1;
  }

  const [a1, a2] = match.teams.A;
  const [b1, b2] = match.teams.B;

  const ensure = (obj, key) => {
    if (!obj[key]) obj[key] = {};
  };

  // partners
  ensure(partnerCount, a1);
  ensure(partnerCount, a2);
  ensure(partnerCount, b1);
  ensure(partnerCount, b2);

  partnerCount[a1][a2] = (partnerCount[a1][a2] || 0) + 1;
  partnerCount[a2][a1] = partnerCount[a1][a2];

  partnerCount[b1][b2] = (partnerCount[b1][b2] || 0) + 1;
  partnerCount[b2][b1] = partnerCount[b1][b2];

  // opponents – increment for every cross pair
  const vsPairs = [
    [a1, b1],
    [a1, b2],
    [a2, b1],
    [a2, b2],
    [b1, a1],
    [b1, a2],
    [b2, a1],
    [b2, a2],
  ];

  for (const [x, y] of vsPairs) {
    ensure(opponentCount, x);
    opponentCount[x][y] = (opponentCount[x][y] || 0) + 1;
  }
}

// ============================================================================
// PERFECT AMERICANO (FIXED)
// - Build (N-1) round-robin rounds of PAIRS using circle method.
// - Convert PAIRS into americano matches: (pair0 vs pair1), (pair2 vs pair3), ...
// - If courtsCount < matchesPerRound (N/4), split into sub-rounds (chunking).
// ============================================================================

// -------------------- PACKING HELPERS --------------------

function matchPlayers(match) {
  return [...match.teams.A, ...match.teams.B];
}

function hasConflict(round, match) {
  const players = matchPlayers(match);
  for (const m of round) {
    const used = matchPlayers(m);
    // any overlap => conflict
    if (players.some((p) => used.includes(p))) return true;
  }
  return false;
}

/**
 * Global packer:
 * - tries to pack each match into the earliest round it fits (first-fit)
 * - guarantees: no player repeats within a round, and max courtsCount per round
 */
function packMatchesIntoRounds(matches, courtsCount) {
  const rounds = [];

  for (const match of matches) {
    let placed = false;

    for (const round of rounds) {
      if (round.length >= courtsCount) continue;
      if (hasConflict(round, match)) continue;

      round.push(match);
      placed = true;
      break;
    }

    if (!placed) {
      rounds.push([match]);
    }
  }

  // Optional but recommended: compact rounds further (best-effort pass)
  // This helps eliminate sparse rounds if any exist.
  // It is safe because it only moves matches into earlier rounds when valid.
  for (let i = rounds.length - 1; i >= 0; i--) {
    const round = rounds[i];
    for (let j = round.length - 1; j >= 0; j--) {
      const m = round[j];

      let moved = false;
      for (let k = 0; k < i; k++) {
        if (rounds[k].length >= courtsCount) continue;
        if (hasConflict(rounds[k], m)) continue;

        rounds[k].push(m);
        round.splice(j, 1);
        moved = true;
        break;
      }

      if (!moved) {
        // can't move this match; keep it
      }
    }

    if (round.length === 0) {
      rounds.splice(i, 1);
    }
  }

  return rounds;
}

// -------------------- PERFECT AMERICANO --------------------

/**
 * Perfect Americano match generation:
 * - generates ALL matches using circle method
 * - then globally packs them into rounds using packMatchesIntoRounds()
 */
function buildPerfectAmericanoRounds(participants, courtsCount) {
  const ids = participants.map((p) => p.id);
  const N = ids.length;

  if (N < 4 || N % 2 !== 0 || courtsCount <= 0) return [];

  const matches = [];
  const totalRounds = N - 1;

  let left = ids.slice(0, N / 2);
  let right = ids.slice(N / 2).reverse();

  for (let r = 0; r < totalRounds; r++) {
    // each iteration produces N/4 matches
    for (let i = 0; i < left.length; i += 2) {
      if (i + 1 >= left.length) break;

      matches.push({
        teams: {
          A: [left[i], right[i]],
          B: [left[i + 1], right[i + 1]],
        },
      });
    }

    // rotate (keep first fixed)
    const fixed = left[0];
    const movedLeft = left.splice(1, 1)[0];
    const movedRight = right.pop();

    left = [fixed, movedRight, ...left.slice(1)];
    right = [movedLeft, ...right];
  }

  // GLOBAL repacking to maximize courts usage per round
  return packMatchesIntoRounds(matches, courtsCount);
}

// ============================================================================
// BALANCED AMERICANO (your heuristic; unchanged logic)
// ============================================================================

function buildBalancedAmericanoRounds(participants, courtsCount) {
  const playerIds = participants.map((p) => p.id);
  const N = playerIds.length;

  if (N < 4 || courtsCount <= 0) return [];

  // targetMatches = floor((N*(N-1)/2) / 2) = floor(N*(N-1)/4)
  const totalPairs = (N * (N - 1)) / 2;
  const targetMatches = Math.floor(totalPairs / 2);

  const gamesPlayed = {};
  const partnerCount = {};
  const opponentCount = {};

  const rounds = [];
  let matchesCreated = 0;

  const MAX_GLOBAL_ITER = targetMatches * 10 || 1000;
  let iter = 0;

  while (matchesCreated < targetMatches && iter < MAX_GLOBAL_ITER) {
    iter++;

    const round = [];
    const usedThisRound = new Set();

    let localTries = 0;

    while (round.length < courtsCount && localTries < N * 4) {
      localTries++;

      const available = playerIds.filter((id) => !usedThisRound.has(id));
      if (available.length < 4) break;

      available.sort((a, b) => (gamesPlayed[a] || 0) - (gamesPlayed[b] || 0));

      const pool = available.slice(0, Math.min(6, available.length));
      if (pool.length < 4) break;

      let bestChoice = null;
      let bestScore = Infinity;

      for (let i = 0; i < pool.length; i++) {
        for (let j = i + 1; j < pool.length; j++) {
          for (let k = j + 1; k < pool.length; k++) {
            for (let l = k + 1; l < pool.length; l++) {
              const four = [pool[i], pool[j], pool[k], pool[l]];

              const opt = chooseBestTeams(
                four,
                partnerCount,
                opponentCount,
                gamesPlayed
              );

              const s = scoreMatch(
                opt.A[0],
                opt.A[1],
                opt.B[0],
                opt.B[1],
                partnerCount,
                opponentCount,
                gamesPlayed
              );

              if (s < bestScore) {
                bestScore = s;
                bestChoice = {
                  teams: {
                    A: [...opt.A],
                    B: [...opt.B],
                  },
                };
              }
            }
          }
        }
      }

      if (!bestChoice) break;

      round.push(bestChoice);
      matchesCreated++;

      const players = [...bestChoice.teams.A, ...bestChoice.teams.B];
      players.forEach((p) => usedThisRound.add(p));

      applyMatchStats(bestChoice, partnerCount, opponentCount, gamesPlayed);

      if (matchesCreated >= targetMatches) break;
    }

    if (round.length === 0) break;

    rounds.push(round);
  }

  rounds.sort((a, b) => b.length - a.length);
  return rounds;
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

async function generatePerfectAmericanoStageMatches({
  tournamentId,
  stageId,
  participants,
  courtsCount,
  client,
}) {
  const rounds = buildPerfectAmericanoRounds(participants, courtsCount);
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
}) {
  const n = participants?.length || 0;

  if (isPerfectAmericano(n)) {
    const rounds = buildPerfectAmericanoRounds(participants, courtsCount);
    return persistRounds(rounds, tournamentId, stageId, client);
  }

  const rounds = buildBalancedAmericanoRounds(participants, courtsCount);
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
