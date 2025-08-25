const pool = require("../db");
const {
  createInitialStagesForTournament,
  deleteStagesByTournamentId,
} = require("./stage.service");

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
    open_signup = true,
    private: isPrivate = false,
    poster_url,
  } = tournamentData;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

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
        open_signup,
        private,
        poster_url,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21, $22, $23, $24,
        NOW(), NOW()
      )
      RETURNING *;
    `,
      [
        name,
        description,
        category,
        Number(max_allowed_teams),
        tournament_type,
        tournament_format,
        Number(participants_per_group),
        Number(participants_advance),
        final_stage_format,
        ranked_by,
        registration_deadline,
        registration_type,
        Number(registration_fee),
        payment_deadline,
        Number(prize_pool),
        Number(prize_1st),
        Number(prize_2nd),
        Number(prize_3rd),
        Number(prize_mvp),
        start_at,
        company_id,
        open_signup,
        isPrivate,
        poster_url,
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
  const tournaments = await pool.query(`SELECT * FROM tournaments ORDER BY id`);
  return tournaments.rows;
};

const getTournamentsByCompanyId = async (companyId) => {
  const tournaments = await pool.query(
    `
    SELECT * FROM tournaments WHERE company_id = $1 ORDER BY created_at DESC`,
    [companyId]
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

module.exports = {
  createTournament,
  updateTournament,
  getAllTournaments,
  getTournamentById,
  getTournamentsByCompanyId,
  deleteTournament,
};
