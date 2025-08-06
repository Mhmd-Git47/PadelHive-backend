const pool = require("../db");
const { createInitialStagesForTournament } = require("./stage.service");

// tournament
const createTournament = async (tournamentData) => {
  const {
    name,
    description,
    tournament_type,
    start_at,
    created_at,
    updated_at,
    category,
    company_id,
  } = tournamentData;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Insert tournament
    const tournamentResult = await client.query(
      `
      INSERT INTO tournaments (
        name, description, tournament_type, start_at, created_at, updated_at, category, company_id
      ) VALUES ($1, $2, $3, $4, NOW(), NOW(), $5, $6)
      RETURNING *;
    `,
      [name, description, tournament_type, start_at, category, company_id]
    );

    const tournament = tournamentResult.rows[0];

    // Call helper to create stages
    // for now only round robin two stages
    await createInitialStagesForTournament(
      client,
      tournament.id,
      tournament.tournament_type
    );

    await client.query("COMMIT");
    return tournament;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

const updateTournament = async (id, updateData) => {
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

module.exports = {
  createTournament,
  updateTournament,
  getAllTournaments,
  getTournamentById,
  getTournamentsByCompanyId,
};
