const pool = require("../db");

const createSponsor = async (sponsorData) => {
  const { company_id, name, logo_url } = sponsorData;
  const result = await pool.query(
    `INSERT INTO sponsors (company_id, name, logo_url)
     VALUES ($1, $2, $3) RETURNING *`,
    [company_id, name, logo_url]
  );
  return result.rows[0];
};

const updateSponsor = async (id, updateData) => {
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

  const result = await pool.query(
    `UPDATE sponsors SET ${fields.join(", ")}
     WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0];
};

const deleteSponsor = async (id) => {
  const result = await pool.query(`DELETE FROM sponsors WHERE id = $1`, [id]);
  return result.rowCount > 0;
};

const getSponsorsByCompanyId = async (companyId) => {
  const result = await pool.query(
    `SELECT * FROM sponsors WHERE company_id = $1`,
    [companyId]
  );
  return result.rows;
};

const getSponsorById = async (id) => {
  const result = await pool.query(`SELECT * FROM sponsors WHERE id = $1`, [id]);
  return result.rows[0];
};

// tournament_sponsors table
const addSponsorToTournament = async (tournamentId, sponsorId) => {
  // Use ON CONFLICT (Postgres equivalent to MySQL's ON DUPLICATE KEY UPDATE)
  const result = await pool.query(
    `INSERT INTO tournament_sponsors (tournament_id, sponsor_id, visible)
     VALUES ($1, $2, true)
     ON CONFLICT (tournament_id, sponsor_id) DO UPDATE SET visible = true
     RETURNING *`,
    [tournamentId, sponsorId]
  );
  return result.rows[0];
};

const removeSponsorFromTournament = async (tournamentId, sponsorId) => {
  const result = await pool.query(
    `DELETE FROM tournament_sponsors
     WHERE tournament_id = $1 AND sponsor_id = $2`,
    [tournamentId, sponsorId]
  );
  return result.rowCount > 0;
};

const getSponsorsByTournament = async (tournamentId) => {
  const result = await pool.query(
    `SELECT s.*
     FROM sponsors s
     JOIN tournament_sponsors ts ON ts.sponsor_id = s.id
     WHERE ts.tournament_id = $1`,
    [tournamentId]
  );
  return result.rows;
};

const getSponsorsWithVisibilityByCompany = async (tournamentId, companyId) => {
  const result = await pool.query(
    `SELECT s.*, COALESCE(ts.visible, false) AS is_shown
     FROM sponsors s
     LEFT JOIN tournament_sponsors ts
       ON s.id = ts.sponsor_id AND ts.tournament_id = $1
     WHERE s.company_id = $2`,
    [tournamentId, companyId]
  );
  return result.rows;
};

module.exports = {
  createSponsor,
  updateSponsor,
  deleteSponsor,
  getSponsorsByTournament,
  getSponsorsByCompanyId,
  getSponsorById,
  addSponsorToTournament,
  removeSponsorFromTournament,
  getSponsorsWithVisibilityByCompany,
};
