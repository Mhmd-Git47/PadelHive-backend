const pool = require("../db");
const { createActivityLog, getActorDetails } = require("./activityLog.service");

const createReport = async (reporterId, reportedId, reason, reporterRole) => {
  const actor = await getActorDetails(reporterId, reporterRole);
  try {
    const query = `
          INSERT INTO reports (reporter_id, reported_id, reason)
          VALUES ($1, $2, $3)
          RETURNING *;
      `;
    const values = [reporterId, reportedId, reason];
    const result = await pool.query(query, values);

    await createActivityLog({
      scope: "superadmin",
      company_id: null,
      actor_id: reportedId,
      actor_name: actor.name ?? "Unknown",
      actor_role: reporterRole,
      action_type: "ADD_REPORT",
      entity_type: "report",
      entity_id: result.rows[0].id,
      description: `Report created by ${
        actor.name ?? "Unknown"
      } (id: ${reporterId}) against user id ${reportedId}. Reason: ${reason}`,
      status: "Success",
    });

    return result.rows[0];
  } catch (err) {
    await createActivityLog({
      scope: "superadmin",
      company_id: null,
      actor_id: reportedId,
      actor_name: actor.name,
      actor_role: reporterRole,
      action_type: "ADD_REPORT_FAILED",
      entity_type: "report",
      entity_id: result.rows[0].id,
      description: `Report created by ${
        actor.name ?? "Unknown"
      } (id: ${reporterId}) against user id ${reportedId}. Reason: ${reason}`,
      status: "Failed",
    });
    console.error(err.message);
  }
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
