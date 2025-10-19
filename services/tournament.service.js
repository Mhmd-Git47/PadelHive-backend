const pool = require("../db");
const {
  createInitialStagesForTournament,
  deleteStagesByTournamentId,
} = require("./stage.service");

const tournamentHelper = require("../helpers/tournament.helper");

// tournament
const createTournament = async (tournamentData) => {
  const {
    name,
    description,
    category,
    max_allowed_teams,
    tournament_type,
    tournament_format,
    participants_per_group,
    participants_advance,
    final_stage_format,
    ranked_by,
    registration_deadline,
    registration_type,
    registration_fee,
    payment_deadline,
    prize_pool,
    prize_1st,
    prize_2nd,
    prize_3rd,
    prize_mvp,
    start_at,
    company_id,
    location_id,
    open_registration = true,
    private: isPrivate = false,
    poster_url,
    competition_type,
  } = tournamentData;

  const client = await pool.connect();

  // Helper to safely convert values to integers or null
  const toInt = (val) => (val != null ? Number(val) : null);

  if (
    competition_type !== "friendly" &&
    competition_type !== "competitive" &&
    competition_type === null
  ) {
    throw new Error(`Invalid competition type.`);
  }

  try {
    await client.query("BEGIN");

    // Get Elo rate from category; may return null
    const eloRate =
      (await tournamentHelper.getEloRateForTournament({ category })) ?? null;

    const tournamentResult = await client.query(
      `
      INSERT INTO tournaments (
        name,
        description,
        category,
        max_allowed_teams,
        tournament_type,
        tournament_format,
        participants_per_group,
        participants_advance,
        final_stage_format,
        ranked_by,
        registration_deadline,
        registration_type,
        registration_fee,
        payment_deadline,
        prize_pool,
        prize_1st,
        prize_2nd,
        prize_3rd,
        prize_mvp,
        start_at,
        company_id,
        open_registration,
        private,
        poster_url,
        created_at,
        updated_at,
        max_allowed_elo_rate,
        state,
        competition_type,
        location_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21, $22, $23, $24,
        NOW(), NOW(), $25, $26, $27, $28
      )
      RETURNING *;
    `,
      [
        name,
        description,
        category,
        toInt(max_allowed_teams),
        tournament_type,
        tournament_format,
        toInt(participants_per_group),
        toInt(participants_advance),
        final_stage_format,
        ranked_by,
        registration_deadline,
        registration_type,
        toInt(registration_fee),
        payment_deadline,
        toInt(prize_pool),
        toInt(prize_1st),
        toInt(prize_2nd),
        toInt(prize_3rd),
        toInt(prize_mvp),
        start_at,
        company_id,
        open_registration,
        isPrivate,
        poster_url,
        eloRate,
        "pending",
        competition_type,
        location_id,
      ]
    );

    const tournament = tournamentResult.rows[0];

    // Create stages based on tournament type
    await createInitialStagesForTournament(
      client,
      tournament.id,
      tournament.tournament_format
    );

    await client.query("COMMIT");
    return tournament;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error creating tournament:", err);
    throw err;
  } finally {
    client.release();
  }
};

const updateTournament = async (id, updateData) => {
  if (Object.keys(updateData).length === 0) {
    throw new Error(`No fields provided to update`);
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

  const query = `
    UPDATE tournaments SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *;
  `;

  const result = await pool.query(query, values);
  return result.rows[0];
};

const getAllTournaments = async () => {
  const result = await pool.query(
    `SELECT * 
     FROM tournaments 
     WHERE private = $1 
       AND state != $2
       
     ORDER BY start_at ASC`,
    [false, "completed"]
  );
  return result.rows;
};

const getTournamentsByCompanyId = async (companyId) => {
  const tournaments = await pool.query(
    `
    SELECT * FROM tournaments WHERE company_id = $1 ORDER BY created_at DESC`,
    [companyId]
  );
  return tournaments.rows;
};

const getTournamentsByLocationId = async (locationId) => {
  const tournaments = await pool.query(
    `
    SELECT * FROM tournaments WHERE location_id = $1 ORDER BY created_at DESC`,
    [locationId]
  );
  return tournaments.rows;
};

const getTournamentById = async (id) => {
  const tournament = await pool.query(
    `SELECT * FROM tournaments WHERE id = $1`,
    [id]
  );

  return tournament.rows[0];
};

const deleteTournament = async (id) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // await deleteStagesByTournamentId(id, client);

    const result = await client.query("DELETE FROM tournaments WHERE id = $1", [
      id,
    ]);

    await client.query("COMMIT");

    if (result.rowCount === 0) {
      return { notFound: true };
    }

    return { success: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// user_tournaments_history
const getTournamentsByUserId = async (userId) => {
  const tournaments = await pool.query(
    `
    SELECT id, tournament_id, participant_id, registered_at, completed_at, cancelled_at,placement
    FROM user_tournaments_history
    WHERE user_id = $1
    ORDER BY registered_at DESC;
  `,
    [userId]
  );

  return tournaments.rows;
};

const isUserRegisteredToTournament = async (userId, tournamentId) => {
  const result = await pool.query(
    `SELECT COUNT(*) AS count 
     FROM user_tournaments_history 
     WHERE user_id = $1 AND tournament_id = $2 AND status = 'registered'`,
    [userId, tournamentId]
  );

  // result.rows[0].count is a string, convert to number
  return Number(result.rows[0].count) > 0;
};

module.exports = {
  createTournament,
  updateTournament,
  getAllTournaments,
  getTournamentById,
  getTournamentsByCompanyId,
  getTournamentsByLocationId,
  deleteTournament,
  getTournamentsByUserId,
  isUserRegisteredToTournament,
};
