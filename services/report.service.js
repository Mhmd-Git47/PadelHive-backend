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
  const result = await pool.query("SELECT * FROM reports;");
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

module.exports = {
  createReport,
  getReportsByUserId,
  getReports,
};
