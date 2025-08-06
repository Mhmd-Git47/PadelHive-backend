const pool = require("../db");
const {
  getAllTournaments,
  getMatches,
  getParticipants,
} = require("./challongeService");

async function upsertTournament(t) {
  await pool.query(
    `INSERT INTO tournaments (
      challonge_id, name, url, tournament_type, state, description,
      created_at, updated_at, started_at, completed_at,
      open_signup, signup_cap, private, progress_meter,
      live_image_url, game_name, full_challonge_url
    )
    VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10,
      $11, $12, $13, $14,
      $15, $16, $17
    )
    ON CONFLICT (challonge_id) DO UPDATE SET
      name = EXCLUDED.name,
      url = EXCLUDED.url,
      tournament_type = EXCLUDED.tournament_type,
      state = EXCLUDED.state,
      description = EXCLUDED.description,
      updated_at = EXCLUDED.updated_at,
      started_at = EXCLUDED.started_at,
      completed_at = EXCLUDED.completed_at,
      open_signup = EXCLUDED.open_signup,
      signup_cap = EXCLUDED.signup_cap,
      private = EXCLUDED.private,
      progress_meter = EXCLUDED.progress_meter,
      live_image_url = EXCLUDED.live_image_url,
      game_name = EXCLUDED.game_name,
      full_challonge_url = EXCLUDED.full_challonge_url
    ;`,
    [
      t.id,
      t.name,
      t.url,
      t.tournament_type,
      t.state,
      t.description,
      t.created_at,
      t.updated_at,
      t.started_at,
      t.completed_at,
      t.open_signup,
      t.signup_cap,
      t.private,
      t.progress_meter,
      t.live_image_url,
      t.game_name,
      t.full_challonge_url,
    ]
  );
}

async function upsertParticipant(p) {
  await pool.query(
    `
    INSERT INTO participants (
      id, tournament_id, name, seed, final_rank, group_id, active,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      seed = EXCLUDED.seed,
      final_rank = EXCLUDED.final_rank,
      group_id = EXCLUDED.group_id,
      active = EXCLUDED.active,
      updated_at = EXCLUDED.updated_at
  `,
    [
      p.id,
      p.tournament_id,
      p.name,
      p.seed,
      p.final_rank,
      p.group_id,
      p.active,
      p.created_at,
      p.updated_at,
    ]
  );
}

async function upsertMatch(m) {
  await pool.query(
    `
    INSERT INTO matches (
      id, tournament_id, state, round, group_id, identifier,
      player1_id, player2_id, winner_id, loser_id, scores_csv,
      started_at, completed_at, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11,
      $12, $13, $14, $15
    )
    ON CONFLICT (id) DO UPDATE SET
      state = EXCLUDED.state,
      round = EXCLUDED.round,
      group_id = EXCLUDED.group_id,
      identifier = EXCLUDED.identifier,
      winner_id = EXCLUDED.winner_id,
      loser_id = EXCLUDED.loser_id,
      scores_csv = EXCLUDED.scores_csv,
      started_at = EXCLUDED.started_at,
      completed_at = EXCLUDED.completed_at,
      updated_at = EXCLUDED.updated_at
  `,
    [
      m.id,
      m.tournament_id,
      m.state,
      m.round,
      m.group_id,
      m.identifier,
      m.player1_id,
      m.player2_id,
      m.winner_id,
      m.loser_id,
      m.scores_csv,
      m.started_at,
      m.completed_at,
      m.created_at,
      m.updated_at,
    ]
  );
}

// check if any thing changes
async function isTournamentChanged(id, updatedAt) {
  const res = await pool.query(
    `SELECT updated_at FROM tournaments WHERE challonge_id = $1`,
    [id]
  );

  if (res.rowCount === 0) return true;

  const dbUpdatedAt = res.rows[0].updated_at;
  return (
    new Date(updatedAt).toISOString().slice(0, 19) !==
    new Date(dbUpdatedAt).toISOString().slice(0, 19)
  );
}

