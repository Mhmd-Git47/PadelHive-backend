const pool = require("../db");

const createReport = async (reporterId, reportedId, reason) => {
  const query = `
        INSERT INTO reports (reporter_id, reported_id, reason)
        VALUES ($1, $2, $3)
        RETURNING *;
    `;
  const values = [reporterId, reportedId, reason];
  const result = await pool.query(query, values);
  return result.rows[0];
};

const getReports = async () => {
  const result = await pool.query(
    "SELECT * FROM reports ORDER BY created_at desc"
  );
  return result.rows;
};

const getReportsByUserId = async (userId) => {
  const query = `
        SELECT * FROM reports
        WHERE reporter_id = $1 OR reported_id = $1;
    `;
  const values = [userId];
  const result = await pool.query(query, values);
  return result.rows;
};

const updateReport = async (id, updatedData) => {
  if (Object.keys(updatedData).length === 0) {
    throw new Error(`No Fields provided to update`);
  }

  const fields = [];
  const values = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updatedData)) {
    fields.push(`${key} = $${idx}`);
    values.push(value);
    idx++;
  }

  values.push(id);

  // fields.push(`updated_at = NOW()`);
  const query = `
    UPDATE reports SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *;
  `;

  const result = await pool.query(query, values);
  return result.rows[0];
};

const deleteReport = async (id) => {
  const result = await pool.query(`DELETE FROM reports WHERE id = $1`, [id]);
  return result;
};

module.exports = {
  createReport,
  getReportsByUserId,
  getReports,
  updateReport,
  deleteReport,
};
