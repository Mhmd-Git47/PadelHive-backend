const pool = require("../db");
const { AppError } = require("../utils/errors");

const getActorDetails = async (user_id, role) => {
  let query;
  let values = [user_id];

  if (role === "company_admin") {
    query = "SELECT id, owner_name AS name FROM companies WHERE admin_id = $1";
  } else if (role === "location_admin") {
    const adminRes = await pool.query(
      `SELECT location_id FROM admins WHERE id = $1`,
      [user_id]
    );
    values = [adminRes.rows[0].location_id];
    query = "SELECT id, name FROM locations WHERE id = $1";
  } else {
    throw new AppError("Invalid user role for activity logging.", 400);
  }

  const { rows } = await pool.query(query, values);
  if (!rows.length) throw new Error("Actor not found.");

  return rows[0]; // { id, name, role }
};

const createActivityLog = async (
  {
    scope = "company",
    company_id = null,
    actor_id,
    actor_name,
    actor_role,
    action_type,
    entity_type = null,
    entity_id = null,
    description = null,
    status = "Success",
  },
  client = null
) => {
  const query = `
    INSERT INTO activity_logs 
    (scope, company_id, actor_id, actor_name, actor_role, action_type, entity_type, entity_id, description, status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *;
  `;

  const values = [
    scope,
    company_id,
    actor_id,
    actor_name,
    actor_role,
    action_type,
    entity_type,
    entity_id,
    description,
    status,
  ];

  try {
    const executor = client || pool;
    const { rows } = await executor.query(query, values);
    return rows[0];
  } catch (err) {
    console.error("❌ Error inserting activity log:", err.message);
    throw err;
  }
};

const getSuperAdmLog = async () => {
  const query = `
        SELECT * FROM activity_logs WHERE scope = $1 OR scope = $2 ORDER BY created_at desc
    `;

  const result = await pool.query(query, ["superadmin", "both"]);
  return result.rows;
};

const getCompanyAdmLog = async (companyId) => {
  const query = `
        SELECT * FROM activity_logs WHERE scope = $1 OR scope = $2 AND company_id = $3 ORDER BY created_at desc
    `;

  const result = await pool.query(query, ["company", "both", companyId]);
  return result.rows;
};

module.exports = {
  createActivityLog,
  getActorDetails,
  getSuperAdmLog,
  getCompanyAdmLog,
};