// Return an array of changed match objects, or empty array if none changed
async function getChangedMatches(tournamentId, matchesFromAPI) {
  const { rows: existingMatches } = await pool.query(
    `SELECT id, updated_at FROM matches WHERE tournament_id = $1`,
    [tournamentId]
  );

  // console.log("Existing matches from DB:", existingMatches);

  const existingMap = new Map(
    existingMatches.map((m) => [
      String(m.id),
      new Date(m.updated_at).toISOString().slice(0, 19),
    ])
  );

  const changedMatches = [];

  for (const m of matchesFromAPI) {
    const matchId = String(m.match.id);
    const existingUpdated = existingMap.get(matchId);
    const apiUpdated = new Date(m.match.updated_at).toISOString().slice(0, 19);

    // console.log(
    //   `Match ID: ${matchId}, DB updated_at: ${existingUpdated}, API updated_at: ${apiUpdated}`
    // );

    if (!existingUpdated || existingUpdated !== apiUpdated) {
      changedMatches.push(m.match);
    }
  }

  return changedMatches;
}

async function getChangedParticipants(tournamentId, participantsFromAPI) {
  const { rows: existingParticipants } = await pool.query(
    `SELECT id, updated_at FROM participants WHERE tournament_id = $1`,
    [tournamentId]
  );

  // Normalize by removing milliseconds from date for comparison
  function normalizeTime(time) {
    const d = new Date(time);
    d.setMilliseconds(0);
    return d.getTime(); // or d.toISOString().slice(0,19) for string comparison
  }

  // Map of participant id => normalized updated_at timestamp (without milliseconds)
  const existingMap = new Map(
    existingParticipants.map((p) => [String(p.id), normalizeTime(p.updated_at)])
  );

  const changed = [];

  for (const p of participantsFromAPI) {
    const id = String(p.participant.id);
    const apiUpdated = normalizeTime(p.participant.updated_at);
    const dbUpdated = existingMap.get(id);

    if (!dbUpdated || dbUpdated !== apiUpdated) {
      changed.push(p.participant);
    }
  }

  return changed;
}

async function syncAllTournaments() {
  const tournaments = await getAllTournaments();

  for (const t of tournaments) {
    const tid = t.tournament.id;
    const updatedAt = t.tournament.updated_at;

    const shouldUpdateTournament = await isTournamentChanged(tid, updatedAt);
    const matches = await getMatches(tid);
    const participants = await getParticipants(tid);
    const changedParticipants = await getChangedParticipants(tid, participants);
    const changedMatches = await getChangedMatches(tid, matches);

    // ❗️If nothing changed, skip everything
    if (
      !shouldUpdateTournament &&
      changedMatches.length === 0 &&
      changedParticipants.length === 0
    ) {
      console.log(`⏩ Skipped everything for tournament: ${t.tournament.name}`);
      continue;
    }

    // ⬆️ Update tournament if needed
    if (shouldUpdateTournament) {
      await upsertTournament(t.tournament);
      console.log(`⬆️  Updated tournament: ${t.tournament.name}`);
    }

    // 🏁 Update changed matches
    if (changedMatches.length > 0) {
      for (const m of changedMatches) {
        await upsertMatch(m);
        console.log(
          `⬆️  Upserted Match: ${m.id} in tournament ${t.tournament.name}`
        );
      }
    }

    // 👤 Update changed participants
    if (changedParticipants.length > 0) {
      for (const p of changedParticipants) {
        await upsertParticipant(p);
        console.log(
          `⬆️  Upserted Participant: ${p.name} in tournament ${t.tournament.name}`
        );
      }
    }
    console.log("matches length ", changedMatches.length);
    console.log(changedParticipants.length);
  }

  console.log("✅ Finished syncing Challonge tournaments to PostgreSQL");
}

async function scheduleSync() {
  try {
    await syncAllTournaments();
  } catch (err) {
    console.error("Sync error:", err);
  }

  // Schedule next run after 1 minute
  setTimeout(scheduleSync, 60 * 1000);
}

// Start initial sync loop
// scheduleSync();

module.exports = { syncAllTournaments };
