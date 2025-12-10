// ============================================================================
// AMERICANO HELPER – Unified Americano Scheduling Engine
//  - Works for any N and any courtsCount
//  - Builds rounds incrementally (like americano-padel.com style generators)
//  - Tries to:
//      * fill all courts each round
//      * balance games per player
//      * minimise partner/opponent repetitions
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

  // gamesPlayed
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
// CORE SCHEDULER – used for all Americano cases
// ============================================================================

/**
 * Build an Americano schedule for arbitrary N and courtsCount.
 * Returns array of rounds; each round is array of matches:
 *   match = { teams: { A: [p1, p2], B: [p3, p4] } }
 *
 * Key properties:
 *  - Uses up to `courtsCount` matches per round.
 *  - No player appears twice in the same round.
 *  - Tries to balance games per player.
 *  - Tries to minimise partner/opponent repetition.
 */
function buildAmericanoRounds(participants, courtsCount) {
  const playerIds = participants.map((p) => p.id);
  const N = playerIds.length;

  if (N < 4 || courtsCount <= 0) return [];

  // Max “reasonable” number of matches:
  // This mirrors your earlier target floor(N*(N-1)/4).
  const totalPairs = (N * (N - 1)) / 2;
  const targetMatches = Math.floor(totalPairs / 2);

  // Stats
  const gamesPlayed = {};
  const partnerCount = {};
  const opponentCount = {};

  const rounds = [];
  let matchesCreated = 0;

  // Safety limit to avoid pathological infinite loops
  const MAX_GLOBAL_ITER = targetMatches * 10 || 1000;
  let iter = 0;

  while (matchesCreated < targetMatches && iter < MAX_GLOBAL_ITER) {
    iter++;

    const round = [];
    const usedThisRound = new Set();

    // We try to fill all courts in this round
    let localTries = 0;

    while (round.length < courtsCount && localTries < N * 4) {
      localTries++;

      // Candidate players for this round = not yet used
      const available = playerIds.filter((id) => !usedThisRound.has(id));
      if (available.length < 4) break;

      // Sort by (gamesPlayed) so that the least-used play first
      available.sort((a, b) => (gamesPlayed[a] || 0) - (gamesPlayed[b] || 0));

      // Take first 6 as pool to build 4-player groups – keeps things local
      const pool = available.slice(0, Math.min(6, available.length));
      if (pool.length < 4) break;

      // Try all 4-player combinations from this small pool
      let bestChoice = null;
      let bestScore = Infinity;

      for (let i = 0; i < pool.length; i++) {
        for (let j = i + 1; j < pool.length; j++) {
          for (let k = j + 1; k < pool.length; k++) {
            for (let l = k + 1; l < pool.length; l++) {
              const four = [pool[i], pool[j], pool[k], pool[l]];

              // Build optimal 2x2 teams for these four
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

      // Commit this match into current round
      round.push(bestChoice);
      matchesCreated++;

      const players = [...bestChoice.teams.A, ...bestChoice.teams.B];
      players.forEach((p) => usedThisRound.add(p));

      applyMatchStats(bestChoice, partnerCount, opponentCount, gamesPlayed);

      if (matchesCreated >= targetMatches) break;
    }

    if (round.length === 0) {
      // Could not schedule anything without insane repetition; stop.
      break;
    }

    rounds.push(round);
  }

  // Finally, sort rounds by fullness (most matches first) to push
  // short rounds toward the end.
  rounds.sort((a, b) => b.length - a.length);

  return rounds;
}

// ============================================================================
// PUBLIC API – used by your match.service.js
// ============================================================================

/**
 * Unified generator (replaces old perfect/non-perfect split).
 * Creates stage_participants + matches for all rounds.
 */
async function generateAmericanoStageMatches({
  tournamentId,
  stageId,
  participants,
  courtsCount,
  client,
}) {
  const rounds = buildAmericanoRounds(participants, courtsCount);
  const createdMatches = [];

  for (let r = 0; r < rounds.length; r++) {
    const roundMatches = rounds[r];

    for (const match of roundMatches) {
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

  // -------------------------------------
  // Proper stats container
  // -------------------------------------
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

  // -------------------------------------
  // Aggregate matches
  // -------------------------------------
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

    // Scoring
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

    // Wins
    if (m.winner_id) {
      if (playersA.some((p) => p.id === m.winner_id)) {
        playersA.forEach((p) => stats[p.id].wins++);
      } else if (playersB.some((p) => p.id === m.winner_id)) {
        playersB.forEach((p) => stats[p.id].wins++);
      }
    }

    // Matches played
    playersA.forEach((p) => stats[p.id].matchesPlayed++);
    playersB.forEach((p) => stats[p.id].matchesPlayed++);
  }

  // -------------------------------------
  // Derived fields
  // -------------------------------------
  Object.values(stats).forEach((s) => {
    s.totalPoints = s.pointsFor;
    s.matchDiff = s.pointsFor - s.pointsAgainst;
  });

  // -------------------------------------
  // Sorting
  // -------------------------------------
  let ranked = Object.values(stats).sort(
    (a, b) =>
      b.totalPoints - a.totalPoints ||
      b.matchDiff - a.matchDiff ||
      b.wins - a.wins
  );

  // Head-to-head tie break
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

    // Find direct encounters between p1 and p2
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
          // p1 on A side, p2 on B side
          p1Points += sa;
          p2Points += sb;
        } else if (!p1IsA && p2IsA) {
          // p2 on A side, p1 on B side
          p1Points += sb;
          p2Points += sa;
        }
      }
    }

    // If p2 scored more points directly vs p1 → swap
    if (p1Points < p2Points) {
      out[i] = p2;
      out[i + 1] = p1;
    }
  }

  return out;
}

module.exports = {
  generateAmericanoStageMatches,
  calculateAmericanoLeaderboard,
};
