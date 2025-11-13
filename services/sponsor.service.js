const pool = require("../db");
const { AppError } = require("../utils/errors");

const createSponsor = async (sponsorData) => {
  const { company_id, name, logo_url, is_featured } = sponsorData;
  const result = await pool.query(
    `INSERT INTO sponsors (company_id, name, logo_url, is_featured)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [company_id, name, logo_url, is_featured]
  );
  return result.rows[0];
};

const updateSponsor = async (id, updateData) => {
  if (Object.keys(updateData).length === 0) {
    throw new AppError(`No fields provided to update`, 401);
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
  // 1️⃣ Fetch tournament details
  const tournamentRes = await pool.query(
    `SELECT show_all_sponsors, company_id, featured_sponsor_id
     FROM tournaments
     WHERE id = $1`,
    [tournamentId]
  );

  const tournament = tournamentRes.rows[0];
  if (!tournament) throw new Error("Tournament not found");

  // 2️⃣ Get sponsors based on show_all_sponsors
  let sponsors;
  if (tournament.show_all_sponsors) {
    const result = await pool.query(
      `SELECT * FROM sponsors
       WHERE company_id = $1 AND is_featured = false
       ORDER BY name ASC`,
      [tournament.company_id]
    );
    sponsors = result.rows;
  } else {
    const result = await pool.query(
      `SELECT s.*
       FROM sponsors s
       JOIN tournament_sponsors ts ON ts.sponsor_id = s.id
       WHERE ts.tournament_id = $1
       ORDER BY ts.display_order NULLS LAST, s.name ASC`,
      [tournamentId]
    );
    sponsors = result.rows;
  }

  // 3️⃣ If there’s a featured sponsor → fetch it
  let featuredSponsor = null;
  if (tournament.featured_sponsor_id) {
    const featuredRes = await pool.query(
      `SELECT * FROM sponsors WHERE id = $1`,
      [tournament.featured_sponsor_id]
    );
    featuredSponsor = featuredRes.rows[0] || null;
  }

  // 4️⃣ Return both
  return {
    featured: featuredSponsor,
    sponsors,
  };
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
